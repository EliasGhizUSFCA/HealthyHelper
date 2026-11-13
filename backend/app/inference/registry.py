"""Model registry: discovers versioned artifacts on disk and loads them for inference.

Layout::

    models/<model_id>/<version>/model_card.json
                               /weights.pt        (torch state_dict)
                               /model.onnx        (optional, scripts/export_onnx.py)
                               /eval_report.json  (optional)

The newest version (by ``created_at``) of each model is served. Runtime can be
``torch`` (default, supports Grad-CAM) or ``onnx`` (faster CPU inference via
ONNX Runtime; explainability then falls back to a torch copy if weights exist).
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.config import Settings, get_settings
from app.inference.catalog import CATALOG
from app.inference.model_card import ModelCard
from app.inference.preprocess import PreprocessConfig
from app.schemas.protocol import ModelInfo, ModelTier

log = logging.getLogger(__name__)


TIER_MESSAGES = {
    "demo": "DEMO model trained on synthetic data only — outputs are not observations about a real face.",
    "experimental": "EXPERIMENTAL model trained on a small real, consented dataset that has not passed the validation gate — treat outputs as tentative.",
    "validated": "Loaded. Passed the project's validation gate on held-out real data; not clinically validated.",
}


def _softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


@dataclass
class LoadedModel:
    card: ModelCard
    path: Path
    runtime: str
    device: str
    torch_model: object | None = None
    onnx_session: object | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def preprocess_cfg(self) -> PreprocessConfig:
        n = self.card.normalization
        return PreprocessConfig(self.card.input_size, tuple(n["mean"]), tuple(n["std"]))  # type: ignore[arg-type]

    def predict_logits(self, batch: np.ndarray) -> np.ndarray:
        """batch: float32 (N, 3, S, S) → raw logits (N, C)."""
        if self.runtime == "onnx" and self.onnx_session is not None:
            sess = self.onnx_session
            name = sess.get_inputs()[0].name  # type: ignore[attr-defined]
            return np.asarray(sess.run(None, {name: batch})[0])  # type: ignore[attr-defined]
        import torch

        with self.lock, torch.inference_mode():
            t = torch.from_numpy(batch).to(self.device)
            return self.torch_model(t).float().cpu().numpy()  # type: ignore[operator]

    def predict_proba(self, batch: np.ndarray) -> np.ndarray:
        return _softmax(self.predict_logits(batch) / max(self.card.temperature, 1e-3))

    def info(self) -> ModelInfo:
        c = self.card
        return ModelInfo(
            model_id=c.model_id,
            version=c.version,
            tier=ModelTier(c.tier),
            feature=c.feature,
            regions=c.regions,  # type: ignore[arg-type]
            classes=c.classes,
            positive_class=c.positive_class,
            input_size=c.input_size,
            normalization=c.normalization,
            backbone=c.backbone,
            runtime=self.runtime,  # type: ignore[arg-type]
            default_threshold=c.default_threshold,
            explainable=self.torch_model is not None,
            status_message=TIER_MESSAGES[c.tier],
            training_summary=c.training_summary,
            metrics=c.metrics,
        )


def resolve_device(pref: str) -> str:
    try:
        import torch

        if pref == "cuda" or (pref == "auto" and torch.cuda.is_available()):
            return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:  # pragma: no cover
        pass
    return "cpu"


def load_artifact(path: Path, settings: Settings) -> LoadedModel:
    card = ModelCard.model_validate_json((path / "model_card.json").read_text())
    device = resolve_device(settings.device)
    runtime = settings.runtime
    lm = LoadedModel(card=card, path=path, runtime="torch", device=device)
    weights = path / card.weights_file
    if weights.exists():
        import torch

        from app.inference.architectures import build_model

        torch.set_num_threads(max(1, settings.torch_threads))
        model = build_model(card.backbone, len(card.classes), pretrained=False)
        state = torch.load(weights, map_location=device, weights_only=True)
        model.load_state_dict(state)
        model.eval().to(device)
        lm.torch_model = model
    if runtime == "onnx" and card.onnx_file and (path / card.onnx_file).exists():
        import onnxruntime as ort

        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if device == "cuda" else ["CPUExecutionProvider"]
        so = ort.SessionOptions()
        so.intra_op_num_threads = max(1, settings.torch_threads)  # avoid oversubscription with the 2-worker pool
        so.inter_op_num_threads = 1
        lm.onnx_session = ort.InferenceSession(str(path / card.onnx_file), sess_options=so, providers=providers)
        lm.runtime = "onnx"
    if lm.torch_model is None and lm.onnx_session is None:
        raise FileNotFoundError(f"no weights found in {path}")
    return lm


class ModelRegistry:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self._models: dict[str, LoadedModel] = {}
        self._errors: dict[str, str] = {}
        self._info_cache: list[ModelInfo] | None = None
        self._lock = threading.Lock()

    def discover(self) -> list[Path]:
        root = self.settings.models_dir
        if not root.exists():
            return []
        best: dict[str, tuple[str, Path]] = {}
        for card_path in root.glob("*/*/model_card.json"):
            try:
                meta = json.loads(card_path.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            mid, created = meta.get("model_id"), meta.get("created_at", "")
            if mid and (mid not in best or created > best[mid][0]):
                best[mid] = (created, card_path.parent)
        return [p for _, p in best.values()]

    def load_all(self) -> None:
        with self._lock:
            self._models.clear()
            self._errors.clear()
            for path in self.discover():
                try:
                    lm = load_artifact(path, self.settings)
                    self._models[lm.card.model_id] = lm
                    log.info("loaded model %s@%s (%s, %s)", lm.card.model_id, lm.card.version, lm.card.tier, lm.runtime)
                except Exception as exc:  # noqa: BLE001 - report, keep serving others
                    self._errors[path.parent.name] = f"{type(exc).__name__}: {exc}"
                    log.warning("failed to load model at %s: %s", path, exc)
            self._info_cache = None

    def get(self, model_id: str) -> LoadedModel | None:
        return self._models.get(model_id)

    def loaded(self) -> list[LoadedModel]:
        return list(self._models.values())

    def register(self, lm: LoadedModel) -> None:
        """Register an in-memory model (used by tests)."""
        self._models[lm.card.model_id] = lm
        self._info_cache = None

    def model_infos(self) -> list[ModelInfo]:
        if self._info_cache is not None:
            return self._info_cache
        infos = [m.info() for m in self._models.values()]
        for mid, entry in CATALOG.items():
            if mid in self._models:
                continue
            infos.append(
                ModelInfo(
                    model_id=mid, version="none", tier=ModelTier.unavailable, feature=entry.feature,
                    regions=list(entry.regions),  # type: ignore[arg-type]
                    classes=list(entry.classes), positive_class=entry.classes[0], input_size=entry.input_size,
                    normalization={"mean": [], "std": []}, backbone="none", runtime="none",
                    default_threshold=entry.default_threshold, explainable=False,
                    status_message=self._errors.get(mid, "No weights found. Train with `make demo-models` or `python -m training.train`."),
                )
            )
        self._info_cache = sorted(infos, key=lambda i: i.model_id)
        return self._info_cache

    def models_for_region(self, region: str) -> list[LoadedModel]:
        return [m for m in self._models.values() if region in m.card.regions]
