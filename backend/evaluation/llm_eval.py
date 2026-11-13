"""LLM behaviour evaluation (groundedness, hallucination, safety, preference consistency).

    python -m evaluation.llm_eval [--out ../docs/evaluation/llm.md]

Runs the hand-written cases in evaluation/cases/llm_cases.json through the CONFIGURED provider (offline
template unless ANTHROPIC_API_KEY / LLM_PROVIDER is set) and the real local catalogue. The provider used is
recorded with the results; offline-template numbers say nothing about a hosted model.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from app.config import get_settings
from app.services import build_services
from app.schemas.catalog import RecommendationRequest
from app.schemas.protocol import ChatMessage, ChatRequest, Observation, StructuredObservations

CASES = Path(__file__).parent / "cases" / "llm_cases.json"


def obs_from(rows):
    if rows is None:
        return None
    return StructuredObservations(image_quality="acceptable", generated_at=time.time() * 1000, demo_mode=True, validation_status="demo",
                                  observations=[Observation(region=r, feature=f, confidence=0.85 if st == "accepted" else 0.55, status=st, present=pr,
                                                            model_id="m", model_version="v", model_tier="demo", frames_aggregated=5) for r, f, st, pr in rows])


def run() -> dict:
    svc = build_services(get_settings(), load_models=False)
    cases = json.loads(CASES.read_text())
    chat_rows = []
    for c in cases["chat"]:
        resp = svc.assistant.respond(ChatRequest(session_id="eval-0001", messages=[ChatMessage(role="user", content=c["message"])]), obs_from(c["obs"]))
        e, msg = c["expect"], resp.reply.message.lower()
        checks = {"validator_all_passed": all(v.passed for v in resp.trace.validation) if resp.trace.validation else True}
        if "route" in e:
            checks["route"] = resp.trace.route == e["route"] or (e["route"] != "urgent_safety" and resp.trace.route == "fallback")
        if e.get("suggests_professional"):
            checks["suggests_professional"] = resp.reply.suggests_professional
        if e.get("must_mention_any"):
            checks["mentions"] = any(w in msg for w in e["must_mention_any"])
        if e.get("must_not"):
            checks["forbidden_phrases_absent"] = not any(w in msg for w in e["must_not"])
        if e.get("no_visual_claims"):
            checks["no_observation_hallucination"] = next((v.passed for v in resp.trace.validation if v.name == "visual_claims_grounded"), True) and not resp.reply.referenced_observations
        chat_rows.append({"id": c["id"], "route": resp.trace.route, "provider": resp.trace.provider, "checks": checks, "passed": all(checks.values())})
    rec_rows = []
    for c in cases["recommendations"]:
        r = svc.recommender.recommend(RecommendationRequest(**c["request"]))
        ids = {x.product.product_id for x in r.results}
        req = r.request
        violations = []
        if req.fragrance_free:
            violations += [x.product.product_id for x in r.results if x.product.attributes.contains_fragrance_ingredient == "yes"]
        if req.confirmed_age_range == "under_18":
            violations += [x.product.product_id for x in r.results if "anti_aging_marketing" in x.product.attributes.benefits]
        explained = {p.product_id for p in (r.explanations.products if r.explanations else [])}
        rec_rows.append({"id": c["id"], "results": len(r.results), "validation_passed": all(v["passed"] for v in r.trace.validation) if r.trace.validation else None,
                         "product_hallucination": len(explained - ids), "preference_violations": len(violations), "age_used": r.trace.age_used,
                         "llm_provider": r.trace.llm.get("provider")})
    return {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "provider": svc.assistant.provider.name, "model": getattr(svc.assistant.provider, "model", ""),
        "chat": {"cases": len(chat_rows), "passed": sum(r["passed"] for r in chat_rows),
                 "safety_routing_accuracy": sum(r["checks"].get("route", True) for r in chat_rows if r["id"] in ("urgent-eye", "airway")) / 2, "rows": chat_rows},
        "recommendations": {"cases": len(rec_rows), "product_hallucinations": sum(r["product_hallucination"] for r in rec_rows),
                            "preference_violations": sum(r["preference_violations"] for r in rec_rows), "rows": rec_rows},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    rep = run()
    text = json.dumps(rep, indent=2)
    print(text)
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(f"# LLM evaluation (generated)\n\nProvider: **{rep['provider']}** ({rep['model']}). "
                         "Offline-template results only test the deterministic pipeline (routing, validation, grounding), not a hosted LLM.\n\n"
                         "Command: `python -m evaluation.llm_eval`\n\n```json\n" + text + "\n```\n")


if __name__ == "__main__":
    main()
