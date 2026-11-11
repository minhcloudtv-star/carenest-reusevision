"""
Tier 2: Multi-Hazard Evidence Packaging & Vision-Language Model Verifier.
Bridges `cloud.behavior.vlm_reviewer.VLMReviewer` and `VLMVerificationResult` so both
`src.tier2_vlm_verifier` and `cloud.behavior.vlm_reviewer` expose the upgraded
Emergency Medical & Safety Visual Triage AI client and schema.
"""

from cloud.behavior.vlm_reviewer import (
    HazardCategoryLiteral,
    SeverityLiteral,
    VLMReviewer,
    VLMVerificationResult,
)


class Tier2VLMVerifier(VLMReviewer):
    """
    Packages temporal visual evidence (T-2s and Current frame) into a composite
    snapshot and queries an Ollama Vision-LLM using the multi-hazard triage schema.
    """
    pass


__all__ = [
    "HazardCategoryLiteral",
    "SeverityLiteral",
    "Tier2VLMVerifier",
    "VLMReviewer",
    "VLMVerificationResult",
]
