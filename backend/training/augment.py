"""Training-time augmentation on RGB uint8 images (applied BEFORE shared preprocessing).

Chosen to simulate webcam variability: exposure/contrast, white balance, defocus
and motion blur, sensor noise, JPEG compression, small rotations/scale (head
pose / crop jitter) and horizontal flips (regions are roughly symmetric).
Hue shifts are kept small on purpose: redness features are colour-defined, so
aggressive colour augmentation would destroy the signal.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class Augmenter:
    seed: int = 0
    p_flip: float = 0.5
    max_rotate: float = 12.0
    scale: tuple[float, float] = (0.85, 1.15)
    brightness: float = 0.25
    contrast: float = 0.25
    wb_shift: float = 0.06
    p_blur: float = 0.25
    p_noise: float = 0.3
    p_jpeg: float = 0.3

    def __post_init__(self) -> None:
        self.rng = np.random.default_rng(self.seed)

    def __call__(self, img: np.ndarray) -> np.ndarray:
        r = self.rng
        h, w = img.shape[:2]
        if r.random() < self.p_flip:
            img = img[:, ::-1]
        M = cv2.getRotationMatrix2D((w / 2, h / 2), r.uniform(-self.max_rotate, self.max_rotate), r.uniform(*self.scale))
        M[:, 2] += r.uniform(-0.06, 0.06, 2) * (w, h)
        img = cv2.warpAffine(np.ascontiguousarray(img), M, (w, h), borderMode=cv2.BORDER_REFLECT)
        x = img.astype(np.float32)
        x = x * (1 + r.uniform(-self.brightness, self.brightness))
        mean = x.mean()
        x = (x - mean) * (1 + r.uniform(-self.contrast, self.contrast)) + mean
        x = x * (1 + r.uniform(-self.wb_shift, self.wb_shift, 3))
        if r.random() < self.p_blur:
            if r.random() < 0.5:
                x = cv2.GaussianBlur(x, (0, 0), r.uniform(0.5, 1.8))
            else:
                k = int(r.integers(3, 8))
                kern = np.zeros((k, k), np.float32)
                kern[k // 2, :] = 1.0 / k
                x = cv2.filter2D(x, -1, kern)
        if r.random() < self.p_noise:
            x = x + r.normal(0, r.uniform(2, 8), x.shape)
        out = np.clip(x, 0, 255).astype(np.uint8)
        if r.random() < self.p_jpeg:
            ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, int(r.integers(35, 90))])
            if ok:
                out = cv2.imdecode(buf, cv2.IMREAD_UNCHANGED)
        return out
