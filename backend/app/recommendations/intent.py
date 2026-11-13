"""Turn a plain-language request ("fragrance-free moisturiser under $25") into a RecommendationRequest.

Deterministic keyword rules (inspectable, testable) — not an LLM guess. Returns None when the message is not
a product request, so ordinary questions keep going to the normal assistant flow.
"""

from __future__ import annotations

import re

from app.schemas.catalog import RecommendationRequest

ASK = re.compile(r"\b(recommend\w*|suggest\w*|find|show|looking for|look for|need|want|buy|shop|options?|products?|which (?:one|product)|what (?:should|can) i (?:use|try|buy)|best)\b", re.I)

# (pattern, mode, concern, categories) — first match wins, so more specific entries come first
RULES: list[tuple[str, str, str | None, list[str]]] = [
    (r"colou?r[- ]?correct\w*|green (?:primer|corrector)", "makeup", "redness_coverage", ["color_corrector"]),
    (r"under[- ]?eye.*conceal\w*|conceal\w*.*under[- ]?eye|dark circles?", "makeup", "under_eye_coverage", ["concealer", "color_corrector"]),
    (r"conceal\w*", "makeup", "spot_coverage", ["concealer"]),
    (r"tinted moisturi[sz]er|skin tint|bb cream|cc cream", "makeup", "light_coverage", ["skin_tint"]),
    (r"foundation", "makeup", "even_coverage", ["foundation"]),
    (r"setting (?:powder|spray)|powder|set my makeup", "makeup", "set_makeup", ["setting_powder"]),
    (r"lipstick|lip ?gloss|lip (?:colou?r|stain|tint|oil)", "makeup", "lip_colour", ["lip_product"]),
    (r"lip ?balm|chapped|cracked lips|dry lips|lip (?:care|mask|treatment|repair)|lips? (?:are|feel|look) dry", "skincare", "dry_lips", ["lip_care"]),
    (r"sunscreen|spf|sun ?(?:protection|block|cream)", "skincare", "sun_protection", ["sunscreen"]),
    (r"acne|blemish\w*|breakouts?|pimples?|spots?|pores?", "skincare", "blemish_prone", []),
    (r"redness|red (?:skin|cheeks)|irritat\w*|calm\w*|sooth\w*", "skincare", "visible_redness", []),
    (r"sensitive", "skincare", "sensitive_skin", []),
    (r"oily|shine|shiny|greasy", "skincare", "oiliness", []),
    (r"cleanser|face wash|cleansing", "skincare", "sensitive_skin", ["cleanser"]),
    (r"serum", "skincare", "surface_dryness", ["serum"]),
    (r"dry (?:skin|patches)|flak\w*|dehydrated[- ]feeling|tight skin", "skincare", "surface_dryness", []),
    (r"moisturi[sz]\w*|hydrat\w*|face cream|lotion", "skincare", "general_moisture", ["moisturizer"]),
]
BUDGET = re.compile(r"(?:under|below|less than|max(?:imum)?|up to|no more than|<)\s*\$?\s?(\d+(?:\.\d{1,2})?)|\$\s?(\d+(?:\.\d{1,2})?)\s*(?:or less|max|budget)", re.I)
WITHOUT = re.compile(r"\b(?:without|no|free of|free from|avoid(?:ing)?)\s+([a-z][a-z -]{2,24}?)(?=[,.;!?]|\s+(?:and|or|please|under|below|for)\b|$)", re.I)
FINISH = {"matte": r"\bmatte\b", "dewy": r"\bdewy\b|\bglowy\b|\bluminous\b", "satin": r"\bsatin\b", "natural": r"\bnatural finish\b"}
COVERAGE = {"full": r"\bfull[- ]coverage\b|\bfull\b", "medium": r"\bmedium[- ]coverage\b", "light": r"\blight[- ]coverage\b|\bsheer\b", "buildable": r"\bbuildable\b"}
NOT_INGREDIENTS = {"fragrance", "scent", "perfume", "makeup", "budget", "more", "shine"}


def parse(text: str, include_observations: list[str] | None = None, require_ask: bool = True) -> RecommendationRequest | None:
    t = " ".join(text.lower().split())
    rule = next(((mode, concern, cats) for pat, mode, concern, cats in RULES if re.search(pat, t)), None)
    if rule is None and not require_ask and t:
        rule = ("skincare", None, [])  # search box with no recognisable type: free-text search across skincare
    if rule is None or (require_ask and not ASK.search(t)):
        return None
    mode, concern, cats = rule
    budget = None
    m = BUDGET.search(t)
    if m:
        budget = float(m.group(1) or m.group(2))
    fragrance_free = bool(re.search(r"fragrance[- ]free|unscented|no fragrance|without fragrance|no scent|no perfume", t))
    excludes = []
    for m in WITHOUT.finditer(t):
        term = m.group(1).strip()
        if term.split()[0] not in NOT_INGREDIENTS and not term.startswith(("fragrance", "scent")):
            excludes.append(term)
    finish = next((k for k, p in FINISH.items() if re.search(p, t)), None)
    coverage = next((k for k, p in COVERAGE.items() if re.search(p, t)), None) if mode == "makeup" else None
    return RecommendationRequest(
        mode=mode, concern=concern, categories=cats, query=text[:200], budget_max=budget, fragrance_free=fragrance_free,
        exclude_ingredients=excludes[:5], finish=finish, coverage=coverage, in_stock_only=bool(re.search(r"in stock|available now", t)),
        include_observations=include_observations or [], limit=6,
    )
