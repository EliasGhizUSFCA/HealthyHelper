import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, InferenceSocket } from "@/lib/ws";
import type { ClientFrame } from "@/lib/protocol";

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  recv(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) } as MessageEvent);
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

const ack = (session_id: string) => ({ type: "hello_ack", session_id, protocol_version: "1.0.0", models: [], server_time: 0, max_queue: 1 });
const frame = (id: number): ClientFrame => ({
  type: "frame",
  frame_id: id,
  captured_at: 0,
  quality: { status: "acceptable", issues: [], metrics: {} },
  regions: [],
  client_events: [],
  options: {},
});

describe("backoffDelay", () => {
  it("grows exponentially, caps at max, and jitters within [50%,100%]", () => {
    expect(backoffDelay(0, 500, 8000, () => 1)).toBe(500);
    expect(backoffDelay(0, 500, 8000, () => 0)).toBe(250);
    expect(backoffDelay(3, 500, 8000, () => 1)).toBe(4000);
    expect(backoffDelay(10, 500, 8000, () => 1)).toBe(8000);
    expect(backoffDelay(10, 500, 8000, () => 0)).toBe(4000);
  });
});

describe("InferenceSocket", () => {
  beforeEach(() => {
    FakeWS.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const make = (consent = true) =>
    new InferenceSocket({ url: "ws://x/ws/inference", consent, WebSocketImpl: FakeWS as never, random: () => 1, pingIntervalMs: 5000, creditTimeoutMs: 3000, now: () => 1000 });

  it("sends hello on open and becomes ready after hello_ack", () => {
    const s = make();
    s.connect();
    const ws = FakeWS.instances[0];
    ws.open();
    expect(ws.sent[0]).toMatchObject({ type: "hello", consent_upload_crops: true, session_id: null });
    expect(s.ready).toBe(false);
    ws.recv(ack("sess-1"));
    expect(s.ready).toBe(true);
    expect(s.stats.status).toBe("open");
    expect(ws.sent.some((m) => m.type === "ping")).toBe(true);
  });

  it("reconnects with backoff and resends the previous session id", () => {
    const s = make();
    s.connect();
    FakeWS.instances[0].open();
    FakeWS.instances[0].recv(ack("sess-1"));
    FakeWS.instances[0].drop();
    expect(s.stats.status).toBe("reconnecting");
    expect(s.stats.nextRetryInMs).toBe(500);
    vi.advanceTimersByTime(499);
    expect(FakeWS.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWS.instances).toHaveLength(2);
    // second failure before ack -> longer delay
    FakeWS.instances[1].drop();
    expect(s.stats.nextRetryInMs).toBe(1000);
    vi.advanceTimersByTime(1000);
    const ws3 = FakeWS.instances[2];
    ws3.open();
    expect(ws3.sent[0]).toMatchObject({ type: "hello", session_id: "sess-1" });
    ws3.recv(ack("sess-1"));
    // backoff resets after a successful handshake
    ws3.drop();
    expect(s.stats.nextRetryInMs).toBe(500);
    s.close();
  });

  it("does not reconnect after close()", () => {
    const s = make();
    s.connect();
    FakeWS.instances[0].open();
    s.close();
    vi.advanceTimersByTime(20000);
    expect(FakeWS.instances).toHaveLength(1);
    expect(s.stats.status).toBe("closed");
  });

  it("keeps one frame in flight; latest pending frame wins", () => {
    const s = make();
    s.connect();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv(ack("a"));
    expect(s.offerFrame(frame(1))).toBe("sent");
    expect(s.offerFrame(frame(2))).toBe("queued");
    expect(s.offerFrame(frame(3))).toBe("queued");
    expect(s.stats.framesSupersededLocally).toBe(1);
    const frames = () => ws.sent.filter((m) => m.type === "frame").map((m) => m.frame_id);
    expect(frames()).toEqual([1]);
    ws.recv({ type: "inference_result", frame_id: 1 });
    expect(frames()).toEqual([1, 3]);
    ws.recv({ type: "frame_dropped", frame_id: 3, reason: "superseded" });
    expect(s.stats.inFlightFrameId).toBeNull();
  });

  it("releases credit after a timeout", () => {
    const s = make();
    s.connect();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv(ack("a"));
    s.offerFrame(frame(1));
    vi.advanceTimersByTime(3000);
    expect(s.stats.creditTimeouts).toBe(1);
    expect(s.offerFrame(frame(2))).toBe("sent");
  });

  it("rejects frames without consent and re-handshakes when consent changes", () => {
    const s = make(false);
    s.connect();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv(ack("a"));
    expect(s.offerFrame(frame(1))).toBe("rejected");
    s.setConsent(true);
    expect(ws.sent.filter((m) => m.type === "hello").at(-1)).toMatchObject({ consent_upload_crops: true, session_id: "a" });
    expect(s.offerFrame(frame(2))).toBe("sent");
  });

  it("computes RTT from pong", () => {
    let now = 1000;
    const s = new InferenceSocket({ url: "ws://x", consent: true, WebSocketImpl: FakeWS as never, now: () => now });
    s.connect();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv(ack("a"));
    now = 1042;
    ws.recv({ type: "pong", t: 1000, server_time: 5000 });
    expect(s.stats.rttMs).toBe(42);
  });
});
