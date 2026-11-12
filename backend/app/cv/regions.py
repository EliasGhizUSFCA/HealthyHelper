"""Landmark → region crop geometry, driven by shared/regions.json.

The same JSON is used by the browser (frontend/lib/regions.ts), so a crop computed
server-side from landmarks matches the crop the browser would have sent.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.config import get_settings


@dataclass(frozen=True)
class RegionSpec:
    name: str
    label: str
    landmarks: tuple[int, ...]
    margin: float
    square: bool
    min_size_px: int


@lru_cache
def load_region_config(path: str | None = None) -> dict:
    p = Path(path) if path else get_settings().regions_file
    return json.loads(p.read_text())


def region_specs(path: str | None = None) -> dict[str, RegionSpec]:
    cfg = load_region_config(path)
    return {
        name: RegionSpec(
            name=name,
            label=r["label"],
            landmarks=tuple(r["landmarks"]),
            margin=float(r["margin"]),
            square=bool(r["square"]),
            min_size_px=int(r["min_size_px"]),
        )
        for name, r in cfg["regions"].items()
    }


def region_bbox_px(landmarks: np.ndarray, spec: RegionSpec, width: int, height: int) -> tuple[int, int, int, int]:
    """Pixel bbox (x, y, w, h) for a region from normalised landmarks (N, >=2).

    Identical maths to ``computeRegionBox`` in frontend/lib/regions.ts:
    tight bbox of the region's landmarks → expand by ``margin`` on each side
    around its centre → if square, side = min(max(w, h), frame_w, frame_h) →
    *shift* (not clip) the box so it lies inside the frame. Shifting keeps crops
    square and full-size at frame edges. Regions smaller than ``min_size_px``
    are reported by :func:`region_is_valid`.
    """
    pts = landmarks[list(spec.landmarks), :2] * np.array([width, height], dtype=np.float64)
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w = (x1 - x0) * (1 + 2 * spec.margin)
    h = (y1 - y0) * (1 + 2 * spec.margin)
    if spec.square:
        w = h = min(max(w, h), float(width), float(height))
    else:
        w, h = min(w, float(width)), min(h, float(height))
    x = min(max(cx - w / 2, 0.0), width - w)
    y = min(max(cy - h / 2, 0.0), height - h)
    xi, yi = int(round(x)), int(round(y))
    wi, hi = int(round(w)), int(round(h))
    return xi, yi, min(wi, width - xi), min(hi, height - yi)


def region_is_valid(bbox: tuple[int, int, int, int], spec: RegionSpec) -> bool:
    return min(bbox[2], bbox[3]) >= spec.min_size_px


def crop_regions(image: np.ndarray, landmarks: np.ndarray, names: list[str] | None = None) -> dict[str, tuple[np.ndarray, list[float]]]:
    """Return {region: (crop RGB, normalised bbox [x,y,w,h])} for every region with a non-empty crop."""
    h, w = image.shape[:2]
    specs = region_specs()
    out: dict[str, tuple[np.ndarray, list[float]]] = {}
    for name, spec in specs.items():
        if names and name not in names:
            continue
        x, y, bw, bh = region_bbox_px(landmarks, spec, w, h)
        if not region_is_valid((x, y, bw, bh), spec):
            continue
        out[name] = (image[y : y + bh, x : x + bw].copy(), [x / w, y / h, bw / w, bh / h])
    return out


def validate_landmarks(lm: list[list[float]]) -> np.ndarray:
    arr = np.asarray(lm, dtype=np.float64)
    if arr.ndim != 2 or arr.shape[0] < 468 or arr.shape[1] < 2:
        raise ValueError("expected >=468 landmarks of [x, y(, z)]")
    if not np.isfinite(arr[:, :2]).all():
        raise ValueError("landmarks contain non-finite values")
    return arr
