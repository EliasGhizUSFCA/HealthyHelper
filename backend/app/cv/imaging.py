"""Image encode/decode helpers. All images inside the backend are RGB uint8 numpy arrays (H, W, 3)."""

from __future__ import annotations

import base64
import binascii

import cv2
import numpy as np


class ImageDecodeError(ValueError):
    pass


def decode_data_url(data: str, max_bytes: int | None = None) -> np.ndarray:
    """Decode a data URL (or bare base64) JPEG/PNG into an RGB uint8 array."""
    if not isinstance(data, str) or not data:
        raise ImageDecodeError("empty image payload")
    payload = data.split(",", 1)[1] if data.startswith("data:") else data
    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as exc:  # pragma: no cover - defensive
        raise ImageDecodeError(f"invalid base64: {exc}") from exc
    if max_bytes is not None and len(raw) > max_bytes:
        raise ImageDecodeError(f"image exceeds {max_bytes} bytes")
    buf = np.frombuffer(raw, dtype=np.uint8)
    bgr = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ImageDecodeError("unsupported or corrupt image")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def encode_png_data_url(rgb: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    if not ok:  # pragma: no cover
        raise RuntimeError("PNG encode failed")
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def encode_jpeg_data_url(rgb: np.ndarray, quality: int = 85) -> str:
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:  # pragma: no cover
        raise RuntimeError("JPEG encode failed")
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def colorize_heatmap(cam: np.ndarray) -> np.ndarray:
    """Map a [0,1] float map to an RGB 'jet' heatmap."""
    cam8 = np.clip(cam * 255.0, 0, 255).astype(np.uint8)
    return cv2.cvtColor(cv2.applyColorMap(cam8, cv2.COLORMAP_JET), cv2.COLOR_BGR2RGB)
