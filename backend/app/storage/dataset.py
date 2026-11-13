"""Consented real-data collection and labelling for training.

Separate from the longitudinal snapshot store on purpose: images here are
collected *for training*, under a separate research consent that the
contributor can withdraw at any time (which deletes every sample, label and
file they contributed).

Layout (under DATA_DIR/dataset/):
    images/<sample_id>.jpg          crops exactly as captured in the browser
    manifests/<model_id>.csv        exported training manifests (path,label,subject_id,...)
    manifests/<model_id>.dataset_card.json   counts + inter-annotator agreement

Labels are per (sample, model, annotator) and are one of
``positive`` / ``negative`` / ``cannot_judge``. Export resolves them to a
consensus label (strict majority; ties and cannot_judge are excluded).
"""

from __future__ import annotations

import csv
import json
import shutil
import time
import uuid
from collections import Counter, defaultdict
from pathlib import Path

from sqlalchemy import JSON, Boolean, Column, Float, Integer, MetaData, String, Table, create_engine, delete, select, update

from app.config import Settings, get_settings
from app.inference.catalog import CATALOG

LABELS = ("positive", "negative", "cannot_judge")
metadata = MetaData()
contributors = Table(
    "ds_contributors", metadata,
    Column("contributor_id", String(64), primary_key=True),
    Column("consent_text_version", String(32), nullable=False),
    Column("consent_at", Float, nullable=False),
    Column("active", Boolean, nullable=False, default=True),
)
samples = Table(
    "ds_samples", metadata,
    Column("sample_id", String(32), primary_key=True),
    Column("contributor_id", String(64), index=True, nullable=False),
    Column("session_id", String(64), nullable=False),
    Column("created_at", Float, nullable=False),
    Column("region", String(32), index=True, nullable=False),
    Column("width", Integer, nullable=False),
    Column("height", Integer, nullable=False),
    Column("quality", JSON, nullable=False),
    Column("meta", JSON, nullable=False),
)
labels = Table(
    "ds_labels", metadata,
    Column("sample_id", String(32), primary_key=True),
    Column("model_id", String(64), primary_key=True),
    Column("annotator_id", String(64), primary_key=True),
    Column("label", String(16), nullable=False),
    Column("created_at", Float, nullable=False),
)


def _safe_id(s: str) -> str:
    if not (4 <= len(s) <= 64 and all(c.isalnum() or c in "-_" for c in s)):
        raise ValueError("invalid id")
    return s


def cohen_kappa(a: list[str], b: list[str]) -> float | None:
    """Cohen's kappa for two annotators over the same items."""
    n = len(a)
    if n == 0:
        return None
    po = sum(x == y for x, y in zip(a, b)) / n
    ca, cb = Counter(a), Counter(b)
    pe = sum(ca[k] * cb[k] for k in set(a) | set(b)) / (n * n)
    return 1.0 if pe == 1 else (po - pe) / (1 - pe)


def consensus(votes: list[str]) -> str | None:
    """Strict-majority label over positive/negative votes; None if tied, empty or mostly cannot_judge."""
    c = Counter(votes)
    top, n = (c.most_common(1) or [(None, 0)])[0]
    if top is None or top == "cannot_judge":
        return None
    if list(c.values()).count(n) > 1:  # tie
        return None
    return top


class DatasetStore:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.root = self.settings.data_dir / "dataset"
        (self.root / "images").mkdir(parents=True, exist_ok=True)
        (self.root / "manifests").mkdir(parents=True, exist_ok=True)
        url = self.settings.resolved_database_url
        if url.startswith("sqlite:///"):
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(url, future=True)
        metadata.create_all(self.engine)

    # ---------------------------------------------------------------- consent
    def register(self, contributor_id: str, consent_version: str) -> dict:
        cid = _safe_id(contributor_id)
        row = dict(contributor_id=cid, consent_text_version=consent_version, consent_at=time.time() * 1000, active=True)
        with self.engine.begin() as c:
            if c.execute(select(contributors).where(contributors.c.contributor_id == cid)).first():
                c.execute(update(contributors).where(contributors.c.contributor_id == cid).values(**row))
            else:
                c.execute(contributors.insert().values(**row))
        return row

    def has_consent(self, contributor_id: str) -> bool:
        with self.engine.connect() as c:
            r = c.execute(select(contributors.c.active).where(contributors.c.contributor_id == _safe_id(contributor_id))).first()
        return bool(r and r[0])

    def withdraw(self, contributor_id: str) -> tuple[int, int]:
        """Delete every sample, label and file from this contributor, and the consent record."""
        cid = _safe_id(contributor_id)
        with self.engine.begin() as c:
            ids = [r[0] for r in c.execute(select(samples.c.sample_id).where(samples.c.contributor_id == cid))]
            if ids:
                c.execute(delete(labels).where(labels.c.sample_id.in_(ids)))
                c.execute(delete(samples).where(samples.c.sample_id.in_(ids)))
            c.execute(delete(contributors).where(contributors.c.contributor_id == cid))
        files = 0
        for sid in ids:
            p = self.image_path(sid)
            if p.exists():
                p.unlink()
                files += 1
        return len(ids), files

    # ---------------------------------------------------------------- samples
    def image_path(self, sample_id: str) -> Path:
        return self.root / "images" / f"{_safe_id(sample_id)}.jpg"

    def add_sample(self, contributor_id: str, session_id: str, region: str, jpeg_bytes: bytes, width: int, height: int,
                   quality: dict, meta: dict) -> dict:
        sid = uuid.uuid4().hex
        self.image_path(sid).write_bytes(jpeg_bytes)
        row = dict(sample_id=sid, contributor_id=_safe_id(contributor_id), session_id=_safe_id(session_id), created_at=time.time() * 1000,
                   region=region, width=width, height=height, quality=quality, meta=meta)
        with self.engine.begin() as c:
            c.execute(samples.insert().values(**row))
        return row

    def delete_sample(self, sample_id: str) -> bool:
        with self.engine.begin() as c:
            c.execute(delete(labels).where(labels.c.sample_id == sample_id))
            n = c.execute(delete(samples).where(samples.c.sample_id == sample_id)).rowcount
        p = self.image_path(sample_id)
        if p.exists():
            p.unlink()
        return bool(n)

    def list_samples(self, regions: list[str] | None = None, contributor_id: str | None = None, limit: int = 500) -> list[dict]:
        q = select(samples).order_by(samples.c.created_at)
        if regions:
            q = q.where(samples.c.region.in_(regions))
        if contributor_id:
            q = q.where(samples.c.contributor_id == contributor_id)
        with self.engine.connect() as c:
            rows = [dict(r) for r in c.execute(q.limit(limit)).mappings()]
            if rows:
                lab = c.execute(select(labels).where(labels.c.sample_id.in_([r["sample_id"] for r in rows]))).mappings().all()
            else:
                lab = []
        by: dict[str, list[dict]] = defaultdict(list)
        for lr in lab:
            by[lr["sample_id"]].append({"model_id": lr["model_id"], "annotator_id": lr["annotator_id"], "label": lr["label"]})
        for r in rows:
            r["labels"] = by.get(r["sample_id"], [])
        return rows

    def set_label(self, sample_id: str, model_id: str, annotator_id: str, label: str) -> None:
        if label not in LABELS:
            raise ValueError(f"label must be one of {LABELS}")
        if model_id not in CATALOG:
            raise ValueError("unknown model_id")
        with self.engine.begin() as c:
            s = c.execute(select(samples.c.region).where(samples.c.sample_id == sample_id)).first()
            if not s:
                raise LookupError("sample not found")
            if s[0] not in CATALOG[model_id].regions:
                raise ValueError(f"region {s[0]} is not used by {model_id}")
            key = (labels.c.sample_id == sample_id) & (labels.c.model_id == model_id) & (labels.c.annotator_id == _safe_id(annotator_id))
            c.execute(delete(labels).where(key))
            c.execute(labels.insert().values(sample_id=sample_id, model_id=model_id, annotator_id=annotator_id, label=label, created_at=time.time() * 1000))

    # ---------------------------------------------------------------- stats / export
    def model_stats(self, model_id: str) -> dict:
        entry = CATALOG[model_id]
        rows = self.list_samples(list(entry.regions), limit=1_000_000)
        votes = {r["sample_id"]: {lb["annotator_id"]: lb["label"] for lb in r["labels"] if lb["model_id"] == model_id} for r in rows}
        cons = {sid: consensus(list(v.values())) for sid, v in votes.items()}
        usable = [r for r in rows if cons[r["sample_id"]]]
        annotators = sorted({a for v in votes.values() for a in v})
        pairs = []
        for i in range(len(annotators)):
            for j in range(i + 1, len(annotators)):
                a, b = annotators[i], annotators[j]
                shared = [(v[a], v[b]) for v in votes.values() if a in v and b in v]
                if len(shared) >= 10:
                    pairs.append({"annotators": [a, b], "n": len(shared), "kappa": cohen_kappa([x for x, _ in shared], [y for _, y in shared]),
                                  "agreement": sum(x == y for x, y in shared) / len(shared)})
        counts = Counter(cons[r["sample_id"]] for r in usable)
        kappas = [p["kappa"] for p in pairs if p["kappa"] is not None]
        return {
            "model_id": model_id, "feature": entry.feature, "regions": list(entry.regions),
            "samples": len(rows), "labelled": sum(1 for v in votes.values() if v), "usable": len(usable),
            "positive": counts.get("positive", 0), "negative": counts.get("negative", 0),
            "excluded_cannot_judge_or_tie": sum(1 for v in votes.values() if v) - len(usable),
            "subjects": len({r["contributor_id"] for r in usable}), "sessions": len({r["session_id"] for r in usable}),
            "annotators": annotators, "agreement_pairs": pairs, "mean_kappa": (sum(kappas) / len(kappas)) if kappas else None,
        }

    def export_manifest(self, model_id: str) -> dict:
        entry = CATALOG[model_id]
        pos, neg = entry.classes
        rows = self.list_samples(list(entry.regions), limit=1_000_000)
        out = self.root / "manifests" / f"{model_id}.csv"
        n = 0
        with out.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["path", "label", "subject_id", "session_id", "region", "lighting", "glasses", "makeup", "device", "skin_tone", "n_annotators", "source"])
            for r in rows:
                v = [lb["label"] for lb in r["labels"] if lb["model_id"] == model_id]
                c = consensus(v)
                if not c:
                    continue
                m = r["meta"] or {}
                w.writerow([f"../images/{r['sample_id']}.jpg", pos if c == "positive" else neg, r["contributor_id"], r["session_id"], r["region"],
                            m.get("lighting", "unknown"), m.get("glasses", "unknown"), m.get("makeup", "unknown"), m.get("device", "unknown"),
                            m.get("skin_tone", "unspecified"), len(v), "real-consented"])
                n += 1
        stats = self.model_stats(model_id)
        card = {**stats, "manifest": str(out), "exported_at": time.time() * 1000, "rows": n,
                "consent": "separate research consent per contributor; withdrawable (deletes all contributions)"}
        out.with_suffix(".dataset_card.json").write_text(json.dumps(card, indent=2))
        return card

    def wipe(self) -> None:  # tests only
        shutil.rmtree(self.root, ignore_errors=True)
