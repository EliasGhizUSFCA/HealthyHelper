"""Deterministic, template-based provider used when no LLM credentials are configured.

It is NOT a language model: it composes replies from the accepted evidence and
retrieved educational snippets. Clearly labelled as ``offline-template`` in the
trace. Also used as the last-resort grounded fallback when an LLM reply fails
validation twice.
"""

from __future__ import annotations

from app.llm.providers.base import LLMRequest, LLMResult
from app.schemas.protocol import AssistantReply

REGION_PHRASE = {
    "lips": "your lips", "left_eye": "your left eye", "right_eye": "your right eye", "nose": "the skin around your nose",
    "skin_forehead": "the skin on your forehead", "skin_left_cheek": "the skin on your left cheek", "skin_right_cheek": "the skin on your right cheek",
    "skin_chin": "the skin on your chin", "left_undereye": "the area under your left eye", "right_undereye": "the area under your right eye",
}
FEATURE_PHRASE = {  # (plural subject, singular subject)
    "visible_dryness": ("appear visibly dry", "appears visibly dry"), "visible_redness": ("show some visible redness", "shows some visible redness"),
    "visible_flaking": ("appear dry or flaky", "appears dry or flaky"), "visible_blemishes": ("show some visible spots or blemishes", "shows some visible spots or blemishes"),
    "visible_shine": ("look somewhat shiny", "looks somewhat shiny"), "visible_darkness": ("look somewhat darker than nearby skin", "looks somewhat darker than nearby skin"),
}


def compose(context: dict, last_user: str) -> AssistantReply:
    evidence = [e for e in context.get("evidence", []) if e.get("status") == "accepted" and e.get("present")]
    demo = context.get("demo_mode", False)
    docs = context.get("retrieved", [])
    route = context.get("route")
    parts: list[str] = []
    follow: list[str] = []
    refs: list[str] = []
    if route == "diagnosis_request":
        parts.append("I can't diagnose conditions, and a camera can't tell whether someone is dehydrated or unwell — an image only shows some surface appearance, and lighting strongly affects it.")
    if context.get("image_quality") == "unusable":
        parts.append("The current image isn't clear enough for me to describe anything reliably — try even, front-facing light and keep your face centred.")
    elif evidence:
        e = evidence[0]
        refs = [f"{x['region']}:{x['feature']}" for x in evidence]
        plural = e["region"] in ("lips",)
        phrase = FEATURE_PHRASE.get(e["feature"], ("show a visible feature", "shows a visible feature"))[0 if plural else 1]
        lead = "In this image, " + REGION_PHRASE.get(e["region"], e["region"]) + " " + phrase
        parts.append(lead + ", although lighting and camera quality can affect how this looks.")
        if demo:
            parts.append("Note: this comes from a demonstration model trained on synthetic images, so please treat it as a demo of the system rather than a real observation.")
        elif context.get("validation_status") == "experimental":
            parts.append("Note: this comes from an experimental model trained on a small set of real images and not yet validated, so treat it as tentative.")
    elif context.get("evidence"):
        parts.append("I don't have a clear, confident visual observation to share right now; the available model results were inconclusive or unavailable.")
    else:
        parts.append("I don't have any visual observations yet. You can start the camera and enable analysis, or tell me what you've noticed.")
    for d in docs[:1]:
        if d.get("self_care") and (evidence or route != "diagnosis_request"):
            parts.append(d["self_care"])
        follow.extend(d.get("follow_up_questions", [])[:2])
        if d.get("see_professional_if"):
            parts.append("Consider speaking with a healthcare professional if you notice: " + d["see_professional_if"][0].lower() + d["see_professional_if"][1:])
    products = context.get("products") or []
    if products:
        q = (context.get("question") or last_user or "").lower()
        facts = []
        for p in products[:3]:
            price = f"${p['price']:.2f}" if p.get("price") is not None else "price not listed"
            bit = f"{p.get('brand') or ''} {p['name']}".strip() + f" ({price}" + (f", {p['size']}" if p.get("size") else "") + ")"
            if "ingredient" in q or "fragrance" in q:
                a = p.get("attributes", {})
                if a.get("fragrance_free_claimed") == "yes":
                    bit += " is marketed as fragrance-free"
                elif a.get("contains_fragrance_ingredient") == "yes":
                    bit += " lists fragrance/parfum or is described as scented"
                elif a.get("contains_fragrance_ingredient") == "no":
                    bit += " — its listed ingredients don't include fragrance/parfum"
                else:
                    bit += " — no ingredient list on the retailer page"
            facts.append(bit)
        parts.insert(0, "About the products you selected (from the retailer's listings, not tested by this app): " + "; ".join(facts) + ".")
    suggests = route == "diagnosis_request" or any(d.get("see_professional_if") for d in docs[:1])
    if route == "diagnosis_request" and not any("professional" in p for p in parts):
        parts.append("If you're concerned about your health, a healthcare professional can examine you properly.")
    return AssistantReply(
        message=" ".join(parts),
        follow_up_questions=follow[:2],
        referenced_observations=refs,
        evidence_sufficient=bool(evidence) and context.get("image_quality") != "unusable",
        suggests_professional=suggests,
    )


class OfflineTemplateProvider:
    name = "offline-template"
    model = "rules-v1 (no LLM)"

    def generate(self, req: LLMRequest) -> LLMResult:
        if req.output_model is not AssistantReply:
            from app.recommendations.explain import template_explanations

            return LLMResult(reply=template_explanations(req.context), model=self.model, usage={}, stop_reason="end_turn")
        last_user = next((m["content"] for m in reversed(req.messages) if m["role"] == "user"), "")
        return LLMResult(reply=compose(req.context, last_user), model=self.model, usage={}, stop_reason="end_turn")
