# Recommendation evaluation (generated)

Command: `python -m evaluation.recommendations_eval`

```json
{
  "generated_at": "2026-11-13 01:20:05",
  "catalogue_products": 271,
  "completeness": {
    "brand": 1.0,
    "description": 0.937,
    "price": 0.863,
    "size": 0.384,
    "image_url": 1.0,
    "ingredients": 0.38,
    "usage": 0.41,
    "sku": 1.0,
    "availability_known": 1.0
  },
  "freshness_hours": {
    "median": 0.13,
    "max": 0.23,
    "stale_share": 0.0
  },
  "category_precision_at_5": {
    "dry_lips": 1.0,
    "surface_dryness": 1.0,
    "sensitive_skin": 1.0,
    "blemish_prone": 1.0,
    "visible_redness": 1.0,
    "oiliness": 1.0,
    "sun_protection": 1.0,
    "general_moisture": 1.0,
    "under_eye_coverage": 1.0,
    "even_coverage": 1.0,
    "spot_coverage": 1.0,
    "redness_coverage": 1.0,
    "light_coverage": 1.0,
    "set_makeup": 1.0,
    "lip_colour": 1.0
  },
  "ingredient_filtering": {
    "alcohol": {
      "returned": 30,
      "returned_checked": 6,
      "returned_unverifiable": 24,
      "violations": 0,
      "recall_of_removals": 1.0
    },
    "parfum": {
      "returned": 30,
      "returned_checked": 8,
      "returned_unverifiable": 22,
      "violations": 0,
      "recall_of_removals": 1.0
    },
    "fragrance": {
      "returned": 30,
      "returned_checked": 6,
      "returned_unverifiable": 24,
      "violations": 0,
      "recall_of_removals": 1.0
    },
    "lanolin": {
      "returned": 30,
      "returned_checked": 9,
      "returned_unverifiable": 21,
      "violations": 0,
      "recall_of_removals": 1.0
    },
    "salicylic": {
      "returned": 30,
      "returned_checked": 7,
      "returned_unverifiable": 23,
      "violations": 0,
      "recall_of_removals": 1.0
    },
    "retinol": {
      "returned": 30,
      "returned_checked": 9,
      "returned_unverifiable": 21,
      "violations": 0,
      "recall_of_removals": 1.0
    },
    "paraben": {
      "returned": 30,
      "returned_checked": 8,
      "returned_unverifiable": 22,
      "violations": 0,
      "recall_of_removals": 1.0
    },
    "mineral oil": {
      "returned": 30,
      "returned_checked": 8,
      "returned_unverifiable": 22,
      "violations": 0,
      "recall_of_removals": 1.0
    }
  },
  "fragrance_free_consistency": {
    "returned": 30,
    "violations": 0,
    "unverifiable": 21
  },
  "latency_ms": {
    "p50": 11.81,
    "p95": 1002.13,
    "n": 15
  },
  "ndcg_at_5": "n/a \u2014 no human relevance judgments yet (see evaluation/cases/relevance_judgments.template.csv)"
}
```
