"""Render docs/model-cards/<model_id>.md from the newest artifact's model_card.json + eval report.

All numbers come from the artifacts on disk — nothing is typed by hand.
    python scripts/render_model_cards.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.inference.catalog import CATALOG  # noqa: E402

OUT = ROOT / "docs" / "model-cards"


def newest(model_id: str) -> Path | None:
    cards = sorted((ROOT / "models" / model_id).glob("*/model_card.json"), key=lambda p: json.loads(p.read_text())["created_at"])
    return cards[-1].parent if cards else None


def render(model_id: str) -> str:
    e = CATALOG[model_id]
    d = newest(model_id)
    lines = [f"# Model card — `{model_id}`", ""]
    if d is None:
        return "\n".join(lines + ["No trained artifact. Status: **unavailable** (the UI shows 'model not loaded').", ""])
    c = json.loads((d / "model_card.json").read_text())
    ts = c["training_summary"]
    m = c.get("metrics", {})
    tier_note = ("> **DEMO tier — trained only on procedurally generated synthetic images.** The numbers below measure how well the "
                 "network separates *synthetic* patterns. They say nothing about performance on real faces, and the model must not be "
                 "used to make any statement about a real person.") if c["tier"] == "demo" else "> Validated tier: evaluated on held-out real data. Not clinically validated."
    lines += [
        tier_note, "",
        "| field | value |", "|---|---|",
        f"| version | `{c['version']}` |", f"| tier | {c['tier']} |", f"| feature | {c['feature']} — {e.description} |",
        f"| regions | {', '.join(c['regions'])} |", f"| classes | {', '.join(c['classes'])} (positive: `{c['positive_class']}`) |",
        f"| abstention | 'inconclusive' when top score < threshold ({c['default_threshold']}); 'abstained' when the quality gate fails |",
        f"| backbone | {c['backbone']} (ImageNet-pretrained: {ts.get('pretrained_imagenet')}) |", f"| input | {c['input_size']}×{c['input_size']} RGB, ImageNet normalisation |",
        f"| calibration | temperature scaling, T = {c['temperature']:.3f} (fitted on validation split) |",
        f"| data | {', '.join(c['dataset'].get('source', []))}; train/val/test = {ts.get('n_train')}/{ts.get('n_val')}/{ts.get('n_test')} images, split by subject (seed {ts.get('split_seed')}) |",
        f"| training | {ts.get('epochs_run')} epochs (best {ts.get('best_epoch')}), {ts.get('train_seconds')} s on {ts.get('device')}, torch {ts.get('torch')}, tracker {ts.get('tracker')} run `{ts.get('run_id')}` |",
        "", "## Intended use", "", c.get("intended_use", ""), "", "## Limitations", "",
    ]
    lines += [f"- {x}" for x in c.get("limitations", [])]
    lines += ["- Classifier scores are not probabilities of any medical condition.", "- Not a medical device; no clinical validation has been performed.", ""]
    if m:
        lines += ["## Held-out test metrics (from `eval_report.json`)", ""]
        rep = d / "eval_report.md"
        if rep.exists():
            body = rep.read_text().split("\n", 1)[1]
            lines += [body.replace("\n# ", "\n### ").replace("\n## ", "\n### ")]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for mid in CATALOG:
        (OUT / f"{mid}.md").write_text(render(mid))
        print("wrote", OUT / f"{mid}.md")
