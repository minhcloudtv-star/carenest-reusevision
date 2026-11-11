"""
Multi-Hazard Benchmark Runner (`benchmarks/run_sandbox.py`).
Executes:
  1. MediaPipe Pose 33-landmark sanity verification (>70% frame detection)
  2. 2-Tier Multi-Hazard Elderly Anomaly Detection Pipeline across all 3 real-human
     test videos (`real_human_fall.mp4`, `stroke_symptoms.mp4`, `staggering_walk.mp4`)
  3. Prints a structured summary table of Tier 1 triggers, activation timestamps/frames,
     and Tier 2 VLM JSON outputs.

Usage:
  python benchmarks/run_sandbox.py --mock-vlm --save-debug-media
"""

import argparse
import json
import logging
from pathlib import Path
import sys
from typing import Dict, List

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import config
from benchmarks.acquire_test_videos import (
    acquire_all_benchmark_videos,
    run_mediapipe_pose_sanity_check,
)
from src.video_pipeline import ElderlyFallPipeline


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Multi-Hazard Elderly Anomaly Detection Benchmark Sandbox Runner"
    )
    parser.add_argument(
        "--input",
        "-i",
        type=str,
        default=str(config.INPUT_VIDEOS_DIR),
        help="Path to a single video or directory of benchmark videos (default: input_videos/)",
    )
    parser.add_argument(
        "--mock-vlm",
        action="store_true",
        help="Use deterministic context-aware mock VLM triage output.",
    )
    parser.add_argument(
        "--save-debug-media",
        action="store_true",
        help="Save annotated debug videos (outputs/videos/) and stitched snapshots (outputs/snapshots/).",
    )
    return parser.parse_args()


def main() -> int:
    configure_logging()
    args = parse_args()
    logger = logging.getLogger("run_sandbox")

    target_names = [
        "real_human_fall.mp4",
        "stroke_symptoms.mp4",
        "staggering_walk.mp4",
    ]

    # Acquire missing benchmark videos automatically if not yet downloaded
    missing = [
        name
        for name in target_names
        if not (config.INPUT_VIDEOS_DIR / name).exists()
    ]
    if missing:
        logger.info("Acquiring missing benchmark videos: %s", missing)
        acquire_all_benchmark_videos()

    # Clean previous events log & snapshots so this benchmark run is fresh
    config.EVENTS_LOG_PATH.unlink(missing_ok=True)
    for snap in config.SNAPSHOTS_DIR.glob("*.jpg"):
        snap.unlink(missing_ok=True)

    # Step 1: Run MediaPipe Pose 33-landmark verification on each video
    mp33_stats: Dict[str, Tuple[int, int, float]] = {}
    video_paths: List[Path] = []
    for name in target_names:
        vpath = config.INPUT_VIDEOS_DIR / name
        if vpath.exists():
            video_paths.append(vpath)
            det_f, tot_f, pct = run_mediapipe_pose_sanity_check(vpath)
            mp33_stats[name] = (det_f, tot_f, pct)
            logger.info(
                "MediaPipe 33-Landmark Check [%s]: %d/%d frames (%.1f%%)",
                name,
                det_f,
                tot_f,
                pct,
            )

    # Step 2: Run the 2-Tier Multi-Hazard Pipeline across all 3 test videos
    pipeline = ElderlyFallPipeline(mock_vlm=args.mock_vlm)
    summaries = []
    for vpath in video_paths:
        summaries.append(pipeline.process_video(vpath))

    # Step 3: Load generated events from outputs/events_log.json and print summary table
    events = []
    if config.EVENTS_LOG_PATH.exists():
        events = json.loads(config.EVENTS_LOG_PATH.read_text(encoding="utf-8"))

    print("\n" + "=" * 118)
    print("MULTI-HAZARD ELDERLY ANOMALY BENCHMARK SUMMARY")
    print("=" * 118)
    header = (
        f"{'Video File':<22} | {'MP33 Pose':<14} | {'Tier 1 Trigger':<21} | "
        f"{'Frame / Time':<14} | {'Tier 2 Category':<27} | {'Severity':<8}"
    )
    print(header)
    print("-" * 118)

    for name in target_names:
        det_f, tot_f, pct = mp33_stats.get(name, (0, 0, 0.0))
        mp_str = f"{pct:5.1f}% ({det_f}/{tot_f})"
        vid_events = [e for e in events if e.get("video_file") == name]
        if not vid_events:
            print(
                f"{name:<22} | {mp_str:<14} | {'None':<21} | {'-':<14} | {'-':<27} | {'-':<8}"
            )
            continue

        for idx, ev in enumerate(vid_events):
            trig = ev.get("tier1_trigger_reason", "unknown")
            f_idx = ev.get("frame_index", 0)
            t_sec = ev.get("video_timestamp_sec", 0.0)
            vlm = ev.get("tier2_vlm_response", {})
            cat = vlm.get("hazard_category", "N/A")
            sev = vlm.get("severity", "N/A")
            vid_col = name if idx == 0 else ""
            mp_col = mp_str if idx == 0 else ""
            print(
                f"{vid_col:<22} | {mp_col:<14} | {trig:<21} | "
                f"F:{f_idx:<4d} ({t_sec:4.2f}s) | {cat:<27} | {sev:<8}"
            )

    print("=" * 118)
    print("\nDetailed Tier 2 VLM JSON Outputs per Video (First Activation):")
    for name in target_names:
        vid_events = [e for e in events if e.get("video_file") == name]
        if vid_events:
            first_ev = vid_events[0]
            print(
                f"\n--- {name} (Trigger: {first_ev['tier1_trigger_reason']} @ Frame {first_ev['frame_index']}, {first_ev['video_timestamp_sec']}s) ---"
            )
            print(json.dumps(first_ev["tier2_vlm_response"], indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main())
