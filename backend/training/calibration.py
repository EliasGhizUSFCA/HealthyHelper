"""Post-hoc temperature scaling (Guo et al., 2017) fitted on the validation split."""

from __future__ import annotations

import numpy as np


def fit_temperature(logits: np.ndarray, labels: np.ndarray, max_iter: int = 200) -> float:
    import torch

    z = torch.from_numpy(logits.astype(np.float32))
    y = torch.from_numpy(labels.astype(np.int64))
    log_t = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=max_iter)
    loss_fn = torch.nn.CrossEntropyLoss()

    def closure():
        opt.zero_grad()
        loss = loss_fn(z / log_t.exp(), y)
        loss.backward()
        return loss

    opt.step(closure)
    return float(np.clip(log_t.exp().item(), 0.05, 20.0))
