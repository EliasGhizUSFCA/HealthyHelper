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
    group_by: str = "subject_id"  # or "session_id" when there are too few people (forces tier experimental)
    class_weighted: bool = False  # weight the loss by inverse class frequency (useful for imbalanced real data)
    split_column: str | None = None  # manifest column marking an official test split ("test")


# Validation gate: a model may only be marked "validated" if its held-out test split is big and diverse enough
# and the labels are reliable. These are project rules, not clinical standards.
GATE = {"min_test_subjects": 15, "min_test_images": 100, "min_test_per_class": 30, "min_mean_kappa": 0.6}


def check_validation_gate(cfg: TrainConfig, splits: dict, classes: list[str], dataset_card: dict | None) -> list[str]:
    test = splits["test"]
    problems = []
    if cfg.group_by != "subject_id":
        problems.append("split must be grouped by subject_id (not session) to estimate performance on new people")
    if len({s.subject_id for s in test}) < GATE["min_test_subjects"]:
        problems.append(f"test split has {len({s.subject_id for s in test})} subjects < {GATE['min_test_subjects']}")
    if len(test) < GATE["min_test_images"]:
        problems.append(f"test split has {len(test)} images < {GATE['min_test_images']}")
    for c in classes:
        n = sum(1 for s in test if s.label == c)
        if n < GATE["min_test_per_class"]:
            problems.append(f"test split has {n} '{c}' images < {GATE['min_test_per_class']}")
    kappa = (dataset_card or {}).get("mean_kappa")
    if kappa is None or kappa < GATE["min_mean_kappa"]:
        problems.append(f"inter-annotator agreement (mean Cohen's kappa) is {kappa} — need >= {GATE['min_mean_kappa']} from >= 2 annotators")
    if any(s.meta.get("source") == "synthetic" for s in test):
        problems.append("synthetic data cannot produce a validated model")
    return problems


def _limitations(cfg: TrainConfig, n_subjects: int) -> list[str]:
    if cfg.model_id == "apparent_age":
        return [
            "EXPERIMENTAL: trained on FairFace (CC BY 4.0) face photos from Flickr; labels are crowd-annotated APPARENT-age bins, not verified ages.",
            "Domain shift: FairFace photos differ from webcam frames (lighting, resolution, pose) — expect lower accuracy live.",
            "The 'under_20' range merges 0–19, so the model cannot tell minors from young adults; only a user-confirmed range may be used for age-appropriateness.",
            "FairFace has no identity ids, so near-duplicate faces across splits cannot be ruled out; test metrics may be optimistic.",
            "Performance differs across gender and race groups — see the subgroup table. Never use for identity verification, age-gating or health statements.",
        ]
    if cfg.tier == "demo":
        return ["Trained ONLY on procedurally generated synthetic images; predictions on real faces are meaningless.",
                "Synthetic skin-tone groups do not establish fairness on real people."]
    out = ["Not clinically validated.", "Performance depends on camera, lighting and pose; see eval report slices."]
    if cfg.tier == "experimental":
        out.insert(0, f"EXPERIMENTAL: trained on real images from {n_subjects} contributor(s); did not pass (or was not checked against) the validation gate.")
    if cfg.group_by != "subject_id":
        out.insert(1, "Split grouped by capture session, not by person: test metrics overestimate performance on new people.")
    if n_subjects < 30:
        out.append("Very few contributors: results will not generalise across skin tones, ages, cameras or lighting.")
    return out


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
    is_synthetic = all(s.meta.get("source") == "synthetic" for s in samples)
    if cfg.tier == "demo" and not is_synthetic:
        raise ValueError("tier 'demo' is reserved for synthetic data; use --tier experimental for real images")
    if cfg.tier in ("experimental", "validated") and is_synthetic:
        raise ValueError("synthetic data can only train a 'demo' model")
    for c in classes:
        if sum(1 for s in samples if s.label == c) < 10:
            raise ValueError(f"need at least 10 labelled '{c}' images (have {sum(1 for s in samples if s.label == c)})")
    n_subjects = len({s.subject_id for s in samples})
    if cfg.group_by == "subject_id" and n_subjects < 3:
        raise ValueError(f"only {n_subjects} subject(s): a subject-grouped split is impossible. Collect images from more people, "
                         "or pass --group-by session_id (the model will then be tier 'experimental' and its test score will "
                         "OVERESTIMATE performance on new people).")
    splits = grouped_split(samples, cfg.val_frac, cfg.test_frac, cfg.split_seed, cfg.group_by, cfg.split_column)
    assert_no_leakage(splits, cfg.group_by)
    for k, v in splits.items():
        if not v:
            raise ValueError(f"empty {k} split — need more {'subjects' if cfg.group_by == 'subject_id' else 'capture sessions'}")
    dataset_card = None
    card_path = Path(cfg.manifest).with_suffix(".dataset_card.json")
    if card_path.exists():
        dataset_card = json.loads(card_path.read_text())
    if cfg.tier == "validated":
        problems = check_validation_gate(cfg, splits, classes, dataset_card)
        if problems:
            raise ValueError("validation gate failed — train with --tier experimental instead:\n  - " + "\n  - ".join(problems))
    device = "cuda" if torch.cuda.is_available() else "cpu"

    train_ds = RegionDataset(splits["train"], classes, pre, Augmenter(seed=cfg.seed))
    val_ds = RegionDataset(splits["val"], classes, pre)
    g = torch.Generator().manual_seed(cfg.seed)
    train_dl = DataLoader(train_ds, cfg.batch_size, shuffle=True, generator=g, num_workers=cfg.num_workers)
    val_dl = DataLoader(val_ds, cfg.batch_size, shuffle=False, num_workers=cfg.num_workers)

    model = build_model(cfg.backbone, len(classes), pretrained=cfg.pretrained).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(1, cfg.epochs))
    weight = None
    if cfg.class_weighted:
        counts = np.array([sum(1 for s in splits["train"] if s.label == c) for c in classes], dtype=np.float64)
        weight = torch.tensor(counts.sum() / (len(classes) * np.maximum(counts, 1)), dtype=torch.float32, device=device)
    loss_fn = nn.CrossEntropyLoss(weight=weight, label_smoothing=cfg.label_smoothing)

    version = cfg.version or f"{ {'demo': '0.1.0', 'experimental': '0.5.0', 'validated': '1.0.0'}[cfg.tier] }-{cfg.tier}.{time.strftime('%Y%m%d%H%M%S')}"
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
        model_id=cfg.model_id, version=version, tier=cfg.tier, feature=entry.feature, task=entry.task, regions=list(entry.regions), classes=classes,
        positive_class=classes[0], backbone=cfg.backbone, input_size=cfg.input_size,
        normalization={"mean": list(IMAGENET_MEAN), "std": list(IMAGENET_STD)}, default_threshold=threshold, temperature=temperature,
        created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        training_summary={
            "best_epoch": best_epoch, "epochs_run": len(history), "best_val_loss": best_loss, "train_seconds": round(time.time() - t_start, 1),
            "split_seed": cfg.split_seed, "split_column": cfg.split_column, "seed": cfg.seed, "pretrained_imagenet": cfg.pretrained and cfg.backbone != "small_cnn", "device": device,
            "n_train": len(train_ds), "n_val": len(val_ds), "n_test": len(splits["test"]), "tracker": tracker.backend, "run_id": tracker.run_id,
            "torch": torch.__version__, "python": platform.python_version(), "history": history,
        },
        intended_use="Educational demonstration of a region-classifier pipeline. Not for health assessment." if cfg.tier == "demo"
        else "Wellness-education visual observation of a single facial region. Not a diagnostic device.",
        limitations=_limitations(cfg, n_subjects),
        dataset={"manifest": str(cfg.manifest), "source": sorted({s.meta.get("source", "unknown") for s in samples}),
                 "subjects": n_subjects, "group_by": cfg.group_by, "class_weighted": cfg.class_weighted,
                 "label_counts": {c: sum(1 for s in samples if s.label == c) for c in classes},
                 "mean_kappa": (dataset_card or {}).get("mean_kappa"), "annotators": len((dataset_card or {}).get("annotators", []))},
    )
    (out / "model_card.json").write_text(card.model_dump_json(indent=2))

    lm = LoadedModel(card=card, path=out, runtime="torch", device=device, torch_model=model.eval())
    report = evaluate_samples(lm, splits["test"], perturb=entry.task != "age_range" or len(splits["test"]) <= 5000)
    (out / "eval_report.json").write_text(json.dumps(report, indent=2))
    (out / "eval_report.md").write_text(to_markdown(report, f"{cfg.model_id}@{version} — held-out test split ({cfg.tier})"))
    o = report["overall"]
    card.metrics = {
        "split": "test", "n": o["n"], "accuracy": o["accuracy"], "macro_f1": o["macro_f1"], "ece": o["calibration"]["ece"],
        "per_class": {c: {k: round(v, 4) for k, v in m.items()} for c, m in o["per_class"].items()},
        "selective": o["selective"], "latency": report.get("latency"), "age": (report.get("age") or {}).get("overall"),
        "data_caveat": "synthetic test data — says nothing about real-world performance" if cfg.tier == "demo"
        else ("test split grouped by session, not person — optimistic" if cfg.group_by != "subject_id" else ""),
    }
    (out / "model_card.json").write_text(card.model_dump_json(indent=2))
    tracker.log_metrics({"test_accuracy": o["accuracy"], "test_macro_f1": o["macro_f1"], "test_ece": o["calibration"]["ece"], "temperature": temperature})
    for f in ("model_card.json", "eval_report.json", "eval_report.md"):
        tracker.log_artifact(out / f)
    tracker.end()
    write_card_md(out)
    print(f"saved {out}")
    return out


def write_card_md(out: Path) -> None:
    """Human-readable model card next to the artifact (same renderer as docs/model-cards)."""
    import sys

    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    try:
        from render_model_cards import render_dir

        (out / "MODEL_CARD.md").write_text(render_dir(out))
    except Exception as exc:  # noqa: BLE001 - documentation must never fail a training run
        print(f"[model card] skipped: {exc}")


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
