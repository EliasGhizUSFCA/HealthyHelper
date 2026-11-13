"""Export the consented, labelled dataset for one model to a training manifest.

    python -m training.export_dataset --model-id lip_dryness

Reads the same store the Collect/Label pages write to (DATA_DIR/dataset + DATABASE_URL),
resolves multi-annotator labels to a consensus, and prints dataset statistics.
"""

from __future__ import annotations

import argparse
import json

from app.inference.catalog import CATALOG
from app.storage.dataset import DatasetStore


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-id", required=True, choices=list(CATALOG))
    a = ap.parse_args()
    card = DatasetStore().export_manifest(a.model_id)
    keys = ("rows", "positive", "negative", "subjects", "sessions", "annotators", "mean_kappa", "excluded_cannot_judge_or_tie", "manifest")
    print(json.dumps({k: card[k] for k in keys}, indent=2))
    if card["positive"] < 10 or card["negative"] < 10:
        raise SystemExit("Not enough labelled data yet: need at least 10 of each class. Collect and label more on /collect and /label.")
    if card["subjects"] < 3:
        print("NOTE: fewer than 3 contributors — train with GROUP=session_id (results will be optimistic).")


if __name__ == "__main__":
    main()
