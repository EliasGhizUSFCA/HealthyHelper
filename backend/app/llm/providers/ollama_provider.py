"""Open-weight alternative: any model served by Ollama (https://ollama.com), e.g. `ollama run llama3.1`.

Uses Ollama's native /api/chat with a JSON-schema ``format`` so outputs are constrained to the same
Pydantic schemas, then validated exactly like the hosted provider's outputs.
"""

from __future__ import annotations

import httpx
from pydantic import ValidationError

from app.llm.providers.base import LLMError, LLMRequest, LLMResult


class OllamaProvider:
    name = "ollama"

    def __init__(self, model: str, base_url: str = "http://localhost:11434", timeout_s: float = 120.0):
        self.model, self.base_url = model, base_url.rstrip("/")
        self.client = httpx.Client(timeout=timeout_s)

    def generate(self, req: LLMRequest) -> LLMResult:
        body = {
            "model": self.model, "stream": False, "format": req.output_model.model_json_schema(),
            "messages": [{"role": "system", "content": req.system}] + req.messages,
            "options": {"temperature": 0.2, "num_predict": req.max_tokens},
        }
        try:
            r = self.client.post(f"{self.base_url}/api/chat", json=body)
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMError(f"ollama request failed: {exc}") from exc
        data = r.json()
        try:
            reply = req.output_model.model_validate_json(data["message"]["content"])
        except (KeyError, ValidationError) as exc:
            raise LLMError(f"ollama returned invalid structured output: {str(exc)[:200]}") from exc
        usage = {"input_tokens": int(data.get("prompt_eval_count", 0)), "output_tokens": int(data.get("eval_count", 0))}
        return LLMResult(reply=reply, model=f"ollama:{self.model}", usage=usage, stop_reason=data.get("done_reason"))
