"""Deterministic safety routing that runs BEFORE any LLM call.

Urgent complaints get a predetermined, reviewable response instead of a
speculative image-based answer. Diagnosis requests are flagged so the agent
explains the limits of visual observation instead of guessing.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_RESPONSES = Path(__file__).with_name("reviewed_responses.json")

_NEGATION = re.compile(r"\b(no|not|never|without|don'?t have|haven'?t had|isn'?t|aren'?t)\b[^.?!]{0,25}$")

DIAGNOSIS_PATTERNS = [
    r"\bdo i have\b", r"\bam i (dehydrated|sick|ill|unwell|anemic|anaemic|deficient)\b", r"\bdiagnos\w*\b",
    r"\bwhat (disease|condition|illness|infection)\b", r"\bis (it|this|that) (an? )?(infection|disease|conjunctivitis|pink ?eye|eczema|psoriasis|rosacea|cancer|melanoma)\b",
    r"\bwhat'?s wrong with me\b", r"\bam i healthy\b", r"\bhealth score\b", r"\bshould i (take|use) (antibiotics|medication|steroids)\b",
]


@dataclass(frozen=True)
class TriageResult:
    route: str  # "urgent_safety" | "diagnosis_request" | "standard"
    category: str | None = None
    message: str | None = None
    matched: str | None = None
    review_status: str | None = None


@lru_cache
def _config() -> dict:
    return json.loads(_RESPONSES.read_text())


@lru_cache
def _compiled() -> list[tuple[str, re.Pattern[str]]]:
    out = []
    for cat, r in _config()["routes"].items():
        for p in r["patterns"]:
            out.append((cat, re.compile(r"\b" + p, re.IGNORECASE)))
    return out


def triage(text: str) -> TriageResult:
    t = " ".join(text.split())
    for cat, pat in _compiled():
        m = pat.search(t)
        if m and not _NEGATION.search(t[: m.start()]):
            cfg = _config()
            return TriageResult("urgent_safety", cat, cfg["routes"][cat]["message"], m.group(0), cfg["review_status"])
    for p in DIAGNOSIS_PATTERNS:
        m = re.search(p, t, re.IGNORECASE)
        if m:
            return TriageResult("diagnosis_request", matched=m.group(0))
    return TriageResult("standard")
