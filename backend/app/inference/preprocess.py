"""Preprocessing shared by training AND serving.

Training (backend/training/data.py) imports these exact functions, guaranteeing
train/serve parity: the tensor a model sees in production is produced by the
same code path it was trained on. Augmentation happens *before* this step and
only during training.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


@dataclass(frozen=True)
class PreprocessConfig:
    input_size: int = 128
    mean: tuple[float, float, float] = IMAGENET_MEAN
    std: tuple[float, float, float] = IMAGENET_STD

    def describe(self) -> list[str]:
        return [
            "decode JPEG/PNG → RGB uint8",
            f"resize → {self.input_size}x{self.input_size} (cv2.INTER_AREA)",
            "scale → float32 [0, 1]",
            f"normalize mean={list(self.mean)} std={list(self.std)}",
            "HWC → CHW, add batch dim",
        ]


def to_square(rgb: np.ndarray) -> np.ndarray:
    """Centre-pad a crop to square with edge replication (crops near the frame edge may be clipped)."""
    h, w = rgb.shape[:2]
    if h == w:
        return rgb
    side = max(h, w)
    top = (side - h) // 2
    left = (side - w) // 2
    return cv2.copyMakeBorder(rgb, top, side - h - top, left, side - w - left, cv2.BORDER_REPLICATE)


def preprocess(rgb: np.ndarray, cfg: PreprocessConfig) -> np.ndarray:
    """RGB uint8 (H, W, 3) → float32 (3, S, S) normalised tensor (no batch dim)."""
    if rgb.ndim != 3 or rgb.shape[2] != 3 or rgb.dtype != np.uint8:
        raise ValueError(f"expected HxWx3 uint8, got {rgb.shape} {rgb.dtype}")
    sq = to_square(rgb)
    interp = cv2.INTER_AREA if sq.shape[0] > cfg.input_size else cv2.INTER_LINEAR
    x = cv2.resize(sq, (cfg.input_size, cfg.input_size), interpolation=interp).astype(np.float32) / 255.0
    x = (x - np.asarray(cfg.mean, dtype=np.float32)) / np.asarray(cfg.std, dtype=np.float32)
    return np.ascontiguousarray(x.transpose(2, 0, 1))


def denormalize(chw: np.ndarray, cfg: PreprocessConfig) -> np.ndarray:
    """Inverse of :func:`preprocess` for visualisation → RGB uint8 (S, S, 3)."""
    x = chw.transpose(1, 2, 0) * np.asarray(cfg.std, dtype=np.float32) + np.asarray(cfg.mean, dtype=np.float32)
    return np.clip(x * 255.0 + 0.5, 0, 255).astype(np.uint8)


def tensor_stats(chw: np.ndarray) -> dict:
    flat = chw.reshape(chw.shape[0], -1)
    return {
        "shape": [1, *chw.shape],
        "dtype": str(chw.dtype),
        "channel_mean": [round(float(v), 4) for v in flat.mean(axis=1)],
        "channel_std": [round(float(v), 4) for v in flat.std(axis=1)],
        "min": round(float(chw.min()), 4),
        "max": round(float(chw.max()), 4),
    }
