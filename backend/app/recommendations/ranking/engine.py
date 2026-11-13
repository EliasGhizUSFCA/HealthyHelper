"""Hybrid, inspectable product ranking.

    candidates (local catalogue, by category)
      → hard filters (category, brand, budget, stock, ingredient exclusions, fragrance-free, confirmed-age
        appropriateness) — every removal is recorded with its reason
      → per-component scores in [0, 1] (or None = information missing)
      → total = Σ wᵢ·sᵢ / Σ wᵢ over components with KNOWN scores (missing info is neither rewarded nor
        penalised; it is surfaced as a warning)
      → deterministic ordering (score desc, then product_id)

Nothing here reads images, estimated age, or infers skin conditions. Concerns are chosen by the user; visual
observations contribute search terms only if the user explicitly includes them.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass

from app.recommendations.taxonomy import AGE_SENSITIVE_RETAILER_PATHS, CATEGORIES
from app.schemas.catalog import CatalogProduct, Claim, FilteredOut, RankedProduct, RecommendationRequest, ScoreComponent

DEFAULT_WEIGHTS = {
    "category_relevance": 1.0,
    "concern_match": 2.0,
    "text_relevance": 1.5,
    "ingredient_preference": 1.5,
    "budget_fit": 1.0,
    "availability": 1.0,
    "finish_match": 1.0,
    "coverage_match": 1.0,
    "shade_match": 1.0,
    "data_reliability": 0.75,
}


@dataclass(frozen=True)
class ConcernProfile:
    mode: str
    categories: tuple[str, ...]
    benefits: tuple[str, ...]
    skin_types: tuple[str, ...]
    terms: tuple[str, ...]
    prefer_fragrance_free: bool = False


CONCERNS: dict[str, ConcernProfile] = {
    "dry_lips": ConcernProfile("skincare", ("lip_care",), ("lip_conditioning", "hydrating"), (), ("lip balm", "dry lips", "chapped", "moisturizing", "nourishing")),
    "surface_dryness": ConcernProfile("skincare", ("moisturizer", "serum"), ("hydrating", "barrier"), ("dry",), ("moisturizer", "hydrating", "dry skin", "barrier", "ceramide")),
    "sensitive_skin": ConcernProfile("skincare", ("moisturizer", "cleanser"), ("soothing", "barrier"), ("sensitive",), ("gentle", "sensitive skin", "soothing", "calming"), True),
    "blemish_prone": ConcernProfile("skincare", ("blemish_care", "cleanser", "moisturizer"), ("exfoliating",), ("blemish_prone", "oily"), ("blemish-prone", "acne-prone", "non-comedogenic", "pores", "salicylic")),
    "visible_redness": ConcernProfile("skincare", ("moisturizer", "serum"), ("soothing", "barrier"), ("sensitive",), ("soothing", "calming", "redness", "gentle")),
    "oiliness": ConcernProfile("skincare", ("moisturizer", "cleanser"), ("oil_control",), ("oily", "combination"), ("oil control", "mattifying", "lightweight", "oil-free")),
    "sun_protection": ConcernProfile("skincare", ("sunscreen",), ("sun_protection",), (), ("spf", "broad spectrum", "sunscreen")),
    "general_moisture": ConcernProfile("skincare", ("moisturizer",), ("hydrating",), (), ("moisturizer", "hydration")),
    "under_eye_coverage": ConcernProfile("makeup", ("concealer", "color_corrector"), (), (), ("under eye", "concealer", "brightening", "corrector")),
    "even_coverage": ConcernProfile("makeup", ("foundation", "skin_tint"), (), (), ("foundation", "coverage", "even")),
    "spot_coverage": ConcernProfile("makeup", ("concealer",), (), (), ("concealer", "coverage", "spot")),
    "redness_coverage": ConcernProfile("makeup", ("color_corrector", "concealer"), (), (), ("green", "color correct", "redness")),
    "light_coverage": ConcernProfile("makeup", ("skin_tint",), (), (), ("tinted", "sheer", "light coverage", "skin tint")),
    "set_makeup": ConcernProfile("makeup", ("setting_powder",), (), (), ("setting", "powder", "translucent")),
    "lip_colour": ConcernProfile("makeup", ("lip_product",), (), (), ("lipstick", "lip color", "gloss")),
}

# observation key prefix → (terms, category) — used only if the user ticks the observation
OBSERVATION_TERMS = {
    "lips:visible_dryness": (("dry lips", "lip balm", "moisturizing"), "lip_care"),
    "visible_flaking": (("dry skin", "hydrating", "moisturizer"), "moisturizer"),
    "visible_redness": (("soothing", "calming", "gentle"), None),
    "visible_blemishes": (("blemish-prone", "non-comedogenic"), None),
    "visible_shine": (("oil control", "mattifying"), None),
    "visible_darkness": (("under eye", "eye cream", "concealer"), None),
}

AGE_UNDER_18 = {"under_18", "<18", "0-17", "13-17"}


def load_weights() -> dict[str, float]:
    w = dict(DEFAULT_WEIGHTS)
    if os.getenv("RECOMMENDER_WEIGHTS"):
        w.update({k: float(v) for k, v in json.loads(os.environ["RECOMMENDER_WEIGHTS"]).items() if k in w})
    return w


def product_text(p: CatalogProduct) -> str:
    return " ".join(filter(None, [p.name, p.brand, p.description, p.usage, " ".join(p.categories), " ".join(p.retailer_categories)]))


def plan(req: RecommendationRequest) -> tuple[list[str], list[str], ConcernProfile | None]:
    prof = CONCERNS.get(req.concern or "")
    cats = list(req.categories) or (list(prof.categories) if prof else [c.key for c in CATEGORIES.values() if c.mode == req.mode])
    terms = list(prof.terms) if prof else []
    for key in req.include_observations:
        for k, (t, cat) in OBSERVATION_TERMS.items():
            if key == k or key.endswith(":" + k) or k in key:
                terms += t
                if cat and cat not in cats and not req.categories and CATEGORIES[cat].mode == req.mode:
                    cats.append(cat)
    if req.query:
        terms.append(req.query)
    return cats, list(dict.fromkeys(terms)), prof


def _tfidf_scores(texts: list[str], query: str) -> list[float]:
    if not texts or not query.strip():
        return [0.0] * len(texts)
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity

    vec = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, stop_words="english", min_df=1)
    m = vec.fit_transform(texts + [query])
    sims = cosine_similarity(m[-1], m[:-1]).ravel()
    top = sims.max() if len(sims) else 0
    return [float(s / top) if top > 0 else 0.0 for s in sims]


def _ingredient_hit(p: CatalogProduct, term: str) -> str | None:
    t = term.strip().lower()
    if not t:
        return None
    for ing in p.ingredients_list:
        if t in ing.lower():
            return ing
    return None


def rank(req: RecommendationRequest, candidates: list[CatalogProduct], weights: dict[str, float] | None = None
         ) -> tuple[list[RankedProduct], list[FilteredOut], dict]:
    w = weights or load_weights()
    cats, terms, prof = plan(req)
    meta = {"categories": cats, "terms": terms, "age_used": False, "age_note": "no confirmed age range provided — age not used"}
    under18 = bool(req.confirmed_age_range and req.confirmed_age_range.strip().lower() in AGE_UNDER_18)
    if req.confirmed_age_range:
        meta["age_note"] = ("confirmed under-18 range: products marketed with anti-aging / peel claims are excluded (age-appropriateness only)"
                            if under18 else "confirmed age range provided; it does not change rankings for adults")
    brands = {b.lower() for b in req.brands}
    kept: list[tuple[CatalogProduct, list[str]]] = []
    removed: list[FilteredOut] = []

    def drop(p: CatalogProduct, why: str) -> None:
        removed.append(FilteredOut(product_id=p.product_id, name=p.name, reason=why))

    for p in sorted(candidates, key=lambda x: x.product_id):
        if not set(p.categories) & set(cats):
            continue  # not a candidate for these categories at all
        if p.mode not in (req.mode, "mixed"):
            drop(p, f"mode is {p.mode}")
            continue
        if brands and (p.brand or "").lower() not in brands:
            drop(p, "brand not selected")
            continue
        if req.in_stock_only and p.availability == "out_of_stock":
            drop(p, "out of stock")
            continue
        if req.budget_max is not None and p.price is not None and p.price > req.budget_max:
            drop(p, f"price {p.price:.2f} above budget {req.budget_max:.2f}")
            continue
        hit = next((h for t in req.exclude_ingredients if (h := _ingredient_hit(p, t))), None)
        if hit:
            drop(p, f"contains excluded ingredient: {hit[:60]}")
            continue
        if req.fragrance_free and p.attributes.contains_fragrance_ingredient == "yes":
            drop(p, "ingredient list includes fragrance/parfum")
            continue
        if under18 and ("anti_aging_marketing" in p.attributes.benefits or any(
                r.startswith(a) for r in p.retailer_categories for a in AGE_SENSITIVE_RETAILER_PATHS)):
            meta["age_used"] = True
            drop(p, "age-appropriateness: marketed with anti-aging/peel claims (confirmed under-18 range)")
            continue
        verified_ff = p.attributes.fragrance_free_claimed == "yes" or p.attributes.contains_fragrance_ingredient == "no"
        if req.strict_ingredient_check and ((req.exclude_ingredients and not p.ingredients_list) or (req.fragrance_free and not verified_ff)):
            drop(p, "strict check: ingredient information unavailable on the retailer page")
            continue
        warns = []
        if req.exclude_ingredients and not p.ingredients_list:
            warns.append("ingredient list unavailable — exclusions could not be verified")
        if req.fragrance_free and p.attributes.contains_fragrance_ingredient == "unknown":
            warns.append("ingredient list unavailable — fragrance-free could not be verified")
        if req.budget_max is not None and p.price is None:
            warns.append("price not available from permitted pages — budget could not be checked")
        if req.in_stock_only and p.availability == "unknown":
            warns.append("availability unknown")
        if p.stale:
            warns.append("listing not re-verified recently — price/availability may have changed")
        kept.append((p, warns))

    query = " ".join(terms)
    text_scores = _tfidf_scores([product_text(p) for p, _ in kept], query)
    results: list[RankedProduct] = []
    for (p, warns), ts in zip(kept, text_scores):
        comps: list[tuple[str, float | None, str]] = []
        primary = [c for c in cats if c in p.categories]
        cat_score = 1.0 if (req.categories or (primary and primary[0] == cats[0])) else 0.8
        comps.append(("category_relevance", cat_score, f"in {', '.join(primary)}"))
        matched: list[Claim] = []
        if prof and (prof.benefits or prof.skin_types):
            targets = [("benefit", b) for b in prof.benefits] + [("skin", s) for s in prof.skin_types]
            hits = [t for t in targets if (t[0] == "benefit" and t[1] in p.attributes.benefits) or (t[0] == "skin" and t[1] in p.attributes.skin_types)]
            if p.description or p.usage:
                score = len(hits) / len(targets)
                comps.append(("concern_match", score, f"marketed for {', '.join(h[1] for h in hits) or 'none of'} / targets {', '.join(t[1] for t in targets)}"))
            else:
                comps.append(("concern_match", None, "no description on page — marketing claims unknown"))
            wanted = {f"for_{s}_skin" for s in prof.skin_types} | set(prof.benefits)
            matched = [c for c in p.claims if c.attribute in wanted]
        comps.append(("text_relevance", ts if query else None, f"TF-IDF similarity to: {query[:80]}" if query else "no search terms"))
        if req.fragrance_free or req.exclude_ingredients or (prof and prof.prefer_fragrance_free):
            if p.attributes.fragrance_free_claimed == "yes":
                s, d = 1.0, "marketed as fragrance-free"
            elif p.ingredients_list:
                s = 0.9 if p.attributes.contains_fragrance_ingredient == "no" else (0.3 if not req.fragrance_free else 0.0)
                d = "ingredient list checked" + ("" if p.attributes.contains_fragrance_ingredient == "no" else "; lists fragrance")
            else:
                s, d = None, "no ingredient list"
            comps.append(("ingredient_preference", s, d))
            if p.attributes.fragrance_free_claimed == "yes":
                matched += [c for c in p.claims if c.attribute == "fragrance_free"]
        if req.budget_max is not None:
            comps.append(("budget_fit", (1 - 0.3 * min(1.0, p.price / req.budget_max)) if p.price is not None and req.budget_max > 0 else None,
                          f"{p.price:.2f} of {req.budget_max:.2f}" if p.price is not None else "price unavailable"))
        comps.append(("availability", {"in_stock": 1.0, "out_of_stock": 0.2}.get(p.availability), p.availability))
        for key, wanted, have in (("finish_match", req.finish, p.attributes.finish), ("coverage_match", req.coverage, p.attributes.coverage)):
            if wanted:
                comps.append((key, (1.0 if wanted in have else 0.0) if have else None, f"wants {wanted}; page states {', '.join(have) or 'nothing'}"))
                if wanted in have:
                    matched += [c for c in p.claims if c.attribute == f"{key.split('_')[0]}_{wanted}"]
        if req.shade or req.undertone:
            needle = (req.shade or req.undertone or "").lower()
            if p.shades:
                ok = any(needle in s.lower() for s in p.shades)
                comps.append(("shade_match", 1.0 if ok else 0.0, f"{len(p.shades)} shades listed"))
            else:
                comps.append(("shade_match", None, "shade list not available on the static page"))
        comps.append(("data_reliability", round(p.completeness * (0.5 if p.stale else 1.0), 3), f"completeness {p.completeness:.2f}{', stale' if p.stale else ''}"))

        known = [(n, s, d) for n, s, d in comps if s is not None and w.get(n, 0) > 0]
        denom = sum(w[n] for n, _, _ in known) or 1.0
        total = sum(w[n] * s for n, s, _ in known) / denom
        components = [ScoreComponent(name=n, weight=w.get(n, 0.0), score=None if s is None else round(s, 4),
                                     contribution=0.0 if s is None else round(w.get(n, 0) * s / denom, 4), detail=d) for n, s, d in comps]
        results.append(RankedProduct(rank=0, product=p, total_score=round(total, 4), components=components,
                                     matched_claims=list({(c.attribute, c.text): c for c in matched}.values())[:6], warnings=warns))
    # Missing data never changes a SCORE, but when the user set a hard constraint we can't check for some products
    # (budget without a listed price; fragrance-free without ingredient info), verified matches are listed first.
    def unverified(r: RankedProduct) -> int:
        u = 0
        if req.budget_max is not None and r.product.price is None:
            u += 1
        if req.fragrance_free and r.product.attributes.fragrance_free_claimed != "yes" and r.product.attributes.contains_fragrance_ingredient != "no":
            u += 1
        return u
    results.sort(key=lambda r: (unverified(r), -r.total_score, r.product.product_id))
    meta["ordering"] = ("verified matches first, then listings whose price/ingredients could not be checked; then by score"
                        if (req.budget_max is not None or req.fragrance_free) else "by score")
    for i, r in enumerate(results):
        r.rank = i + 1
    return results[: req.limit], removed, meta


def normalise_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()
