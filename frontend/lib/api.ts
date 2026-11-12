import { API_URL } from "./config";
import type {
  ChatRequest,
  ChatResponse,
  ComparisonResult,
  DeletionReport,
  ModelInfo,
  SnapshotCreate,
  SnapshotSummary,
} from "./protocol";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, `Cannot reach the analysis server at ${API_URL}. Is the backend running?`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => req<{ status: string; protocol_version: string; models_loaded: number; llm_provider: string }>("/api/health"),
  models: () => req<ModelInfo[]>("/api/models"),
  chat: (body: ChatRequest) => req<ChatResponse>("/api/chat", { method: "POST", body: JSON.stringify(body) }),
  deleteSession: (id: string) => req<DeletionReport>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createSnapshot: (body: SnapshotCreate) =>
    req<SnapshotSummary>("/api/history/snapshots", { method: "POST", body: JSON.stringify(body) }),
  listSnapshots: (historyId: string) => req<SnapshotSummary[]>(`/api/history/${encodeURIComponent(historyId)}/snapshots`),
  compare: (historyId: string, before: string, after: string) =>
    req<ComparisonResult>(
      `/api/history/${encodeURIComponent(historyId)}/compare?before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`,
    ),
  deleteHistory: (historyId: string) =>
    req<DeletionReport>(`/api/history/${encodeURIComponent(historyId)}`, { method: "DELETE" }),
  privacy: () => req<Record<string, unknown>>("/api/privacy"),
};

const HISTORY_KEY = "ahm.history_id";

/** Pseudonymous id for consented longitudinal history; lives only in this browser. */
export function getHistoryId(create = true): string | null {
  try {
    let id = localStorage.getItem(HISTORY_KEY);
    if (!id && create) {
      id = crypto.randomUUID();
      localStorage.setItem(HISTORY_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function forgetHistoryId() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}
