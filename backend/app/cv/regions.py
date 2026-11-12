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

    Steps: tight bbox of the region's landmarks → expand by ``margin`` on each side
    → optionally square it around its centre → clamp to the frame. Mirrors
    ``regionBBox`` in frontend/lib/regions.ts exactly.
    """
    pts = landmarks[list(spec.landmarks), :2] * np.array([width, height], dtype=np.float64)
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    w, h = x1 - x0, y1 - y0
    x0 -= w * spec.margin
    x1 += w * spec.margin
    y0 -= h * spec.margin
    y1 += h * spec.margin
    if spec.square:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        side = max(x1 - x0, y1 - y0, float(spec.min_size_px))
        x0, x1 = cx - side / 2, cx + side / 2
        y0, y1 = cy - side / 2, cy + side / 2
    xi0 = int(max(0, np.floor(x0)))
    yi0 = int(max(0, np.floor(y0)))
    xi1 = int(min(width, np.ceil(x1)))
    yi1 = int(min(height, np.ceil(y1)))
    return xi0, yi0, max(0, xi1 - xi0), max(0, yi1 - yi0)


def crop_regions(image: np.ndarray, landmarks: np.ndarray, names: list[str] | None = None) -> dict[str, tuple[np.ndarray, list[float]]]:
    """Return {region: (crop RGB, normalised bbox [x,y,w,h])} for every region with a non-empty crop."""
    h, w = image.shape[:2]
    specs = region_specs()
    out: dict[str, tuple[np.ndarray, list[float]]] = {}
    for name, spec in specs.items():
        if names and name not in names:
            continue
        x, y, bw, bh = region_bbox_px(landmarks, spec, w, h)
        if bw < 2 or bh < 2:
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
