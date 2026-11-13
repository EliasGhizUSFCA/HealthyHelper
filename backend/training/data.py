"""Manifest-driven dataset loading with subject-grouped splitting.

Manifest CSV columns (required): ``path,label,subject_id``; any other columns are
treated as metadata for slice evaluation (e.g. ``skin_tone_group``, ``lighting``,
``blur``, ``angle_bucket``, ``device``). ``path`` is relative to the manifest.

Leakage prevention: several images usually come from the same person. Splits are
made at the *subject* level (deterministic hash of subject_id + seed), and
:func:`assert_no_leakage` is called before training starts.
"""

from __future__ import annotations

import csv
import hashlib
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from app.inference.preprocess import PreprocessConfig, preprocess
from training.augment import Augmenter


@dataclass(frozen=True)
class Sample:
    path: Path
    label: str
    subject_id: str
    meta: dict[str, str]


def read_manifest(manifest: Path) -> list[Sample]:
    root = manifest.parent
    out: list[Sample] = []
    with manifest.open() as f:
        reader = csv.DictReader(f)
        missing = {"path", "label", "subject_id"} - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"manifest missing columns: {sorted(missing)}")
        for row in reader:
            meta = {k: v for k, v in row.items() if k not in {"path", "label", "subject_id"}}
            out.append(Sample(root / row["path"], row["label"], row["subject_id"], meta))
    return out


def subject_bucket(subject_id: str, seed: int) -> float:
    h = hashlib.sha256(f"{seed}:{subject_id}".encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def group_key(s: Sample, group_by: str = "subject_id") -> str:
    if group_by == "subject_id":
        return s.subject_id
    if group_by not in s.meta:
        raise ValueError(f"manifest has no column {group_by!r} to group by")
    return f"{s.subject_id}/{s.meta[group_by]}"


def grouped_split(samples: list[Sample], val_frac: float = 0.15, test_frac: float = 0.15, seed: int = 42,
                  group_by: str = "subject_id") -> dict[str, list[Sample]]:
    """Deterministic split where every group (subject, or subject/session) lands in exactly one split.

    If a split would end up empty (few groups), groups are assigned by sorted hash order instead
    so that each split gets at least one group when there are >= 3 groups.
    """
    splits: dict[str, list[Sample]] = {"train": [], "val": [], "test": []}
    groups = sorted({group_key(s, group_by) for s in samples}, key=lambda g: subject_bucket(g, seed))
    assign: dict[str, str] = {}
    for g in groups:
        b = subject_bucket(g, seed)
        assign[g] = "test" if b < test_frac else "val" if b < test_frac + val_frac else "train"
    if len(groups) >= 3 and len(set(assign.values())) < 3:
        n_test = max(1, round(len(groups) * test_frac))
        n_val = max(1, round(len(groups) * val_frac))
        for i, g in enumerate(groups):
            assign[g] = "test" if i < n_test else "val" if i < n_test + n_val else "train"
    for s in samples:
        splits[assign[group_key(s, group_by)]].append(s)
    return splits


def assert_no_leakage(splits: dict[str, list[Sample]], group_by: str = "subject_id") -> None:
    subjects = {k: {group_key(s, group_by) for s in v} for k, v in splits.items()}
    names = list(subjects)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            overlap = subjects[names[i]] & subjects[names[j]]
            if overlap:
                raise AssertionError(f"subject leakage between {names[i]} and {names[j]}: {sorted(overlap)[:5]}")


def load_rgb(path: Path) -> np.ndarray:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise FileNotFoundError(path)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


class RegionDataset:
    """torch-compatible dataset (implements __len__/__getitem__)."""

    def __init__(self, samples: list[Sample], classes: list[str], cfg: PreprocessConfig, augment: Augmenter | None = None, cache: bool = True):
        self.samples = samples
        self.class_to_idx = {c: i for i, c in enumerate(classes)}
        unknown = {s.label for s in samples} - set(classes)
        if unknown:
            raise ValueError(f"labels not in classes: {unknown}")
        self.cfg = cfg
        self.augment = augment
        self._cache: dict[int, np.ndarray] = {} if cache else None  # type: ignore[assignment]

    def __len__(self) -> int:
        return len(self.samples)

    def image(self, i: int) -> np.ndarray:
        if self._cache is not None and i in self._cache:
            return self._cache[i]
        img = load_rgb(self.samples[i].path)
        if self._cache is not None:
            self._cache[i] = img
        return img

    def __getitem__(self, i: int):
        import torch

        img = self.image(i)
        if self.augment is not None:
            img = self.augment(img)
        x = preprocess(img, self.cfg)  # identical to serving
        return torch.from_numpy(x), self.class_to_idx[self.samples[i].label]
