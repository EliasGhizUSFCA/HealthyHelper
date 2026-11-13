"""Application service container (dependency wiring in one place)."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.config import Settings, get_settings
from app.inference.engine import InferenceEngine
from app.inference.registry import ModelRegistry
from app.llm.agent import HealthAssistant
from app.llm.providers import make_provider
from app.recommendations.catalog.refresh import RefreshJob
from app.recommendations.catalog.store import CatalogStore
from app.recommendations.scraper.discovery import SitemapCache
from app.recommendations.scraper.policy import AccessPolicy
from app.recommendations.service import RecommendationService
from app.sessions import SessionStore
from app.storage.dataset import DatasetStore
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
    dataset: DatasetStore
    catalog: CatalogStore
    catalog_policy: AccessPolicy
    sitemap_cache: SitemapCache
    refresh_job: RefreshJob
    recommender: RecommendationService
    counters: Counters = field(default_factory=Counters)


def build_services(settings: Settings | None = None, load_models: bool = True, provider=None) -> Services:
    s = settings or get_settings()
    reg = ModelRegistry(s)
    if load_models:
        reg.load_all()
    llm = provider or make_provider(s)
    catalog = CatalogStore(s)
    recommender = RecommendationService(catalog, llm)
    return Services(
        settings=s, registry=reg, engine=InferenceEngine(reg, s), sessions=SessionStore(),
        assistant=HealthAssistant(llm, s, catalog, recommender), history=HistoryStore(s), dataset=DatasetStore(s),
        catalog=catalog, catalog_policy=AccessPolicy(), sitemap_cache=SitemapCache(s.data_dir / "catalog_cache" / "sitemap.json"),
        refresh_job=RefreshJob(catalog), recommender=recommender,
    )
