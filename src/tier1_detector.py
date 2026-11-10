"""
Tier 1: Multi-Hazard Edge Computer Vision & Pose Estimation Detector.
Bridges `cloud.vision.pose_tracker.PoseTracker` so both `src.tier1_detector`
and `cloud.vision.pose_tracker` expose the unified multi-hazard pose tracker.
"""

from cloud.vision.pose_tracker import PersonDetection, PoseTracker


class Tier1PoseDetector(PoseTracker):
    """
    Executes YOLO11-Pose tracking with ByteTrack (or evaluates 33-keypoint MediaPipe
    pose landmarks) for multi-hazard anomaly detection:
      - Low Posture / Fall ("low_posture")
      - Trigger A: Distress Gesture - Stroke / Heart Attack ("chest_head_clutching")
      - Trigger B: Seated Slumping / Head Drop ("head_slump")
    """
    pass


__all__ = ["PersonDetection", "PoseTracker", "Tier1PoseDetector"]
