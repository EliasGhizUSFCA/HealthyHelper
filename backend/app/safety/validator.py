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
    r"cheilitis|herpes|cold sore|acne|pimples? condition|allerg\w*|deficien\w*|anemi\w*|anaemi\w*|diabetes|cancer|melanoma|lupus|disease|disorder|syndrome|illness|sick"
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
    "eyes": r"(?<!under )(?<!under-)(?<!under your )\beyes?\b|\bsclera\b",
    "nose": r"\bnose\b|\bnostrils?\b|\bnasal\b",
    "skin": r"\bskin\b|\bcheeks?\b|\bforehead\b|\bchin\b|\bface\b",
    "undereye": r"\bunder[- ]?eyes?\b|\bunder your eyes\b|\bdark circles\b|\bbags\b",
}
REGION_GROUP = {"lips": "lips", "left_eye": "eyes", "right_eye": "eyes", "nose": "nose",
                "skin_forehead": "skin", "skin_left_cheek": "skin", "skin_right_cheek": "skin",
                "skin_chin": "skin", "left_undereye": "undereye", "right_undereye": "undereye"}
FEATURE_WORDS = re.compile(
    r"\b(dry|dryness|cracked|cracking|chapped|flak\w*|peel\w*|red|redness|irritat\w*|bloodshot|"
    r"spots?|blemish\w*|bumps?|pimples?|breakouts?|shin\w*|oily|oiliness|dark|darker|darkness|circles)\b", re.I)
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


APPEARANCE_JUDGEMENT = re.compile(
    r"\byou (?:need|should wear|have to wear|must wear) (?:makeup|concealer|foundation)\b|\b(?:flaws?|imperfections?|unsightly|problem areas?)\b|"
    r"\b(?:fix|hide|correct) your (?:face|skin|spots|blemishes|dark circles|redness)\b|\blook (?:better|younger|older)\b|\bmore attractive\b", re.I)
PRODUCT_EFFICACY = re.compile(r"\b(?:will|guaranteed to|clinically proven to|proven to) (?:cure|heal|treat|fix|eliminate|clear up)\b|\bcures?\b", re.I)


def validate_reply(reply: AssistantReply, obs: StructuredObservations | None, diagnosis_requested: bool,
                   products: list[dict] | None = None) -> list[ValidationCheck]:
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
        # normalise "under your left eye" etc. so it is the under-eye region, not the eye itself
        norm = re.sub(r"\b(?:the (?:area|skin) )?under (?:your |the )?(?:left |right )?eyes?\b", "under-eye", sent, flags=re.I)
        for clause in re.split(r"[;,]|\band\b|\bbut\b", norm):
            if not FEATURE_WORDS.search(clause):
                continue
            mentioned = [g for g, pat in REGION_WORDS.items() if re.search(pat, clause, re.I)]
            # a clause is grounded if at least one region it talks about has accepted positive evidence
            if mentioned and not set(mentioned) & positive:
                unsupported.append(f"{'/'.join(mentioned)}: '{clause.strip()[:80]}'")
    checks.append(ValidationCheck(name="visual_claims_grounded", passed=not unsupported,
                                  detail="; ".join(unsupported) or "every visual claim maps to accepted evidence"))

    if obs is not None and obs.demo_mode and positive:
        ok = bool(re.search(r"\bdemo\w*|\bsynthetic\b", text, re.I))
        checks.append(ValidationCheck(name="demo_mode_disclosed", passed=ok, detail="mentions demonstration model" if ok else "demo-tier evidence used without disclosure"))
    elif obs is not None and obs.validation_status == "experimental" and positive:
        ok = bool(re.search(r"\bexperimental\b|\btentative\b|\bnot (yet )?validated\b", text, re.I))
        checks.append(ValidationCheck(name="experimental_model_disclosed", passed=ok,
                                      detail="mentions experimental model" if ok else "experimental-tier evidence used without disclosure"))

    if diagnosis_requested:
        checks.append(ValidationCheck(name="diagnosis_request_redirected", passed=reply.suggests_professional,
                                      detail="suggests professional" if reply.suggests_professional else "must point to a professional"))

    judg = APPEARANCE_JUDGEMENT.search(text)
    checks.append(ValidationCheck(name="no_appearance_judgement", passed=not judg, detail=judg.group(0) if judg else "ok"))

    if products is not None:
        prices = {round(float(p["price"]), 2) for p in products if p.get("price") is not None}
        bad = [m.group(0) for m in re.finditer(r"\$\s?(\d+(?:\.\d{1,2})?)", text) if round(float(m.group(1)), 2) not in prices]
        checks.append(ValidationCheck(name="product_prices_match_records", passed=not bad, detail=", ".join(bad) or "ok"))
        eff = PRODUCT_EFFICACY.search(text)
        checks.append(ValidationCheck(name="no_product_efficacy_claims", passed=not eff, detail=eff.group(0) if eff else "ok"))

    checks.append(ValidationCheck(name="length_reasonable", passed=20 <= len(text) <= 1500, detail=f"{len(text)} chars"))
    return checks
