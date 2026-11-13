"""Ephemeral in-memory session state. Holds derived observations only — never images."""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field

from app.config import get_settings
from app.inference.aggregator import ObservationAggregator
from app.schemas.protocol import StructuredObservations
from app.telemetry.events import SequenceSource


@dataclass
class SessionState:
    session_id: str
    created_at: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    aggregator: ObservationAggregator = field(default_factory=lambda: ObservationAggregator(
        get_settings().observation_window, get_settings().min_frames_for_observation))
    seq: SequenceSource = field(default_factory=SequenceSource)
    latest_observations: StructuredObservations | None = None


class SessionStore:
    def __init__(self, ttl_s: int | None = None):
        self.ttl_s = ttl_s or get_settings().session_ttl_s
        self._sessions: dict[str, SessionState] = {}
        self._lock = threading.Lock()

    def get_or_create(self, session_id: str | None = None) -> SessionState:
        with self._lock:
            self._evict()
            if session_id and session_id in self._sessions:
                s = self._sessions[session_id]
                s.last_seen = time.time()
                return s
            sid = session_id if session_id and _valid_id(session_id) else uuid.uuid4().hex
            s = SessionState(sid)
            self._sessions[sid] = s
            return s

    def get(self, session_id: str) -> SessionState | None:
        with self._lock:
            return self._sessions.get(session_id)

    def delete(self, session_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(session_id, None) is not None

    def __len__(self) -> int:
        return len(self._sessions)

    def _evict(self) -> None:
        cutoff = time.time() - self.ttl_s
        for sid in [k for k, v in self._sessions.items() if v.last_seen < cutoff]:
            del self._sessions[sid]


def _valid_id(s: str) -> bool:
    return 8 <= len(s) <= 64 and all(c.isalnum() or c in "-_" for c in s)
