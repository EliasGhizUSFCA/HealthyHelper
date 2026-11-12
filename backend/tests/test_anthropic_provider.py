"""AnthropicProvider against a fake SDK client (no network, no credentials)."""

from types import SimpleNamespace

import pytest

from app.llm.providers.anthropic_provider import AnthropicProvider
from app.llm.providers.base import LLMError, LLMRefusal, LLMRequest
from app.schemas.protocol import AssistantReply

REPLY = AssistantReply(message="Your lips appear dry in this image (demo).", evidence_sufficient=True, suggests_professional=False)


class FakeMessages:
    def __init__(self, resp):
        self.resp, self.kwargs = resp, None

    def parse(self, **kw):
        self.kwargs = kw
        return self.resp


def provider(resp, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    p = AnthropicProvider(model="claude-opus-5-5", effort="low")
    fake = FakeMessages(resp)
    p.client = SimpleNamespace(beta=SimpleNamespace(messages=fake))
    return p, fake


def resp(stop="end_turn", parsed=REPLY):
    return SimpleNamespace(stop_reason=stop, parsed_output=parsed, model="claude-opus-5-5",
                           usage=SimpleNamespace(input_tokens=120, output_tokens=40, cache_read_input_tokens=100))


def test_request_shape_and_usage(monkeypatch):
    p, fake = provider(resp(), monkeypatch)
    out = p.generate(LLMRequest(system="SYS", messages=[{"role": "user", "content": "hi"}], context={}))
    kw = fake.kwargs
    assert kw["model"] == "claude-opus-5-5" and kw["output_format"] is AssistantReply
    assert kw["output_config"] == {"effort": "low"} and kw["fallbacks"] == "default"
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"}  # static system prompt is cacheable
    assert "temperature" not in kw and "thinking" not in kw
    assert out.reply == REPLY and out.usage == {"input_tokens": 120, "output_tokens": 40, "cache_read_input_tokens": 100}


def test_refusal_and_truncation(monkeypatch):
    p, _ = provider(resp(stop="refusal", parsed=None), monkeypatch)
    with pytest.raises(LLMRefusal):
        p.generate(LLMRequest("s", [{"role": "user", "content": "x"}], {}))
    p, _ = provider(resp(stop="max_tokens"), monkeypatch)
    with pytest.raises(LLMError):
        p.generate(LLMRequest("s", [{"role": "user", "content": "x"}], {}))
