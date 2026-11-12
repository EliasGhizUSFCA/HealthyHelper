import pytest

from app.llm.agent import HealthAssistant
from app.llm.providers.base import LLMError, LLMResult
from app.llm.providers.offline_provider import OfflineTemplateProvider
from app.safety.redaction import redact
from app.safety.triage import triage
from app.safety.validator import validate_reply
from app.schemas.protocol import AssistantReply, ChatMessage, ChatRequest, Observation, StructuredObservations


def obs(present=True, status="accepted", tier="demo", quality="acceptable", region="lips", feature="visible_dryness"):
    return StructuredObservations(
        image_quality=quality, observations=[Observation(region=region, feature=feature, confidence=0.86 if present else 0.2, status=status,
                                                         present=present if status == "accepted" else None, model_id="lip_dryness",
                                                         model_version="t", model_tier=tier, frames_aggregated=5)],
        demo_mode=tier == "demo", generated_at=0.0)


def req(text, symptoms=()):
    return ChatRequest(session_id="sess-0001", messages=[ChatMessage(role="user", content=text)], user_reported_symptoms=list(symptoms))


@pytest.mark.parametrize("text,cat", [
    ("I have severe eye pain since this morning", "eye_emergency"),
    ("suddenly I can't see out of my left eye", "eye_emergency"),
    ("my lips are swelling and it's hard to breathe", "airway_allergy"),
    ("one side of my face is drooping", "stroke_signs"),
    ("I want to kill myself", "self_harm"),
])
def test_urgent_routes(text, cat):
    t = triage(text)
    assert t.route == "urgent_safety" and t.category == cat and t.message


def test_negated_symptom_not_urgent():
    assert triage("no eye pain, just a bit of dryness on my lips").route == "standard"


@pytest.mark.parametrize("text", ["Am I dehydrated?", "do I have an infection", "can you diagnose this", "what's my health score"])
def test_diagnosis_requests(text):
    assert triage(text).route == "diagnosis_request"


def test_validator_blocks_diagnosis_and_scores():
    r = AssistantReply(message="You are dehydrated. Your health score is 6/10.", evidence_sufficient=True, suggests_professional=False)
    failed = {c.name for c in validate_reply(r, obs(), False) if not c.passed}
    assert {"no_diagnostic_language", "no_health_score"} <= failed


def test_validator_blocks_ungrounded_visual_claims():
    r = AssistantReply(message="Your eyes look visibly red in this image, and your lips appear dry (demo model).", referenced_observations=["left_eye:visible_redness"],
                       evidence_sufficient=True, suggests_professional=False)
    checks = {c.name: c for c in validate_reply(r, obs(), False)}
    assert not checks["visual_claims_grounded"].passed and "eyes" in checks["visual_claims_grounded"].detail
    assert not checks["references_are_accepted_evidence"].passed


def test_validator_requires_demo_disclosure():
    r = AssistantReply(message="Your lips appear visibly dry in this image, though lighting matters.", referenced_observations=["lips:visible_dryness"],
                       evidence_sufficient=True, suggests_professional=False)
    checks = {c.name: c.passed for c in validate_reply(r, obs(tier="demo"), False)}
    assert checks["demo_mode_disclosed"] is False
    assert all(validate_reply(r, obs(tier="validated"), False)[i].passed for i in range(3))


def test_hedged_sentences_allowed():
    r = AssistantReply(message="I can't tell whether your eyes look red from this image. Cold weather can cause dry lips.",
                       evidence_sufficient=False, suggests_professional=False)
    assert all(c.passed for c in validate_reply(r, None, False))


class Scripted:
    name, model = "scripted", "fake-1"

    def __init__(self, replies):
        self.replies, self.calls = list(replies), 0

    def generate(self, r):
        self.calls += 1
        item = self.replies.pop(0)
        if isinstance(item, Exception):
            raise item
        return LLMResult(reply=item, model=self.model, usage={"input_tokens": 10, "output_tokens": 5})


GOOD = AssistantReply(message="Your lips appear visibly dry in this image (demo model trained on synthetic data), though lighting affects this. Have you been in cold air?",
                      follow_up_questions=["Have you been outside in the cold?"], referenced_observations=["lips:visible_dryness"],
                      evidence_sufficient=True, suggests_professional=False)
BAD = AssistantReply(message="You are dehydrated and your eyes look red.", evidence_sufficient=True, suggests_professional=False)


def test_urgent_bypasses_llm():
    p = Scripted([])
    out = HealthAssistant(p).respond(req("I have sudden vision loss"), obs())
    assert p.calls == 0 and out.trace.route == "urgent_safety" and out.reply.suggests_professional
    assert any(e.stage == "llm_request" and e.status == "skipped" for e in out.events)


def test_retry_then_pass():
    p = Scripted([BAD, GOOD])
    out = HealthAssistant(p).respond(req("how do my lips look?"), obs())
    assert p.calls == 2 and out.trace.attempts == 2 and out.trace.route == "standard"
    assert all(c.passed for c in out.trace.validation) and out.trace.usage["input_tokens"] == 20


def test_double_failure_falls_back_to_grounded_template():
    p = Scripted([BAD, BAD])
    out = HealthAssistant(p).respond(req("how do my lips look?"), obs())
    assert out.trace.route == "fallback" and all(c.passed for c in out.trace.validation)
    assert "dehydrated" not in out.reply.message


def test_provider_error_falls_back():
    out = HealthAssistant(Scripted([LLMError("down")])).respond(req("hello"), obs())
    assert out.trace.route == "fallback"
    assert any(e.status == "error" for e in out.events)


def test_offline_provider_grounded_and_discloses_demo():
    out = HealthAssistant(OfflineTemplateProvider()).respond(req("I've been out in the cold", ["dry lips"]), obs())
    assert "lips" in out.reply.message and "demonstration" in out.reply.message
    assert all(c.passed for c in out.trace.validation), out.trace.validation
    assert out.trace.retrieval and out.trace.retrieval[0].doc_id == "edu-lips-dry"


def test_insufficient_evidence_makes_no_visual_claims():
    out = HealthAssistant(OfflineTemplateProvider()).respond(req("what do you see?"), obs(status="inconclusive"))
    assert out.trace.route == "insufficient_evidence" and out.reply.referenced_observations == []
    assert "lips appear" not in out.reply.message


def test_diagnosis_request_redirects():
    out = HealthAssistant(OfflineTemplateProvider()).respond(req("Am I dehydrated?"), obs())
    assert out.trace.route == "diagnosis_request" and out.reply.suggests_professional
    assert "can't diagnose" in out.reply.message


def test_redaction():
    s = redact("mail me at a.b@example.com or +1 (555) 123-4567 data:image/png;base64,AAAA sk-abcdefghijkl")
    assert "example.com" not in s and "555" not in s and "AAAA" not in s and "sk-abc" not in s
