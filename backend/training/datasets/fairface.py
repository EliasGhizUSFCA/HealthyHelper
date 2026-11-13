"""Prepare FairFace (Kärkkäinen & Joo, 2021; CC BY 4.0) for apparent-age-range training.

    python -m training.datasets.fairface --src ../data/external/fairface --out ../data/age/fairface \
        --train-n 15000 --test-n 4000

Source: https://huggingface.co/datasets/HuggingFaceM4/FairFace ("0.25" padding variant). Licence CC BY 4.0;
images originate from YFCC-100M (Flickr). Attribution is required — see docs/data-sources/fairface.md.

Labels are *annotated apparent age* bins (crowd-sourced), not verified chronological age. The nine FairFace bins
are merged into six broad ranges. FairFace has no identity ids, so a subject-grouped split is not possible;
each image is its own group (documented limitation). The official validation split is used as our TEST split.
"""

from __future__ import annotations

import argparse
import csv
import io
from pathlib import Path

import numpy as np
from PIL import Image

FAIRFACE_AGE = ["0-2", "3-9", "10-19", "20-29", "30-39", "40-49", "50-59", "60-69", "more than 70"]
GENDER = ["male", "female"]
RACE = ["east_asian", "indian", "black", "white", "middle_eastern", "latino_hispanic", "southeast_asian"]
MERGE = {0: "under_20", 1: "under_20", 2: "under_20", 3: "20_29", 4: "30_39", 5: "40_49", 6: "50_59", 7: "60_plus", 8: "60_plus"}


def convert(parquet: Path, out: Path, split: str, n: int | None, seed: int, size: int = 160) -> list[dict]:
    import pyarrow.parquet as pq

    t = pq.read_table(parquet, columns=["age", "gender", "race"]).to_pydict()
    idx = np.arange(len(t["age"]))
    if n and n < len(idx):  # stratified subsample by merged age range so rare ranges are kept
        rng = np.random.default_rng(seed)
        labels = np.array([MERGE[a] for a in t["age"]])
        chosen = []
        for lab in sorted(set(labels)):
            pool = idx[labels == lab]
            k = max(1, round(n * len(pool) / len(idx)))
            chosen += list(rng.choice(pool, size=min(k, len(pool)), replace=False))
        idx = np.array(sorted(chosen))
    keep = set(int(i) for i in idx)
    img_dir = out / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    rows, offset = [], 0
    pf = pq.ParquetFile(parquet)
    for batch in pf.iter_batches(batch_size=512, columns=["image", "age", "gender", "race"]):
        d = batch.to_pydict()
        for j in range(len(d["age"])):
            i = offset + j
            if i not in keep:
                continue
            im = Image.open(io.BytesIO(d["image"][j]["bytes"])).convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
            name = f"{split}_{i:06d}.jpg"
            im.save(img_dir / name, quality=92)
            rows.append({"path": f"images/{name}", "label": MERGE[d["age"][j]], "subject_id": f"ff-{split}-{i}", "fairface_age_bin": FAIRFACE_AGE[d["age"][j]],
                         "gender": GENDER[d["gender"][j]], "race": RACE[d["race"][j]], "ff_split": split, "source": "fairface"})
        offset += len(d["age"])
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--train-n", type=int, default=15000)
    ap.add_argument("--test-n", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    rows = convert(a.src / "train-0.parquet", a.out, "train", a.train_n, a.seed)
    rows += convert(a.src / "validation.parquet", a.out, "test", a.test_n, a.seed)
    with (a.out / "manifest.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} rows to {a.out / 'manifest.csv'}")


if __name__ == "__main__":
    main()
