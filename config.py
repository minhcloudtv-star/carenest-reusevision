"""
Centralized configuration for the 2-Tier Multi-Hazard Elderly Safety & Anomaly Detection Pipeline.
Supports:
  - Low Posture / Fall Detection ("low_posture")
  - Trigger A: Distress Gesture - Stroke / Heart Attack / Severe Pain ("chest_head_clutching")
  - Trigger B: Seated Slumping / Head Drop - Fainting / Unconsciousness ("head_slump")
  - Trigger C: Staggering / Swaying / Erratic Motion & Prolonged Freezing ("erratic_motion" / "impact_immobility")
"""

from pathlib import Path
from typing import Tuple

# ==============================================================================
# Directory & File Paths
# ==============================================================================
BASE_DIR = Path(__file__).resolve().parent
INPUT_VIDEOS_DIR = BASE_DIR / "input_videos"
OUTPUTS_DIR = BASE_DIR / "outputs"
SNAPSHOTS_DIR = OUTPUTS_DIR / "snapshots"
OUTPUT_VIDEOS_DIR = OUTPUTS_DIR / "videos"
EVENTS_LOG_PATH = OUTPUTS_DIR / "events_log.json"
MEDIAPIPE_TASK_PATH = BASE_DIR / "pose_landmarker_lite.task"

# Ensure required directories exist
for directory in [INPUT_VIDEOS_DIR, SNAPSHOTS_DIR, OUTPUT_VIDEOS_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# ==============================================================================
# Tier 1: Edge CV & Pose Estimation Settings
# ==============================================================================
YOLO_MODEL_NAME = "yolo11n-pose.pt"
PERSON_CLASS_ID = 0
YOLO_CONF_THRESHOLD = 0.40
KEYPOINT_CONF_THRESHOLD = 0.35

# Rolling Buffer & Persistence Settings (in seconds of video time)
BUFFER_SECONDS = 2.0                # Rolling window of clean frames (T - 2s)
ANOMALY_PERSISTENCE_SECONDS = 1.0   # Consecutive seconds required to trigger Tier 2
COOLDOWN_SECONDS = 5.0              # Cooldown period after a Tier 2 VLM trigger

# Optional normalized BED zone ROI (x1_norm, y1_norm, x2_norm, y2_norm).
BED_ZONE_NORM: Tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)

# ==============================================================================
# Tier 1: Multi-Hazard Geometric & Temporal Heuristic Thresholds
# ==============================================================================
# 1. Low Posture / Fall ("low_posture")
BBOX_ASPECT_RATIO_THRESHOLD = 1.15
TORSO_ANGLE_DEG_THRESHOLD = 45.0
TORSO_VERTICAL_RATIO_THRESHOLD = 0.25

# 2. Trigger A - Distress Gesture: Stroke / Heart Attack / Chest or Head Clutching ("chest_head_clutching")
CLUTCH_CHEST_DIST_RATIO = 0.15
CLUTCH_CHEST_ASYM_DIST_RATIO = 0.255   # Upper-body/seated single-hand chest clutching
CLUTCH_WRIST_ASYMMETRY_RATIO = 0.12    # Vertical asymmetry between left & right wrists
CLUTCH_HEAD_DIST_RATIO = 0.17
DISTRESS_TORSO_LEAN_DEG = 65.0         # Torso leaning (< 65 deg from horizontal)
DISTRESS_HEAD_DROP_RATIO = 0.175       # Head dropping closer to shoulder line during chest clutching

# 3. Trigger B - Seated Slumping / Head Drop ("head_slump")
HEAD_SLUMP_VERTICAL_RATIO_THRESHOLD = 0.085
HEAD_SLUMP_MIN_BBOX_HEIGHT_PX = 80

# 4. Trigger C - Staggering / Swaying / Erratic Motion & Prolonged Freezing ("erratic_motion" / "impact_immobility")
STAGGER_WINDOW_SECONDS = 1.0           # Rolling window for gait / sway analysis
STAGGER_MAX_ASPECT_RATIO = 0.65        # Standing/walking silhouette (excludes seated posture)
STAGGER_MIN_VELOCITY = 0.09            # Minimum movement velocity to evaluate walking gait sway
STAGGER_SH_HIP_DX_STD_THRESHOLD = 0.016  # Std dev of horizontal shoulder-hip offset / bbox_height
STAGGER_SH_HIP_DX_MAX_THRESHOLD = 0.031  # Peak horizontal shoulder-hip lean offset while walking
STAGGER_TORSO_ANGLE_STD_THRESHOLD = 2.1  # Torso tilt angle standard deviation (deg) while walking
IMPACT_VELOCITY_SPIKE_THRESHOLD = 1.65   # Sudden high-velocity motion spike
STILLNESS_VELOCITY_THRESHOLD = 0.06      # Immediate stillness threshold
POST_IMPACT_STILLNESS_SECONDS = 0.5      # Stillness window after spike to confirm impact
PROLONGED_IMMOBILITY_SECONDS = 8.0       # Complete freezing outside BED zone

# ==============================================================================
# Keypoint Index Definitions (Supports both COCO-17 and MediaPipe-33)
# ==============================================================================
# COCO 17 Keypoint Indices (Ultralytics YOLO11-Pose)
KP_NOSE = 0
KP_LEFT_SHOULDER = 5
KP_RIGHT_SHOULDER = 6
KP_LEFT_ELBOW = 7
KP_RIGHT_ELBOW = 8
KP_LEFT_WRIST = 9
KP_RIGHT_WRIST = 10
KP_LEFT_HIP = 11
KP_RIGHT_HIP = 12
COCO_HEAD_INDICES = (0, 1, 2, 3, 4)

# MediaPipe 33 Keypoint Indices
MP_NOSE = 0
MP_HEAD_INDICES = tuple(range(0, 11))
MP_LEFT_SHOULDER = 11
MP_RIGHT_SHOULDER = 12
MP_LEFT_WRIST = 15
MP_RIGHT_WRIST = 16
MP_LEFT_HIP = 23
MP_RIGHT_HIP = 24

# ==============================================================================
# Tier 2: Open-Source Vision-Language Model (Ollama) Settings
# ==============================================================================
OLLAMA_API_URL = "http://localhost:11434/api/generate"
DEFAULT_VLM_MODEL = "qwen2.5vl:7b"  # Alternatives: "llava:7b", "minicpm-v:8b"
VLM_TIMEOUT_SECONDS = 30.0

VLM_SYSTEM_PROMPT_TEMPLATE = """You are an Emergency Medical & Safety Visual Triage AI monitoring an elderly person living alone.
You are analyzing a stitched 2-panel security camera image:
- LEFT panel ("T - 2 Seconds"): Scene 2 seconds prior to the alert.
- RIGHT panel ("Current (Suspected Anomaly)"): Current scene that triggered Tier 1 edge analytics.

Tier 1 Edge Trigger Context:
- Primary Trigger Code: "{tier1_trigger_reason}"
- Active Telemetry Reasons: {anomaly_reasons}

Carefully inspect the visual transition between T-2s and Current across these four clinical and safety dimensions:
1. Posture & Body Mechanics: Did the person fall to the floor, slump unconsciously in a chair, stagger with unsteady gait/loss of balance, or collapse against furniture/walls?
2. Medical Distress Signs (Stroke / Cardiac / Seizure): Is the person clutching their chest, holding their head in severe pain, showing asymmetrical posture, or visibly struggling to stand/breathe?
3. Environmental & Domestic Accidents: Are there overturned objects, spilled liquids, smoke/fire, sharp hazards, or is the person trapped/injured by surrounding objects?
4. False Positive Filtering: Distinguish real emergencies from normal daily activities (e.g., sleeping safely in bed, bending intentionally to pick up an item, tying shoes, normal resting on a sofa).

Respond with ONLY a valid JSON object matching this exact schema (no markdown formatting, no code fences, no extra text):
{{
  "is_emergency": true or false,
  "hazard_category": "FALL" | "STROKE_OR_MEDICAL_DISTRESS" | "UNCONSCIOUS_SLUMP" | "DOMESTIC_ACCIDENT" | "NORMAL_ACTIVITY",
  "severity": "CRITICAL" | "WARNING" | "SAFE",
  "detected_symptoms": ["list of visual cues, e.g., clutching chest, slumped head, unsteady staggering gait, lying on floor"],
  "environmental_hazards": ["any surrounding dangers, e.g., overturned chair, wet floor, none"],
  "confidence": float between 0.0 and 1.0,
  "explanation": "Detailed clinical and contextual explanation of what happened between T-2s and Current frame."
}}"""
