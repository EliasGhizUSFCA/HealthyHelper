"""Export a model artifact to ONNX and verify numerical parity with PyTorch.

    python scripts/export_onnx.py --model-dir models/lip_dryness/<version>

Writes model.onnx next to the weights and records it in model_card.json. Serve
with INFERENCE_RUNTIME=onnx (Grad-CAM still uses the torch weights).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def main() -> None:
    import numpy as np
    import onnxruntime as ort
    import torch

    from app.config import get_settings
    from app.inference.registry import load_artifact

    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", type=Path, required=True)
    ap.add_argument("--opset", type=int, default=17)
    a = ap.parse_args()
    lm = load_artifact(a.model_dir, get_settings())
    model = lm.torch_model.cpu().eval()
    s = lm.card.input_size
    dummy = torch.randn(1, 3, s, s)
    out = a.model_dir / "model.onnx"
    torch.onnx.export(model, (dummy,), str(out), input_names=["input"], output_names=["logits"],
                      dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}}, opset_version=a.opset, dynamo=False)
    sess = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
    x = np.random.default_rng(0).normal(size=(4, 3, s, s)).astype(np.float32)
    ref = model(torch.from_numpy(x)).detach().numpy()
    got = sess.run(None, {"input": x})[0]
    err = float(np.abs(ref - got).max())
    if err > 1e-3:
        raise SystemExit(f"ONNX parity check failed: max abs diff {err}")
    card_path = a.model_dir / "model_card.json"
    card = json.loads(card_path.read_text())
    card["onnx_file"] = "model.onnx"
    card_path.write_text(json.dumps(card, indent=2))
    print(f"exported {out} (max |Δlogit| = {err:.2e})")


if __name__ == "__main__":
    main()
