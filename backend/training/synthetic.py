"""Procedural SYNTHETIC dataset generator.

Purpose: exercise the full training / evaluation / serving pipeline end-to-end
without real face data. Images are cartoon-like region patches (lips, eyes,
nose, skin) with a controllable "severity" of a visible feature (crack lines,
red vessels, redness, flakes).

A model trained on this data learns synthetic artefacts. It is labelled tier
"demo" and its outputs on real faces are NOT observations. See docs/datasets.md
for real-data sourcing.

Each synthetic "subject" has fixed appearance parameters (skin tone, lip hue,
iris colour, shape) and contributes several images, so the grouped split in
``training.data`` is genuinely necessary to avoid identity leakage.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import cv2
import numpy as np

# Broad range of skin tones (RGB) from very light to very dark, grouped for slice evaluation.
SKIN_TONES = {
    "tone_1": [(244, 214, 196), (236, 200, 178)],
    "tone_2": [(224, 180, 150), (214, 168, 136)],
    "tone_3": [(196, 146, 110), (184, 132, 96)],
    "tone_4": [(160, 110, 78), (146, 98, 66)],
    "tone_5": [(116, 78, 54), (100, 66, 46)],
    "tone_6": [(78, 52, 38), (62, 42, 32)],
}
LIGHTING = {"dim": 0.6, "normal": 1.0, "bright": 1.3}


def _jitter(c, rng, amt=10):
    return tuple(int(np.clip(v + rng.integers(-amt, amt + 1), 0, 255)) for v in c)


def _skin_canvas(size, tone, rng):
    img = np.zeros((size, size, 3), np.float32)
    img[:] = tone
    noise = cv2.GaussianBlur(rng.normal(0, 6, (size, size)).astype(np.float32), (0, 0), 3)
    img += noise[..., None]
    # soft shading gradient
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    ang = rng.uniform(0, 2 * np.pi)
    img *= (0.9 + 0.15 * (np.cos(ang) * xx + np.sin(ang) * yy))[..., None]
    return img


def gen_lips(size, subj, severity, rng):
    img = _skin_canvas(size, subj["tone"], rng)
    lip = np.array(subj["lip"], np.float32) * (1 - 0.25 * severity) + np.array([200, 180, 170]) * 0.25 * severity
    c = (size // 2 + rng.integers(-4, 5), size // 2 + rng.integers(-4, 5))
    axes = (int(size * subj["lip_w"]), int(size * subj["lip_h"]))
    mask = np.zeros((size, size), np.uint8)
    cv2.ellipse(mask, c, axes, 0, 0, 360, 255, -1)
    m = cv2.GaussianBlur(mask, (5, 5), 0).astype(np.float32)[..., None] / 255
    img = img * (1 - m) + lip * m
    cv2.line(img, (c[0] - axes[0] + 6, c[1]), (c[0] + axes[0] - 6, c[1]), tuple(float(v) * 0.55 for v in lip), 2)
    if severity < 0.4:  # healthy specular highlight
        cv2.ellipse(img, (c[0], c[1] + axes[1] // 2), (axes[0] // 3, 3), 0, 0, 360, (255, 235, 235), -1)
    n_cracks = int(severity * 28)
    for _ in range(n_cracks):
        x = int(rng.uniform(c[0] - axes[0] * 0.85, c[0] + axes[0] * 0.85))
        y0 = int(rng.uniform(c[1] - axes[1] * 0.8, c[1] + axes[1] * 0.4))
        L = int(rng.uniform(4, axes[1] * 0.9))
        col = tuple(float(v) * 0.5 for v in lip) if rng.random() < 0.6 else (235.0, 220.0, 215.0)
        cv2.line(img, (x, y0), (x + int(rng.integers(-2, 3)), y0 + L), col, 1)
    for _ in range(int(severity * 40)):
        p = (int(rng.uniform(c[0] - axes[0], c[0] + axes[0])), int(rng.uniform(c[1] - axes[1], c[1] + axes[1])))
        if mask[min(p[1], size - 1), min(p[0], size - 1)]:
            cv2.circle(img, p, 1, (240, 230, 225), -1)
    return img


def gen_eye(size, subj, severity, rng):
    img = _skin_canvas(size, subj["tone"], rng)
    c = (size // 2 + rng.integers(-3, 4), size // 2 + rng.integers(-3, 4))
    axes = (int(size * 0.36), int(size * subj["eye_open"]))
    sclera = np.array([245, 242, 238], np.float32) * (1 - 0.35 * severity) + np.array([230, 120, 120]) * 0.35 * severity
    mask = np.zeros((size, size), np.uint8)
    cv2.ellipse(mask, c, axes, 0, 0, 360, 255, -1)
    m = mask.astype(np.float32)[..., None] / 255
    img = img * (1 - m) + sclera * m
    for _ in range(int(severity * 18)):
        side = -1 if rng.random() < 0.5 else 1
        x0 = c[0] + side * int(axes[0] * rng.uniform(0.6, 0.95))
        y0 = c[1] + int(rng.uniform(-axes[1] * 0.6, axes[1] * 0.6))
        pts = [(x0, y0)]
        for _k in range(3):
            pts.append((pts[-1][0] - side * int(rng.uniform(3, 8)), pts[-1][1] + int(rng.integers(-3, 4))))
        cv2.polylines(img, [np.array(pts, np.int32)], False, (200.0, 40.0, 50.0), 1)
    img = img * (1 - m) + img * m  # keep vessels inside sclera
    r = int(axes[1] * 0.95)
    cv2.circle(img, c, r, subj["iris"], -1)
    cv2.circle(img, c, max(2, r // 2), (20, 20, 20), -1)
    cv2.circle(img, (c[0] - r // 3, c[1] - r // 3), 2, (255, 255, 255), -1)
    outside = (1 - m)
    skin = _skin_canvas(size, subj["tone"], rng)
    img = img * m + skin * outside
    cv2.ellipse(img, c, axes, 0, 180, 360, tuple(float(v) * 0.45 for v in subj["tone"]), 2)
    return img


def gen_nose(size, subj, severity, rng):
    img = _skin_canvas(size, subj["tone"], rng)
    c = (size // 2, int(size * 0.62))
    shade = tuple(float(v) * 0.7 for v in subj["tone"])
    cv2.ellipse(img, (c[0] - size // 6, c[1]), (size // 10, size // 16), 0, 0, 360, (40, 25, 20), -1)
    cv2.ellipse(img, (c[0] + size // 6, c[1]), (size // 10, size // 16), 0, 0, 360, (40, 25, 20), -1)
    cv2.line(img, (c[0] - size // 8, size // 6), (c[0] - size // 5, c[1] - 6), shade, 3)
    if severity > 0:
        red = np.zeros((size, size), np.float32)
        for _ in range(3):
            cx = c[0] + int(rng.uniform(-size * 0.3, size * 0.3))
            cy = c[1] + int(rng.uniform(-size * 0.25, size * 0.05))
            cv2.circle(red, (cx, cy), int(size * rng.uniform(0.1, 0.22)), 1.0, -1)
        red = cv2.GaussianBlur(red, (0, 0), size * 0.06)[..., None] * severity
        img = img * (1 - 0.55 * red) + np.array([215, 60, 60], np.float32) * 0.55 * red
    return img


def gen_skin(size, subj, severity, rng):
    img = _skin_canvas(size, subj["tone"], rng)
    tex = cv2.GaussianBlur(rng.normal(0, 1, (size, size)).astype(np.float32), (0, 0), 1.0)
    img += (tex * 4 * (1 + severity))[..., None]
    for _ in range(int(severity * 35)):
        p = (int(rng.uniform(0, size)), int(rng.uniform(0, size)))
        ax = (int(rng.uniform(1, 5)), int(rng.uniform(1, 3)))
        light = tuple(min(255.0, float(v) * 1.25 + 30) for v in subj["tone"])
        cv2.ellipse(img, p, ax, float(rng.uniform(0, 180)), 0, 360, light, -1)
    for _ in range(int(severity * 12)):
        p0 = (int(rng.uniform(0, size)), int(rng.uniform(0, size)))
        p1 = (p0[0] + int(rng.integers(-15, 16)), p0[1] + int(rng.integers(-15, 16)))
        cv2.line(img, p0, p1, tuple(float(v) * 0.8 for v in subj["tone"]), 1)
    return img


def gen_blemishes(size, subj, severity, rng):
    img = _skin_canvas(size, subj["tone"], rng)
    tone = np.array(subj["tone"], np.float32)
    for _ in range(int(severity * 14)):
        p = (int(rng.uniform(6, size - 6)), int(rng.uniform(6, size - 6)))
        r = int(rng.uniform(2, 6))
        halo = np.zeros((size, size), np.float32)
        cv2.circle(halo, p, r * 2, 1.0, -1)
        halo = cv2.GaussianBlur(halo, (0, 0), r)[..., None]
        img = img * (1 - 0.45 * halo) + (tone * 0.75 + np.array([70, 0, 0])) * 0.45 * halo
        cv2.circle(img, p, r, tuple(float(v) for v in tone * 0.8 + np.array([55, 5, 5])), -1)
        if rng.random() < 0.5:
            cv2.circle(img, (p[0] - 1, p[1] - 1), max(1, r // 3), tuple(min(255.0, float(v) * 1.15 + 40) for v in tone), -1)
    return img


def gen_skin_redness(size, subj, severity, rng):
    img = _skin_canvas(size, subj["tone"], rng)
    red = np.zeros((size, size), np.float32)
    for _ in range(int(1 + severity * 4)):
        c = (int(rng.uniform(0, size)), int(rng.uniform(0, size)))
        cv2.ellipse(red, c, (int(rng.uniform(10, 35)), int(rng.uniform(8, 25))), float(rng.uniform(0, 180)), 0, 360, 1.0, -1)
    red = cv2.GaussianBlur(red, (0, 0), size * 0.07)[..., None] * severity
    return img * (1 - 0.5 * red) + np.array([210, 70, 70], np.float32) * 0.5 * red


def gen_shine(size, subj, severity, rng):
    img = _skin_canvas(size, subj["tone"], rng)
    spec = np.zeros((size, size), np.float32)
    for _ in range(int(1 + severity * 5)):
        c = (int(rng.uniform(0, size)), int(rng.uniform(0, size)))
        cv2.ellipse(spec, c, (int(rng.uniform(6, 22)), int(rng.uniform(4, 12))), float(rng.uniform(0, 180)), 0, 360, 1.0, -1)
    spec = cv2.GaussianBlur(spec, (0, 0), 4)[..., None] * severity
    return img * (1 - 0.6 * spec) + 250.0 * 0.6 * spec


def gen_undereye(size, subj, severity, rng):
    img = _skin_canvas(size, subj["tone"], rng)
    tone = np.array(subj["tone"], np.float32)
    c = (size // 2 + int(rng.integers(-4, 5)), int(size * 0.18))
    cv2.ellipse(img, c, (int(size * 0.4), int(size * 0.12)), 0, 0, 180, tuple(float(v) * 0.5 for v in tone), 2)  # lower lid line
    dark = np.zeros((size, size), np.float32)
    cv2.ellipse(dark, (c[0], c[1] + int(size * 0.1)), (int(size * 0.36), int(size * 0.16)), 0, 0, 180, 1.0, -1)
    dark = cv2.GaussianBlur(dark, (0, 0), size * 0.06)[..., None] * severity
    shade = tone * np.array([0.62, 0.55, 0.62])  # darker, slightly purple-brown
    return img * (1 - 0.6 * dark) + shade * 0.6 * dark


GENERATORS = {
    "lip_dryness": gen_lips,
    "eye_redness": gen_eye,
    "nasal_redness": gen_nose,
    "skin_flaking": gen_skin,
    "skin_blemishes": gen_blemishes,
    "skin_redness": gen_skin_redness,
    "skin_shine": gen_shine,
    "undereye_darkness": gen_undereye,
}


def make_subject(rng, idx: int) -> dict:
    group = list(SKIN_TONES)[idx % len(SKIN_TONES)]
    tone = _jitter(SKIN_TONES[group][rng.integers(0, 2)], rng, 8)
    return {
        "subject_id": f"syn{idx:04d}",
        "skin_tone_group": group,
        "tone": tone,
        "lip": _jitter((tone[0] * 0.8 + 40, tone[1] * 0.45, tone[2] * 0.5), rng, 12),
        "lip_w": rng.uniform(0.34, 0.42),
        "lip_h": rng.uniform(0.13, 0.2),
        "eye_open": rng.uniform(0.12, 0.18),
        "iris": _jitter([(90, 60, 40), (60, 110, 150), (80, 120, 70), (40, 30, 25)][rng.integers(0, 4)], rng, 15),
    }


def capture_effects(img: np.ndarray, rng, lighting: str, blur: bool, angle: float) -> np.ndarray:
    size = img.shape[0]
    img = img * LIGHTING[lighting]
    M = cv2.getRotationMatrix2D((size / 2, size / 2), angle, 1.0)
    img = cv2.warpAffine(img, M, (size, size), borderMode=cv2.BORDER_REFLECT)
    if blur:
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(1.2, 2.2))
    img = img + rng.normal(0, rng.uniform(1, 5), img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def generate(model_id: str, out_dir: Path, n_subjects: int, per_subject: int, size: int = 160, seed: int = 0, label_noise: float = 0.03) -> Path:
    if model_id not in GENERATORS:
        raise ValueError(f"no synthetic generator for {model_id}")
    from app.inference.catalog import CATALOG

    pos, neg = CATALOG[model_id].classes
    rng = np.random.default_rng(seed)
    img_dir = out_dir / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for s in range(n_subjects):
        subj = make_subject(rng, s)
        for k in range(per_subject):
            label_pos = rng.random() < 0.5
            severity = float(rng.uniform(0.55, 1.0) if label_pos else rng.uniform(0.0, 0.45))
            lighting = rng.choice(list(LIGHTING), p=[0.2, 0.6, 0.2])
            blur = bool(rng.random() < 0.15)
            angle = float(rng.uniform(-12, 12))
            img = capture_effects(GENERATORS[model_id](size, subj, severity, rng), rng, lighting, blur, angle)
            if rng.random() < label_noise:
                label_pos = not label_pos
            name = f"{subj['subject_id']}_{k:02d}.png"
            cv2.imwrite(str(img_dir / name), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
            rows.append({
                "path": f"images/{name}", "label": pos if label_pos else neg, "subject_id": subj["subject_id"],
                "skin_tone_group": subj["skin_tone_group"], "lighting": lighting, "blur": int(blur),
                "angle_bucket": "frontal" if abs(angle) < 6 else "tilted", "severity": round(severity, 3), "source": "synthetic",
            })
    manifest = out_dir / "manifest.csv"
    with manifest.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--model-id", required=True, choices=list(GENERATORS))
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--subjects", type=int, default=120)
    ap.add_argument("--per-subject", type=int, default=10)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    print(generate(a.model_id, a.out, a.subjects, a.per_subject, seed=a.seed))


if __name__ == "__main__":
    main()
