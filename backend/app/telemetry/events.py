"""Telemetry event construction with monotonic sequencing and real timing."""

from __future__ import annotations

import itertools
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

from app.schemas.protocol import PipelineStage, StageStatus, TelemetryEvent
from app.timeutil import now_ms, perf_ms


@dataclass
class StageHandle:
    status: StageStatus = StageStatus.ok
    message: str | None = None
    model_id: str | None = None
    model_version: str | None = None

    def warn(self, msg: str) -> None:
        self.status, self.message = StageStatus.warning, msg

    def skip(self, msg: str) -> None:
        self.status, self.message = StageStatus.skipped, msg


@dataclass
class EventRecorder:
    session_id: str
    frame_id: int
    _counter: itertools.count[int]
    events: list[TelemetryEvent] = field(default_factory=list)

    @contextmanager
    def stage(self, stage: PipelineStage, input_type: str, output_type: str, **kw) -> Iterator[StageHandle]:
        h = StageHandle(model_id=kw.get("model_id"), model_version=kw.get("model_version"))
        started, t0 = now_ms(), perf_ms()
        try:
            yield h
        except Exception as exc:
            h.status, h.message = StageStatus.error, f"{type(exc).__name__}: {exc}"
            self._emit(stage, h, started, perf_ms() - t0, input_type, output_type)
            raise
        self._emit(stage, h, started, perf_ms() - t0, input_type, output_type)

    def skipped(self, stage: PipelineStage, input_type: str, output_type: str, reason: str) -> None:
        h = StageHandle(status=StageStatus.skipped, message=reason)
        self._emit(stage, h, now_ms(), 0.0, input_type, output_type)

    def _emit(self, stage, h: StageHandle, started: float, dur: float, it: str, ot: str) -> None:
        self.events.append(
            TelemetryEvent(
                session_id=self.session_id, frame_id=self.frame_id, stage=stage, status=h.status, origin="server",
                started_at=started, duration_ms=round(dur, 3), input_type=it, output_type=ot,
                model_id=h.model_id, model_version=h.model_version, message=h.message, seq=next(self._counter),
            )
        )


class SequenceSource:
    """Thread-safe per-session server sequence counter."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._it = itertools.count()

    def recorder(self, session_id: str, frame_id: int) -> EventRecorder:
        return EventRecorder(session_id, frame_id, _LockedCount(self._it, self._lock))  # type: ignore[arg-type]


class _LockedCount:
    def __init__(self, it, lock):
        self._it, self._lock = it, lock

    def __next__(self) -> int:
        with self._lock:
            return next(self._it)
