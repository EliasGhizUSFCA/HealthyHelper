"""Face alignment for longitudinal comparison.

A similarity transform (rotation + uniform scale + translation) maps five stable
landmarks (eye corners, nose tip, mouth corners) onto canonical positions, so the
same region lands in the same place across sessions regardless of head position
or camera distance. Similarity (not full affine / homography) avoids warping
facial shape, which would itself create spurious "differences".
"""

from __future__ import annotations

import cv2
import numpy as np

from app.cv.regions import load_region_config


def canonical_anchors() -> tuple[list[int], np.ndarray, int]:
    cfg = load_region_config()["alignment"]
    idx = [int(k) for k in cfg["anchors"].keys()]
    dst = np.array(list(cfg["anchors"].values()), dtype=np.float32)
    return idx, dst, int(cfg["output_size"])


def align_face(image: np.ndarray, landmarks: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (aligned RGB image, 2x3 transform, aligned normalised landmarks)."""
    h, w = image.shape[:2]
    idx, dst, size = canonical_anchors()
    src = (landmarks[idx, :2] * np.array([w, h])).astype(np.float32)
    M, _ = cv2.estimateAffinePartial2D(src, dst, method=cv2.LMEDS)
    if M is None:
        raise ValueError("could not estimate alignment transform")
    aligned = cv2.warpAffine(image, M, (size, size), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    pts = landmarks[:, :2] * np.array([w, h])
    pts_h = np.hstack([pts, np.ones((pts.shape[0], 1))])
    aligned_pts = (M @ pts_h.T).T / size
    out_lm = landmarks.copy()
    out_lm[:, :2] = aligned_pts
    return aligned, M, out_lm


def lighting_stats(rgb: np.ndarray) -> dict[str, float]:
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    L = lab[..., 0].astype(np.float32) * (100.0 / 255.0)
    return {
        "mean_L": round(float(L.mean()), 3),
        "std_L": round(float(L.std()), 3),
        "mean_a": round(float(lab[..., 1].mean()) - 128.0, 3),
        "mean_b": round(float(lab[..., 2].mean()) - 128.0, 3),
    }


def normalize_lighting(rgb: np.ndarray, target_mean_L: float = 60.0) -> np.ndarray:
    """Shift the L channel to a common mean so diffs reflect structure, not exposure."""
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    cur = lab[..., 0].mean() * (100.0 / 255.0)
    lab[..., 0] = np.clip(lab[..., 0] + (target_mean_L - cur) * (255.0 / 100.0), 0, 255)
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB)


def region_difference(before: np.ndarray, after: np.ndarray) -> tuple[np.ndarray, float]:
    """Lighting-normalised absolute difference heat image + mean abs diff (0..1)."""
    if before.shape != after.shape:
        after = cv2.resize(after, (before.shape[1], before.shape[0]), interpolation=cv2.INTER_AREA)
    a = cv2.GaussianBlur(normalize_lighting(before), (3, 3), 0).astype(np.float32)
    b = cv2.GaussianBlur(normalize_lighting(after), (3, 3), 0).astype(np.float32)
    d = np.abs(a - b).mean(axis=2) / 255.0
    return d, float(d.mean())
