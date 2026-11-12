from __future__ import annotations

import logging
import os

from app.config import Settings

log = logging.getLogger(__name__)


def make_provider(settings: Settings):
    from app.llm.providers.offline_provider import OfflineTemplateProvider

    choice = settings.llm_provider
    has_creds = bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))
    if choice == "anthropic" or (choice == "auto" and has_creds):
        try:
            from app.llm.providers.anthropic_provider import AnthropicProvider

            return AnthropicProvider(settings.llm_model, settings.llm_effort, settings.llm_timeout_s)
        except Exception as exc:  # noqa: BLE001
            log.warning("Anthropic provider unavailable (%s); using offline template provider", exc)
    return OfflineTemplateProvider()
