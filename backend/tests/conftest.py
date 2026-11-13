from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")


def synthetic_landmarks(cx: float = 0.5, cy: float = 0.5, scale: float = 0.3, angle_deg: float = 0.0, seed: int = 0) -> np.ndarray:
    """478 plausible-ish normalised landmarks: random cloud in a face box, with key anchors placed anatomically."""
    from app.cv.regions import region_specs

    rng = np.random.default_rng(seed)
    pts = np.zeros((478, 3))
    pts[:, :2] = rng.uniform(-0.45, 0.45, (478, 2))
    layout = {  # canonical offsets in face units
        "lips": (0.0, 0.3, 0.16, 0.06), "left_eye": (0.18, -0.12, 0.08, 0.03), "right_eye": (-0.18, -0.12, 0.08, 0.03),
        "nose": (0.0, 0.08, 0.07, 0.1), "skin_forehead": (0.0, -0.38, 0.12, 0.06),
        "skin_left_cheek": (0.24, 0.12, 0.06, 0.06), "skin_right_cheek": (-0.24, 0.12, 0.06, 0.06),
        "left_undereye": (0.18, -0.03, 0.07, 0.03), "right_undereye": (-0.18, -0.03, 0.07, 0.03), "skin_chin": (0.0, 0.42, 0.07, 0.04),
    }
    for name, spec in region_specs().items():
        ox, oy, sx, sy = layout[name]
        n = len(spec.landmarks)
        t = np.linspace(0, 2 * np.pi, n, endpoint=False)
        pts[list(spec.landmarks), 0] = ox + sx * np.cos(t)
        pts[list(spec.landmarks), 1] = oy + sy * np.sin(t)
    anchors = {33: (-0.26, -0.12), 263: (0.26, -0.12), 1: (0.0, 0.1), 61: (-0.12, 0.3), 291: (0.12, 0.3)}
    for i, (x, y) in anchors.items():
        pts[i, :2] = (x, y)
    a = np.deg2rad(angle_deg)
    R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    pts[:, :2] = pts[:, :2] @ R.T * scale + [cx, cy]
    return pts


def make_artifact(root: Path, model_id: str = "lip_dryness", backbone: str = "small_cnn", seed: int = 0) -> Path:
    import time

    import torch

    from app.inference.architectures import build_model
    from app.inference.catalog import CATALOG
    from app.inference.model_card import ModelCard
    from app.inference.preprocess import IMAGENET_MEAN, IMAGENET_STD

    torch.manual_seed(seed)
    e = CATALOG[model_id]
    d = root / model_id / "0.0.1-test"
    d.mkdir(parents=True, exist_ok=True)
    m = build_model(backbone, 2)
    torch.save(m.state_dict(), d / "weights.pt")
    card = ModelCard(model_id=model_id, version="0.0.1-test", tier="demo", feature=e.feature, regions=list(e.regions), classes=list(e.classes),
                     positive_class=e.classes[0], backbone=backbone, input_size=64, normalization={"mean": list(IMAGENET_MEAN), "std": list(IMAGENET_STD)},
                     default_threshold=0.5, created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ"))
    (d / "model_card.json").write_text(card.model_dump_json())
    return d


@pytest.fixture()
def settings(tmp_path):
    from app.config import Settings

    models = tmp_path / "models"
    make_artifact(models, "lip_dryness")
    make_artifact(models, "eye_redness", seed=1)
    return Settings(models_dir=models, data_dir=tmp_path / "data", database_url=f"sqlite:///{tmp_path / 'db.sqlite'}", llm_provider="offline",
                    min_frames_for_observation=2, observation_window=4)


@pytest.fixture()
def services(settings):
    from app.services import build_services

    return build_services(settings)


@pytest.fixture()
def client(services):
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(services)) as c:
        yield c


def textured(size=96, color=(180, 100, 100), seed=0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = np.full((size, size, 3), color, np.float32) + rng.normal(0, 25, (size, size, 3))
    return np.clip(img, 0, 255).astype(np.uint8)


def data_url(img: np.ndarray) -> str:
    from app.cv.imaging import encode_jpeg_data_url

    return encode_jpeg_data_url(img, 92)


def frame_payload(frame_id: int, regions=("lips", "left_eye", "right_eye"), quality="acceptable", img=None, **opts) -> dict:
    img = textured() if img is None else img
    return {
        "type": "frame", "frame_id": frame_id, "captured_at": 1.0e12 + frame_id,
        "quality": {"status": quality, "issues": [], "metrics": {}},
        "regions": [{"region": r, "bbox": [0.1, 0.1, 0.2, 0.2], "image_b64": data_url(img)} for r in regions],
        "client_events": [], "options": opts,
    }
