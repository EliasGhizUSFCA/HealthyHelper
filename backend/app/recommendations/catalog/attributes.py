"""Deterministic extraction of marketed attributes from retailer text.

Everything here is a *retailer or brand claim*, recorded with the verbatim snippet it came from.
Absence of a claim means "unknown", never "no" — except where the ingredient list itself shows something
(e.g. 'fragrance'/'parfum' listed → contains_fragrance_ingredient = yes).
"""

from __future__ import annotations

import re

from app.schemas.catalog import Claim, ProductAttributes

FRAGRANCE_INGREDIENTS = re.compile(r"\b(fragrance|parfum|perfume|aroma)\b", re.I)
FRAGRANCE_FREE = re.compile(r"\b(fragrance[- ]free|free (?:of|from) fragrance|unscented|without (?:added )?fragrance|no (?:added )?fragrance)\b", re.I)
SCENTED = re.compile(r"\b(?<!un)(?<!un-)scented\b|\bfragranced\b|\bperfumed\b", re.I)
NON_COMEDOGENIC = re.compile(r"\b(non[- ]?comedogenic|won'?t clog pores|does not clog pores|oil[- ]free)\b", re.I)
SPF = re.compile(r"\bSPF\s?(\d{1,3})\b", re.I)

SKIN_TYPES = {
    "dry": r"\b(dry|very dry|dehydrated[- ]looking|parched) skin\b|\bfor dry\b",
    "oily": r"\b(oily|oil[- ]prone|shiny) skin\b|\bfor oily\b",
    "combination": r"\bcombination skin\b",
    "sensitive": r"\bsensitive skin\b|\bfor sensitive\b|\bgentle enough\b",
    # "marketed FOR blemish-prone skin" — not merely "hides blemishes" (that is a coverage claim)
    "blemish_prone": r"\b(acne|blemish|breakout)[- ]prone\b|\bcongested skin\b|"
                     r"\b(?:for|targets?|fights?|treats?|clears?|reduces?|helps? (?:prevent|reduce|clear))(?: the appearance of)? (?:blemish|breakout|acne|pimple)\w*",
    "all": r"\ball skin types\b",
}
BENEFITS = {
    "hydrating": r"\bhydrat\w*|\bmoistur\w*|\bhyaluronic\b|\bglycerin\b",
    "barrier": r"\bbarrier\b|\bceramides?\b",
    "soothing": r"\bsooth\w*|\bcalm\w*|\bredness\b|\bcomfort\w*",
    "lip_conditioning": r"\b(chapped|dry|cracked) lips\b|\bconditions? lips\b|\blip (repair|treatment|conditioner)\b",
    "oil_control": r"\boil[- ]control\b|\bmattif\w*|\bshine[- ]control\b|\babsorbs? (excess )?oil\b",
    "exfoliating": r"\bexfoliat\w*|\bAHA\b|\bBHA\b|\bsalicylic\b|\bglycolic\b|\blactic acid\b",
    "sun_protection": r"\bSPF\b|\bbroad[- ]spectrum\b|\bsunscreen\b|\bUVA\b",
    "anti_aging_marketing": r"\banti[- ]?aging\b|\banti[- ]?wrinkle\b|\bretinol\b|\bretinoid\b|\bfirming\b|\bfine lines\b",
}
FINISH = {"matte": r"\bmatte\b|\bmattif", "dewy": r"\bdewy\b|\bluminous\b|\bglow\w*", "satin": r"\bsatin\b", "natural": r"\bnatural finish\b|\bskin[- ]like\b",
          "radiant": r"\bradian\w*"}
COVERAGE = {"sheer": r"\bsheer\b", "light": r"\blight coverage\b|\blightweight coverage\b", "medium": r"\bmedium coverage\b",
            "full": r"\bfull[- ]coverage\b|\bfull coverage\b|\bhigh coverage\b|\bultimate coverage\b", "buildable": r"\bbuildable\b"}
TEXTURE = {"gel": r"\bgel\b", "cream": r"\bcream\b", "lotion": r"\blotion\b", "balm": r"\bbalm\b", "oil": r"\boil\b(?![- ]free)", "liquid": r"\bliquid\b",
           "stick": r"\bstick\b", "powder": r"\bpowder\b", "serum": r"\bserum\b"}


def _snippet(text: str, m: re.Match, limit: int = 160) -> str:
    """The sentence containing the match (trimmed around the match if long), never starting mid-word."""
    starts = [i + 1 for i in (text.rfind(". ", 0, m.start()), text.rfind("! ", 0, m.start()), text.rfind("? ", 0, m.start()))]
    a = max([0] + starts)
    ends = [i for i in (text.find(". ", m.end()), text.find("! ", m.end()), text.find("? ", m.end())) if i != -1]
    b = (min(ends) + 1) if ends else len(text)
    sent = text[a:b].strip()
    if len(sent) <= limit:
        return sent
    rel = m.start() - a
    lo = max(0, rel - limit // 2)
    lo = sent.rfind(" ", 0, lo) + 1 if lo > 0 else 0
    piece = sent[lo:lo + limit]
    piece = piece[: piece.rfind(" ")] if lo + limit < len(sent) and " " in piece else piece
    return ("…" if lo > 0 else "") + piece.strip() + ("…" if lo + len(piece) < len(sent) else "")


def extract(name: str, description: str | None, usage: str | None, ingredients: str | None) -> tuple[ProductAttributes, list[Claim]]:
    fields = {"name": name or "", "description": description or "", "usage": usage or ""}
    claims: list[Claim] = []
    attrs = ProductAttributes()

    def find(pattern: str, attr: str) -> bool:
        hit = False
        for f, text in fields.items():
            m = re.search(pattern, text, re.I)
            if m:
                claims.append(Claim(attribute=attr, text=_snippet(text, m)[:160], source_field=f))
                hit = True
        return hit

    if find(FRAGRANCE_FREE.pattern, "fragrance_free"):
        attrs.fragrance_free_claimed = "yes"
    if ingredients:
        m = FRAGRANCE_INGREDIENTS.search(ingredients)
        attrs.contains_fragrance_ingredient = "yes" if m else "no"
        if m:
            claims.append(Claim(attribute="contains_fragrance_ingredient", text=_snippet(ingredients, m)[:160], source_field="ingredients"))
    if attrs.fragrance_free_claimed != "yes":
        for f in ("name", "description"):
            m = SCENTED.search(fields[f])
            if m:  # the listing itself says it is scented/fragranced → evidence of fragrance even without an ingredient list
                attrs.contains_fragrance_ingredient = "yes"
                claims.append(Claim(attribute="contains_fragrance_ingredient", text=_snippet(fields[f], m)[:160], source_field=f))
                break
    if find(NON_COMEDOGENIC.pattern, "non_comedogenic"):
        attrs.non_comedogenic_claimed = "yes"
    for f, text in fields.items():
        m = SPF.search(text)
        if m:
            attrs.spf = float(m.group(1))
            claims.append(Claim(attribute="spf", text=_snippet(text, m)[:160], source_field=f))
            break
    for key, pat in SKIN_TYPES.items():
        if find(pat, f"for_{key}_skin"):
            attrs.skin_types.append(key)
    for key, pat in BENEFITS.items():
        if find(pat, key):
            attrs.benefits.append(key)
    for key, pat in FINISH.items():
        if find(pat, f"finish_{key}"):
            attrs.finish.append(key)
    for key, pat in COVERAGE.items():
        if find(pat, f"coverage_{key}"):
            attrs.coverage.append(key)
    for key, pat in TEXTURE.items():
        if re.search(pat, fields["name"], re.I) or re.search(pat, fields["description"][:200], re.I):
            attrs.texture.append(key)
    return attrs, claims


def split_ingredients(text: str | None) -> list[str]:
    if not text:
        return []
    parts = re.split(r",(?![^()]*\))", text)
    return [re.sub(r"\s+", " ", p).strip(" .;") for p in parts if p.strip(" .;")][:200]
