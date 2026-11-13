"""Metrics for ordinal apparent-age-range classification.

Labels are age RANGES, so "MAE" is computed between range midpoints (a coarse approximation of year error;
the true per-image age is unknown). Also reported: exact-range accuracy, ±1-range accuracy, mean entropy
(uncertainty), coverage of the 80% plausible span, and all of these per subgroup (e.g. gender, race).
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from app.inference.age import plausible_set
from app.inference.catalog import AGE_MIDPOINTS


def age_report(probs: np.ndarray, y: np.ndarray, classes: list[str], groups: dict[str, list[str]] | None = None) -> dict:
    mids = np.array([AGE_MIDPOINTS[c] for c in classes])
    pred = probs.argmax(1)
    expected = probs @ mids

    def block(idx: np.ndarray) -> dict:
        if len(idx) == 0:
            return {"n": 0}
        p, t, e = pred[idx], y[idx], expected[idx]
        spans = [plausible_set(probs[i]) for i in idx]
        ent = -(probs[idx] * np.log2(np.clip(probs[idx], 1e-12, 1))).sum(1)
        return {
            "n": int(len(idx)),
            "range_accuracy": float((p == t).mean()),
            "within_one_range": float((np.abs(p - t) <= 1).mean()),
            "mae_years_midpoint_of_top_range": float(np.abs(mids[p] - mids[t]).mean()),
            "mae_years_expected_vs_midpoint": float(np.abs(e - mids[t]).mean()),
            "plausible_span_coverage": float(np.mean([lo <= tt <= hi for (lo, hi), tt in zip(spans, t)])),
            "mean_span_width_ranges": float(np.mean([hi - lo + 1 for lo, hi in spans])),
            "mean_entropy_bits": float(ent.mean()),
        }

    out = {"overall": block(np.arange(len(y))), "caveat": "MAE uses range midpoints; labels are annotated apparent-age bins, not verified ages."}
    if groups:
        out["subgroups"] = {}
        for key, vals in groups.items():
            by: dict[str, list[int]] = defaultdict(list)
            for i, v in enumerate(vals):
                by[v].append(i)
            out["subgroups"][key] = {g: block(np.array(ix)) for g, ix in sorted(by.items()) if len(ix) >= 20}
            accs = [v["range_accuracy"] for v in out["subgroups"][key].values()]
            maes = [v["mae_years_expected_vs_midpoint"] for v in out["subgroups"][key].values()]
            out["subgroups"][key + "_gap"] = {"range_accuracy_max_minus_min": float(max(accs) - min(accs)) if accs else None,
                                              "mae_max_minus_min": float(max(maes) - min(maes)) if maes else None}
    return out
