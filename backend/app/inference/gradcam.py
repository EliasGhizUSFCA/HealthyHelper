"""Grad-CAM (Selvaraju et al., 2017) for the CNN classifiers.

Heatmaps are *approximate attribution visualisations*: they show where gradients
of the chosen class score w.r.t. the last conv block's activations are large.
They are not proof of causal pixel importance nor a complete explanation.
"""

from __future__ import annotations

import cv2
import numpy as np

from app.inference.architectures import gradcam_target_layer
from app.inference.registry import LoadedModel

CAVEAT = (
    "Approximate attribution (Grad-CAM on the last convolutional block). Highlights regions whose "
    "activations most increase the selected class score; it is not proof of what caused the prediction "
    "and not a complete explanation of the network."
)


def grad_cam(lm: LoadedModel, chw: np.ndarray, target_index: int | None = None) -> tuple[np.ndarray, int, float]:
    """Return (cam in [0,1] at input resolution, target index, target probability)."""
    import torch

    if lm.torch_model is None:
        raise RuntimeError("Grad-CAM requires torch weights")
    model = lm.torch_model
    layer = gradcam_target_layer(model, lm.card.backbone)  # type: ignore[arg-type]
    acts: dict[str, torch.Tensor] = {}
    grads: dict[str, torch.Tensor] = {}

    def fwd_hook(_m, _i, o):
        acts["a"] = o
        # tensor hook (not module full-backward hook) — safe with in-place ReLUs downstream
        o.register_hook(lambda g: grads.__setitem__("g", g))

    with lm.lock:
        h1 = layer.register_forward_hook(fwd_hook)
        try:
            x = torch.from_numpy(chw[None]).to(lm.device).requires_grad_(True)
            with torch.enable_grad():
                logits = model(x)  # type: ignore[operator]
                probs = torch.softmax(logits / max(lm.card.temperature, 1e-3), dim=1)
                idx = int(probs.argmax(1).item()) if target_index is None else int(target_index)
                model.zero_grad(set_to_none=True)  # type: ignore[attr-defined]
                logits[0, idx].backward()
        finally:
            h1.remove()
        a = acts["a"].detach()[0]
        g = grads["g"].detach()[0]
    weights = g.mean(dim=(1, 2), keepdim=True)
    cam = torch.relu((weights * a).sum(0)).cpu().numpy()
    if cam.max() > 0:
        cam = cam / cam.max()
    size = chw.shape[-1]
    cam = cv2.resize(cam.astype(np.float32), (size, size), interpolation=cv2.INTER_CUBIC)
    return np.clip(cam, 0, 1), idx, float(probs[0, idx].item())
