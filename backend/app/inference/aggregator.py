"""Temporal aggregation of per-frame predictions into user-facing observations.

Single frames are noisy (motion blur, a blink, lighting flicker). Observations
shown to the user and sent to the LLM are built from a sliding window of the
last N frames per (model, region): the median positive score of non-abstained
frames, re-thresholded. Fewer than ``min_frames`` usable frames → inconclusive.
Model Lab still shows the raw per-frame predictions.
"""

from __future__ import annotations

from collections import defaultdict, deque
from statistics import median

from app.schemas.protocol import Decision, Observation, Prediction, QualityStatus, StructuredObservations
from app.timeutil import now_ms


class ObservationAggregator:
    def __init__(self, window: int = 5, min_frames: int = 3):
        self.window = window
        self.min_frames = min_frames
        self._hist: dict[tuple[str, str], deque[Prediction]] = defaultdict(lambda: deque(maxlen=window))
        self.last_quality: str = QualityStatus.unusable.value
        self.last_issues: list[str] = []

    def add(self, predictions: list[Prediction], quality_status: str, issues: list[str]) -> None:
        self.last_quality = quality_status
        self.last_issues = issues
        for p in predictions:
            self._hist[(p.model_id, p.region)].append(p)

    def reset(self) -> None:
        self._hist.clear()

    def observations(self) -> StructuredObservations:
        obs: list[Observation] = []
        for (model_id, region), preds in sorted(self._hist.items()):
            latest = preds[-1]
            if latest.decision == Decision.unavailable.value:
                obs.append(Observation(region=region, feature=latest.feature, confidence=None, status="unavailable", present=None,
                                       model_id=model_id, model_version=latest.model_version, model_tier=latest.model_tier, frames_aggregated=0))
                continue
            usable = [p for p in preds if p.decision != Decision.abstained.value and p.positive_probability is not None]
            if len(usable) < self.min_frames:
                status = "abstained" if latest.decision == Decision.abstained.value else "inconclusive"
                conf = round(median(p.positive_probability for p in usable), 3) if usable else None  # type: ignore[misc]
                obs.append(Observation(region=region, feature=latest.feature, confidence=conf, status=status, present=None,
                                       model_id=model_id, model_version=latest.model_version, model_tier=latest.model_tier,
                                       frames_aggregated=len(usable)))
                continue
            pos = median(p.positive_probability for p in usable)  # type: ignore[misc]
            thr = latest.threshold
            if pos >= thr:
                status, present = "accepted", True
            elif (1 - pos) >= thr:
                status, present = "accepted", False
            else:
                status, present = "inconclusive", None
            obs.append(Observation(region=region, feature=latest.feature, confidence=round(pos, 3), status=status, present=present,
                                   model_id=model_id, model_version=latest.model_version, model_tier=latest.model_tier,
                                   frames_aggregated=len(usable)))
        return StructuredObservations(
            image_quality=self.last_quality,  # type: ignore[arg-type]
            quality_issues=self.last_issues,
            observations=obs,
            demo_mode=any(o.model_tier == "demo" for o in obs),
            generated_at=now_ms(),
        )
