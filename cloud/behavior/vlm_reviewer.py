"""
Tier 2 Multi-Hazard Vision-LLM Reviewer (`cloud/behavior/vlm_reviewer.py`).
Stitches `T - 2 Seconds` vs `Current` frames and invokes an Open-Source Vision-LLM
via Ollama as an Emergency Medical & Safety Visual Triage AI.
"""

import base64
import json
import logging
import re
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
import requests
from pydantic import BaseModel, Field, ValidationError

import config

logger = logging.getLogger(__name__)

HazardCategoryLiteral = Literal[
    "FALL",
    "STROKE_OR_MEDICAL_DISTRESS",
    "UNCONSCIOUS_SLUMP",
    "DOMESTIC_ACCIDENT",
    "NORMAL_ACTIVITY",
]

SeverityLiteral = Literal["CRITICAL", "WARNING", "SAFE"]


class VLMVerificationResult(BaseModel):
    """
    Strict Pydantic schema for the upgraded Multi-Hazard Tier 2 Vision-LLM JSON output.
    """
    is_emergency: bool = Field(
        ...,
        description="True if an emergency or hazardous medical/safety event is occurring.",
    )
    hazard_category: HazardCategoryLiteral = Field(
        ...,
        description="Primary hazard category classification.",
    )
    severity: SeverityLiteral = Field(
        ...,
        description="Clinical/safety urgency level: CRITICAL, WARNING, or SAFE.",
    )
    detected_symptoms: list[str] = Field(
        default_factory=list,
        description="Visual cues observed on the person (e.g., clutching chest, slumped head, lying on floor).",
    )
    environmental_hazards: list[str] = Field(
        default_factory=list,
        description="Surrounding dangers observed (e.g., overturned chair, spilled liquid, none).",
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Model confidence score between 0.0 and 1.0.",
    )
    explanation: str = Field(
        ...,
        description="Detailed clinical and contextual explanation of what happened between T-2s and Current frame.",
    )


class VLMReviewer:
    """
    Packages temporal visual evidence (T-2s and Current frame) into a composite
    snapshot and queries an Ollama Vision-LLM (or deterministic mock fallback)
    using the multi-hazard triage schema.
    """

    def __init__(
        self,
        model_name: str = config.DEFAULT_VLM_MODEL,
        api_url: str = config.OLLAMA_API_URL,
        mock_mode: bool = False,
    ) -> None:
        self.model_name = model_name
        self.api_url = api_url
        self.mock_mode = mock_mode

    @staticmethod
    def _add_header_banner(
        frame: np.ndarray, label: str, bg_color: tuple
    ) -> np.ndarray:
        """Adds a clean top title bar to a frame prior to horizontal stitching."""
        annotated = frame.copy()
        h, w = annotated.shape[:2]
        banner_height = max(40, int(h * 0.08))

        cv2.rectangle(annotated, (0, 0), (w, banner_height), bg_color, -1)
        cv2.putText(
            annotated,
            label,
            (14, int(banner_height * 0.70)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.70,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.rectangle(annotated, (0, 0), (w - 1, h - 1), (200, 200, 200), 2)
        return annotated

    def create_stitched_evidence(
        self,
        frame_a: np.ndarray,
        frame_b: np.ndarray,
        save_path: Path,
        tier1_trigger_reason: str = "low_posture",
    ) -> np.ndarray:
        """
        Stitches Frame_A (T - 2 Seconds) and Frame_B (Current) horizontally using
        cv2.hconcat with header labels.
        """
        if frame_a.shape[:2] != frame_b.shape[:2]:
            frame_a = cv2.resize(frame_a, (frame_b.shape[1], frame_b.shape[0]))

        right_label = (
            "Current (Suspected Fall)"
            if tier1_trigger_reason == "low_posture"
            else f"Current ({tier1_trigger_reason})"
        )

        left_panel = self._add_header_banner(
            frame_a, "T - 2 Seconds", bg_color=(60, 60, 60)
        )
        right_panel = self._add_header_banner(
            frame_b, right_label, bg_color=(0, 0, 180)
        )

        stitched = cv2.hconcat([left_panel, right_panel])
        save_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(save_path), stitched)
        return stitched

    @staticmethod
    def encode_image_base64(image: np.ndarray) -> str:
        """Encodes an OpenCV BGR image array into a JPEG base64 string."""
        success, buffer = cv2.imencode(
            ".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 90]
        )
        if not success:
            raise ValueError("Failed to encode stitched image to JPEG buffer.")
        return base64.b64encode(buffer.tobytes()).decode("utf-8")

    def build_prompt(
        self,
        tier1_trigger_reason: str = "low_posture",
        reasons: list[str] | None = None,
    ) -> str:
        """Builds the context-aware Emergency Medical & Safety Visual Triage AI prompt."""
        reason_str = ", ".join(reasons) if reasons else tier1_trigger_reason
        return config.VLM_SYSTEM_PROMPT_TEMPLATE.format(
            tier1_trigger_reason=tier1_trigger_reason,
            anomaly_reasons=reason_str,
        )

    def verify_anomaly(
        self,
        stitched_image: np.ndarray,
        tier1_trigger_reason: str = "low_posture",
        reasons: list[str] | None = None,
    ) -> VLMVerificationResult:
        """
        Sends the stitched side-by-side image and `tier1_trigger_reason` context to
        the Ollama Vision-LLM endpoint and parses the structured JSON judgment.
        """
        if self.mock_mode:
            return self._mock_response(
                tier1_trigger_reason=tier1_trigger_reason,
                reasons=reasons,
                note="[Mock Mode]",
            )

        try:
            b64_image = self.encode_image_base64(stitched_image)
            prompt = self.build_prompt(
                tier1_trigger_reason=tier1_trigger_reason,
                reasons=reasons,
            )
            payload = {
                "model": self.model_name,
                "prompt": prompt,
                "images": [b64_image],
                "format": "json",
                "stream": False,
                "options": {
                    "temperature": 0.1,
                },
            }

            response = requests.post(
                self.api_url,
                json=payload,
                timeout=config.VLM_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            data = response.json()
            raw_text = data.get("response", "").strip()
            return self._parse_vlm_json(
                raw_text, tier1_trigger_reason=tier1_trigger_reason
            )

        except requests.exceptions.RequestException as req_err:
            logger.warning(
                "Ollama API unreachable (%s). Falling back to Mock/Heuristic VLM response.",
                req_err,
            )
            return self._mock_response(
                tier1_trigger_reason=tier1_trigger_reason,
                reasons=reasons,
                note="[Fallback: Ollama Offline]",
            )
        except (ValueError, KeyError, OSError) as err:
            logger.error("Unexpected error during VLM verification: %s", err)
            return self._mock_response(
                tier1_trigger_reason=tier1_trigger_reason,
                reasons=reasons,
                note=f"[Fallback: VLM Error ({type(err).__name__})]",
            )

    def _parse_vlm_json(
        self, raw_text: str, tier1_trigger_reason: str = "low_posture"
    ) -> VLMVerificationResult:
        """Extracts and validates the multi-hazard JSON object from the VLM response."""
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)

        start_idx = cleaned.find("{")
        end_idx = cleaned.rfind("}")
        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            cleaned = cleaned[start_idx : end_idx + 1]

        try:
            parsed_dict = json.loads(cleaned)

            # Normalize hazard_category
            valid_categories = {
                "FALL",
                "STROKE_OR_MEDICAL_DISTRESS",
                "UNCONSCIOUS_SLUMP",
                "DOMESTIC_ACCIDENT",
                "NORMAL_ACTIVITY",
            }
            raw_cat = str(
                parsed_dict.get(
                    "hazard_category",
                    parsed_dict.get("hazard_type", "FALL"),
                )
            ).strip().upper()
            if raw_cat not in valid_categories:
                legacy_map = {
                    "FALL": "FALL",
                    "FAINT": "UNCONSCIOUS_SLUMP",
                    "NORMAL_LYING": "NORMAL_ACTIVITY",
                    "BENDING": "NORMAL_ACTIVITY",
                }
                raw_cat = legacy_map.get(raw_cat, "FALL")
            parsed_dict["hazard_category"] = raw_cat

            # Normalize severity
            valid_severities = {"CRITICAL", "WARNING", "SAFE"}
            raw_sev = str(parsed_dict.get("severity", "")).strip().upper()
            if raw_sev not in valid_severities:
                if parsed_dict.get("is_emergency", True):
                    raw_sev = "CRITICAL"
                else:
                    raw_sev = "SAFE"
            parsed_dict["severity"] = raw_sev

            if not isinstance(parsed_dict.get("detected_symptoms"), list):
                parsed_dict["detected_symptoms"] = ["posture anomaly detected"]
            if not isinstance(parsed_dict.get("environmental_hazards"), list):
                parsed_dict["environmental_hazards"] = ["none"]

            return VLMVerificationResult(**parsed_dict)

        except (json.JSONDecodeError, ValidationError) as parse_err:
            logger.warning(
                "Failed to parse VLM JSON output (%s). Raw text: %s",
                parse_err,
                raw_text,
            )
            fallback = self._mock_response(
                tier1_trigger_reason=tier1_trigger_reason,
                reasons=None,
                note="[Unstructured VLM Output Fallback]",
            )
            fallback.confidence = 0.50
            fallback.explanation = (
                f"Unstructured VLM output received; treating with caution. Raw: {raw_text[:120]}"
            )
            return fallback

    @staticmethod
    def _mock_response(
        tier1_trigger_reason: str = "low_posture",
        reasons: list[str] | None = None,
        note: str = "[Mock VLM]",
    ) -> VLMVerificationResult:
        """
        Generates a realistic, context-aware clinical & safety VLM judgment tailored
        to the specific `tier1_trigger_reason`.
        """
        reason_str = (
            ", ".join(reasons)
            if reasons
            else f"trigger={tier1_trigger_reason}"
        )

        if tier1_trigger_reason == "chest_head_clutching":
            return VLMVerificationResult(
                is_emergency=True,
                hazard_category="STROKE_OR_MEDICAL_DISTRESS",
                severity="CRITICAL",
                detected_symptoms=[
                    "clutching chest/head",
                    "guarded leaning torso posture",
                    "acute medical distress",
                ],
                environmental_hazards=["none"],
                confidence=0.91,
                explanation=(
                    f"{note} Between T-2s and Current frame, the individual brought their hand "
                    f"to their chest/head while leaning forward in distress ({reason_str}), "
                    f"consistent with potential cardiac or neurological emergency."
                ),
            )

        if tier1_trigger_reason == "head_slump":
            return VLMVerificationResult(
                is_emergency=True,
                hazard_category="UNCONSCIOUS_SLUMP",
                severity="CRITICAL",
                detected_symptoms=[
                    "slumped head onto chest",
                    "loss of postural tone outside bed zone",
                ],
                environmental_hazards=["seated furniture edge"],
                confidence=0.88,
                explanation=(
                    f"{note} Individual's head dropped significantly toward the chest line "
                    f"outside the bed zone ({reason_str}), indicating possible syncope or "
                    f"unconsciousness while seated."
                ),
            )

        if tier1_trigger_reason == "erratic_motion":
            return VLMVerificationResult(
                is_emergency=True,
                hazard_category="STROKE_OR_MEDICAL_DISTRESS",
                severity="WARNING",
                detected_symptoms=[
                    "unsteady staggering gait",
                    "lateral torso swaying and loss of balance",
                    "ataxic or dizzy walking pattern",
                ],
                environmental_hazards=["nearby furniture/walls", "hard walking surface"],
                confidence=0.89,
                explanation=(
                    f"{note} Between T-2s and Current frame, the individual exhibited an unsteady, "
                    f"staggering gait with lateral torso sway and balance instability ({reason_str}), "
                    f"indicative of acute dizziness, neurological ataxia, or pre-syncope."
                ),
            )

        if tier1_trigger_reason == "impact_immobility":
            return VLMVerificationResult(
                is_emergency=True,
                hazard_category="DOMESTIC_ACCIDENT",
                severity="WARNING",
                detected_symptoms=[
                    "abrupt motion spike followed by stillness",
                    "prolonged immobility outside bed zone",
                ],
                environmental_hazards=["potential floor/furniture impact"],
                confidence=0.86,
                explanation=(
                    f"{note} Detected sudden erratic motion or prolonged freezing outside "
                    f"normal resting zones ({reason_str}), suggesting a domestic accident or paralysis."
                ),
            )

        # Default: "low_posture" -> FALL
        return VLMVerificationResult(
            is_emergency=True,
            hazard_category="FALL",
            severity="CRITICAL",
            detected_symptoms=[
                "lying on floor",
                "rapid upright-to-horizontal posture collapse",
                "inability to recover standing posture",
            ],
            environmental_hazards=["hard floor surface"],
            confidence=0.92,
            explanation=(
                f"{note} Rapid transition from upright walking posture at T-2s to horizontal "
                f"posture on the floor in the Current frame ({reason_str})."
            ),
        )
