"""Reproducible evaluation of a model artifact.

Reports precision / recall / F1 / confusion matrix / FPR / FNR / calibration
(ECE, Brier, NLL, reliability bins) / selective (abstention) metrics, broken
down by metadata slices (e.g. skin_tone_group, lighting, blur, angle_bucket) and
under controlled perturbations (blur, under/over-exposure, noise, JPEG), plus
inference latency (p50/p95) for batch size 1 on the current device.

The test split is recomputed from the manifest with the *same* seed used in
training, so evaluation is reproducible and subject-disjoint.

    python -m evaluation.evaluate --model-dir ../models/lip_dryness/<version> --manifest data/.../manifest.csv
"""

from __future__ import annotations

import argparse
import json
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

from app.inference.preprocess import preprocess
from evaluation.metrics import summarize

PERTURBATIONS = {
    "none": lambda im: im,
    "gaussian_blur_s2": lambda im: cv2.GaussianBlur(im, (0, 0), 2.0),
    "underexposed_x0.5": lambda im: np.clip(im.astype(np.float32) * 0.5, 0, 255).astype(np.uint8),
    "overexposed_x1.6": lambda im: np.clip(im.astype(np.float32) * 1.6, 0, 255).astype(np.uint8),
    "sensor_noise_s12": lambda im: np.clip(im + np.random.default_rng(0).normal(0, 12, im.shape), 0, 255).astype(np.uint8),
    "jpeg_q25": lambda im: cv2.imdecode(cv2.imencode(".jpg", im, [cv2.IMWRITE_JPEG_QUALITY, 25])[1], cv2.IMREAD_UNCHANGED),
}


def predict(lm, images: list[np.ndarray], batch: int = 64) -> np.ndarray:
    cfg = lm.preprocess_cfg
    out = []
    for i in range(0, len(images), batch):
        x = np.stack([preprocess(im, cfg) for im in images[i : i + batch]]).astype(np.float32)
        out.append(lm.predict_proba(x))
    return np.concatenate(out) if out else np.zeros((0, len(lm.card.classes)))


def latency(lm, image: np.ndarray, n: int = 50) -> dict[str, float]:
    x = preprocess(image, lm.preprocess_cfg)[None].astype(np.float32)
    for _ in range(5):
        lm.predict_proba(x)
    ts = []
    for _ in range(n):
        t0 = time.perf_counter()
        lm.predict_proba(x)
        ts.append((time.perf_counter() - t0) * 1000)
    return {"p50_ms": float(np.percentile(ts, 50)), "p95_ms": float(np.percentile(ts, 95)), "n": n, "device": lm.device, "runtime": lm.runtime}


def evaluate_samples(lm, samples, threshold: float | None = None, slice_keys: list[str] | None = None, perturb: bool = True) -> dict:
    from training.data import load_rgb

    classes = lm.card.classes
    thr = lm.card.default_threshold if threshold is None else threshold
    images = [load_rgb(s.path) for s in samples]
    y = np.array([classes.index(s.label) for s in samples])
    probs = predict(lm, images)
    report: dict = {"overall": summarize(probs, y, classes, thr)}
    keys = slice_keys if slice_keys is not None else sorted({k for s in samples for k in s.meta if k not in {"severity", "source"}})
    slices: dict[str, dict] = {}
    for k in keys:
        groups: dict[str, list[int]] = defaultdict(list)
        for i, s in enumerate(samples):
            groups[str(s.meta.get(k, "unknown"))].append(i)
        slices[k] = {g: summarize(probs[idx], y[idx], classes, thr) for g, idx in sorted(groups.items()) if len(idx) >= 5}
        for v in slices[k].values():  # keep slice output compact
            v.pop("calibration", None)
    report["slices"] = slices
    if perturb:
        report["perturbations"] = {}
        for name, fn in PERTURBATIONS.items():
            pp = predict(lm, [fn(im) for im in images])
            s = summarize(pp, y, classes, thr)
            report["perturbations"][name] = {"accuracy": s["accuracy"], "macro_f1": s["macro_f1"], "ece": s["calibration"]["ece"], "coverage": s["selective"]["coverage"]}
    if images:
        report["latency"] = latency(lm, images[0])
    return report


def to_markdown(report: dict, title: str) -> str:
    o = report["overall"]
    lines = [f"# {title}", "", f"n = {o['n']}, accuracy = {o['accuracy']:.3f}, macro-F1 = {o['macro_f1']:.3f}", "",
             "| class | precision | recall | F1 | FPR | FNR | support |", "|---|---|---|---|---|---|---|"]
    for c, m in o["per_class"].items():
        lines.append(f"| {c} | {m['precision']:.3f} | {m['recall']:.3f} | {m['f1']:.3f} | {m['false_positive_rate']:.3f} | {m['false_negative_rate']:.3f} | {m['support']} |")
    cal = o["calibration"]
    sel = o["selective"]
    lines += ["", f"Calibration: ECE = {cal['ece']:.3f}, Brier = {cal['brier']:.3f}, NLL = {cal['nll']:.3f}",
              f"Selective @ threshold {sel['threshold']}: coverage = {sel['coverage']:.3f}, selective accuracy = {sel['selective_accuracy']:.3f}", "",
              "Confusion matrix (rows = true, cols = predicted): " + json.dumps(o["confusion_matrix"]), ""]
    for k, groups in report.get("slices", {}).items():
        lines += [f"## Slice: {k}", "", "| group | n | accuracy | macro-F1 |", "|---|---|---|---|"]
        lines += [f"| {g} | {v['n']} | {v['accuracy']:.3f} | {v['macro_f1']:.3f} |" for g, v in groups.items()]
        lines.append("")
    if "perturbations" in report:
        lines += ["## Robustness (controlled perturbations)", "", "| perturbation | accuracy | macro-F1 | ECE | coverage |", "|---|---|---|---|---|"]
        lines += [f"| {k} | {v['accuracy']:.3f} | {v['macro_f1']:.3f} | {v['ece']:.3f} | {v['coverage']:.3f} |" for k, v in report["perturbations"].items()]
        lines.append("")
    if "latency" in report:
        lat = report["latency"]
        lines.append(f"Latency (batch 1, {lat['device']}, {lat['runtime']}): p50 = {lat['p50_ms']:.2f} ms, p95 = {lat['p95_ms']:.2f} ms")
    return "\n".join(lines) + "\n"


def main() -> None:
    from app.config import get_settings
    from app.inference.registry import load_artifact
    from training.data import grouped_split, read_manifest

    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", type=Path, required=True)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--split", default="test", choices=["train", "val", "test", "all"])
    ap.add_argument("--seed", type=int, default=None, help="split seed (defaults to the one recorded in the model card)")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    lm = load_artifact(a.model_dir, get_settings())
    seed = a.seed if a.seed is not None else int(lm.card.training_summary.get("split_seed", 42))
    samples = read_manifest(a.manifest)
    if a.split != "all":
        samples = grouped_split(samples, seed=seed)[a.split]
    rep = evaluate_samples(lm, samples)
    out = a.out or a.model_dir / f"eval_{a.split}.json"
    out.write_text(json.dumps(rep, indent=2))
    out.with_suffix(".md").write_text(to_markdown(rep, f"{lm.card.model_id}@{lm.card.version} — {a.split} split"))
    print(to_markdown(rep, f"{lm.card.model_id}@{lm.card.version}"))


if __name__ == "__main__":
    main()
