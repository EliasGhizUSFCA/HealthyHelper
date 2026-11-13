"""Claude via the official Anthropic SDK with structured (Pydantic-validated) outputs.

The API key is read server-side from ANTHROPIC_API_KEY (or another SDK credential
source); it never reaches the browser.
"""

from __future__ import annotations

from app.llm.providers.base import LLMError, LLMRefusal, LLMRequest, LLMResult


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, model: str = "claude-opus-5-5", effort: str = "low", timeout_s: float = 60.0):
        import anthropic

        self._anthropic = anthropic
        self.client = anthropic.Anthropic(timeout=timeout_s, max_retries=2)
        self.model = model
        self.effort = effort

    def generate(self, req: LLMRequest) -> LLMResult:
        a = self._anthropic
        try:
            resp = self.client.beta.messages.parse(
                model=self.model,
                max_tokens=req.max_tokens,
                system=[{"type": "text", "text": req.system, "cache_control": {"type": "ephemeral"}}],
                messages=req.messages,
                output_format=req.output_model,
                output_config={"effort": self.effort},
                # Server-side refusal fallback: on a policy decline the API re-runs on a fallback model.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except a.RateLimitError as exc:
            raise LLMError(f"rate limited: {exc}") from exc
        except a.APIStatusError as exc:
            raise LLMError(f"API error {exc.status_code}") from exc
        except a.APIConnectionError as exc:
            raise LLMError("could not reach the LLM API") from exc
        if resp.stop_reason == "refusal":
            raise LLMRefusal("model declined the request")
        if resp.stop_reason == "max_tokens":
            raise LLMError("response truncated (max_tokens)")
        parsed = resp.parsed_output
        if parsed is None:
            raise LLMError("no structured output returned")
        u = resp.usage
        usage = {
            "input_tokens": int(getattr(u, "input_tokens", 0) or 0),
            "output_tokens": int(getattr(u, "output_tokens", 0) or 0),
            "cache_read_input_tokens": int(getattr(u, "cache_read_input_tokens", 0) or 0),
        }
        return LLMResult(reply=parsed, model=resp.model, usage=usage, stop_reason=resp.stop_reason)
