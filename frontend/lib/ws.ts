import {
  PROTOCOL_VERSION,
  type ClientExplain,
  type ClientFrame,
  type ClientMessage,
  type ServerMessage,
} from "./protocol";

export type SocketStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface SocketStats {
  status: SocketStatus;
  sessionId: string | null;
  rttMs: number | null;
  reconnects: number;
  framesSent: number;
  framesSupersededLocally: number;
  creditTimeouts: number;
  inFlightFrameId: number | null;
  lastError: string | null;
  nextRetryInMs: number | null;
}

type WSLike = Pick<WebSocket, "send" | "close" | "readyState"> & {
  onopen: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
};

export interface InferenceSocketOptions {
  url: string;
  consent: boolean;
  WebSocketImpl?: new (url: string) => WSLike;
  random?: () => number;
  pingIntervalMs?: number;
  creditTimeoutMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
}

const OPEN = 1;

/** Exponential backoff with jitter in [50%, 100%] of the capped exponential delay. */
export function backoffDelay(attempt: number, min = 500, max = 8000, random: () => number = Math.random): number {
  const base = Math.min(max, min * 2 ** attempt);
  return Math.round(base * (0.5 + 0.5 * random()));
}

export function epochNow(): number {
  if (typeof performance !== "undefined" && performance.timeOrigin) return performance.timeOrigin + performance.now();
  return Date.now();
}

/**
 * WebSocket client for /ws/inference with:
 *  - hello/hello_ack handshake (session id preserved across reconnects)
 *  - credit-based flow control: at most one frame in flight; newer frames replace the pending one
 *  - jittered exponential reconnect, ping/RTT
 */
export class InferenceSocket {
  private ws: WSLike | null = null;
  private opts: Required<Omit<InferenceSocketOptions, "WebSocketImpl">> & { WebSocketImpl?: InferenceSocketOptions["WebSocketImpl"] };
  private listeners = new Set<(m: ServerMessage) => void>();
  private statusListeners = new Set<(s: SocketStats) => void>();
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private creditTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: ClientFrame | null = null;
  private handshakeDone = false;
  private stopped = true;
  stats: SocketStats = {
    status: "idle",
    sessionId: null,
    rttMs: null,
    reconnects: 0,
    framesSent: 0,
    framesSupersededLocally: 0,
    creditTimeouts: 0,
    inFlightFrameId: null,
    lastError: null,
    nextRetryInMs: null,
  };

  constructor(options: InferenceSocketOptions) {
    this.opts = {
      random: Math.random,
      pingIntervalMs: 5000,
      creditTimeoutMs: 3000,
      minBackoffMs: 500,
      maxBackoffMs: 8000,
      now: epochNow,
      ...options,
    };
  }

  get consent() {
    return this.opts.consent;
  }

  onMessage(fn: (m: ServerMessage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: (s: SocketStats) => void) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private update(p: Partial<SocketStats>) {
    this.stats = { ...this.stats, ...p };
    for (const l of this.statusListeners) l(this.stats);
  }

  connect() {
    this.stopped = false;
    this.open();
  }

  private open() {
    if (this.stopped) return;
    const Impl = this.opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as new (url: string) => WSLike);
    this.update({ status: this.stats.reconnects > 0 || this.attempt > 0 ? "reconnecting" : "connecting", nextRetryInMs: null });
    let ws: WSLike;
    try {
      ws = new Impl(this.opts.url);
    } catch (e) {
      this.update({ lastError: String(e) });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.handshakeDone = false;
    ws.onopen = () => {
      this.sendRaw({
        type: "hello",
        session_id: this.stats.sessionId,
        protocol_version: PROTOCOL_VERSION,
        consent_upload_crops: this.opts.consent,
      });
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onerror = () => this.update({ lastError: "WebSocket error" });
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.handshakeDone = false;
      this.clearTimers();
      this.update({ inFlightFrameId: null });
      if (!this.stopped) this.scheduleReconnect();
      else this.update({ status: "closed" });
    };
  }

  private scheduleReconnect() {
    const delay = backoffDelay(this.attempt, this.opts.minBackoffMs, this.opts.maxBackoffMs, this.opts.random);
    this.attempt += 1;
    this.update({ status: "reconnecting", nextRetryInMs: delay, reconnects: this.stats.reconnects + 1 });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.creditTimer) clearTimeout(this.creditTimer);
    this.pingTimer = null;
    this.creditTimer = null;
  }

  close() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearTimers();
    this.pending = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    this.update({ status: "closed", inFlightFrameId: null, nextRetryInMs: null });
  }

  setConsent(consent: boolean) {
    if (consent === this.opts.consent) return;
    this.opts.consent = consent;
    if (!consent) this.pending = null;
    if (this.ws && this.ws.readyState === OPEN) {
      this.sendRaw({ type: "hello", session_id: this.stats.sessionId, protocol_version: PROTOCOL_VERSION, consent_upload_crops: consent });
    }
  }

  get ready() {
    return !!this.ws && this.ws.readyState === OPEN && this.handshakeDone;
  }

  private sendRaw(m: ClientMessage) {
    if (!this.ws || this.ws.readyState !== OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  /**
   * Offer a frame. If nothing is in flight it is sent immediately; otherwise it replaces any
   * pending frame (latest wins). Returns "sent" | "queued" | "rejected".
   */
  offerFrame(frame: ClientFrame): "sent" | "queued" | "rejected" {
    if (!this.opts.consent || !this.ready) return "rejected";
    if (this.stats.inFlightFrameId == null) {
      this.dispatch(frame);
      return "sent";
    }
    if (this.pending) this.update({ framesSupersededLocally: this.stats.framesSupersededLocally + 1 });
    this.pending = frame;
    return "queued";
  }

  private dispatch(frame: ClientFrame) {
    if (!this.sendRaw(frame)) return;
    this.update({ inFlightFrameId: frame.frame_id, framesSent: this.stats.framesSent + 1 });
    if (this.creditTimer) clearTimeout(this.creditTimer);
    this.creditTimer = setTimeout(() => {
      this.update({ creditTimeouts: this.stats.creditTimeouts + 1 });
      this.releaseCredit();
    }, this.opts.creditTimeoutMs);
  }

  private releaseCredit() {
    if (this.creditTimer) clearTimeout(this.creditTimer);
    this.creditTimer = null;
    this.update({ inFlightFrameId: null });
    const next = this.pending;
    this.pending = null;
    if (next && this.ready && this.opts.consent) this.dispatch(next);
  }

  sendExplain(req: ClientExplain) {
    return this.sendRaw(req);
  }

  ping() {
    return this.sendRaw({ type: "ping", t: this.opts.now() });
  }

  private handleMessage(raw: unknown) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      this.update({ lastError: "Malformed server message" });
      return;
    }
    switch (msg.type) {
      case "hello_ack":
        this.handshakeDone = true;
        this.attempt = 0;
        this.update({ status: "open", sessionId: msg.session_id, lastError: null, nextRetryInMs: null });
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.ping(), this.opts.pingIntervalMs);
        this.ping();
        break;
      case "pong":
        this.update({ rttMs: this.opts.now() - msg.t });
        break;
      case "inference_result":
      case "frame_dropped":
        if (this.stats.inFlightFrameId != null && msg.frame_id >= this.stats.inFlightFrameId) this.releaseCredit();
        break;
      case "error":
        this.update({ lastError: `${msg.code}: ${msg.message}` });
        break;
    }
    for (const l of this.listeners) l(msg);
  }
}
