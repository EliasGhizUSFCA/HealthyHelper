#!/usr/bin/env bash
# Download the FairFace "0.25" parquet files (CC BY 4.0, Kärkkäinen & Joo 2021) used to train the apparent-age model.
# ~315 MB. Stored under data/ (git-ignored). See docs/data-sources/fairface.md for licence and attribution.
set -euo pipefail
DEST="$(dirname "$0")/../data/external/fairface"
mkdir -p "$DEST"
BASE=https://huggingface.co/datasets/HuggingFaceM4/FairFace/resolve/main/0.25
curl -fL -o "$DEST/train-0.parquet" "$BASE/train-00000-of-00002-d405faba4f4b9b85.parquet"
curl -fL -o "$DEST/validation.parquet" "$BASE/validation-00000-of-00001-951dbd63c8724ee1.parquet"
echo "saved to $DEST"
