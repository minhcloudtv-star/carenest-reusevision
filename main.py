"""
CLI Entry Point for the 2-Tier Elderly Safety & Fall Detection Video Analytics Pipeline.
Supports running on a single video file or a directory of videos, plus a --mock-vlm flag
and a synthetic demo video generator when no input videos are present.
"""

import argparse
import logging
import sys
from pathlib import Path
from typing import List

import config
from src.video_pipeline import ElderlyFallPipeline


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )


def discover_videos(source_path: Path) -> List[Path]:
    """Finds .mp4 and .avi video files from a file path or directory."""
    valid_exts = {".mp4", ".avi", ".mov", ".mkv"}
    if source_path.is_file():
        if source_path.suffix.lower() in valid_exts:
            return [source_path]
        raise ValueError(f"Unsupported video file extension: {source_path.suffix}")

    if source_path.is_dir():
        videos = sorted(
            [p for p in source_path.iterdir() if p.is_file() and p.suffix.lower() in valid_exts]
        )
        return videos

    raise FileNotFoundError(f"Input path does not exist: {source_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="2-Tier Elderly Safety & Fall Detection Video Analytics Pipeline"
    )
    parser.add_argument(
        "--input",
        "-i",
        type=str,
        default=str(config.INPUT_VIDEOS_DIR),
        help="Path to a single video file (.mp4, .avi) or a folder of videos (default: input_videos/)",
    )
    parser.add_argument(
        "--yolo-model",
        type=str,
        default=config.YOLO_MODEL_NAME,
        help=f"Ultralytics YOLO Pose model weight file (default: {config.YOLO_MODEL_NAME})",
    )
    parser.add_argument(
        "--vlm-model",
        type=str,
        default=config.DEFAULT_VLM_MODEL,
        help=f"Ollama Vision-LLM model tag (default: {config.DEFAULT_VLM_MODEL})",
    )
    parser.add_argument(
        "--mock-vlm",
        action="store_true",
        help="Bypass live Ollama API calls and use a deterministic mock VLM response for testing Tier 1.",
    )
    return parser.parse_args()


def main() -> int:
    configure_logging()
    args = parse_args()
    logger = logging.getLogger("main")

    input_path = Path(args.input).resolve()
    try:
        video_files = discover_videos(input_path)
    except Exception as err:
        logger.error("Error discovering input videos: %s", err)
        return 1

    if not video_files:
        logger.warning(
            "No video files (.mp4, .avi) found in '%s'. Place test videos in '%s' or specify `--input /path/to/video.mp4`.",
            input_path,
            config.INPUT_VIDEOS_DIR,
        )
        return 0

    logger.info(
        "Initializing Elderly Fall Detection Pipeline (YOLO=%s, VLM=%s, MockVLM=%s)",
        args.yolo_model,
        args.vlm_model,
        args.mock_vlm,
    )

    pipeline = ElderlyFallPipeline(
        yolo_model=args.yolo_model,
        vlm_model=args.vlm_model,
        mock_vlm=args.mock_vlm,
    )

    summaries = []
    for video_file in video_files:
        try:
            summary = pipeline.process_video(video_file)
            summaries.append(summary)
        except Exception as exc:
            logger.exception("Failed to process video '%s': %s", video_file.name, exc)

    logger.info("=" * 70)
    logger.info("Pipeline Execution Complete. Processed %d video(s).", len(summaries))
    for item in summaries:
        logger.info(
            " - %s: %d frames, %d VLM triggers -> %s",
            item["video"],
            item["frames_processed"],
            item["vlm_events_triggered"],
            item["output_video"],
        )
    logger.info("Structured Event Log: %s", config.EVENTS_LOG_PATH)
    logger.info("Stitched Evidence Snapshots: %s", config.SNAPSHOTS_DIR)
    logger.info("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
