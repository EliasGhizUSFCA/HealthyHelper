"""Turning classifier scores into accept / inconclusive / abstain decisions.

Design: 'inconclusive' is an *abstention outcome*, not a trained class. A
binary classifier (visible feature vs. no clearly visible feature) produces
calibrated scores; the system accepts the top class only if its score clears
the threshold AND the crop passed the quality gate. This keeps the label space
honest (annotators label what they see) and makes abstention tunable.
"""

from __future__ import annotations

from app.schemas.protocol import Decision, ImageQuality, QualityStatus


def decide(probabilities: list[float], classes: list[str], threshold: float, quality: ImageQuality) -> tuple[Decision, str]:
    if quality.status == QualityStatus.unusable.value or quality.status == QualityStatus.unusable:
        return Decision.abstained, "quality gate: " + ", ".join(quality.issues or ["unusable"])
    top = max(range(len(probabilities)), key=lambda i: probabilities[i])
    p = probabilities[top]
    if quality.status in (QualityStatus.poor, QualityStatus.poor.value):
        # Poor quality: require a stricter margin before accepting.
        strict = min(0.99, threshold + 0.1)
        if p < strict:
            return Decision.inconclusive, f"poor quality ({', '.join(quality.issues)}); score {p:.2f} < strict threshold {strict:.2f}"
        return Decision.accepted, f"score {p:.2f} ≥ strict threshold {strict:.2f} despite poor quality"
    if p < threshold:
        return Decision.inconclusive, f"top score {p:.2f} < threshold {threshold:.2f}"
    return Decision.accepted, f"{classes[top]} score {p:.2f} ≥ threshold {threshold:.2f}"
