"""Recommendation pipeline evaluation on the REAL local catalogue.

    python -m evaluation.recommendations_eval [--judgments evaluation/cases/relevance_judgments.csv] [--out ../docs/evaluation/recommendations.md]

Reports (all computed, nothing typed in):
* catalogue metadata completeness per field and freshness (age of last verification)
* category precision@k per concern (automated proxy: share of top-k inside the concern's target categories)
* ingredient-filter accuracy: for each exclusion term, products returned vs. an independent substring check of
  the stored ingredient list (and the count that could NOT be checked because no list exists)
* fragrance-free consistency (no returned product lists fragrance/parfum or is described as scented)
* nDCG@5 against human relevance judgments IF a judgments file exists (otherwise reported as n/a)
* latency p50/p95 per request
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import time
from pathlib import Path

from app.config import get_settings
from app.recommendations.catalog.store import CatalogStore
from app.recommendations.ranking.engine import CONCERNS, rank
from app.schemas.catalog import RecommendationRequest

FIELDS = ["brand", "description", "price", "size", "image_url", "ingredients", "usage", "sku"]
EXCLUSIONS = ["alcohol", "parfum", "fragrance", "lanolin", "salicylic", "retinol", "paraben", "mineral oil"]


def run(judgments: Path | None) -> dict:
    store = CatalogStore(get_settings())
    ps = store.all()
    now = time.time() * 1000
    report: dict = {"generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "catalogue_products": len(ps)}
    report["completeness"] = {f: round(sum(1 for p in ps if getattr(p, f)) / max(1, len(ps)), 3) for f in FIELDS}
    report["completeness"]["availability_known"] = round(sum(p.availability != "unknown" for p in ps) / max(1, len(ps)), 3)
    ages_h = sorted((now - p.last_verified) / 3.6e6 for p in ps)
    report["freshness_hours"] = {"median": round(statistics.median(ages_h), 2) if ages_h else None, "max": round(max(ages_h), 2) if ages_h else None,
                                 "stale_share": round(sum(p.stale for p in ps) / max(1, len(ps)), 3)}
    lat, prec = [], {}
    for key, prof in CONCERNS.items():
        req = RecommendationRequest(mode=prof.mode, concern=key, explain=False, limit=5)
        t0 = time.perf_counter()
        ranked, _, _ = rank(req, store.all(categories=list(prof.categories), mode=prof.mode))
        lat.append((time.perf_counter() - t0) * 1000)
        prec[key] = round(sum(1 for r in ranked if set(r.product.categories) & set(prof.categories)) / len(ranked), 3) if ranked else None
    report["category_precision_at_5"] = prec
    filt = {}
    for term in EXCLUSIONS:
        req = RecommendationRequest(mode="skincare", concern="surface_dryness", categories=["moisturizer", "serum", "cleanser", "lip_care"],
                                    exclude_ingredients=[term], explain=False, limit=30)
        cands = store.all(categories=req.categories)
        ranked, removed, _ = rank(req, cands)
        returned_with_list = [r.product for r in ranked if r.product.ingredients_list]
        violations = [p.product_id for p in returned_with_list if any(term in i.lower() for i in p.ingredients_list)]
        should_remove = {p.product_id for p in cands if p.ingredients_list and any(term in i.lower() for i in p.ingredients_list)}
        removed_ids = {r.product_id for r in removed}
        filt[term] = {"returned": len(ranked), "returned_checked": len(returned_with_list), "returned_unverifiable": len(ranked) - len(returned_with_list),
                      "violations": len(violations), "recall_of_removals": round(len(should_remove & removed_ids) / len(should_remove), 3) if should_remove else None}
    report["ingredient_filtering"] = filt
    req = RecommendationRequest(mode="skincare", concern="sensitive_skin", fragrance_free=True, explain=False, limit=30)
    ranked, _, _ = rank(req, store.all(categories=["moisturizer", "cleanser"]))
    report["fragrance_free_consistency"] = {"returned": len(ranked), "violations": sum(r.product.attributes.contains_fragrance_ingredient == "yes" for r in ranked),
                                            "unverifiable": sum(r.product.attributes.contains_fragrance_ingredient == "unknown" and r.product.attributes.fragrance_free_claimed != "yes" for r in ranked)}
    report["latency_ms"] = {"p50": round(statistics.median(lat), 2), "p95": round(sorted(lat)[max(0, math.ceil(0.95 * len(lat)) - 1)], 2), "n": len(lat)}
    report["ndcg_at_5"] = ndcg(store, judgments) if judgments and judgments.exists() else "n/a — no human relevance judgments yet (see evaluation/cases/relevance_judgments.template.csv)"
    return report


def ndcg(store, path: Path) -> dict:
    rows = list(csv.DictReader(path.open()))
    by_q: dict[str, dict[str, float]] = {}
    for r in rows:
        by_q.setdefault(r["concern"], {})[r["product_id"]] = float(r["relevance"])
    out = {}
    for concern, rel in by_q.items():
        prof = CONCERNS[concern]
        ranked, _, _ = rank(RecommendationRequest(mode=prof.mode, concern=concern, explain=False, limit=5), store.all(categories=list(prof.categories)))
        dcg = sum(rel.get(r.product.product_id, 0) / math.log2(i + 2) for i, r in enumerate(ranked))
        ideal = sum(v / math.log2(i + 2) for i, v in enumerate(sorted(rel.values(), reverse=True)[:5]))
        out[concern] = round(dcg / ideal, 3) if ideal else None
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--judgments", type=Path, default=Path("evaluation/cases/relevance_judgments.csv"))
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    rep = run(a.judgments)
    text = json.dumps(rep, indent=2)
    print(text)
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text("# Recommendation evaluation (generated)\n\nCommand: `python -m evaluation.recommendations_eval`\n\n```json\n" + text + "\n```\n")


if __name__ == "__main__":
    main()
