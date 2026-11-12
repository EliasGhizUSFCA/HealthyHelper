"""Application service container (dependency wiring in one place)."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.config import Settings, get_settings
from app.inference.engine import InferenceEngine
from app.inference.registry import ModelRegistry
from app.llm.agent import HealthAssistant
from app.llm.providers import make_provider
from app.sessions import SessionStore
from app.storage.history import HistoryStore


@dataclass
class Counters:
    frames_received: int = 0
    frames_processed: int = 0
    frames_dropped: int = 0
    frames_rejected: int = 0


@dataclass
class Services:
    settings: Settings
    registry: ModelRegistry
    engine: InferenceEngine
    sessions: SessionStore
    assistant: HealthAssistant
    history: HistoryStore
    counters: Counters = field(default_factory=Counters)


def build_services(settings: Settings | None = None, load_models: bool = True, provider=None) -> Services:
    s = settings or get_settings()
    reg = ModelRegistry(s)
    if load_models:
        reg.load_all()
    return Services(
        settings=s, registry=reg, engine=InferenceEngine(reg, s), sessions=SessionStore(),
        assistant=HealthAssistant(provider or make_provider(s), s), history=HistoryStore(s),
    )
