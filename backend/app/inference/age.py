"""Apparent-age range post-processing (uncertainty summaries)."""

from __future__ import annotations

import math

import numpy as np

from app.cv.imaging import encode_jpeg_data_url, encode_png_data_url
from app.inference.catalog import AGE_MIDPOINTS
from app.inference.preprocess import denormalize, tensor_stats
from app.schemas.protocol import AgeEstimate, Decision, ModelInput, ModelTier, QualityStatus, TensorStats

AGE_DISCLAIMER = ("Apparent age is how old a face LOOKS to the model in this image — lighting, makeup, expression and camera all change it. "
                  "It is not your age, it is not stored, it is never used for health statements, and recommendations only use an age range you confirm.")


def plausible_set(p: np.ndarray, mass: float = 0.8) -> tuple[int, int]:
    """Smallest contiguous window of ordered ranges whose probability sum is >= mass."""
    best = (0, len(p) - 1)
    for i in range(len(p)):
        acc = 0.0
        for j in range(i, len(p)):
            acc += p[j]
            if acc >= mass:
                if j - i < best[1] - best[0]:
                    best = (i, j)
                break
    return best


def summarize_age(lm, pr: np.ndarray, quality, ms: float, chw, raw, return_inputs: bool) -> AgeEstimate:
    classes = lm.card.classes
    top = int(np.argmax(pr))
    mids = np.array([AGE_MIDPOINTS.get(c, np.nan) for c in classes])
    expected = float(np.nansum(pr * mids)) if not np.isnan(mids).all() else None
    lo, hi = plausible_set(pr)
    entropy = float(-sum(p * math.log2(p) for p in pr if p > 0))
    thr = lm.card.default_threshold
    if quality is not None and quality.status == QualityStatus.poor.value:
        thr = min(0.95, thr + 0.1)
    accepted = pr[top] >= thr
    model_input = None
    if return_inputs:
        model_input = ModelInput(raw_size=[int(raw.shape[1]), int(raw.shape[0])], raw_preview_b64=encode_jpeg_data_url(raw, 80),
                                 tensor_preview_b64=encode_png_data_url(denormalize(chw, lm.preprocess_cfg)), tensor=TensorStats(**tensor_stats(chw)),
                                 transforms=lm.preprocess_cfg.describe())
    return AgeEstimate(
        model_id=lm.card.model_id, model_version=lm.card.version, model_tier=ModelTier(lm.card.tier), classes=classes,
        probabilities=[round(float(v), 4) for v in pr], top_range=classes[top], top_probability=round(float(pr[top]), 4),
        expected_age_years=round(expected, 1) if expected is not None else None, plausible_ranges=list(classes[lo:hi + 1]),
        entropy_bits=round(entropy, 3), decision=Decision.accepted if accepted else Decision.inconclusive,
        decision_reason=(f"top range {pr[top]:.2f} ≥ {thr:.2f}" if accepted else f"top range {pr[top]:.2f} < {thr:.2f}: showing a wider plausible span"),
        latency_ms=round(ms, 3), input=model_input, disclaimer=AGE_DISCLAIMER,
    )
