import logging

import numpy as np

from tests.conftest import frame_payload, synthetic_landmarks, textured


def recv_until(ws, types, limit=20):
    for _ in range(limit):
        m = ws.receive_json()
        if m["type"] in types:
            return m
    raise AssertionError(f"no {types}")


def hello(ws, consent=True, sid=None):
    ws.send_json({"type": "hello", "protocol_version": "1.0.0", "consent_upload_crops": consent, "session_id": sid})
    return recv_until(ws, {"hello_ack"})


def test_ws_requires_consent(client):
    with client.websocket_connect("/ws/inference") as ws:
        hello(ws, consent=False)
        assert recv_until(ws, {"error"})["code"] == "consent_required"
        ws.send_json(frame_payload(1))
        m = recv_until(ws, {"frame_dropped"})
        assert m["reason"] == "no_consent"


def test_ws_inference_roundtrip(client):
    with client.websocket_connect("/ws/inference") as ws:
        ack = hello(ws)
        assert {m["model_id"] for m in ack["models"]} >= {"lip_dryness", "eye_redness", "nasal_redness", "skin_flaking"}
        ws.send_json(frame_payload(7, return_inputs=True))
        r = recv_until(ws, {"inference_result"})
        assert r["frame_id"] == 7 and r["session_id"] == ack["session_id"] and r["predictions"]
        assert r["completed_at"] >= r["received_at"]
        ws.send_json({"type": "ping", "t": 123})
        assert recv_until(ws, {"pong"})["t"] == 123


def test_ws_rejects_invalid_and_requires_hello(client):
    with client.websocket_connect("/ws/inference") as ws:
        ws.send_json(frame_payload(1))
        assert recv_until(ws, {"error"})["code"] == "hello_required"
        ws.send_text("{not json")
        assert recv_until(ws, {"error"})["code"] == "invalid_message"


def test_ws_backpressure_latest_frame_wins(client):
    with client.websocket_connect("/ws/inference") as ws:
        hello(ws)
        n = 6
        for i in range(n):
            ws.send_json(frame_payload(i))
        done, dropped, results = set(), [], []
        while len(done) < n:
            m = ws.receive_json()
            if m["type"] == "inference_result":
                results.append(m["frame_id"])
                done.add(m["frame_id"])
            elif m["type"] == "frame_dropped":
                dropped.append(m["frame_id"])
                done.add(m["frame_id"])
        assert n - 1 in results, "the newest frame must always be processed"
        assert results == sorted(results)
        assert len(results) + len(dropped) == n


def test_ws_reconnect_resumes_session(client):
    with client.websocket_connect("/ws/inference") as ws:
        sid = hello(ws)["session_id"]
        ws.send_json(frame_payload(1, regions=("lips",)))
        recv_until(ws, {"inference_result"})
    with client.websocket_connect("/ws/inference") as ws:
        assert hello(ws, sid=sid)["session_id"] == sid
        ws.send_json(frame_payload(2, regions=("lips",)))
        r = recv_until(ws, {"inference_result"})
        (o,) = [o for o in r["observations"]["observations"] if o["model_id"] == "lip_dryness"]
        assert o["frames_aggregated"] == 2  # history from before the reconnect survived


def test_ws_explain(client):
    with client.websocket_connect("/ws/inference") as ws:
        hello(ws)
        from tests.conftest import data_url

        ws.send_json({"type": "explain", "request_id": "x1", "model_id": "lip_dryness", "region": "lips", "image_b64": data_url(textured())})
        m = recv_until(ws, {"explanation", "error"})
        assert m["type"] == "explanation" and m["request_id"] == "x1"
        ws.send_json({"type": "explain", "request_id": "x2", "model_id": "nasal_redness", "region": "nose", "image_b64": data_url(textured())})
        m = recv_until(ws, {"explanation", "error"})
        assert m["type"] == "error" and m["request_id"] == "x2"


def _image_and_landmarks(seed=0, brightness=0):
    rng = np.random.default_rng(seed)
    img = np.clip(rng.normal(150 + brightness, 30, (480, 640, 3)), 0, 255).astype(np.uint8)
    from tests.conftest import data_url

    return data_url(img), synthetic_landmarks(scale=0.5).tolist()


def test_full_pipeline_image_to_chat(client):
    """Integration: image + landmarks → server crops → CV models → observations → grounded chat."""
    img, lm = _image_and_landmarks()
    sid = client.post("/api/sessions").json()["session_id"]
    for _ in range(3):
        r = client.post("/api/inference/image", json={"session_id": sid, "image_b64": img, "landmarks": lm, "consent_upload": True})
        assert r.status_code == 200, r.text
    body = r.json()
    assert {p["region"] for p in body["predictions"]} >= {"lips", "left_eye", "right_eye", "nose"}
    stages = {e["stage"] for e in body["events"]}
    assert {"image_quality", "preprocessing", "cv_inference", "structured_observations"} <= stages
    chat = client.post("/api/chat", json={"session_id": sid, "messages": [{"role": "user", "content": "How do my lips look?"}]})
    assert chat.status_code == 200
    tr = chat.json()["trace"]
    assert tr["evidence"]["observations"], "server-held observations must be used"
    assert all(c["passed"] for c in tr["validation"])
    assert client.delete(f"/api/sessions/{sid}").json()["deleted_session_state"] is True


def test_image_inference_requires_consent(client):
    img, lm = _image_and_landmarks()
    assert client.post("/api/inference/image", json={"image_b64": img, "landmarks": lm, "consent_upload": False}).status_code == 403
    assert client.post("/api/inference/image", json={"image_b64": img, "landmarks": [[0, 0]], "consent_upload": True}).status_code == 422


def test_history_consent_compare_and_delete(client, services):
    hid = "hist-12345678"
    img, lm = _image_and_landmarks(0)
    base = {"history_id": hid, "landmarks": lm, "consent_text_version": "v1"}
    assert client.post("/api/history/snapshots", json={**base, "image_b64": img, "consent_store_images": False}).status_code == 403
    assert not (services.settings.data_dir / "history" / hid).exists()
    a = client.post("/api/history/snapshots", json={**base, "image_b64": img, "consent_store_images": True}).json()
    img2, _ = _image_and_landmarks(1, brightness=40)
    b = client.post("/api/history/snapshots", json={**base, "image_b64": img2, "consent_store_images": True}).json()
    snaps = client.get(f"/api/history/{hid}/snapshots").json()
    assert [s["snapshot_id"] for s in snaps] == [a["snapshot_id"], b["snapshot_id"]]
    cmp = client.get(f"/api/history/{hid}/compare", params={"before": a["snapshot_id"], "after": b["snapshot_id"]}).json()
    assert cmp["regions"] and all(r["diff_b64"].startswith("data:image/png") for r in cmp["regions"])
    assert any("not evidence of medical" in c for c in cmp["caveats"])
    rep = client.delete(f"/api/history/{hid}").json()
    assert rep["deleted_snapshots"] == 2 and rep["deleted_files"] > 0
    assert client.get(f"/api/history/{hid}/snapshots").json() == []
    assert not (services.settings.data_dir / "history" / hid).exists()


def test_no_image_content_in_logs(client, caplog):
    caplog.set_level(logging.DEBUG)
    img, lm = _image_and_landmarks()
    client.post("/api/inference/image", json={"image_b64": img, "landmarks": lm, "consent_upload": True})
    client.post("/api/chat", json={"session_id": "abcdefgh1", "messages": [{"role": "user", "content": "my email is x@y.com"}]})
    text = caplog.text
    assert "base64," not in text and img[30:80] not in text and "x@y.com" not in text


def test_health_and_privacy(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and h["llm_provider"] == "offline-template"
    assert "never used for training" in client.get("/api/privacy").json()["training_use"]
