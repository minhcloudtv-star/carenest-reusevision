"""
Multi-Hazard Behavior State Machine (`cloud/behavior/state_machine.py`).
Tracks temporal keypoint velocity and gait sway oscillations:
  - Staggering / Unsteady Gait ("erratic_motion"): rapid horizontal hip/shoulder
    oscillation or sudden torso tilt variance while walking
  - Sudden Erratic Motion Spike + Stillness or Prolonged Freezing ("impact_immobility")
  - Evaluates persistence durations across all Tier 1 anomaly triggers (`low_posture`,
    `chest_head_clutching`, `head_slump`, `erratic_motion`, `impact_immobility`) and
    manages transitions to `LOW_POSTURE_REVIEW` / `ANOMALY_REVIEW` and `COOLDOWN`.
"""

import math
from collections import deque
from dataclasses import dataclass, field

import numpy as np

import config
from cloud.vision.pose_tracker import PersonDetection


@dataclass
class TrackStateRecord:
    """Per-person temporal state tracked across video frames."""
    track_id: int
    state: str = "NORMAL"  # NORMAL | SUSPECTED_ANOMALY | LOW_POSTURE_REVIEW | ANOMALY_REVIEW | COOLDOWN
    consecutive_anomaly_frames: int = 0
    active_trigger_reason: str | None = None
    prev_keypoints_centroid: tuple[float, float] | None = None
    prev_frame_idx: int | None = None
    recent_spike_frame: int | None = None
    post_spike_still_frames: int = 0
    immobile_frames: int = 0
    last_velocity: float = 0.0
    sh_hip_dx_history: deque[float] = field(default_factory=lambda: deque(maxlen=30))
    torso_angle_history: deque[float] = field(default_factory=lambda: deque(maxlen=30))
    velocity_history: deque[float] = field(default_factory=lambda: deque(maxlen=30))
    reason_counts: dict[str, int] = field(default_factory=dict)


@dataclass
class Tier2TriggerEvent:
    """Returned when a tracked person transitions into ANOMALY_REVIEW / LOW_POSTURE_REVIEW."""
    track_id: int
    frame_index: int
    video_timestamp_sec: float
    state: str
    tier1_trigger_reason: str
    trigger_codes: list[str]
    anomaly_reasons: list[str]
    consecutive_frames: int
    detection: PersonDetection


class MultiHazardStateMachine:
    """
    Manages temporal velocity & gait sway tracking (`erratic_motion` and `impact_immobility`)
    and state transitions (`NORMAL` -> `SUSPECTED_ANOMALY` -> `LOW_POSTURE_REVIEW` /
    `ANOMALY_REVIEW` -> `COOLDOWN`) for all tracked individuals.
    """

    def __init__(self, fps: float = 30.0) -> None:
        self.fps = max(1.0, float(fps))
        self.persistence_frames_req = max(
            1, round(config.ANOMALY_PERSISTENCE_SECONDS * self.fps)
        )
        self.cooldown_frames_req = max(
            1, round(config.COOLDOWN_SECONDS * self.fps)
        )
        self.post_impact_still_frames_req = max(
            1, round(config.POST_IMPACT_STILLNESS_SECONDS * self.fps)
        )
        self.prolonged_immobility_frames_req = max(
            1, round(config.PROLONGED_IMMOBILITY_SECONDS * self.fps)
        )
        self.stagger_window_len = max(
            5, round(config.STAGGER_WINDOW_SECONDS * self.fps)
        )

        self.tracks: dict[int, TrackStateRecord] = {}
        self.last_vlm_trigger_frame: int | None = None

    @staticmethod
    def _compute_valid_keypoint_centroid(
        det: PersonDetection,
    ) -> tuple[float, float]:
        """Computes the mean (x, y) of valid keypoints, or bounding box center if none."""
        kps = det.keypoints
        valid_mask = (
            (kps[:, 2] >= config.KEYPOINT_CONF_THRESHOLD)
            & (kps[:, 0] > 0)
            & (kps[:, 1] > 0)
        )
        if np.any(valid_mask):
            pts = kps[valid_mask, :2]
            return (float(np.mean(pts[:, 0])), float(np.mean(pts[:, 1])))
        x1, y1, x2, y2 = det.bbox
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

    def is_in_cooldown(self, frame_idx: int) -> tuple[bool, float]:
        if self.last_vlm_trigger_frame is None:
            return False, 0.0
        elapsed = frame_idx - self.last_vlm_trigger_frame
        if elapsed < self.cooldown_frames_req:
            rem_sec = max(0.0, (self.cooldown_frames_req - elapsed) / self.fps)
            return True, rem_sec
        return False, 0.0

    def update(
        self, frame_idx: int, detections: list[PersonDetection]
    ) -> list[Tier2TriggerEvent]:
        """
        Updates per-track velocity, gait sway oscillation, and anomaly persistence.
        Returns a list of Tier2TriggerEvent objects to be verified by the Tier 2 VLM.
        """
        triggers: list[Tier2TriggerEvent] = []
        active_ids: set[int] = set()
        in_cooldown, _ = self.is_in_cooldown(frame_idx)

        for det in detections:
            tid = det.track_id
            active_ids.add(tid)
            if tid not in self.tracks:
                self.tracks[tid] = TrackStateRecord(
                    track_id=tid,
                    sh_hip_dx_history=deque(maxlen=self.stagger_window_len),
                    torso_angle_history=deque(maxlen=self.stagger_window_len),
                    velocity_history=deque(maxlen=self.stagger_window_len),
                )
            rec = self.tracks[tid]

            # ------------------------------------------------------------------
            # Velocity & Gait Sway Tracking
            # ------------------------------------------------------------------
            centroid = self._compute_valid_keypoint_centroid(det)
            bbox_h = max(1.0, float(det.bbox[3] - det.bbox[1]))

            velocity_norm = 0.0
            if rec.prev_keypoints_centroid is not None and rec.prev_frame_idx is not None:
                dt_frames = max(1, frame_idx - rec.prev_frame_idx)
                dt_sec = dt_frames / self.fps
                dist_px = math.hypot(
                    centroid[0] - rec.prev_keypoints_centroid[0],
                    centroid[1] - rec.prev_keypoints_centroid[1],
                )
                velocity_norm = (dist_px / bbox_h) / dt_sec

            rec.prev_keypoints_centroid = centroid
            rec.prev_frame_idx = frame_idx
            rec.last_velocity = velocity_norm
            det.keypoint_velocity = velocity_norm

            rec.velocity_history.append(velocity_norm)
            if det.shoulder_hip_dx_ratio is not None:
                rec.sh_hip_dx_history.append(det.shoulder_hip_dx_ratio)
            if det.torso_angle_deg is not None:
                rec.torso_angle_history.append(det.torso_angle_deg)

            # 1. Check Staggering / Unsteady Gait ("erratic_motion")
            min_samples = max(4, self.stagger_window_len // 2)
            if (
                not det.in_bed_zone
                and det.aspect_ratio < config.STAGGER_MAX_ASPECT_RATIO
                and "low_posture" not in det.trigger_codes
                and "chest_head_clutching" not in det.trigger_codes
                and len(rec.velocity_history) >= min_samples
            ):
                mean_vel = float(np.mean(rec.velocity_history))
                if mean_vel >= config.STAGGER_MIN_VELOCITY:
                    sway_std = (
                        float(np.std(rec.sh_hip_dx_history))
                        if len(rec.sh_hip_dx_history) >= min_samples
                        else 0.0
                    )
                    sway_max = (
                        float(np.max(np.abs(rec.sh_hip_dx_history)))
                        if len(rec.sh_hip_dx_history) >= min_samples
                        else 0.0
                    )
                    angle_std = (
                        float(np.std(rec.torso_angle_history))
                        if len(rec.torso_angle_history) >= min_samples
                        else 0.0
                    )

                    if (
                        sway_std >= config.STAGGER_SH_HIP_DX_STD_THRESHOLD
                        or sway_max >= config.STAGGER_SH_HIP_DX_MAX_THRESHOLD
                        or angle_std >= config.STAGGER_TORSO_ANGLE_STD_THRESHOLD
                    ):
                        if "erratic_motion" not in det.trigger_codes:
                            det.trigger_codes.append("erratic_motion")
                        det.anomaly_reasons.append(
                            f"StaggerSway(dxMax={sway_max:.2f},angStd={angle_std:.1f}d)"
                        )
                        det.is_suspected_anomaly = True

            # 2. Check Sudden Impact Spike + Stillness or Prolonged Freezing ("impact_immobility")
            if velocity_norm >= config.IMPACT_VELOCITY_SPIKE_THRESHOLD:
                rec.recent_spike_frame = frame_idx
                rec.post_spike_still_frames = 0

            if velocity_norm <= config.STILLNESS_VELOCITY_THRESHOLD:
                rec.immobile_frames += 1
                if (
                    rec.recent_spike_frame is not None
                    and (frame_idx - rec.recent_spike_frame) <= int(self.fps * 3.0)
                ):
                    rec.post_spike_still_frames += 1
            else:
                rec.immobile_frames = 0
                rec.post_spike_still_frames = 0

            if not det.in_bed_zone:
                if rec.post_spike_still_frames >= self.post_impact_still_frames_req:
                    if "impact_immobility" not in det.trigger_codes:
                        det.trigger_codes.append("impact_immobility")
                    det.anomaly_reasons.append(
                        f"ImpactStillness={rec.post_spike_still_frames / self.fps:.1f}s"
                    )
                    det.is_suspected_anomaly = True
                elif rec.immobile_frames >= self.prolonged_immobility_frames_req:
                    if "impact_immobility" not in det.trigger_codes:
                        det.trigger_codes.append("impact_immobility")
                    det.anomaly_reasons.append(
                        f"ProlongedFreeze={rec.immobile_frames / self.fps:.1f}s"
                    )
                    det.is_suspected_anomaly = True

            if det.trigger_codes and not det.primary_trigger_reason:
                det.primary_trigger_reason = det.trigger_codes[0]

            # ------------------------------------------------------------------
            # Update Streak & State Transitions
            # ------------------------------------------------------------------
            if det.is_suspected_anomaly:
                rec.consecutive_anomaly_frames += 1
                for code in det.trigger_codes:
                    rec.reason_counts[code] = rec.reason_counts.get(code, 0) + 1

                if "low_posture" in det.trigger_codes:
                    dominant_reason = "low_posture"
                elif det.primary_trigger_reason:
                    dominant_reason = det.primary_trigger_reason
                elif rec.reason_counts:
                    dominant_reason = max(rec.reason_counts.items(), key=lambda kv: kv[1])[0]
                else:
                    dominant_reason = "low_posture"

                rec.active_trigger_reason = dominant_reason
                det.primary_trigger_reason = dominant_reason

                if rec.consecutive_anomaly_frames >= self.persistence_frames_req:
                    if not in_cooldown:
                        review_state = (
                            "LOW_POSTURE_REVIEW"
                            if dominant_reason == "low_posture"
                            else "ANOMALY_REVIEW"
                        )
                        rec.state = review_state
                        det.behavior_state = review_state

                        self.last_vlm_trigger_frame = frame_idx
                        in_cooldown = True
                        rec.reason_counts.clear()

                        triggers.append(
                            Tier2TriggerEvent(
                                track_id=tid,
                                frame_index=frame_idx,
                                video_timestamp_sec=round(frame_idx / self.fps, 2),
                                state=review_state,
                                tier1_trigger_reason=dominant_reason,
                                trigger_codes=list(det.trigger_codes),
                                anomaly_reasons=list(det.anomaly_reasons),
                                consecutive_frames=rec.consecutive_anomaly_frames,
                                detection=det,
                            )
                        )
                    else:
                        rec.state = "COOLDOWN"
                        det.behavior_state = "COOLDOWN"
                else:
                    rec.state = "SUSPECTED_ANOMALY"
                    det.behavior_state = "SUSPECTED_ANOMALY"
            else:
                rec.consecutive_anomaly_frames = 0
                rec.reason_counts.clear()
                rec.active_trigger_reason = None
                rec.state = "COOLDOWN" if in_cooldown else "NORMAL"
                det.behavior_state = rec.state

        # Decay streaks for tracks temporarily occluded
        for tid, rec in list(self.tracks.items()):
            if tid not in active_ids:
                rec.consecutive_anomaly_frames = max(
                    0, rec.consecutive_anomaly_frames - 1
                )

        return triggers
