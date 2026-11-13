"""Train a region classifier with transfer learning.

    python -m training.train --model-id lip_dryness --manifest data/synthetic/lip_dryness/manifest.csv \
        --backbone resnet18 --pretrained --tier demo

Pipeline: manifest → subject-grouped train/val/test split (leakage-checked) →
augmentation → shared preprocessing → fine-tune (AdamW + cosine LR, label
smoothing) with early stopping on validation loss → best checkpoint → temperature
scaling on validation → evaluation on the held-out test split → versioned
artifact (weights + model card + eval report) under models/<model_id>/<version>/.
Every run is tracked (MLflow if installed, else JSON).
"""

from __future__ import annotations

import argparse
import json
import platform
import random
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from app.config import REPO_ROOT
from app.inference.catalog import CATALOG
from app.inference.model_card import ModelCard
from app.inference.preprocess import IMAGENET_MEAN, IMAGENET_STD, PreprocessConfig


@dataclass
class TrainConfig:
    model_id: str
    manifest: str
    backbone: str = "resnet18"
    pretrained: bool = False
    tier: str = "demo"
    input_size: int = 128
    epochs: int = 8
    batch_size: int = 64
    lr: float = 3e-4
    weight_decay: float = 1e-4
    label_smoothing: float = 0.05
    patience: int = 2
    seed: int = 42
    split_seed: int = 42
    val_frac: float = 0.15
    test_frac: float = 0.15
    threshold: float | None = None
    num_workers: int = 0
    out_dir: str = str(REPO_ROOT / "models")
    runs_dir: str = str(REPO_ROOT / "runs")
    tracker: str = "auto"
    max_train_batches: int | None = None  # for smoke tests
    version: str | None = None


def set_seed(seed: int) -> None:
    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def run(cfg: TrainConfig) -> Path:
    import torch
    from torch import nn
    from torch.utils.data import DataLoader

    from app.inference.architectures import build_model
    from app.inference.registry import LoadedModel
    from evaluation.evaluate import evaluate_samples, to_markdown
    from training.augment import Augmenter
    from training.calibration import fit_temperature
    from training.data import RegionDataset, assert_no_leakage, grouped_split, read_manifest
    from training.tracking import make_tracker

    set_seed(cfg.seed)
    entry = CATALOG[cfg.model_id]
    classes = list(entry.classes)
    pre = PreprocessConfig(cfg.input_size, IMAGENET_MEAN, IMAGENET_STD)
    samples = read_manifest(Path(cfg.manifest))
    splits = grouped_split(samples, cfg.val_frac, cfg.test_frac, cfg.split_seed)
    assert_no_leakage(splits)
    for k, v in splits.items():
        if not v:
            raise ValueError(f"empty {k} split — need more subjects")
    device = "cuda" if torch.cuda.is_available() else "cpu"

    train_ds = RegionDataset(splits["train"], classes, pre, Augmenter(seed=cfg.seed))
    val_ds = RegionDataset(splits["val"], classes, pre)
    g = torch.Generator().manual_seed(cfg.seed)
    train_dl = DataLoader(train_ds, cfg.batch_size, shuffle=True, generator=g, num_workers=cfg.num_workers)
    val_dl = DataLoader(val_ds, cfg.batch_size, shuffle=False, num_workers=cfg.num_workers)

    model = build_model(cfg.backbone, len(classes), pretrained=cfg.pretrained).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(1, cfg.epochs))
    loss_fn = nn.CrossEntropyLoss(label_smoothing=cfg.label_smoothing)

    version = cfg.version or f"{'0.1.0' if cfg.tier == 'demo' else '1.0.0'}-{cfg.tier}.{time.strftime('%Y%m%d%H%M%S')}"
    out = Path(cfg.out_dir) / cfg.model_id / version
    out.mkdir(parents=True, exist_ok=True)
    tracker = make_tracker(cfg.tracker, Path(cfg.runs_dir), f"health-mirror-{cfg.model_id}", version)
    tracker.log_params({**asdict(cfg), "classes": classes, "n_train": len(train_ds), "n_val": len(val_ds), "n_test": len(splits["test"]),
                        "subjects": {k: len({s.subject_id for s in v}) for k, v in splits.items()}})

    def evaluate_loss() -> tuple[float, float, np.ndarray, np.ndarray]:
        model.eval()
        losses, logits_all, ys = [], [], []
        with torch.inference_mode():
            for x, y in val_dl:
                x, y = x.to(device), y.to(device)
                lo = model(x)
                losses.append(loss_fn(lo, y).item() * len(y))
                logits_all.append(lo.cpu().numpy())
                ys.append(y.cpu().numpy())
        L, Y = np.concatenate(logits_all), np.concatenate(ys)
        return float(np.sum(losses) / len(Y)), float((L.argmax(1) == Y).mean()), L, Y

    best_loss, best_epoch, bad, history = float("inf"), -1, 0, []
    t_start = time.time()
    for epoch in range(cfg.epochs):
        model.train()
        tl, tn, t0 = 0.0, 0, time.time()
        for b, (x, y) in enumerate(train_dl):
            if cfg.max_train_batches is not None and b >= cfg.max_train_batches:
                break
            x, y = x.to(device), y.to(device)
            opt.zero_grad(set_to_none=True)
            loss = loss_fn(model(x), y)
            loss.backward()
            opt.step()
            tl += loss.item() * len(y)
            tn += len(y)
        sched.step()
        vl, va, _, _ = evaluate_loss()
        rec = {"epoch": epoch, "train_loss": tl / max(tn, 1), "val_loss": vl, "val_accuracy": va, "lr": sched.get_last_lr()[0], "epoch_s": time.time() - t0}
        history.append(rec)
        tracker.log_metrics({k: v for k, v in rec.items() if k != "epoch"}, step=epoch)
        print(json.dumps(rec))
        if vl < best_loss - 1e-4:
            best_loss, best_epoch, bad = vl, epoch, 0
            torch.save(model.state_dict(), out / "weights.pt")
        else:
            bad += 1
            if bad > cfg.patience:
                print(f"early stopping at epoch {epoch} (best {best_epoch})")
                break

    model.load_state_dict(torch.load(out / "weights.pt", map_location=device, weights_only=True))
    _, _, val_logits, val_y = evaluate_loss()
    temperature = fit_temperature(val_logits, val_y)
    threshold = cfg.threshold if cfg.threshold is not None else entry.default_threshold

    card = ModelCard(
        model_id=cfg.model_id, version=version, tier=cfg.tier, feature=entry.feature, regions=list(entry.regions), classes=classes,
        positive_class=classes[0], backbone=cfg.backbone, input_size=cfg.input_size,
        normalization={"mean": list(IMAGENET_MEAN), "std": list(IMAGENET_STD)}, default_threshold=threshold, temperature=temperature,
        created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        training_summary={
            "best_epoch": best_epoch, "epochs_run": len(history), "best_val_loss": best_loss, "train_seconds": round(time.time() - t_start, 1),
            "split_seed": cfg.split_seed, "seed": cfg.seed, "pretrained_imagenet": cfg.pretrained, "device": device,
            "n_train": len(train_ds), "n_val": len(val_ds), "n_test": len(splits["test"]), "tracker": tracker.backend, "run_id": tracker.run_id,
            "torch": torch.__version__, "python": platform.python_version(), "history": history,
        },
        intended_use="Educational demonstration of a region-classifier pipeline. Not for health assessment." if cfg.tier == "demo"
        else "Wellness-education visual observation of a single facial region. Not a diagnostic device.",
        limitations=(["Trained ONLY on procedurally generated synthetic images; predictions on real faces are meaningless.",
                      "Synthetic skin-tone groups do not establish fairness on real people."] if cfg.tier == "demo" else
                     ["Not clinically validated.", "Performance depends on camera, lighting and pose; see eval report slices."]),
        dataset={"manifest": str(cfg.manifest), "source": sorted({s.meta.get("source", "unknown") for s in samples})},
    )
    (out / "model_card.json").write_text(card.model_dump_json(indent=2))

    lm = LoadedModel(card=card, path=out, runtime="torch", device=device, torch_model=model.eval())
    report = evaluate_samples(lm, splits["test"])
    (out / "eval_report.json").write_text(json.dumps(report, indent=2))
    (out / "eval_report.md").write_text(to_markdown(report, f"{cfg.model_id}@{version} — held-out test split ({cfg.tier})"))
    o = report["overall"]
    card.metrics = {
        "split": "test", "n": o["n"], "accuracy": o["accuracy"], "macro_f1": o["macro_f1"], "ece": o["calibration"]["ece"],
        "per_class": {c: {k: round(v, 4) for k, v in m.items()} for c, m in o["per_class"].items()},
        "selective": o["selective"], "latency": report.get("latency"),
        "data_caveat": "synthetic test data — says nothing about real-world performance" if cfg.tier == "demo" else "",
    }
    (out / "model_card.json").write_text(card.model_dump_json(indent=2))
    tracker.log_metrics({"test_accuracy": o["accuracy"], "test_macro_f1": o["macro_f1"], "test_ece": o["calibration"]["ece"], "temperature": temperature})
    for f in ("model_card.json", "eval_report.json", "eval_report.md"):
        tracker.log_artifact(out / f)
    tracker.end()
    print(f"saved {out}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Train a region classifier")
    for f, d in TrainConfig.__dataclass_fields__.items():
        flag = "--" + f.replace("_", "-")
        default = d.default
        if f in ("model_id", "manifest"):
            ap.add_argument(flag, required=True, choices=list(CATALOG) if f == "model_id" else None)
        elif isinstance(default, bool):
            ap.add_argument(flag, action="store_true", default=default)
        elif default is None:
            ap.add_argument(flag, default=None, type=float if f == "threshold" else (int if f == "max_train_batches" else str))
        else:
            ap.add_argument(flag, default=default, type=type(default))
    a = ap.parse_args()
    run(TrainConfig(**vars(a)))


if __name__ == "__main__":
    main()
