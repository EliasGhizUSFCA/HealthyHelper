"""Measure end-to-end WebSocket inference latency/throughput against a running backend.

    python scripts/bench_ws.py --url ws://localhost:8000/ws/inference --frames 100 --regions 7

Sends synthetic region crops (labelled as such) with one frame in flight, like the browser client.
Prints p50/p95 round-trip and per-stage server timings. Numbers are for THIS machine only.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import statistics
import time

import cv2
import numpy as np
import websockets

REGIONS = ["lips", "left_eye", "right_eye", "nose", "skin_forehead", "skin_left_cheek", "skin_right_cheek"]


def crop(seed: int) -> str:
    rng = np.random.default_rng(seed)
    img = np.clip(rng.normal(150, 35, (160, 160, 3)), 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


async def main(a) -> None:
    async with websockets.connect(a.url, max_size=8_000_000) as ws:
        await ws.send(json.dumps({"type": "hello", "protocol_version": "1.0.0", "consent_upload_crops": True}))
        while json.loads(await ws.recv())["type"] != "hello_ack":
            pass
        rtts, stages = [], {}
        imgs = [crop(i) for i in range(a.regions)]
        for i in range(a.frames):
            msg = {"type": "frame", "frame_id": i, "captured_at": time.time() * 1000,
                   "quality": {"status": "acceptable", "issues": ["synthetic_input"], "metrics": {}},
                   "regions": [{"region": r, "bbox": [0, 0, 0.1, 0.1], "image_b64": imgs[j]} for j, r in enumerate(REGIONS[: a.regions])],
                   "client_events": [], "options": {"return_inputs": a.return_inputs}}
            t0 = time.perf_counter()
            await ws.send(json.dumps(msg))
            while True:
                m = json.loads(await ws.recv())
                if m["type"] in ("inference_result", "frame_dropped", "error"):
                    break
            rtts.append((time.perf_counter() - t0) * 1000)
            if m["type"] == "inference_result":
                for e in m["events"]:
                    key = e["stage"] + (f"[{e['model_id']}]" if e.get("model_id") else "")
                    stages.setdefault(key, []).append(e["duration_ms"])
        q = lambda xs, p: float(np.percentile(xs, p))  # noqa: E731
        print(f"frames={a.frames} regions={a.regions} return_inputs={a.return_inputs}")
        print(f"round-trip ms: p50={q(rtts, 50):.1f} p95={q(rtts, 95):.1f} max={max(rtts):.1f}  → sustainable ≈ {1000 / statistics.mean(rtts):.1f} inferences/s")
        for k, v in sorted(stages.items()):
            print(f"  {k:40s} p50={q(v, 50):7.2f} ms  p95={q(v, 95):7.2f} ms")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="ws://localhost:8000/ws/inference")
    ap.add_argument("--frames", type=int, default=100)
    ap.add_argument("--regions", type=int, default=7)
    ap.add_argument("--return-inputs", action="store_true")
    asyncio.run(main(ap.parse_args()))
