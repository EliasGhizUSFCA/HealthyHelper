"""Runtime configuration (12-factor: everything from environment variables)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    models_dir: Path = field(default_factory=lambda: Path(os.getenv("MODELS_DIR", REPO_ROOT / "models")))
    regions_file: Path = field(default_factory=lambda: Path(os.getenv("REGIONS_FILE", REPO_ROOT / "shared" / "regions.json")))
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", REPO_ROOT / "data" / "runtime")))
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", ""))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip())
    )
    device: str = field(default_factory=lambda: os.getenv("INFERENCE_DEVICE", "auto"))  # auto|cpu|cuda
    runtime: str = field(default_factory=lambda: os.getenv("INFERENCE_RUNTIME", "torch"))  # torch|onnx
    torch_threads: int = field(default_factory=lambda: int(os.getenv("TORCH_THREADS", "2")))
    llm_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "auto"))  # auto|anthropic|offline
    llm_model: str = field(default_factory=lambda: os.getenv("LLM_MODEL", "claude-opus-5-5"))
    llm_effort: str = field(default_factory=lambda: os.getenv("LLM_EFFORT", "low"))
    llm_timeout_s: float = field(default_factory=lambda: float(os.getenv("LLM_TIMEOUT_S", "60")))
    # Privacy: content logging is OFF unless explicitly enabled for local debugging.
    log_content: bool = field(default_factory=lambda: _bool("LOG_SENSITIVE_CONTENT", False))
    observation_window: int = field(default_factory=lambda: int(os.getenv("OBSERVATION_WINDOW", "5")))
    min_frames_for_observation: int = field(default_factory=lambda: int(os.getenv("MIN_FRAMES_FOR_OBSERVATION", "3")))
    session_ttl_s: int = field(default_factory=lambda: int(os.getenv("SESSION_TTL_S", "3600")))
    max_crop_bytes: int = field(default_factory=lambda: int(os.getenv("MAX_CROP_BYTES", str(200_000))))
    max_image_bytes: int = field(default_factory=lambda: int(os.getenv("MAX_IMAGE_BYTES", str(4_000_000))))

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{self.data_dir / 'health_mirror.db'}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
