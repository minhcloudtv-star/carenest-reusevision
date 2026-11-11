# CareNest ReuseVision — Tech 1: Multi-Hazard Vision & Behavior Architecture

## 1. Overview
The **Tech 1 (Vision & Behavior)** subsystem implements a 2-tier hybrid video analytics pipeline for elderly safety monitoring:
- **Tier 1 (`cloud/vision/` & `cloud/behavior/state_machine.py`)**: Real-time pose tracking, spatial zone evaluation (`BED` vs. non-bed zones), and geometric/temporal multi-hazard heuristics.
- **Tier 2 (`cloud/behavior/vlm_reviewer.py`)**: Open-source Vision-Language Model (Ollama VLM) emergency medical & safety visual triage over side-by-side (`T - 2 Seconds` vs. `Current`) composite snapshots.

## 2. Multi-Hazard Tier 1 Triggers
Implemented in [`PoseTracker`](../cloud/vision/pose_tracker.py) and [`BehaviorStateMachine`](../cloud/behavior/state_machine.py):
1. **`low_posture` (Uncontrolled Fall / Collapse)**:
   - Bounding box aspect ratio `width / height > 1.15`, OR
   - Torso angle relative to horizontal `< 45°`, OR
   - Vertical shoulder-to-hip span `< 25%` of bounding box height.
2. **`chest_head_clutching` (Stroke / Cardiac Distress / Severe Pain)**:
   - Either wrist (`15, 16`) held in close proximity to the chest center or head/face area accompanied by torso leaning, head dropping, or asymmetrical guarded posture.
3. **`head_slump` (Seated Slumping / Unconsciousness / Syncope)**:
   - Significant drop in vertical distance between the nose (`0`) and mid-shoulder outside the `BED` zone.
4. **`erratic_motion` (Staggering / Loss of Balance / Unsteady Gait)**:
   - High lateral shoulder-to-hip oscillation and torso tilt variance while walking upright.
5. **`impact_immobility` (Domestic Accident / Sudden Impact + Freezing)**:
   - Sudden high-velocity keypoint spike followed by immediate stillness, or prolonged freezing outside the `BED` zone.

## 3. Tier 2 Vision-LLM Triage Schema
Implemented in [`VLMReviewer`](../cloud/behavior/vlm_reviewer.py) using Pydantic schema [`VLMVerificationResult`](../cloud/behavior/vlm_reviewer.py):
```json
{
  "is_emergency": true,
  "hazard_category": "FALL | STROKE_OR_MEDICAL_DISTRESS | UNCONSCIOUS_SLUMP | DOMESTIC_ACCIDENT | NORMAL_ACTIVITY",
  "severity": "CRITICAL | WARNING | SAFE",
  "detected_symptoms": ["string"],
  "environmental_hazards": ["string"],
  "confidence": 0.92,
  "explanation": "string"
}
```

## 4. Running the Multi-Hazard Sandbox Benchmark
```bash
# 1. Acquire and verify real-human test videos (MediaPipe 33-landmark check >70% frames)
python benchmarks/acquire_test_videos.py

# 2. Run the sandbox benchmark across all test videos
python benchmarks/run_sandbox.py --mock-vlm --save-debug-media
```
