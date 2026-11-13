"""Classification and calibration metrics (pure numpy; no sklearn dependency at serve time)."""

from __future__ import annotations

import numpy as np


def confusion_matrix(y_true: np.ndarray, y_pred: np.ndarray, n: int) -> np.ndarray:
    cm = np.zeros((n, n), dtype=np.int64)
    for t, p in zip(y_true, y_pred):
        cm[int(t), int(p)] += 1
    return cm


def per_class_metrics(cm: np.ndarray, classes: list[str]) -> dict[str, dict[str, float]]:
    out = {}
    total = cm.sum()
    for i, c in enumerate(classes):
        tp = cm[i, i]
        fp = cm[:, i].sum() - tp
        fn = cm[i, :].sum() - tp
        tn = total - tp - fp - fn
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        out[c] = {
            "precision": float(prec), "recall": float(rec), "f1": float(f1),
            "false_positive_rate": float(fp / (fp + tn)) if fp + tn else 0.0,
            "false_negative_rate": float(fn / (fn + tp)) if fn + tp else 0.0,
            "support": int(cm[i, :].sum()),
        }
    return out


def expected_calibration_error(probs: np.ndarray, y_true: np.ndarray, n_bins: int = 10) -> tuple[float, list[dict]]:
    """Top-label ECE with equal-width bins; returns (ece, reliability bins)."""
    conf = probs.max(axis=1)
    pred = probs.argmax(axis=1)
    correct = (pred == y_true).astype(np.float64)
    edges = np.linspace(0, 1, n_bins + 1)
    ece, bins = 0.0, []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi) if lo > 0 else (conf >= lo) & (conf <= hi)
        if m.sum() == 0:
            bins.append({"lo": float(lo), "hi": float(hi), "count": 0, "accuracy": None, "confidence": None})
            continue
        acc, cf = correct[m].mean(), conf[m].mean()
        ece += m.mean() * abs(acc - cf)
        bins.append({"lo": float(lo), "hi": float(hi), "count": int(m.sum()), "accuracy": float(acc), "confidence": float(cf)})
    return float(ece), bins


def brier_score(probs: np.ndarray, y_true: np.ndarray) -> float:
    onehot = np.eye(probs.shape[1])[y_true]
    return float(((probs - onehot) ** 2).sum(axis=1).mean())


def nll(probs: np.ndarray, y_true: np.ndarray) -> float:
    return float(-np.log(np.clip(probs[np.arange(len(y_true)), y_true], 1e-12, 1)).mean())


def selective_metrics(probs: np.ndarray, y_true: np.ndarray, threshold: float) -> dict[str, float]:
    """Accuracy/coverage when the system abstains below ``threshold`` (as served)."""
    conf = probs.max(axis=1)
    keep = conf >= threshold
    cov = float(keep.mean())
    acc = float((probs.argmax(1)[keep] == y_true[keep]).mean()) if keep.any() else float("nan")
    return {"threshold": threshold, "coverage": cov, "selective_accuracy": acc, "abstention_rate": 1 - cov}


def summarize(probs: np.ndarray, y_true: np.ndarray, classes: list[str], threshold: float) -> dict:
    pred = probs.argmax(axis=1)
    cm = confusion_matrix(y_true, pred, len(classes))
    pcm = per_class_metrics(cm, classes)
    ece, bins = expected_calibration_error(probs, y_true)
    return {
        "n": int(len(y_true)),
        "accuracy": float((pred == y_true).mean()) if len(y_true) else float("nan"),
        "macro_f1": float(np.mean([v["f1"] for v in pcm.values()])),
        "per_class": pcm,
        "confusion_matrix": {"labels": classes, "matrix": cm.tolist()},
        "calibration": {"ece": ece, "brier": brier_score(probs, y_true), "nll": nll(probs, y_true), "reliability": bins},
        "selective": selective_metrics(probs, y_true, threshold),
    }
