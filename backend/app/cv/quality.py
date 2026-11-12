"""Server-side image-quality gate for region crops.

The browser runs a whole-frame quality check; the server re-checks every crop it
receives because (a) clients are untrusted and (b) a frame can be fine overall
while one region is blown out or blurred. Thresholds are deliberately simple and
documented so abstention behaviour is predictable and testable.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from app.schemas.protocol import ImageQuality, QualityMetrics, QualityStatus


@dataclass(frozen=True)
class CropQualityThresholds:
    min_brightness: float = 40.0
    max_brightness: float = 225.0
    min_contrast: float = 8.0
    min_sharpness: float = 15.0  # variance of Laplacian at 128 px
    min_side_px: int = 20


DEFAULT_THRESHOLDS = CropQualityThresholds()


def luma(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)


def sharpness(gray: np.ndarray, size: int = 128) -> float:
    g = cv2.resize(gray, (size, size), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def assess_crop(rgb: np.ndarray, t: CropQualityThresholds = DEFAULT_THRESHOLDS) -> ImageQuality:
    h, w = rgb.shape[:2]
    gray = luma(rgb)
    brightness = float(gray.mean())
    contrast = float(gray.std())
    sharp = sharpness(gray)
    issues: list[str] = []
    if min(h, w) < t.min_side_px:
        issues.append("region_too_small")
    if brightness < t.min_brightness:
        issues.append("too_dark")
    if brightness > t.max_brightness:
        issues.append("overexposed")
    if contrast < t.min_contrast:
        issues.append("low_contrast")
    if sharp < t.min_sharpness:
        issues.append("blurry")
    hard = {"region_too_small", "too_dark", "overexposed"}
    if any(i in hard for i in issues):
        status = QualityStatus.unusable
    elif issues:
        status = QualityStatus.poor
    else:
        status = QualityStatus.acceptable
    return ImageQuality(
        status=status,
        issues=issues,
        metrics=QualityMetrics(brightness=round(brightness, 2), contrast=round(contrast, 2), sharpness=round(sharp, 2)),
    )


def combine(frame_quality: ImageQuality, crop_qualities: list[ImageQuality]) -> ImageQuality:
    """Overall status = worst of the client-reported frame quality and the server crop checks."""
    order = {QualityStatus.acceptable.value: 0, QualityStatus.poor.value: 1, QualityStatus.unusable.value: 2}
    statuses = [frame_quality.status] + [q.status for q in crop_qualities]
    worst = max(statuses, key=lambda s: order[str(s)])
    issues = list(dict.fromkeys(list(frame_quality.issues) + [i for q in crop_qualities for i in q.issues]))
    return ImageQuality(status=worst, issues=issues, metrics=frame_quality.metrics)
