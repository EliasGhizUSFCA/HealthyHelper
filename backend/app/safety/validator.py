"""Post-generation validation of assistant replies against safety + grounding rules.

Checks are deterministic and individually reported in the agent trace. A reply
that fails is retried once with the failures as feedback; a second failure
falls back to a grounded template response.
"""

from __future__ import annotations

import re

from app.schemas.protocol import AssistantReply, StructuredObservations, ValidationCheck

CONDITIONS = (
    r"dehydrat\w*|infection|infected|conjunctivitis|pink ?eye|blepharitis|uveitis|glaucoma|eczema|psoriasis|dermatitis|rosacea|"
    r"cheilitis|herpes|cold sore|allerg\w*|deficien\w*|anemi\w*|anaemi\w*|diabetes|cancer|melanoma|lupus|disease|disorder|syndrome|illness|sick"
)
DIAGNOSTIC_PATTERNS = [
    re.compile(rf"\byou(?:'re| are| have| likely have| probably have| seem to have| might have| may have|'ve got) (?:an? |mild |some |signs of )?(?:{CONDITIONS})\b", re.I),
    re.compile(rf"\b(?:this|that|it) (?:is|looks like|indicates|means|suggests|confirms) (?:an? |that you have )?(?:{CONDITIONS})\b", re.I),
    re.compile(r"\b(?:i|we) (?:can )?(?:diagnose|confirm)\b", re.I),
    re.compile(r"\bdiagnosis (?:is|of)\b", re.I),
]
NEGATED_CONTEXT = re.compile(r"\b(can't|cannot|can not|unable to|not able to|no way to|whether|if|doesn't mean|does not mean|isn't|not)\b", re.I)
SCORE_PATTERNS = [re.compile(r"\bhealth score\b", re.I), re.compile(r"\b\d{1,3}\s*(?:/|out of)\s*(?:10|100)\b", re.I)]
REGION_WORDS = {
    "lips": r"\blips?\b|\bmouth\b",
    "eyes": r"\beyes?\b|\bsclera\b",
    "nose": r"\bnose\b|\bnostrils?\b|\bnasal\b",
    "skin": r"\bskin\b|\bcheeks?\b|\bforehead\b",
}
REGION_GROUP = {"lips": "lips", "left_eye": "eyes", "right_eye": "eyes", "nose": "nose",
                "skin_forehead": "skin", "skin_left_cheek": "skin", "skin_right_cheek": "skin"}
FEATURE_WORDS = re.compile(r"\b(dry|dryness|cracked|cracking|chapped|flak\w*|peel\w*|red|redness|irritat\w*|bloodshot)\b", re.I)
HEDGE = re.compile(r"\b(if|whether|can't|cannot|can not|couldn't|unable|not|no clear|doesn't|don't|isn't|unclear|inconclusive|could|might|may|can be|can cause|can contribute|often|sometimes|when|any)\b", re.I)
VISUAL_CLAIM = re.compile(r"\b(i can see|i see|appear\w*|look\w*|visible|visibly|noticed|detected|shows?|in (this|the) image)\b", re.I)


def evidence_keys(obs: StructuredObservations | None) -> set[str]:
    if obs is None:
        return set()
    return {f"{o.region}:{o.feature}" for o in obs.observations if o.status == "accepted"}


def _positive_groups(obs: StructuredObservations | None) -> set[str]:
    if obs is None:
        return set()
    return {REGION_GROUP[o.region] for o in obs.observations if o.status == "accepted" and o.present}


def validate_reply(reply: AssistantReply, obs: StructuredObservations | None, diagnosis_requested: bool) -> list[ValidationCheck]:
    text = reply.message
    checks: list[ValidationCheck] = []

    hits = []
    for p in DIAGNOSTIC_PATTERNS:
        for m in p.finditer(text):
            clause = re.split(r"[.!?;]", text[: m.start()])[-1]
            if not NEGATED_CONTEXT.search(clause):  # "I can't tell whether you are dehydrated" is fine
                hits.append(m.group(0))
    checks.append(ValidationCheck(name="no_diagnostic_language", passed=not hits, detail="; ".join(hits) or "no diagnostic statements"))

    scores = [m.group(0) for p in SCORE_PATTERNS for m in [p.search(text)] if m]
    checks.append(ValidationCheck(name="no_health_score", passed=not scores, detail="; ".join(scores) or "ok"))

    allowed = evidence_keys(obs)
    bad_refs = [r for r in reply.referenced_observations if r not in allowed]
    checks.append(ValidationCheck(name="references_are_accepted_evidence", passed=not bad_refs,
                                  detail=("unknown/unaccepted: " + ", ".join(bad_refs)) if bad_refs else f"{len(reply.referenced_observations)} refs ok"))

    positive = _positive_groups(obs)
    unsupported = []
    for sent in re.split(r"(?<=[.!?])\s+", text):
        if not (FEATURE_WORDS.search(sent) and VISUAL_CLAIM.search(sent)) or HEDGE.search(sent):
            continue
        for group, pat in REGION_WORDS.items():
            if re.search(pat, sent, re.I) and group not in positive:
                unsupported.append(f"{group}: '{sent[:80]}'")
    checks.append(ValidationCheck(name="visual_claims_grounded", passed=not unsupported,
                                  detail="; ".join(unsupported) or "every visual claim maps to accepted evidence"))

    if obs is not None and obs.demo_mode and positive:
        ok = bool(re.search(r"\bdemo\w*|\bsynthetic\b", text, re.I))
        checks.append(ValidationCheck(name="demo_mode_disclosed", passed=ok, detail="mentions demonstration model" if ok else "demo-tier evidence used without disclosure"))

    if diagnosis_requested:
        checks.append(ValidationCheck(name="diagnosis_request_redirected", passed=reply.suggests_professional,
                                      detail="suggests professional" if reply.suggests_professional else "must point to a professional"))

    checks.append(ValidationCheck(name="length_reasonable", passed=20 <= len(text) <= 1500, detail=f"{len(text)} chars"))
    return checks
