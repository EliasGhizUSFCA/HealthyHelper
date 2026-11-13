"""Recommendation service: retrieval → ranking → grounded explanation, fully traced.

Privacy: no user data is ever sent to the retailer. Recommendations are computed from the local catalogue;
the retailer is only contacted by the catalogue refresh job (product pages, no user context).
"""

from __future__ import annotations

import uuid

from app.llm.providers.base import LLMError, LLMRequest
from app.recommendations import explain as X
from app.recommendations.catalog.store import CatalogStore
from app.recommendations.ranking.engine import load_weights, plan, rank
from app.schemas.catalog import ExplanationSet, RecommendationRequest, RecommendationResponse, RecommendationTrace
from app.timeutil import now_ms, perf_ms

DISCLAIMER = ("Products are suggestions based on retailer listings and your stated preferences — not medical advice. Marketing claims are "
              "the retailer's or brand's, not verified by this app. Prices and availability can change; confirm on eCosmetics.")


def _event(session_id, stage, status, start, dur, it, ot, output=None, error=None, model=None) -> dict:
    return {"event_id": uuid.uuid4().hex, "session_id": session_id or "anonymous", "frame_id": -1, "stage": stage, "status": status, "origin": "server",
            "started_at": start, "duration_ms": round(dur, 3), "input_type": it, "output_type": ot, "model_id": model, "model_version": None,
            "message": error, "seq": 0, "output": output, "error": error}


class RecommendationService:
    def __init__(self, store: CatalogStore, provider):
        self.store, self.provider = store, provider

    def recommend(self, req: RecommendationRequest) -> RecommendationResponse:
        events, timings = [], {}
        t0, w0 = perf_ms(), now_ms()
        cats, terms, _ = plan(req)
        timings["preferences"] = perf_ms() - t0
        events.append(_event(req.session_id, "user_preferences", "ok", w0, timings["preferences"], "RecommendationRequest", "categories + search terms",
                             {"categories": cats, "terms": terms, "confirmed_age_range_provided": bool(req.confirmed_age_range)}))

        t1, w1 = perf_ms(), now_ms()
        candidates = self.store.all(categories=cats, mode=req.mode)
        timings["retrieval"] = perf_ms() - t1
        events.append(_event(req.session_id, "product_retrieval", "ok" if candidates else "warning", w1, timings["retrieval"],
                             "categories", f"{len(candidates)} catalogue records", {"source": "local_catalogue", "candidates": len(candidates)},
                             None if candidates else "no products in the local catalogue for these categories — run a catalogue refresh"))

        t2, w2 = perf_ms(), now_ms()
        weights = load_weights()
        ranked, removed, meta = rank(req, candidates, weights)
        timings["ranking"] = perf_ms() - t2
        events.append(_event(req.session_id, "product_ranking", "ok", w2, timings["ranking"], f"{len(candidates)} candidates",
                             f"{len(ranked)} ranked", {"filtered_out": len(removed), "top": [r.product.product_id for r in ranked[:5]]}))

        explanations, llm_info, checks = None, {}, []
        if req.explain and ranked:
            ctx = X.build_context(req, ranked, meta["age_used"])
            msg = [{"role": "user", "content": X.render_user_message(ctx)}]
            prov = self.provider
            for attempt in range(2):
                t3, w3 = perf_ms(), now_ms()
                try:
                    res = prov.generate(LLMRequest(X.SYSTEM, msg, ctx, max_tokens=2048, output_model=ExplanationSet))
                except LLMError as exc:
                    events.append(_event(req.session_id, "llm_request", "error", w3, perf_ms() - t3, "ranked product records", "error", error=str(exc),
                                         model=getattr(prov, "model", None)))
                    break
                dur = perf_ms() - t3
                timings[f"llm#{attempt + 1}"] = dur
                events.append(_event(req.session_id, "llm_request", "ok", w3, dur, "ranked product records", "ExplanationSet",
                                     {"provider": prov.name, "usage": res.usage}, model=res.model))
                t4, w4 = perf_ms(), now_ms()
                checks = X.validate(res.reply, ctx)
                ok = all(c["passed"] for c in checks)
                events.append(_event(req.session_id, "response_validation", "ok" if ok else "warning", w4, perf_ms() - t4, "ExplanationSet",
                                     f"{sum(c['passed'] for c in checks)}/{len(checks)} checks", {"failed": [c["name"] for c in checks if not c["passed"]]}))
                llm_info = {"provider": prov.name, "model": res.model, "usage": res.usage, "attempts": attempt + 1, "fallback": False,
                            "latency_ms": round(dur, 1)}
                if ok:
                    explanations = res.reply
                    break
                msg = msg + [{"role": "assistant", "content": res.reply.model_dump_json()},
                             {"role": "user", "content": "These checks failed: " + "; ".join(
                                 f"{c['name']}: {c['detail']}" for c in checks if not c["passed"]) + ". Rewrite so every check passes."}]
            if explanations is None:  # template is always valid by construction; validate anyway
                explanations = X.template_explanations(ctx)
                checks = X.validate(explanations, ctx)
                llm_info = {**llm_info, "provider": "offline-template", "fallback": True}

        timings["total"] = perf_ms() - t0
        trace = RecommendationTrace(
            categories_searched=cats, search_terms=terms, candidates=len(candidates), after_filters=len(candidates) - len(removed),
            filtered_out=removed[:100], weights=weights, age_used=meta["age_used"], age_note=meta["age_note"],
            stale_in_results=sum(r.product.stale for r in ranked), timings_ms={k: round(v, 2) for k, v in timings.items()}, llm=llm_info, validation=checks,
        )
        return RecommendationResponse(request=req, results=ranked, explanations=explanations, trace=trace, events=events, disclaimer=DISCLAIMER)
