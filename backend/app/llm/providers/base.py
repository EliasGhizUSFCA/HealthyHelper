"""LLM provider abstraction. Providers return a validated AssistantReply or raise."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from pydantic import BaseModel

from app.schemas.protocol import AssistantReply


@dataclass
class LLMRequest:
    system: str
    messages: list[dict]  # [{"role": "user"|"assistant", "content": str}]
    context: dict  # structured context (evidence, retrieval, symptoms) — used by offline provider
    max_tokens: int = 2048
    output_model: type[BaseModel] = AssistantReply


@dataclass
class LLMResult:
    reply: Any  # instance of LLMRequest.output_model
    model: str
    usage: dict[str, int] = field(default_factory=dict)
    stop_reason: str | None = None


class LLMError(RuntimeError):
    pass


class LLMRefusal(LLMError):
    pass


class LLMProvider(Protocol):
    name: str
    model: str

    def generate(self, req: LLMRequest) -> LLMResult: ...
