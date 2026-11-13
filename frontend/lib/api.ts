import { API_URL } from "./config";
import type { CatalogCategory, CatalogProduct, CatalogStatus, RecommendationRequest, RecommendationResponse } from "./catalog";
import type {
  ChatRequest,
  ChatResponse,
  ComparisonResult,
  DatasetCapture,
  DatasetConsent,
  DatasetExport,
  DatasetLabel,
  DatasetModelStats,
  DatasetSample,
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
  // consented training-data collection
  datasetConsent: (body: DatasetConsent) => req<Record<string, unknown>>("/api/dataset/consent", { method: "POST", body: JSON.stringify(body) }),
  datasetAdd: (body: DatasetCapture) => req<DatasetSample[]>("/api/dataset/samples", { method: "POST", body: JSON.stringify(body) }),
  datasetSamples: (q: { model_id?: string; contributor_id?: string; limit?: number }) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    return req<DatasetSample[]>(`/api/dataset/samples?${p}`);
  },
  datasetImageUrl: (sampleId: string) => `${API_URL}/api/dataset/samples/${encodeURIComponent(sampleId)}/image`,
  datasetLabel: (sampleId: string, body: DatasetLabel) =>
    req<{ ok: boolean }>(`/api/dataset/samples/${encodeURIComponent(sampleId)}/labels`, { method: "PUT", body: JSON.stringify(body) }),
  datasetDeleteSample: (sampleId: string) => req<{ deleted: boolean }>(`/api/dataset/samples/${encodeURIComponent(sampleId)}`, { method: "DELETE" }),
  datasetWithdraw: (contributorId: string) =>
    req<DeletionReport>(`/api/dataset/contributors/${encodeURIComponent(contributorId)}`, { method: "DELETE" }),
  datasetStats: () => req<DatasetModelStats[]>("/api/dataset/stats"),
  datasetExport: (modelId: string) => req<DatasetExport>(`/api/dataset/export/${encodeURIComponent(modelId)}`, { method: "POST" }),
  // eCosmetics catalogue (local) + recommendations
  catalogStatus: () => req<CatalogStatus>("/api/catalog/status"),
  catalogCategories: () => req<CatalogCategory[]>("/api/catalog/categories"),
  catalogProducts: (q: { category?: string; mode?: string; brand?: string; q?: string; limit?: number } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]));
    return req<CatalogProduct[]>(`/api/catalog/products?${p}`);
  },
  catalogProduct: (id: string) =>
    req<{ product: CatalogProduct; price_history: Record<string, unknown>[] }>(`/api/catalog/products/${encodeURIComponent(id)}`),
  crawlLog: (devToken: string | null, limit = 200) =>
    req<{ entries: Record<string, unknown>[]; summary: Record<string, number> }>(`/api/catalog/crawl-log?limit=${limit}`, {
      headers: devToken ? { "X-Dev-Token": devToken } : {},
    }),
  catalogRefresh: (devToken: string | null, perCategory: number, categories?: string[]) =>
    req<{ started: boolean; running: boolean; note: string | null }>(
      `/api/catalog/refresh?per_category=${perCategory}${categories?.length ? `&categories=${encodeURIComponent(categories.join(","))}` : ""}`,
      { method: "POST", headers: devToken ? { "X-Dev-Token": devToken } : {} },
    ),
  refreshProgress: () => req<{ running: boolean; progress: Record<string, unknown> | null; last_result: Record<string, unknown> | null }>("/api/catalog/refresh/progress"),
  recommend: (body: RecommendationRequest) => req<RecommendationResponse>("/api/recommendations", { method: "POST", body: JSON.stringify(body) }),
};

function localId(key: string, prefix: string, create = true): string | null {
  try {
    let id = localStorage.getItem(key);
    if (!id && create) {
      id = `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return null;
  }
}
export const getContributorId = (create = true) => localId("ahm.contributor_id", "contrib", create);
export const getAnnotatorId = (create = true) => localId("ahm.annotator_id", "annot", create);
export function setAnnotatorId(id: string) {
  try {
    localStorage.setItem("ahm.annotator_id", id);
  } catch {
    /* ignore */
  }
}
export function forgetContributorId() {
  try {
    localStorage.removeItem("ahm.contributor_id");
    localStorage.removeItem("ahm.research_consent");
  } catch {
    /* ignore */
  }
}

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
