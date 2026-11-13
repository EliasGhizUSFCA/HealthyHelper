"""Grounded assistant workflow (code-orchestrated, not an open-ended agent).

    1. safety triage (deterministic)         → urgent route bypasses the LLM
    2. evidence selection                    → only accepted observations are "evidence"
    3. sufficiency check                     → insufficient_evidence route
    4. retrieval of curated education        → lexical retriever
    5. LLM generation (structured output)    → provider abstraction
    6. response validation (+1 retry)        → deterministic safety/grounding checks
    7. grounded template fallback            → if validation fails twice / provider errors

Every step is timed and reported in AgentTrace so Model Lab can show exactly
what the LLM received and why the final answer was accepted.
"""

from __future__ import annotations

import json
import logging

from app.config import Settings, get_settings
from app.llm.prompts import SYSTEM_PROMPT, render_context
from app.llm.providers.base import LLMError, LLMRequest
from app.llm.providers.offline_provider import OfflineTemplateProvider, compose
from app.llm.retrieval import retrieve
from app.safety.redaction import redact
from app.safety.triage import triage
from app.safety.validator import evidence_keys, validate_reply
from app.schemas.protocol import (
    AgentTrace,
    AssistantReply,
    ChatRequest,
    ChatResponse,
    PipelineStage,
    StageStatus,
    StructuredObservations,
    TelemetryEvent,
    TraceStep,
)
from app.timeutil import now_ms, perf_ms

log = logging.getLogger(__name__)


class _Steps:
    def __init__(self) -> None:
        self.steps: list[TraceStep] = []

    def add(self, name: str, t0: float, status: StageStatus = StageStatus.ok, **detail) -> None:
        self.steps.append(TraceStep(name=name, status=status, duration_ms=round(perf_ms() - t0, 3), detail=detail))


class HealthAssistant:
    def __init__(self, provider, settings: Settings | None = None):
        self.provider = provider
        self.settings = settings or get_settings()
        self.fallback = OfflineTemplateProvider()

    def respond(self, req: ChatRequest, server_obs: StructuredObservations | None) -> ChatResponse:
        t_start, wall_start = perf_ms(), now_ms()
        steps = _Steps()
        events: list[TelemetryEvent] = []
        last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
        symptoms = [s[:120] for s in req.user_reported_symptoms]

        # 1. triage
        t0 = perf_ms()
        tri = triage(last_user + " " + " ".join(symptoms))
        steps.add("safety_triage", t0, route=tri.route, category=tri.category, matched=tri.matched)
        obs = server_obs or req.observations
        if obs is not None:
            obs = obs.model_copy(update={"user_reported_symptoms": symptoms, "medical_diagnosis_requested": tri.route == "diagnosis_request"})

        if tri.route == "urgent_safety":
            reply = AssistantReply(message=tri.message or "", follow_up_questions=[], referenced_observations=[],
                                   evidence_sufficient=False, suggests_professional=True)
            return self._finish(req, reply, "urgent_safety", "safety-router", "reviewed-responses-v1", steps, obs, [], [], "(LLM not called: predetermined safety response)",
                                [], 0, {}, t_start, wall_start, events)

        # 2-3. evidence selection + sufficiency
        t0 = perf_ms()
        accepted = sorted(evidence_keys(obs))
        selected = [o.model_dump() for o in (obs.observations if obs else []) if o.status == "accepted"]
        sufficient = bool(obs) and obs.image_quality != "unusable" and any(o["present"] for o in selected)
        route = tri.route if tri.route == "diagnosis_request" else ("standard" if sufficient else "insufficient_evidence")
        steps.add("evidence_selection", t0, accepted=accepted, n_total=len(obs.observations) if obs else 0,
                  image_quality=obs.image_quality if obs else None, demo_mode=bool(obs and obs.demo_mode), sufficient=sufficient, route=route)

        # 4. retrieval
        t0 = perf_ms()
        hits = retrieve(last_user + " " + " ".join(symptoms), set(accepted))
        docs = [d for d, _ in hits]
        steps.add("retrieval", t0, query_chars=len(last_user), docs=[r.doc_id for _, r in hits])

        evidence_payload = None
        if obs is not None:
            evidence_payload = {
                "image_quality": obs.image_quality, "quality_issues": obs.quality_issues, "demo_mode": obs.demo_mode,
                "observations": [{k: o[k] for k in ("region", "feature", "confidence", "status", "present", "model_tier")} for o in
                                 [x.model_dump() for x in obs.observations]],
                "medical_diagnosis_requested": obs.medical_diagnosis_requested,
            }
        context_text = render_context(evidence_payload, docs, symptoms, route)
        history = [{"role": m.role, "content": m.content} for m in req.messages[:-1]][-10:]
        if history and history[0]["role"] != "user":
            history = history[1:]
        messages = history + [{"role": "user", "content": f"{context_text}\n\n<user_message>\n{last_user}\n</user_message>"}]
        offline_ctx = {"evidence": selected, "demo_mode": bool(obs and obs.demo_mode), "retrieved": docs, "route": route,
                       "image_quality": obs.image_quality if obs else None}
        preview = redact(f"[system prompt: {len(SYSTEM_PROMPT)} chars, static]\n" + "\n".join(
            f"[{m['role']}] {m['content'][:1500]}" for m in messages[-3:]))

        # 5-6. generate + validate (one retry with feedback)
        attempts, usage, provider_name, model_name = 0, {}, self.provider.name, getattr(self.provider, "model", "")
        reply: AssistantReply | None = None
        checks = []
        final_route = route
        feedback = ""
        for attempt in range(2):
            attempts += 1
            t0, llm_wall = perf_ms(), now_ms()
            msgs = messages if not feedback else messages + [
                {"role": "assistant", "content": json.dumps(reply.model_dump()) if reply else "{}"},
                {"role": "user", "content": f"Your previous reply failed these checks: {feedback}. Rewrite it so every check passes."}]
            try:
                res = self.provider.generate(LLMRequest(SYSTEM_PROMPT, msgs, offline_ctx))
                reply, model_name = res.reply, res.model
                for k, v in res.usage.items():
                    usage[k] = usage.get(k, 0) + v
                steps.add(f"llm_generate#{attempt + 1}", t0, provider=provider_name, model=model_name, usage=res.usage, stop_reason=res.stop_reason)
                events.append(self._event(req.session_id, PipelineStage.llm_request, StageStatus.ok, llm_wall, perf_ms() - t0,
                                          "context + messages", "AssistantReply (structured)", model_name))
            except LLMError as exc:
                steps.add(f"llm_generate#{attempt + 1}", t0, StageStatus.error, provider=provider_name, error=str(exc))
                events.append(self._event(req.session_id, PipelineStage.llm_request, StageStatus.error, llm_wall, perf_ms() - t0,
                                          "context + messages", "error", model_name, str(exc)))
                reply = None
                break
            t0, v_wall = perf_ms(), now_ms()
            checks = validate_reply(reply, obs, route == "diagnosis_request")
            failed = [c for c in checks if not c.passed]
            steps.add(f"validate#{attempt + 1}", t0, StageStatus.ok if not failed else StageStatus.warning,
                      failed=[c.name for c in failed])
            events.append(self._event(req.session_id, PipelineStage.response_validation, StageStatus.ok if not failed else StageStatus.warning,
                                      v_wall, perf_ms() - t0, "AssistantReply", f"{len(checks) - len(failed)}/{len(checks)} checks passed"))
            if not failed:
                break
            feedback = "; ".join(f"{c.name}: {c.detail}" for c in failed)
            reply = None if attempt == 1 else reply

        # 7. fallback
        if reply is None:
            t0 = perf_ms()
            reply = compose(offline_ctx, last_user)
            checks = validate_reply(reply, obs, route == "diagnosis_request")
            final_route = "fallback"
            steps.add("grounded_template_fallback", t0, StageStatus.warning, reason="provider error or validation failed twice",
                      checks_passed=all(c.passed for c in checks))
        return self._finish(req, reply, final_route, provider_name, model_name, steps, obs, accepted, hits, preview, checks, attempts, usage,
                            t_start, wall_start, events)

    def _event(self, sid, stage, status, start, dur, it, ot, model=None, msg=None) -> TelemetryEvent:
        return TelemetryEvent(session_id=sid, frame_id=-1, stage=stage, status=status, origin="server", started_at=start,
                              duration_ms=round(dur, 3), input_type=it, output_type=ot, model_id=model, message=msg, seq=0)

    def _finish(self, req, reply, route, provider, model, steps, obs, selected, hits, preview, checks, attempts, usage, t_start, wall_start, events):
        if route == "urgent_safety":
            events.append(self._event(req.session_id, PipelineStage.llm_request, StageStatus.skipped, wall_start, 0.0,
                                      "user message", "predetermined safety response", None, "urgent safety route — LLM bypassed"))
        trace = AgentTrace(
            provider=provider, model=model, route=route, steps=steps.steps, evidence=obs, selected_evidence=selected,
            retrieval=[r for _, r in hits], context_preview=preview, validation=checks, attempts=attempts,
            latency_ms=round(perf_ms() - t_start, 2), usage=usage,
        )
        if self.settings.log_content:
            log.info("chat route=%s reply=%s", route, redact(reply.message))
        else:
            log.info("chat route=%s attempts=%d checks_passed=%s", route, attempts, all(c.passed for c in checks))
        return ChatResponse(reply=reply, trace=trace, events=events)
