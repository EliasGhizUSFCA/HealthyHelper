"""Consent-gated longitudinal snapshot storage.

* Metadata (quality, lighting, observations) → SQL (SQLite by default, PostgreSQL via DATABASE_URL).
* Aligned region crops → files under DATA_DIR/history/<history_id>/<snapshot_id>/.
* Nothing is stored without ``consent_store_images=true``; a consent record (text
  version + timestamp) is kept with each snapshot.
* ``delete_history`` removes every row AND file for a history id.
* Stored images are never used for training (no code path reads them besides comparison).
"""

from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path

import cv2
import numpy as np
from sqlalchemy import JSON, Column, Float, MetaData, String, Table, create_engine, delete, select

from app.config import Settings, get_settings

metadata = MetaData()
snapshots = Table(
    "snapshots", metadata,
    Column("snapshot_id", String(32), primary_key=True),
    Column("history_id", String(64), index=True, nullable=False),
    Column("created_at", Float, nullable=False),
    Column("consent_text_version", String(32), nullable=False),
    Column("consent_at", Float, nullable=False),
    Column("quality", JSON, nullable=False),
    Column("lighting", JSON, nullable=False),
    Column("observations", JSON, nullable=False),
    Column("regions", JSON, nullable=False),
)


def _safe_id(s: str) -> str:
    if not (8 <= len(s) <= 64 and all(c.isalnum() or c in "-_" for c in s)):
        raise ValueError("invalid id")
    return s


class HistoryStore:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.root = self.settings.data_dir / "history"
        self.root.mkdir(parents=True, exist_ok=True)
        url = self.settings.resolved_database_url
        if url.startswith("sqlite:///"):
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(url, future=True)
        metadata.create_all(self.engine)

    def _dir(self, history_id: str, snapshot_id: str | None = None) -> Path:
        d = self.root / _safe_id(history_id)
        return d / _safe_id(snapshot_id) if snapshot_id else d

    def save(self, history_id: str, consent_version: str, quality: dict, lighting: dict, observations: list[dict],
             region_images: dict[str, np.ndarray]) -> dict:
        sid = uuid.uuid4().hex
        d = self._dir(history_id, sid)
        d.mkdir(parents=True, exist_ok=True)
        for name, img in region_images.items():
            cv2.imwrite(str(d / f"{name}.png"), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
        row = dict(snapshot_id=sid, history_id=history_id, created_at=time.time() * 1000, consent_text_version=consent_version,
                   consent_at=time.time() * 1000, quality=quality, lighting=lighting, observations=observations, regions=sorted(region_images))
        with self.engine.begin() as c:
            c.execute(snapshots.insert().values(**row))
        return row

    def list(self, history_id: str) -> list[dict]:
        with self.engine.connect() as c:
            rows = c.execute(select(snapshots).where(snapshots.c.history_id == _safe_id(history_id)).order_by(snapshots.c.created_at)).mappings().all()
        return [dict(r) for r in rows]

    def get(self, history_id: str, snapshot_id: str) -> dict | None:
        with self.engine.connect() as c:
            r = c.execute(select(snapshots).where(snapshots.c.history_id == _safe_id(history_id),
                                                  snapshots.c.snapshot_id == _safe_id(snapshot_id))).mappings().first()
        return dict(r) if r else None

    def region_image(self, history_id: str, snapshot_id: str, region: str) -> np.ndarray | None:
        p = self._dir(history_id, snapshot_id) / f"{region}.png"
        if not p.exists():
            return None
        return cv2.cvtColor(cv2.imread(str(p)), cv2.COLOR_BGR2RGB)

    def delete_history(self, history_id: str) -> tuple[int, int]:
        d = self._dir(history_id)
        n_files = sum(1 for p in d.rglob("*") if p.is_file()) if d.exists() else 0
        with self.engine.begin() as c:
            n_rows = c.execute(delete(snapshots).where(snapshots.c.history_id == history_id)).rowcount or 0
        if d.exists():
            shutil.rmtree(d)
        return int(n_rows), n_files


def dumps(o) -> str:
    return json.dumps(o, default=str)
