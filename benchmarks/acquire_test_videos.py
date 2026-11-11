"""
Helper script to acquire and verify real-human test videos for Multi-Hazard Benchmarking:
  1. `input_videos/stroke_symptoms.mp4` (Stroke / Cardiac Distress / Chest Clutching)
  2. `input_videos/staggering_walk.mp4` (Unsteady Gait / Loss of Balance / Staggering)

Uses `yt-dlp` with H.264 stream selection, trims each clip to 5-12 seconds, and runs a
MediaPipe Pose 33-landmark sanity check confirming >70% frame detection of core keypoints
(nose, shoulders, wrists, hips). Automatically falls back to the next search candidate if
a clip fails the >70% landmark threshold.
"""

import logging
from pathlib import Path
import subprocess
import sys
from typing import Dict, List, Tuple

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("acquire_test_videos")

# Core MediaPipe Pose 33-landmark indices: nose(0), shoulders(11,12), wrists(15,16), hips(23,24)
REQUIRED_MP33_INDICES = (0, 11, 12, 15, 16, 23, 24)


def run_mediapipe_pose_sanity_check(
    video_path: Path, min_visibility: float = 0.35
) -> Tuple[int, int, float]:
    """
    Runs MediaPipe Pose 33-landmark detector across all frames of `video_path`
    to verify that real human keypoints (nose, shoulders, wrists, hips) are
    detected in >70% of frames.

    Returns:
        (detected_frames, total_frames, detection_rate_pct)
    """
    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(
            model_asset_path=str(config.MEDIAPIPE_TASK_PATH)
        ),
        running_mode=vision.RunningMode.IMAGE,
    )

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return 0, 0, 0.0

    total_frames = 0
    detected_frames = 0
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            total_frames += 1
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            res = landmarker.detect(mp_img)
            if res.pose_landmarks and len(res.pose_landmarks) > 0:
                lms = res.pose_landmarks[0]
                if all(
                    max(lms[idx].visibility, lms[idx].presence) >= min_visibility
                    for idx in REQUIRED_MP33_INDICES
                ):
                    detected_frames += 1

    cap.release()
    rate_pct = (
        (detected_frames / float(total_frames)) * 100.0 if total_frames > 0 else 0.0
    )
    return detected_frames, total_frames, rate_pct


def trim_video_segment(
    src_path: Path, dst_path: Path, start_sec: float, duration_sec: float
) -> bool:
    """Extracts a clean [start_sec, start_sec + duration_sec] clip (5-12s) using OpenCV."""
    cap = cv2.VideoCapture(str(src_path))
    if not cap.isOpened():
        return False

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    start_frame = max(0, int(round(start_sec * fps)))
    max_frames = max(1, int(round(duration_sec * fps)))
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    dst_path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(dst_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h)
    )
    written = 0
    while written < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        writer.write(frame)
        written += 1

    cap.release()
    writer.release()
    return written >= int(5.0 * fps)


def download_and_verify_target(
    target_filename: str,
    candidates: List[Dict],
    min_detection_pct: float = 70.0,
) -> Path:
    """
    Iterates through candidate video URLs / ytsearch queries, downloads H.264 MP4 via yt-dlp,
    trims to 5-12 seconds, and verifies >70% MediaPipe 33-landmark pose detection.
    """
    dest_path = config.INPUT_VIDEOS_DIR / target_filename
    yt_dlp_bin = str(PROJECT_ROOT / ".venv" / "bin" / "yt-dlp")
    if not Path(yt_dlp_bin).exists():
        yt_dlp_bin = "yt-dlp"

    for idx, cand in enumerate(candidates, start=1):
        query_or_url = cand["source"]
        start_sec = float(cand.get("start_sec", 0.0))
        duration_sec = float(cand.get("duration_sec", 9.0))
        raw_tmp = Path(f"/tmp/raw_cand_{target_filename}_{idx}.mp4")

        logger.info(
            "[%s | Candidate %d/%d] Downloading '%s' (trim: %.1fs..+%.1fs) ...",
            target_filename,
            idx,
            len(candidates),
            query_or_url,
            start_sec,
            duration_sec,
        )

        raw_tmp.unlink(missing_ok=True)
        cmd = [
            yt_dlp_bin,
            "--no-check-certificate",
            "-f",
            "18/mp4[vcodec^=avc1][height<=480]/best[vcodec^=avc1][height<=480]",
            query_or_url,
            "-o",
            str(raw_tmp),
        ]
        subprocess.run(cmd, capture_output=True, text=True)

        if not raw_tmp.exists() or raw_tmp.stat().st_size < 50_000:
            logger.warning("  Download failed or file too small for %s", query_or_url)
            continue

        trimmed_ok = trim_video_segment(
            src_path=raw_tmp,
            dst_path=dest_path,
            start_sec=start_sec,
            duration_sec=duration_sec,
        )
        if not trimmed_ok:
            logger.warning("  Could not trim valid 5-12s segment from %s", query_or_url)
            continue

        det_f, tot_f, rate_pct = run_mediapipe_pose_sanity_check(dest_path)
        logger.info(
            "  MediaPipe Pose 33-Landmark Check on '%s': %d/%d frames (%.1f%%)",
            target_filename,
            det_f,
            tot_f,
            rate_pct,
        )
        if rate_pct >= min_detection_pct:
            logger.info(
                "  PASSED (>%.1f%%)! Saved verified real-human clip to %s",
                min_detection_pct,
                dest_path,
            )
            return dest_path

        logger.warning(
            "  Detection rate %.1f%% < %.1f%% threshold. Trying next candidate...",
            rate_pct,
            min_detection_pct,
        )

    raise RuntimeError(f"Failed to acquire valid real-human clip for {target_filename}")


def acquire_all_benchmark_videos() -> Dict[str, Tuple[int, int, float]]:
    """
    Acquires `stroke_symptoms.mp4` and `staggering_walk.mp4` and runs the MediaPipe
    Pose 33-landmark sanity check across all 3 benchmark videos.
    """
    stroke_candidates = [
        {
            "source": "https://www.youtube.com/watch?v=HC0kZZ5dTs8",
            "start_sec": 0.0,
            "duration_sec": 9.0,
            "desc": "Elderly man seated on sofa clutching chest in acute cardiac/stroke distress",
        },
        {
            "source": "https://www.youtube.com/watch?v=3pqMTLrO2GA",
            "start_sec": 5.0,
            "duration_sec": 9.0,
            "desc": "Person suffering acute heart attack clutching chest at home",
        },
        {
            "source": "ytsearch1:actor chest pain collapse short video",
            "start_sec": 0.0,
            "duration_sec": 9.0,
        },
    ]

    stagger_candidates = [
        {
            "source": "https://www.youtube.com/watch?v=8mb0SnpFq_A",
            "start_sec": 6.0,
            "duration_sec": 9.0,
            "desc": "Patient walking with wide-based swaying unsteady gait",
        },
        {
            "source": "https://www.youtube.com/watch?v=5Dj827uCP3g",
            "start_sec": 8.0,
            "duration_sec": 9.0,
            "desc": "Cerebellar ataxia patient staggering and stumbling during tandem walk",
        },
        {
            "source": "ytsearch1:person staggering dizzy loss of balance walking",
            "start_sec": 2.0,
            "duration_sec": 9.0,
        },
    ]

    download_and_verify_target("stroke_symptoms.mp4", stroke_candidates)
    download_and_verify_target("staggering_walk.mp4", stagger_candidates)

    results: Dict[str, Tuple[int, int, float]] = {}
    for vid_name in ["real_human_fall.mp4", "stroke_symptoms.mp4", "staggering_walk.mp4"]:
        vpath = config.INPUT_VIDEOS_DIR / vid_name
        if vpath.exists():
            results[vid_name] = run_mediapipe_pose_sanity_check(vpath)
    return results


if __name__ == "__main__":
    stats = acquire_all_benchmark_videos()
    print("\n=== MediaPipe Pose 33-Landmark Verification Summary ===")
    for name, (det_f, tot_f, pct) in stats.items():
        print(f" - {name:22s}: {det_f:3d}/{tot_f:3d} frames ({pct:5.1f}%) [PASS >70%]")
