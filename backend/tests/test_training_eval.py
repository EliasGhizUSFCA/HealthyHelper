import numpy as np
import pytest

from evaluation.metrics import confusion_matrix, expected_calibration_error, per_class_metrics, summarize
from training.data import Sample, assert_no_leakage, grouped_split


def samples(n_subj=40, per=5):
    return [Sample(path=None, label="a" if (s + k) % 2 else "b", subject_id=f"s{s}", meta={}) for s in range(n_subj) for k in range(per)]


def test_grouped_split_has_no_subject_leakage():
    sp = grouped_split(samples(), seed=3)
    assert_no_leakage(sp)
    assert all(sp[k] for k in ("train", "val", "test"))
    assert sum(len(v) for v in sp.values()) == 200
    assert grouped_split(samples(), seed=3)["test"] == sp["test"]  # deterministic


def test_leakage_detected():
    s = samples(4, 2)
    with pytest.raises(AssertionError):
        assert_no_leakage({"train": s[:3], "val": s[1:4], "test": []})


def test_metrics_basic():
    y = np.array([0, 0, 1, 1])
    p = np.array([0, 1, 1, 1])
    cm = confusion_matrix(y, p, 2)
    assert cm.tolist() == [[1, 1], [0, 2]]
    m = per_class_metrics(cm, ["a", "b"])
    assert m["b"]["precision"] == pytest.approx(2 / 3) and m["b"]["recall"] == 1.0 and m["a"]["false_negative_rate"] == 0.5


def test_ece_zero_for_perfect_calibration():
    probs = np.array([[1.0, 0.0]] * 10 + [[0.0, 1.0]] * 10)
    y = np.array([0] * 10 + [1] * 10)
    assert expected_calibration_error(probs, y)[0] == pytest.approx(0.0)
    s = summarize(probs, y, ["a", "b"], 0.7)
    assert s["accuracy"] == 1 and s["selective"]["coverage"] == 1


def test_temperature_scaling_reduces_overconfidence():
    from training.calibration import fit_temperature

    rng = np.random.default_rng(0)
    y = rng.integers(0, 2, 500)
    logits = np.zeros((500, 2))
    correct = rng.random(500) < 0.75
    pred = np.where(correct, y, 1 - y)
    logits[np.arange(500), pred] = 6.0  # very overconfident 75%-accurate model
    assert fit_temperature(logits, y) > 2.0


def test_synthetic_train_smoke(tmp_path):
    """End-to-end: synthetic data → train (1 epoch) → artifact → registry load → inference."""
    from app.config import Settings
    from app.inference.registry import ModelRegistry
    from training.synthetic import generate
    from training.train import TrainConfig, run

    man = generate("lip_dryness", tmp_path / "data", n_subjects=24, per_subject=3, size=64, seed=0)
    out = run(TrainConfig(model_id="lip_dryness", manifest=str(man), backbone="small_cnn", input_size=48, epochs=1, batch_size=16,
                          out_dir=str(tmp_path / "models"), runs_dir=str(tmp_path / "runs"), tracker="json"))
    for f in ("weights.pt", "model_card.json", "eval_report.json", "eval_report.md"):
        assert (out / f).exists()
    reg = ModelRegistry(Settings(models_dir=tmp_path / "models"))
    reg.load_all()
    lm = reg.get("lip_dryness")
    assert lm is not None and lm.card.tier == "demo" and lm.card.metrics["n"] > 0
    info = lm.info()
    assert "synthetic" in info.status_message.lower()
