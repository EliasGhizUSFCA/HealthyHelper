"""Opt-in apparent-age estimation: gating, uncertainty, isolation from observations/LLM, metrics."""

import numpy as np
import pytest

from app.inference.age import plausible_set
from app.schemas.protocol import ClientFrame
from evaluation.age_metrics import age_report
from tests.conftest import data_url, make_artifact, textured


@pytest.fixture()
def age_services(settings):
    from app.services import build_services

    make_artifact(settings.models_dir, "apparent_age", seed=3)
    return build_services(settings)


def frame(enable_age: bool, with_face=True):
    regions = [{"region": "lips", "bbox": [0, 0, .1, .1], "image_b64": data_url(textured())}]
    if with_face:
        regions.append({"region": "face", "bbox": [0, 0, .5, .5], "image_b64": data_url(textured(160, (190, 150, 130)))})
    return ClientFrame.model_validate({"type": "frame", "frame_id": 1, "captured_at": 1.0, "quality": {"status": "acceptable"}, "regions": regions,
                                       "options": {"enable_age": enable_age, "return_inputs": True}})


def run(svc, f):
    return svc.engine.process_frame(svc.sessions.get_or_create(None), f, 0.0, 0.0)


def test_age_off_by_default_and_face_crop_ignored(age_services):
    res = run(age_services, frame(enable_age=False))
    assert res.age is None
    assert not any(e.stage == "age_estimation" for e in res.events)
    assert all(p.region != "face" for p in res.predictions)


def test_age_opt_in_returns_distribution_with_uncertainty(age_services):
    res = run(age_services, frame(enable_age=True))
    a = res.age
    assert a is not None and a.model_id == "apparent_age" and len(a.probabilities) == 6
    assert abs(sum(a.probabilities) - 1) < 1e-3 and a.top_range in a.classes and a.plausible_ranges
    assert a.entropy_bits is not None and a.expected_age_years is not None and "not your age" in a.disclaimer
    assert a.input.tensor.shape == [1, 3, 64, 64]
    assert any(e.stage == "age_estimation" and e.model_id == "apparent_age" for e in res.events)
    # age never leaks into the observations that feed the LLM
    assert "age" not in res.observations.model_dump_json().replace("image", "")


def test_age_unavailable_and_abstain(services):
    res = run(services, frame(enable_age=True))
    assert res.age.decision == "unavailable" and res.age.probabilities == []


def test_age_abstains_without_face(age_services):
    res = run(age_services, frame(enable_age=True, with_face=False))
    assert res.age.decision == "abstained" and "no face crop" in res.age.decision_reason


def test_plausible_span():
    assert plausible_set(np.array([0.05, 0.6, 0.3, 0.05, 0, 0])) == (1, 2)
    assert plausible_set(np.array([1 / 6] * 6)) in [(0, 4), (1, 5)]


def test_age_metrics():
    classes = ["under_20", "20_29", "30_39", "40_49", "50_59", "60_plus"]
    y = np.array([0, 1, 2, 3, 4, 5] * 10)
    perfect = np.eye(6)[y]
    r = age_report(perfect, y, classes, {"gender": ["a", "b"] * 30})
    assert r["overall"]["range_accuracy"] == 1 and r["overall"]["mae_years_expected_vs_midpoint"] == 0
    assert r["subgroups"]["gender_gap"]["range_accuracy_max_minus_min"] == 0
    shifted = np.eye(6)[np.clip(y + 1, 0, 5)]
    r2 = age_report(shifted, y, classes)
    assert r2["overall"]["within_one_range"] == 1 and r2["overall"]["range_accuracy"] < 1
