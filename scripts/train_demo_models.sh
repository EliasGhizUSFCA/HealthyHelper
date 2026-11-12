#!/usr/bin/env bash
# Generate SYNTHETIC datasets and train the four DEMO-tier models.
# Output models are tier "demo": they exercise the real pipeline but their
# predictions on real faces are meaningless. See docs/datasets.md for real data.
set -euo pipefail
cd "$(dirname "$0")/../backend"
SUBJECTS="${SUBJECTS:-150}"
PER_SUBJECT="${PER_SUBJECT:-8}"
EPOCHS="${EPOCHS:-6}"
BACKBONE="${BACKBONE:-resnet18}"
PRETRAINED_FLAG="${PRETRAINED_FLAG:---pretrained}"
MODELS="${MODELS:-lip_dryness eye_redness nasal_redness skin_flaking}"
export MLFLOW_DISABLE_AGENT_HINT=1
for m in $MODELS; do
  data="../data/synthetic/$m"
  if [ ! -f "$data/manifest.csv" ]; then
    python -m training.synthetic --model-id "$m" --out "$data" --subjects "$SUBJECTS" --per-subject "$PER_SUBJECT" --seed 7
  fi
  python -m training.train --model-id "$m" --manifest "$data/manifest.csv" --backbone "$BACKBONE" $PRETRAINED_FLAG \
    --tier demo --epochs "$EPOCHS" --batch-size 32
done
