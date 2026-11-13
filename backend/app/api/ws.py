"""WebSocket inference endpoint with bounded, latest-frame-wins queueing.

Per connection:
* a reader task parses client messages; frames go into a 1-slot "mailbox" —
  if a frame is already waiting, it is replaced and the client is told
  ``frame_dropped{superseded}`` (stale work never accumulates);
* a worker task takes the latest frame and runs the CPU-bound pipeline in a
  thread (``asyncio.to_thread``) so the event loop stays responsive;
* explanation requests run in their own bounded thread pool off the hot path;
* a metrics task pushes ServerMetrics every 2 s.
"""

from __future__ import annotations

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import TypeAdapter, ValidationError

from app.inference.registry import resolve_device
from app.schemas.protocol import (
    ClientExplain,
    ClientFrame,
    ClientHello,
    ClientMessage,
    ClientPing,
    FrameDropped,
    ServerError,
    ServerHelloAck,
    ServerMetrics,
    ServerPong,
)
from app.services import Services
from app.telemetry.metrics import ResourceSampler
from app.timeutil import now_ms, perf_ms

log = logging.getLogger(__name__)
_client_msg = TypeAdapter(ClientMessage)
_explain_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="explain")
_infer_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="infer")
_sampler = ResourceSampler()
MAX_MESSAGE_BYTES = 2_000_000


class Connection:
    def __init__(self, ws: WebSocket, svc: Services):
        self.ws, self.svc = ws, svc
        self.state = None
        self.consent = False
        self.pending: tuple[ClientFrame, float, float] | None = None
        self.wakeup = asyncio.Event()
        self.send_lock = asyncio.Lock()
        self.explain_inflight = 0
        self.closed = False

    async def send(self, model) -> None:
        if self.closed:
            return
        async with self.send_lock:
            await self.ws.send_text(model.model_dump_json())

    async def reader(self) -> None:
        while True:
            raw = await self.ws.receive_text()
            if len(raw) > MAX_MESSAGE_BYTES:
                self.svc.counters.frames_rejected += 1
                await self.send(ServerError(code="message_too_large", message=f"max {MAX_MESSAGE_BYTES} bytes"))
                continue
            try:
                msg = _client_msg.validate_python(json.loads(raw))
            except (ValidationError, json.JSONDecodeError) as exc:
                self.svc.counters.frames_rejected += 1
                await self.send(ServerError(code="invalid_message", message=str(exc)[:300]))
                continue
            if isinstance(msg, ClientHello):
                self.state = self.svc.sessions.get_or_create(msg.session_id)
                self.consent = msg.consent_upload_crops
                await self.send(ServerHelloAck(session_id=self.state.session_id, models=self.svc.registry.model_infos(),
                                               server_time=now_ms(), max_queue=1))
                if not self.consent:
                    await self.send(ServerError(code="consent_required", message="Frames are ignored until the user opts in to uploading crops."))
            elif isinstance(msg, ClientPing):
                await self.send(ServerPong(t=msg.t, server_time=now_ms()))
            elif self.state is None:
                await self.send(ServerError(code="hello_required", message="send hello first"))
            elif isinstance(msg, ClientFrame):
                self.svc.counters.frames_received += 1
                if not self.consent:
                    self.svc.counters.frames_dropped += 1
                    await self.send(FrameDropped(frame_id=msg.frame_id, reason="no_consent"))
                    continue
                if self.pending is not None:
                    self.svc.counters.frames_dropped += 1
                    await self.send(FrameDropped(frame_id=self.pending[0].frame_id, reason="superseded"))
                self.pending = (msg, now_ms(), perf_ms())
                self.wakeup.set()
            elif isinstance(msg, ClientExplain):
                if self.explain_inflight >= 1:
                    await self.send(ServerError(code="explain_busy", message="an explanation is already being computed", request_id=msg.request_id))
                    continue
                self.explain_inflight += 1
                asyncio.create_task(self._explain(msg))

    async def _explain(self, msg: ClientExplain) -> None:
        try:
            loop = asyncio.get_running_loop()
            exp = await loop.run_in_executor(_explain_pool, self.svc.engine.explain, msg)
            await self.send(exp)
        except Exception as exc:  # noqa: BLE001
            await self.send(ServerError(code="explain_failed", message=f"{type(exc).__name__}: {exc}", request_id=msg.request_id))
        finally:
            self.explain_inflight -= 1

    async def worker(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            await self.wakeup.wait()
            self.wakeup.clear()
            if self.pending is None:
                continue
            frame, received_at, t_recv = self.pending
            self.pending = None
            wait_ms = perf_ms() - t_recv
            try:
                result = await loop.run_in_executor(_infer_pool, self.svc.engine.process_frame, self.state, frame, received_at, wait_ms)
                self.svc.counters.frames_processed += 1
                await self.send(result)
            except Exception as exc:  # noqa: BLE001
                log.exception("frame processing failed")
                self.svc.counters.frames_rejected += 1
                await self.send(ServerError(code="inference_failed", message=f"{type(exc).__name__}: {exc}"))
                await self.send(FrameDropped(frame_id=frame.frame_id, reason="invalid"))

    async def metrics(self) -> None:
        device = resolve_device(self.svc.settings.device)
        while True:
            await asyncio.sleep(2.0)
            cpu, rss = _sampler.sample()
            c = self.svc.counters
            await self.send(ServerMetrics(t=now_ms(), cpu_percent=cpu, rss_mb=rss, frames_received=c.frames_received,
                                          frames_processed=c.frames_processed, frames_dropped=c.frames_dropped,
                                          frames_rejected=c.frames_rejected, queue_depth=1 if self.pending else 0, device=device))


async def inference_socket(ws: WebSocket, svc: Services) -> None:
    await ws.accept()
    conn = Connection(ws, svc)
    tasks = [asyncio.create_task(conn.reader()), asyncio.create_task(conn.worker()), asyncio.create_task(conn.metrics())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
        for t in done:
            exc = t.exception()
            if exc and not isinstance(exc, (WebSocketDisconnect, RuntimeError)):
                log.warning("websocket task error: %s", exc)
    finally:
        conn.closed = True
        for t in tasks:
            t.cancel()
