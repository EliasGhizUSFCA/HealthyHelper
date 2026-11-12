import numpy as np

from app.inference.aggregator import ObservationAggregator
from app.inference.decision import decide
from app.schemas.protocol import PIPELINE_ORDER, ClientExplain, ClientFrame, ImageQuality
from app.sessions import SessionState
from tests.conftest import data_url, frame_payload, textured


def run(services, payload, state=None):
    state = state or services.sessions.get_or_create(None)
    return services.engine.process_frame(state, ClientFrame.model_validate(payload), 0.0, 0.0), state


def test_predictions_are_real_probabilities(services):
    res, _ = run(services, frame_payload(1, options=None) if False else frame_payload(1))
    lips = [p for p in res.predictions if p.model_id == "lip_dryness"]
    assert len(lips) == 1
    p = lips[0]
    assert abs(sum(p.probabilities) - 1) < 1e-3 and p.top_class in p.classes and p.latency_ms > 0
    eyes = [p for p in res.predictions if p.model_id == "eye_redness"]
    assert {p.region for p in eyes} == {"left_eye", "right_eye"}


def test_unloaded_models_report_unavailable_without_scores(services):
    res, _ = run(services, frame_payload(1, regions=("nose", "skin_forehead")))
    un = [p for p in res.predictions if p.model_id in ("nasal_redness", "skin_flaking")]
    assert un and all(p.decision == "unavailable" and p.probabilities == [] and p.top_probability is None for p in un)


def test_high_threshold_gives_inconclusive(services):
    res, _ = run(services, frame_payload(1, regions=("lips",), thresholds={"lip_dryness": 0.999}))
    (p,) = [p for p in res.predictions if p.model_id == "lip_dryness"]
    assert p.decision == "inconclusive" and p.threshold == 0.999


def test_dark_crop_abstains_and_skips_model(services):
    dark = np.full((96, 96, 3), 5, np.uint8)
    res, _ = run(services, frame_payload(1, regions=("lips",), img=dark))
    (p,) = [p for p in res.predictions if p.model_id == "lip_dryness"]
    assert p.decision == "abstained" and p.probabilities == [] and "too_dark" in p.decision_reason
    assert any(e.stage == "cv_inference" and e.status == "skipped" for e in res.events)


def test_unusable_frame_skips_inference(services):
    res, _ = run(services, frame_payload(1, quality="unusable"))
    assert all(p.decision in ("abstained", "unavailable") for p in res.predictions)
    assert any(e.stage == "preprocessing" and e.status == "skipped" for e in res.events)


def test_return_inputs_previews(services):
    res, _ = run(services, frame_payload(1, regions=("lips",), return_inputs=True))
    (p,) = [p for p in res.predictions if p.model_id == "lip_dryness"]
    assert p.input.tensor.shape == [1, 3, 64, 64]
    assert p.input.raw_preview_b64.startswith("data:image/jpeg") and p.input.tensor_preview_b64.startswith("data:image/png")
    assert p.input.raw_size == [96, 96]


def test_events_are_ordered_and_timed(services):
    res, state = run(services, frame_payload(1))
    res2, _ = run(services, frame_payload(2), state)
    seqs = [e.seq for e in res.events + res2.events]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    order = [PIPELINE_ORDER.index(e.stage) for e in res.events]
    assert order == sorted(order), "server stages must be emitted in pipeline order"
    assert all(e.duration_ms >= 0 and e.session_id == state.session_id and e.frame_id == 1 for e in res.events)


def test_aggregator_requires_min_frames(services):
    state = SessionState("s" * 10, aggregator=ObservationAggregator(window=4, min_frames=3))
    for i in range(2):
        res, _ = run(services, frame_payload(i, regions=("lips",)), state)
    (o,) = [o for o in res.observations.observations if o.model_id == "lip_dryness"]
    assert o.status == "inconclusive" and o.present is None and o.frames_aggregated == 2
    res, _ = run(services, frame_payload(3, regions=("lips",), thresholds={"lip_dryness": 0.5}), state)
    (o,) = [o for o in res.observations.observations if o.model_id == "lip_dryness"]
    assert o.frames_aggregated == 3 and o.status == "accepted" and isinstance(o.present, bool)
    assert res.observations.demo_mode is True


def test_decide_rules():
    ok = ImageQuality(status="acceptable")
    poor = ImageQuality(status="poor", issues=["blurry"])
    bad = ImageQuality(status="unusable", issues=["too_dark"])
    assert decide([0.8, 0.2], ["a", "b"], 0.7, ok)[0] == "accepted"
    assert decide([0.6, 0.4], ["a", "b"], 0.7, ok)[0] == "inconclusive"
    assert decide([0.75, 0.25], ["a", "b"], 0.7, poor)[0] == "inconclusive"  # stricter under poor quality
    assert decide([0.99, 0.01], ["a", "b"], 0.7, bad)[0] == "abstained"


def test_gradcam_explanation(services):
    exp = services.engine.explain(ClientExplain(request_id="r1", model_id="lip_dryness", region="lips", image_b64=data_url(textured())))
    assert exp.method == "grad-cam" and exp.heatmap_b64.startswith("data:image/png") and "Approximate" in exp.caveat
    assert 0 <= exp.target_probability <= 1


def test_gradcam_map_is_normalised(services):
    from app.inference.gradcam import grad_cam
    from app.inference.preprocess import preprocess

    lm = services.registry.get("lip_dryness")
    cam, idx, prob = grad_cam(lm, preprocess(textured(), lm.preprocess_cfg))
    assert cam.shape == (64, 64) and cam.min() >= 0 and cam.max() <= 1


def test_onnx_runtime_matches_torch(tmp_path, services):
    import pytest

    pytest.importorskip("onnx")
    import json
    import subprocess
    import sys
    from pathlib import Path

    lm = services.registry.get("lip_dryness")
    root = Path(__file__).resolve().parents[2]
    r = subprocess.run([sys.executable, str(root / "scripts" / "export_onnx.py"), "--model-dir", str(lm.path)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    from app.inference.registry import load_artifact

    s2 = services.settings.__class__(**{**services.settings.__dict__, "runtime": "onnx"})
    onnx_lm = load_artifact(lm.path, s2)
    assert onnx_lm.runtime == "onnx"
    from app.inference.preprocess import preprocess

    x = preprocess(textured(), lm.preprocess_cfg)[None]
    np.testing.assert_allclose(onnx_lm.predict_proba(x), lm.predict_proba(x), atol=1e-4)
    assert json.loads((lm.path / "model_card.json").read_text())["onnx_file"] == "model.onnx"
