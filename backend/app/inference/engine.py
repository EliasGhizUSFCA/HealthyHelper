"""The server-side inference pipeline for one frame.

    region crops (JPEG) → decode → crop quality gate → preprocess (shared with
    training) → batched per-model inference → decision → temporal aggregation →
    StructuredObservations

Every stage is timed and emitted as a TelemetryEvent; nothing is fabricated —
if a model is not loaded the prediction is ``unavailable`` with no scores.
CPU-bound work runs in a worker thread (see api/ws.py), never on the event loop.
"""

from __future__ import annotations

import numpy as np

from app.config import Settings, get_settings
from app.cv import quality as q
from app.cv.imaging import ImageDecodeError, decode_data_url, encode_jpeg_data_url, encode_png_data_url
from app.inference.catalog import CATALOG
from app.inference.decision import decide
from app.inference.gradcam import CAVEAT, grad_cam
from app.inference.preprocess import denormalize, preprocess, tensor_stats
from app.inference.registry import ModelRegistry
from app.schemas.protocol import (
    ClientExplain,
    ClientFrame,
    Decision,
    Explanation,
    ImageQuality,
    InferenceResult,
    ModelInput,
    ModelTier,
    PipelineStage,
    Prediction,
    QualityStatus,
    TensorStats,
)
from app.sessions import SessionState
from app.timeutil import now_ms, perf_ms


class InferenceEngine:
    def __init__(self, registry: ModelRegistry, settings: Settings | None = None):
        self.registry = registry
        self.settings = settings or get_settings()

    # ------------------------------------------------------------------ frame
    def process_frame(self, state: SessionState, frame: ClientFrame, received_at: float, queue_wait_ms: float) -> InferenceResult:
        rec = state.seq.recorder(state.session_id, frame.frame_id)
        opts = frame.options
        decoded: dict[str, np.ndarray] = {}
        crop_quality: dict[str, ImageQuality] = {}

        # 1. server-side quality gate on each received crop
        with rec.stage(PipelineStage.image_quality, "jpeg region crops", "ImageQuality per region") as h:
            for rc in frame.regions:
                try:
                    decoded[rc.region] = decode_data_url(rc.image_b64, self.settings.max_crop_bytes)
                    crop_quality[rc.region] = q.assess_crop(decoded[rc.region])
                except ImageDecodeError as exc:
                    crop_quality[rc.region] = ImageQuality(status=QualityStatus.unusable, issues=[f"decode_error:{exc}"])
            overall = q.combine(frame.quality, list(crop_quality.values()))
            bad = [r for r, cq in crop_quality.items() if cq.status != QualityStatus.acceptable.value]
            if bad:
                h.warn("degraded regions: " + ", ".join(sorted(bad)))
        frame_unusable = frame.quality.status == QualityStatus.unusable.value

        # 2. preprocess per (model, region)
        jobs: dict[str, list[tuple[str, np.ndarray]]] = {}
        with rec.stage(PipelineStage.preprocessing, "RGB uint8 crops", "float32 NCHW tensors") as h:
            if frame_unusable:
                h.skip("frame quality unusable")
            else:
                for lm in self.registry.loaded():
                    if opts.enabled_models is not None and lm.card.model_id not in opts.enabled_models:
                        continue
                    for region in lm.card.regions:
                        if region in decoded and crop_quality[region].status != QualityStatus.unusable.value:
                            jobs.setdefault(lm.card.model_id, []).append((region, preprocess(decoded[region], lm.preprocess_cfg)))

        # 3. inference, batched per model
        predictions: list[Prediction] = []
        for lm in self.registry.loaded():
            mid = lm.card.model_id
            if opts.enabled_models is not None and mid not in opts.enabled_models:
                continue
            threshold = float(opts.thresholds.get(mid, lm.card.default_threshold))
            pos_idx = lm.card.classes.index(lm.card.positive_class)
            batch_items = jobs.get(mid, [])
            # regions present in the frame but rejected by the quality gate → abstain without running the model
            for region in lm.card.regions:
                if region in crop_quality and (frame_unusable or crop_quality[region].status == QualityStatus.unusable.value):
                    predictions.append(self._abstain(lm, region, threshold, crop_quality[region] if not frame_unusable else frame.quality))
            if not batch_items:
                continue
            with rec.stage(PipelineStage.cv_inference, f"float32[{len(batch_items)},3,{lm.card.input_size},{lm.card.input_size}]",
                           "class probabilities", model_id=mid, model_version=lm.card.version):
                t0 = perf_ms()
                probs = lm.predict_proba(np.stack([b for _, b in batch_items]).astype(np.float32))
                per_item_ms = (perf_ms() - t0) / len(batch_items)
            for (region, chw), pr in zip(batch_items, probs):
                pl = [round(float(v), 4) for v in pr]
                dq = crop_quality[region]
                decision, reason = decide(pl, lm.card.classes, threshold, dq)
                top = int(np.argmax(pr))
                model_input = None
                if opts.return_inputs:
                    model_input = ModelInput(
                        raw_size=[int(decoded[region].shape[1]), int(decoded[region].shape[0])],
                        raw_preview_b64=encode_jpeg_data_url(decoded[region], 80),
                        tensor_preview_b64=encode_png_data_url(denormalize(chw, lm.preprocess_cfg)),
                        tensor=TensorStats(**tensor_stats(chw)),
                        transforms=lm.preprocess_cfg.describe(),
                    )
                predictions.append(Prediction(
                    model_id=mid, model_version=lm.card.version, model_tier=ModelTier(lm.card.tier), region=region,
                    feature=lm.card.feature, classes=lm.card.classes, probabilities=pl, top_class=lm.card.classes[top],
                    top_probability=pl[top], positive_probability=pl[pos_idx], threshold=threshold, decision=decision,
                    decision_reason=reason, latency_ms=round(per_item_ms, 3), input=model_input,
                ))

        # catalogue models with no weights → explicit "unavailable" (never fabricated scores)
        loaded_ids = {m.card.model_id for m in self.registry.loaded()}
        for mid, entry in CATALOG.items():
            if mid in loaded_ids or (opts.enabled_models is not None and mid not in opts.enabled_models):
                continue
            for region in entry.regions:
                if region in decoded:
                    predictions.append(Prediction(
                        model_id=mid, model_version="none", model_tier=ModelTier.unavailable, region=region, feature=entry.feature,
                        classes=list(entry.classes), probabilities=[], top_class=None, top_probability=None, positive_probability=None,
                        threshold=entry.default_threshold, decision=Decision.unavailable, decision_reason="model not loaded", latency_ms=0.0,
                    ))
        if not jobs:
            rec.skipped(PipelineStage.cv_inference, "tensors", "probabilities",
                        "frame quality unusable" if frame_unusable else "no loaded model had a usable region")

        # 4. temporal aggregation → structured observations
        with rec.stage(PipelineStage.structured_observations, "Prediction[]", "StructuredObservations"):
            state.aggregator.add(predictions, str(overall.status), overall.issues)
            observations = state.aggregator.observations()
            state.latest_observations = observations

        return InferenceResult(
            session_id=state.session_id, frame_id=frame.frame_id, captured_at=frame.captured_at, received_at=received_at,
            completed_at=now_ms(), queue_wait_ms=round(queue_wait_ms, 3), image_quality=overall, predictions=predictions,
            observations=observations, events=rec.events,
        )

    def _abstain(self, lm, region: str, threshold: float, quality: ImageQuality) -> Prediction:
        return Prediction(
            model_id=lm.card.model_id, model_version=lm.card.version, model_tier=ModelTier(lm.card.tier), region=region,
            feature=lm.card.feature, classes=lm.card.classes, probabilities=[], top_class=None, top_probability=None,
            positive_probability=None, threshold=threshold, decision=Decision.abstained,
            decision_reason="quality gate: " + ", ".join(quality.issues or ["unusable"]), latency_ms=0.0,
        )

    # ---------------------------------------------------------------- explain
    def explain(self, req: ClientExplain) -> Explanation:
        lm = self.registry.get(req.model_id)
        if lm is None:
            raise LookupError(f"model {req.model_id!r} not loaded")
        if lm.torch_model is None:
            raise RuntimeError("explainability needs torch weights for this model")
        t0 = perf_ms()
        rgb = decode_data_url(req.image_b64, self.settings.max_crop_bytes)
        chw = preprocess(rgb, lm.preprocess_cfg)
        target = lm.card.classes.index(req.target_class) if req.target_class in lm.card.classes else None
        cam, idx, prob = grad_cam(lm, chw, target)
        from app.cv.imaging import colorize_heatmap

        return Explanation(
            request_id=req.request_id, model_id=lm.card.model_id, model_version=lm.card.version, region=req.region,
            method="grad-cam", target_class=lm.card.classes[idx], target_probability=round(prob, 4),
            input_b64=encode_png_data_url(denormalize(chw, lm.preprocess_cfg)),
            heatmap_b64=encode_png_data_url(colorize_heatmap(cam)), latency_ms=round(perf_ms() - t0, 2), caveat=CAVEAT,
        )
