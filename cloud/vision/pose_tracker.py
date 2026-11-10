"""
Multi-Hazard Pose Tracker (`cloud/vision/pose_tracker.py`).
Supports both Ultralytics YOLO11-Pose (17 COCO keypoints) and MediaPipe Pose (33 keypoints)
to evaluate geometric posture anomalies:
  - Low Posture / Fall ("low_posture")
  - Trigger A: Distress Gesture - Chest or Head Clutching ("chest_head_clutching")
  - Trigger B: Seated Slumping / Head Drop ("head_slump")
  - Keypoint & shoulder-hip sway extraction for Trigger C ("erratic_motion" / "impact_immobility")
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
from ultralytics import YOLO

import config


@dataclass
class PersonDetection:
    """
    Represents a single tracked person and their Tier 1 multi-hazard geometric
    and temporal telemetry.
    """
    track_id: int
    bbox: tuple[int, int, int, int]          # (x1, y1, x2, y2)
    confidence: float
    keypoints: np.ndarray                    # Shape: (17, 3) or (33, 3) -> [x, y, conf]
    aspect_ratio: float
    torso_angle_deg: float | None
    torso_vertical_ratio: float | None
    nose_shoulder_vertical_ratio: float | None = None
    min_wrist_to_chest_ratio: float | None = None
    min_wrist_to_head_ratio: float | None = None
    shoulder_hip_dx_ratio: float | None = None
    in_bed_zone: bool = False
    keypoint_velocity: float = 0.0
    is_suspected_anomaly: bool = False
    primary_trigger_reason: str | None = None
    trigger_codes: list[str] = field(default_factory=list)
    anomaly_reasons: list[str] = field(default_factory=list)
    behavior_state: str = "NORMAL"


class PoseTracker:
    """
    Executes pose estimation & tracking and evaluates multi-hazard geometric
    triggers (Low Posture, Trigger A: Chest/Head Clutching, Trigger B: Seated Head Slump).
    Supports both 17-keypoint COCO format and 33-keypoint MediaPipe Pose format.
    """

    def __init__(
        self,
        model_path: str = config.YOLO_MODEL_NAME,
        bed_zone_norm: tuple[float, float, float, float] | None = config.BED_ZONE_NORM,
    ) -> None:
        self.model_path = model_path
        self.model = YOLO(model_path)
        self.bed_zone_norm = bed_zone_norm

    def reset_tracker(self) -> None:
        """Resets the internal ByteTrack state when switching between different videos."""
        if hasattr(self.model, "predictor") and self.model.predictor is not None:
            self.model.predictor = None

    @staticmethod
    def _resolve_keypoint_indices(num_kps: int) -> dict[str, Sequence[int]]:
        """
        Maps semantic body parts to keypoint indices depending on whether the
        skeleton has 33 keypoints (MediaPipe Pose) or 17 keypoints (COCO / YOLO-Pose).
        """
        if num_kps >= 33:
            return {
                "nose": (config.MP_NOSE,),
                "head": config.MP_HEAD_INDICES,            # 0..10
                "shoulders": (config.MP_LEFT_SHOULDER, config.MP_RIGHT_SHOULDER),  # 11, 12
                "wrists": (config.MP_LEFT_WRIST, config.MP_RIGHT_WRIST),           # 15, 16
                "hips": (config.MP_LEFT_HIP, config.MP_RIGHT_HIP),                 # 23, 24
            }
        return {
            "nose": (config.KP_NOSE,),
            "head": config.COCO_HEAD_INDICES,              # 0..4
            "shoulders": (config.KP_LEFT_SHOULDER, config.KP_RIGHT_SHOULDER),      # 5, 6
            "wrists": (config.KP_LEFT_WRIST, config.KP_RIGHT_WRIST),               # 9, 10
            "hips": (config.KP_LEFT_HIP, config.KP_RIGHT_HIP),                     # 11, 12
        }

    @staticmethod
    def _is_valid_kp(kp: np.ndarray) -> bool:
        return (
            float(kp[2]) >= config.KEYPOINT_CONF_THRESHOLD
            and float(kp[0]) > 0.0
            and float(kp[1]) > 0.0
        )

    @classmethod
    def _get_midpoint(
        cls, kps: np.ndarray, idx_a: int, idx_b: int
    ) -> tuple[float, float] | None:
        """Computes the midpoint between two keypoints if valid, or falls back to one side."""
        if idx_a >= len(kps) or idx_b >= len(kps):
            return None
        kp_a = kps[idx_a]
        kp_b = kps[idx_b]
        valid_a = cls._is_valid_kp(kp_a)
        valid_b = cls._is_valid_kp(kp_b)

        if valid_a and valid_b:
            return (
                (float(kp_a[0]) + float(kp_b[0])) / 2.0,
                (float(kp_a[1]) + float(kp_b[1])) / 2.0,
            )
        if valid_a:
            return (float(kp_a[0]), float(kp_a[1]))
        if valid_b:
            return (float(kp_b[0]), float(kp_b[1]))
        return None

    @classmethod
    def _get_valid_points(
        cls, kps: np.ndarray, indices: Sequence[int]
    ) -> list[tuple[float, float]]:
        pts: list[tuple[float, float]] = []
        for idx in indices:
            if idx < len(kps) and cls._is_valid_kp(kps[idx]):
                pts.append((float(kps[idx][0]), float(kps[idx][1])))
        return pts

    def is_in_bed_zone(
        self, bbox: tuple[int, int, int, int], frame_shape: tuple[int, int]
    ) -> bool:
        """Checks if the person's bounding box center lies inside the configured BED zone."""
        if not self.bed_zone_norm:
            return False
        bx1, by1, bx2, by2 = self.bed_zone_norm
        if bx2 <= bx1 or by2 <= by1:
            return False

        h, w = frame_shape[:2]
        x1, y1, x2, y2 = bbox
        cx_norm = ((x1 + x2) / 2.0) / max(1.0, float(w))
        cy_norm = ((y1 + y2) / 2.0) / max(1.0, float(h))
        return (bx1 <= cx_norm <= bx2) and (by1 <= cy_norm <= by2)

    def evaluate_pose_anomalies(
        self,
        bbox: tuple[int, int, int, int],
        kps: np.ndarray,
        in_bed_zone: bool = False,
    ) -> dict:
        """
        Evaluates multi-hazard geometric heuristics on a single person's keypoints:
          1. "low_posture": Aspect ratio > 1.15, torso angle < 45 deg, or torso vertical ratio < 0.25
          2. "chest_head_clutching" (Trigger A): Either wrist close to chest center or head/face
             accompanied by torso leaning, head dropping, or asymmetrical single-arm chest clutching
          3. "head_slump" (Trigger B): Vertical distance between nose and mid-shoulder drops
             significantly while outside the BED zone
        """
        x1, y1, x2, y2 = bbox
        width = max(1, x2 - x1)
        height = max(1, y2 - y1)

        idx_map = self._resolve_keypoint_indices(len(kps))
        sh_a, sh_b = idx_map["shoulders"]
        hp_a, hp_b = idx_map["hips"]
        wr_a, wr_b = idx_map["wrists"]

        mid_shoulder = self._get_midpoint(kps, sh_a, sh_b)
        mid_hip = self._get_midpoint(kps, hp_a, hp_b)
        head_pts = self._get_valid_points(kps, idx_map["head"])
        wrist_pts = self._get_valid_points(kps, idx_map["wrists"])
        nose_pts = self._get_valid_points(kps, idx_map["nose"])
        nose_pt = nose_pts[0] if nose_pts else (head_pts[0] if head_pts else None)

        trigger_codes: list[str] = []
        reasons: list[str] = []

        # ------------------------------------------------------------------
        # 1. Low Posture / Fall Heuristics ("low_posture")
        # ------------------------------------------------------------------
        aspect_ratio = float(width) / float(height)
        low_posture_reasons: list[str] = []
        if aspect_ratio > config.BBOX_ASPECT_RATIO_THRESHOLD:
            low_posture_reasons.append(
                f"AR={aspect_ratio:.2f}>{config.BBOX_ASPECT_RATIO_THRESHOLD}"
            )

        torso_angle_deg: float | None = None
        torso_vertical_ratio: float | None = None
        shoulder_hip_dx_ratio: float | None = None

        if mid_shoulder is not None and mid_hip is not None:
            dx_signed = mid_shoulder[0] - mid_hip[0]
            dx = abs(dx_signed)
            dy = abs(mid_shoulder[1] - mid_hip[1])
            torso_angle_deg = math.degrees(math.atan2(dy, max(dx, 1e-5)))
            torso_vertical_ratio = dy / float(height)
            shoulder_hip_dx_ratio = dx_signed / float(height)

            if torso_angle_deg < config.TORSO_ANGLE_DEG_THRESHOLD:
                low_posture_reasons.append(
                    f"Angle={torso_angle_deg:.1f}deg<{config.TORSO_ANGLE_DEG_THRESHOLD}deg"
                )
            if torso_vertical_ratio < config.TORSO_VERTICAL_RATIO_THRESHOLD:
                low_posture_reasons.append(
                    f"TorsoH={torso_vertical_ratio * 100:.1f}%<{config.TORSO_VERTICAL_RATIO_THRESHOLD * 100:.0f}%"
                )

        if low_posture_reasons and not in_bed_zone:
            trigger_codes.append("low_posture")
            reasons.extend(low_posture_reasons)

        # ------------------------------------------------------------------
        # Head-to-Shoulder Vertical Ratio (used by Trigger A & Trigger B)
        # ------------------------------------------------------------------
        nose_shoulder_vertical_ratio: float | None = None
        if nose_pt is not None and mid_shoulder is not None:
            nose_shoulder_vertical_ratio = (mid_shoulder[1] - nose_pt[1]) / float(height)

        # ------------------------------------------------------------------
        # 2. Trigger A - Distress Gesture: Stroke / Heart Attack ("chest_head_clutching")
        # ------------------------------------------------------------------
        min_wrist_to_chest_ratio: float | None = None
        min_wrist_to_head_ratio: float | None = None

        if wrist_pts and mid_shoulder is not None:
            if mid_hip is not None:
                chest_center = (
                    0.82 * mid_shoulder[0] + 0.18 * mid_hip[0],
                    0.82 * mid_shoulder[1] + 0.18 * mid_hip[1],
                )
            else:
                chest_center = (mid_shoulder[0], mid_shoulder[1] + 0.10 * height)

            chest_dists = [
                math.hypot(wx - chest_center[0], wy - chest_center[1]) / float(height)
                for (wx, wy) in wrist_pts
            ]
            min_wrist_to_chest_ratio = min(chest_dists)

        if wrist_pts and head_pts:
            head_dists = [
                math.hypot(wx - hx, wy - hy) / float(height)
                for (wx, wy) in wrist_pts
                for (hx, hy) in head_pts
            ]
            min_wrist_to_head_ratio = min(head_dists)

        # Check vertical wrist asymmetry (one hand raised to chest/head while the other rests lower)
        wrist_asymmetry_ratio = 0.0
        if wr_a < len(kps) and wr_b < len(kps) and self._is_valid_kp(kps[wr_a]) and self._is_valid_kp(kps[wr_b]):
            wrist_asymmetry_ratio = abs(float(kps[wr_a][1]) - float(kps[wr_b][1])) / float(height)

        is_torso_leaning = (
            torso_angle_deg is not None
            and torso_angle_deg < config.DISTRESS_TORSO_LEAN_DEG
        )
        is_head_dropping = (
            nose_shoulder_vertical_ratio is not None
            and nose_shoulder_vertical_ratio < config.DISTRESS_HEAD_DROP_RATIO
        )

        direct_chest_clutch = (
            min_wrist_to_chest_ratio is not None
            and min_wrist_to_chest_ratio < config.CLUTCH_CHEST_DIST_RATIO
            and (is_torso_leaning or (nose_shoulder_vertical_ratio is not None and nose_shoulder_vertical_ratio < 0.12))
        )
        asym_chest_clutch = (
            min_wrist_to_chest_ratio is not None
            and min_wrist_to_chest_ratio < config.CLUTCH_CHEST_ASYM_DIST_RATIO
            and wrist_asymmetry_ratio >= config.CLUTCH_WRIST_ASYMMETRY_RATIO
            and (is_head_dropping or is_torso_leaning)
        )
        head_clutch = (
            min_wrist_to_head_ratio is not None
            and min_wrist_to_head_ratio < config.CLUTCH_HEAD_DIST_RATIO
            and (is_torso_leaning or is_head_dropping)
        )

        if (
            (direct_chest_clutch or asym_chest_clutch or head_clutch)
            and not in_bed_zone
            and "low_posture" not in trigger_codes
        ):
            trigger_codes.append("chest_head_clutching")
            if (direct_chest_clutch or asym_chest_clutch) and min_wrist_to_chest_ratio is not None:
                reasons.append(f"ChestClutch={min_wrist_to_chest_ratio:.2f}")
            if head_clutch and min_wrist_to_head_ratio is not None:
                reasons.append(f"HeadClutch={min_wrist_to_head_ratio:.2f}")

        # ------------------------------------------------------------------
        # 3. Trigger B - Seated Slumping / Head Drop ("head_slump")
        # ------------------------------------------------------------------
        if (
            not in_bed_zone
            and height >= config.HEAD_SLUMP_MIN_BBOX_HEIGHT_PX
            and nose_shoulder_vertical_ratio is not None
            and nose_shoulder_vertical_ratio < config.HEAD_SLUMP_VERTICAL_RATIO_THRESHOLD
            and "low_posture" not in trigger_codes
            and "chest_head_clutching" not in trigger_codes
        ):
            trigger_codes.append("head_slump")
            reasons.append(
                f"HeadSlump={nose_shoulder_vertical_ratio * 100:.1f}%<{config.HEAD_SLUMP_VERTICAL_RATIO_THRESHOLD * 100:.1f}%"
            )

        primary_reason = trigger_codes[0] if trigger_codes else None

        return {
            "aspect_ratio": aspect_ratio,
            "torso_angle_deg": torso_angle_deg,
            "torso_vertical_ratio": torso_vertical_ratio,
            "nose_shoulder_vertical_ratio": nose_shoulder_vertical_ratio,
            "min_wrist_to_chest_ratio": min_wrist_to_chest_ratio,
            "min_wrist_to_head_ratio": min_wrist_to_head_ratio,
            "shoulder_hip_dx_ratio": shoulder_hip_dx_ratio,
            "trigger_codes": trigger_codes,
            "primary_trigger_reason": primary_reason,
            "anomaly_reasons": reasons,
            "is_suspected_anomaly": len(trigger_codes) > 0,
        }

    def process_frame(self, frame: np.ndarray) -> list[PersonDetection]:
        """
        Runs YOLO11-Pose tracking with ByteTrack on a BGR video frame and returns
        PersonDetection telemetry for each tracked person.
        """
        results = self.model.track(
            source=frame,
            persist=True,
            classes=[config.PERSON_CLASS_ID],
            conf=config.YOLO_CONF_THRESHOLD,
            verbose=False,
        )

        detections: list[PersonDetection] = []
        if not results or len(results) == 0:
            return detections

        result = results[0]
        if result.boxes is None or result.keypoints is None:
            return detections

        boxes = result.boxes
        keypoints_data = result.keypoints.data.cpu().numpy()  # (N, 17, 3)
        xyxy_boxes = boxes.xyxy.cpu().numpy()                 # (N, 4)
        confs = boxes.conf.cpu().numpy()                      # (N,)

        if boxes.id is not None:
            track_ids = boxes.id.int().cpu().tolist()
        else:
            track_ids = list(range(1, len(xyxy_boxes) + 1))

        for idx, track_id in enumerate(track_ids):
            x1, y1, x2, y2 = map(int, xyxy_boxes[idx])
            conf = float(confs[idx])
            kps = keypoints_data[idx]
            in_bed = self.is_in_bed_zone((x1, y1, x2, y2), frame.shape[:2])

            eval_res = self.evaluate_pose_anomalies(
                bbox=(x1, y1, x2, y2),
                kps=kps,
                in_bed_zone=in_bed,
            )

            detections.append(
                PersonDetection(
                    track_id=track_id,
                    bbox=(x1, y1, x2, y2),
                    confidence=conf,
                    keypoints=kps,
                    aspect_ratio=eval_res["aspect_ratio"],
                    torso_angle_deg=eval_res["torso_angle_deg"],
                    torso_vertical_ratio=eval_res["torso_vertical_ratio"],
                    nose_shoulder_vertical_ratio=eval_res["nose_shoulder_vertical_ratio"],
                    min_wrist_to_chest_ratio=eval_res["min_wrist_to_chest_ratio"],
                    min_wrist_to_head_ratio=eval_res["min_wrist_to_head_ratio"],
                    shoulder_hip_dx_ratio=eval_res["shoulder_hip_dx_ratio"],
                    in_bed_zone=in_bed,
                    is_suspected_anomaly=eval_res["is_suspected_anomaly"],
                    primary_trigger_reason=eval_res["primary_trigger_reason"],
                    trigger_codes=eval_res["trigger_codes"],
                    anomaly_reasons=eval_res["anomaly_reasons"],
                    behavior_state=(
                        "SUSPECTED_ANOMALY" if eval_res["is_suspected_anomaly"] else "NORMAL"
                    ),
                )
            )

        return detections
