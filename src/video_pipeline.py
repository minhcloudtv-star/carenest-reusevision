"""
Main Multi-Hazard Video Analytics Pipeline.
Coordinates the rolling frame buffer, Tier 1 pose tracking (`cloud.vision.pose_tracker`),
multi-hazard behavior state machine (`cloud.behavior.state_machine`), Tier 2 Vision-LLM
reviewer (`cloud.behavior.vlm_reviewer`), OpenCV HUD rendering, and JSON event logging.
"""

from collections import deque
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

import config
from cloud.behavior.state_machine import MultiHazardStateMachine
from src.tier1_detector import PersonDetection, Tier1PoseDetector
from src.tier2_vlm_verifier import Tier2VLMVerifier, VLMVerificationResult

logger = logging.getLogger(__name__)

# COCO Skeleton Limb Pairs (0-indexed keypoint indices)
COCO_SKELETON_PAIRS: List[Tuple[int, int]] = [
    (5, 6),   # Shoulders
    (5, 7), (7, 9),   # Left arm
    (6, 8), (8, 10),  # Right arm
    (11, 12), # Hips
    (5, 11), (6, 12), # Torso sides
    (11, 13), (13, 15), # Left leg
    (12, 14), (14, 16), # Right leg
    (0, 1), (0, 2), (1, 3), (2, 4), # Head
]


class ElderlyFallPipeline:
    """
    End-to-end 2-Tier Hybrid Video Analytics Pipeline for Multi-Hazard Elderly
    Anomaly Detection (Falls, Stroke/Cardiac Distress, Unconscious Slumping,
    and Domestic Accidents/Immobility).
    """

    def __init__(
        self,
        yolo_model: str = config.YOLO_MODEL_NAME,
        vlm_model: str = config.DEFAULT_VLM_MODEL,
        mock_vlm: bool = False,
    ) -> None:
        self.detector = Tier1PoseDetector(model_path=yolo_model)
        self.verifier = Tier2VLMVerifier(model_name=vlm_model, mock_mode=mock_vlm)
        self.events_log: List[Dict] = self._load_existing_events()

    @staticmethod
    def _load_existing_events() -> List[Dict]:
        """Loads existing events from outputs/events_log.json if present."""
        if config.EVENTS_LOG_PATH.exists():
            try:
                with open(config.EVENTS_LOG_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        return data
            except Exception as exc:
                logger.warning("Could not read existing events log: %s", exc)
        return []

    def _save_events_log(self) -> None:
        """Persists the structured event log to outputs/events_log.json."""
        config.EVENTS_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(config.EVENTS_LOG_PATH, "w", encoding="utf-8") as f:
            json.dump(self.events_log, f, indent=2)

    def process_video(self, video_path: Path) -> Dict:
        """
        Processes a single video file through the 2-Tier Multi-Hazard pipeline.
        """
        self.detector.reset_tracker()
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"Unable to open video file: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0 or np.isnan(fps):
            fps = 30.0

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        buffer_maxlen = max(2, int(round(config.BUFFER_SECONDS * fps)))
        state_machine = MultiHazardStateMachine(fps=fps)

        logger.info(
            "Processing '%s' (%dx%d @ %.1f FPS | Total Frames: %d | Buffer: %d frames | Trigger N: %d frames | Cooldown: %d frames)",
            video_path.name,
            width,
            height,
            fps,
            total_frames,
            buffer_maxlen,
            state_machine.persistence_frames_req,
            state_machine.cooldown_frames_req,
        )

        clean_frame_buffer: deque = deque(maxlen=buffer_maxlen)

        output_video_path = config.OUTPUT_VIDEOS_DIR / f"annotated_{video_path.stem}.mp4"
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(output_video_path), fourcc, fps, (width, height))

        latest_vlm_result: Optional[VLMVerificationResult] = None
        latest_vlm_track_id: Optional[int] = None
        latest_trigger_reason: Optional[str] = None
        video_events_triggered = 0

        frame_idx = 0
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                clean_frame = frame.copy()
                frame_a = (
                    clean_frame_buffer[0]
                    if len(clean_frame_buffer) > 0
                    else clean_frame
                )
                clean_frame_buffer.append(clean_frame)

                # Step 1: Tier 1 Pose Estimation & Geometric Heuristics
                detections = self.detector.process_frame(clean_frame)

                # Step 2: Multi-Hazard State Machine (Velocity + Persistence + Cooldown)
                trigger_events = state_machine.update(
                    frame_idx=frame_idx,
                    detections=detections,
                )

                # Step 3: Execute Tier 2 VLM Review for any triggered events
                for trig in trigger_events:
                    det = trig.detection
                    tid = trig.track_id
                    timestamp_sec = trig.video_timestamp_sec
                    snapshot_filename = (
                        f"{video_path.stem}_frame{frame_idx:05d}_track{tid}_{trig.tier1_trigger_reason}.jpg"
                    )
                    snapshot_path = config.SNAPSHOTS_DIR / snapshot_filename

                    logger.info(
                        "[Frame %d | %.2fs] Triggering Tier 2 VLM for Track ID %d | State=%s | Reason=%s (Streak: %d frames, Details: %s)",
                        frame_idx,
                        timestamp_sec,
                        tid,
                        trig.state,
                        trig.tier1_trigger_reason,
                        trig.consecutive_frames,
                        trig.anomaly_reasons,
                    )

                    stitched_img = self.verifier.create_stitched_evidence(
                        frame_a=frame_a,
                        frame_b=clean_frame,
                        save_path=snapshot_path,
                        tier1_trigger_reason=trig.tier1_trigger_reason,
                    )

                    vlm_result = self.verifier.verify_anomaly(
                        stitched_image=stitched_img,
                        tier1_trigger_reason=trig.tier1_trigger_reason,
                        reasons=trig.anomaly_reasons,
                    )

                    latest_vlm_result = vlm_result
                    latest_vlm_track_id = tid
                    latest_trigger_reason = trig.tier1_trigger_reason
                    video_events_triggered += 1

                    event_record = {
                        "video_file": video_path.name,
                        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
                        "video_timestamp_sec": timestamp_sec,
                        "frame_index": frame_idx,
                        "track_id": tid,
                        "state": trig.state,
                        "tier1_trigger_reason": trig.tier1_trigger_reason,
                        "tier1_metrics": {
                            "trigger_codes": trig.trigger_codes,
                            "aspect_ratio": round(det.aspect_ratio, 3),
                            "torso_angle_deg": (
                                round(det.torso_angle_deg, 2)
                                if det.torso_angle_deg is not None
                                else None
                            ),
                            "torso_vertical_ratio": (
                                round(det.torso_vertical_ratio, 3)
                                if det.torso_vertical_ratio is not None
                                else None
                            ),
                            "nose_shoulder_vertical_ratio": (
                                round(det.nose_shoulder_vertical_ratio, 3)
                                if det.nose_shoulder_vertical_ratio is not None
                                else None
                            ),
                            "min_wrist_to_chest_ratio": (
                                round(det.min_wrist_to_chest_ratio, 3)
                                if det.min_wrist_to_chest_ratio is not None
                                else None
                            ),
                            "min_wrist_to_head_ratio": (
                                round(det.min_wrist_to_head_ratio, 3)
                                if det.min_wrist_to_head_ratio is not None
                                else None
                            ),
                            "keypoint_velocity": round(det.keypoint_velocity, 3),
                            "anomaly_reasons": trig.anomaly_reasons,
                            "consecutive_frames": trig.consecutive_frames,
                        },
                        "snapshot_path": str(
                            snapshot_path.relative_to(config.BASE_DIR)
                        ),
                        "tier2_vlm_response": vlm_result.model_dump(),
                    }
                    self.events_log.append(event_record)
                    self._save_events_log()

                in_cooldown, cooldown_remaining_sec = state_machine.is_in_cooldown(
                    frame_idx
                )
                frame_has_suspected = any(d.is_suspected_anomaly for d in detections)

                annotated_frame = self._render_hud(
                    frame=clean_frame,
                    detections=detections,
                    state_machine=state_machine,
                    frame_has_suspected=frame_has_suspected,
                    latest_vlm_result=latest_vlm_result,
                    latest_vlm_track_id=latest_vlm_track_id,
                    latest_trigger_reason=latest_trigger_reason,
                    in_cooldown=in_cooldown,
                    cooldown_remaining_sec=cooldown_remaining_sec,
                    frame_idx=frame_idx,
                    fps=fps,
                )

                writer.write(annotated_frame)
                frame_idx += 1

        finally:
            cap.release()
            writer.release()

        logger.info(
            "Finished '%s': %d frames processed, %d Tier 2 VLM events logged. Annotated video saved to %s",
            video_path.name,
            frame_idx,
            video_events_triggered,
            output_video_path,
        )

        return {
            "video": video_path.name,
            "frames_processed": frame_idx,
            "vlm_events_triggered": video_events_triggered,
            "output_video": str(output_video_path),
        }

    def _render_hud(
        self,
        frame: np.ndarray,
        detections: List[PersonDetection],
        state_machine: MultiHazardStateMachine,
        frame_has_suspected: bool,
        latest_vlm_result: Optional[VLMVerificationResult],
        latest_vlm_track_id: Optional[int],
        latest_trigger_reason: Optional[str],
        in_cooldown: bool,
        cooldown_remaining_sec: float,
        frame_idx: int,
        fps: float,
    ) -> np.ndarray:
        """
        Draws bounding boxes, COCO skeleton keypoints, Track IDs, Tier 1 state,
        and a top status banner showing the latest Multi-Hazard Tier 2 VLM alert judgment.
        """
        canvas = frame.copy()
        h, w = canvas.shape[:2]

        for det in detections:
            x1, y1, x2, y2 = det.bbox
            is_anom = det.is_suspected_anomaly
            box_color = (0, 140, 255) if is_anom else (0, 210, 0)
            if latest_vlm_result and latest_vlm_result.is_emergency and is_anom:
                box_color = (0, 0, 255)

            cv2.rectangle(canvas, (x1, y1), (x2, y2), box_color, 2)

            kps = det.keypoints
            for idx_a, idx_b in COCO_SKELETON_PAIRS:
                if (
                    idx_a < len(kps)
                    and idx_b < len(kps)
                    and kps[idx_a][2] >= config.KEYPOINT_CONF_THRESHOLD
                    and kps[idx_b][2] >= config.KEYPOINT_CONF_THRESHOLD
                ):
                    pt_a = (int(kps[idx_a][0]), int(kps[idx_a][1]))
                    pt_b = (int(kps[idx_b][0]), int(kps[idx_b][1]))
                    if pt_a[0] > 0 and pt_a[1] > 0 and pt_b[0] > 0 and pt_b[1] > 0:
                        cv2.line(canvas, pt_a, pt_b, (255, 220, 0), 2, cv2.LINE_AA)

            for kp_idx in range(len(kps)):
                if kps[kp_idx][2] >= config.KEYPOINT_CONF_THRESHOLD:
                    px, py = int(kps[kp_idx][0]), int(kps[kp_idx][1])
                    if px > 0 and py > 0:
                        cv2.circle(canvas, (px, py), 4, (0, 255, 255), -1, cv2.LINE_AA)

            mid_sh = self.detector._get_midpoint(
                kps, config.KP_LEFT_SHOULDER, config.KP_RIGHT_SHOULDER
            )
            mid_hp = self.detector._get_midpoint(
                kps, config.KP_LEFT_HIP, config.KP_RIGHT_HIP
            )
            if mid_sh and mid_hp:
                cv2.line(
                    canvas,
                    (int(mid_sh[0]), int(mid_sh[1])),
                    (int(mid_hp[0]), int(mid_hp[1])),
                    (255, 0, 255),
                    3,
                    cv2.LINE_AA,
                )

            rec = state_machine.tracks.get(det.track_id)
            streak = rec.consecutive_anomaly_frames if rec else 0
            trig_tag = (
                f"/{det.primary_trigger_reason}"
                if det.primary_trigger_reason
                else ""
            )
            state_label = f"SUSPECTED{trig_tag}" if is_anom else "NORMAL"
            angle_str = (
                f"{det.torso_angle_deg:.0f}d"
                if det.torso_angle_deg is not None
                else "N/A"
            )
            label_text = (
                f"ID:{det.track_id} [{state_label}] "
                f"AR:{det.aspect_ratio:.2f} Ang:{angle_str} ({streak}/{state_machine.persistence_frames_req})"
            )

            (tw, th), _ = cv2.getTextSize(
                label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.50, 2
            )
            label_y1 = max(70, y1 - th - 10)
            cv2.rectangle(
                canvas,
                (x1, label_y1),
                (x1 + tw + 10, label_y1 + th + 8),
                box_color,
                -1,
            )
            cv2.putText(
                canvas,
                label_text,
                (x1 + 5, label_y1 + th + 2),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.50,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )

        # Top Banner HUD
        banner_h = 68
        overlay = canvas.copy()
        if latest_vlm_result is not None and latest_vlm_result.is_emergency:
            banner_bg = (0, 0, 190)
        elif frame_has_suspected:
            banner_bg = (0, 120, 220)
        else:
            banner_bg = (35, 35, 35)

        cv2.rectangle(overlay, (0, 0), (w, banner_h), banner_bg, -1)
        cv2.addWeighted(overlay, 0.85, canvas, 0.15, 0, canvas)

        tier1_state_str = "SUSPECTED" if frame_has_suspected else "NORMAL"
        cooldown_str = (
            f" | Cooldown: {cooldown_remaining_sec:.1f}s" if in_cooldown else ""
        )
        top_line = (
            f"Time: {frame_idx / fps:05.1f}s (F:{frame_idx}) | "
            f"Tier 1 State: {tier1_state_str}{cooldown_str}"
        )

        if latest_vlm_result is None:
            bottom_line = (
                "Tier 2 VLM Triage: None (Monitoring multi-hazard safety)"
            )
        else:
            bottom_line = (
                f"Tier 2 [{latest_vlm_result.severity}] (ID:{latest_vlm_track_id} | {latest_trigger_reason}): "
                f"{latest_vlm_result.hazard_category} (Conf:{latest_vlm_result.confidence:.2f}) - "
                f"{latest_vlm_result.explanation[:65]}"
            )

        cv2.putText(
            canvas,
            top_line,
            (12, 25),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.56,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            canvas,
            bottom_line,
            (12, 54),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.50,
            (220, 255, 255),
            1,
            cv2.LINE_AA,
        )

        return canvas
