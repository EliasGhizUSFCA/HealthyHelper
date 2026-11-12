/**
 * TypeScript mirror of backend/app/schemas/protocol.py.
 * Keep in sync — `shared/schemas/protocol.schema.json` is the generated reference
 * and `backend/tests/test_schema_contract.py` checks the field sets below
 * (PROTOCOL_FIELDS) against the Pydantic models.
 *
 * Timestamps: epoch milliseconds. BBoxes: [x, y, w, h] normalised to the frame.
 */

export const PROTOCOL_VERSION = "1.0.0";

export type RegionName =
  | "lips"
  | "left_eye"
  | "right_eye"
  | "nose"
  | "skin_forehead"
  | "skin_left_cheek"
  | "skin_right_cheek";

export const PIPELINE_ORDER = [
  "camera_capture",
  "image_quality",
  "face_detection",
  "landmark_extraction",
  "region_cropping",
  "preprocessing",
  "cv_inference",
  "structured_observations",
  "llm_request",
  "response_validation",
  "ui_render",
] as const;
export type PipelineStage = (typeof PIPELINE_ORDER)[number];

export type StageStatus = "ok" | "warning" | "error" | "skipped";
export type ModelTier = "demo" | "validated" | "unavailable";
export type Decision = "accepted" | "inconclusive" | "abstained" | "unavailable";
export type QualityStatus = "acceptable" | "poor" | "unusable";

export interface TelemetryEvent {
  session_id: string;
  frame_id: number;
  stage: PipelineStage;
  status: StageStatus;
  origin: "client" | "server";
  started_at: number;
  duration_ms: number;
  input_type: string;
  output_type: string;
  model_id?: string | null;
  model_version?: string | null;
  message?: string | null;
  seq: number;
}

export interface QualityMetrics {
  brightness?: number | null;
  contrast?: number | null;
  sharpness?: number | null;
  face_area_fraction?: number | null;
  yaw_deg?: number | null;
  pitch_deg?: number | null;
  face_count?: number | null;
}

export interface ImageQuality {
  status: QualityStatus;
  issues: string[];
  metrics: QualityMetrics;
}

export interface ModelInfo {
  model_id: string;
  version: string;
  tier: ModelTier;
  feature: string;
  regions: RegionName[];
  classes: string[];
  positive_class: string;
  input_size: number;
  normalization: { mean: number[]; std: number[] };
  backbone: string;
  runtime: "torch" | "onnx" | "none";
  default_threshold: number;
  explainable: boolean;
  status_message: string;
  training_summary: Record<string, unknown>;
  metrics: Record<string, unknown>;
}

export interface TensorStats {
  shape: number[];
  dtype: string;
  channel_mean: number[];
  channel_std: number[];
  min: number;
  max: number;
}

export interface ModelInput {
  raw_size: [number, number];
  raw_preview_b64?: string | null;
  tensor_preview_b64?: string | null;
  tensor: TensorStats;
  transforms: string[];
}

export interface Prediction {
  model_id: string;
  model_version: string;
  model_tier: ModelTier;
  region: RegionName;
  feature: string;
  classes: string[];
  probabilities: number[];
  top_class: string | null;
  top_probability: number | null;
  positive_probability: number | null;
  threshold: number;
  decision: Decision;
  decision_reason: string;
  latency_ms: number;
  input?: ModelInput | null;
}

export interface Observation {
  region: RegionName;
  feature: string;
  confidence: number | null;
  status: "accepted" | "inconclusive" | "abstained" | "unavailable";
  present: boolean | null;
  model_id: string;
  model_version: string;
  model_tier: ModelTier;
  frames_aggregated: number;
}

export interface StructuredObservations {
  image_quality: QualityStatus;
  quality_issues: string[];
  observations: Observation[];
  user_reported_symptoms: string[];
  medical_diagnosis_requested: boolean;
  demo_mode: boolean;
  generated_at: number;
}

export interface RegionCrop {
  region: RegionName;
  bbox: [number, number, number, number];
  image_b64: string;
}

export interface FrameOptions {
  return_inputs?: boolean;
  thresholds?: Record<string, number>;
  enabled_models?: string[] | null;
}

// ---- client -> server ----
export interface ClientHello {
  type: "hello";
  session_id?: string | null;
  protocol_version: string;
  consent_upload_crops: boolean;
}
export interface ClientFrame {
  type: "frame";
  frame_id: number;
  captured_at: number;
  quality: ImageQuality;
  regions: RegionCrop[];
  client_events: TelemetryEvent[];
  options: FrameOptions;
}
export interface ClientExplain {
  type: "explain";
  request_id: string;
  model_id: string;
  region: RegionName;
  image_b64: string;
  target_class?: string | null;
}
export interface ClientPing {
  type: "ping";
  t: number;
}
export type ClientMessage = ClientHello | ClientFrame | ClientExplain | ClientPing;

// ---- server -> client ----
export interface ServerHelloAck {
  type: "hello_ack";
  session_id: string;
  protocol_version: string;
  models: ModelInfo[];
  server_time: number;
  max_queue: number;
}
export interface InferenceResult {
  type: "inference_result";
  session_id: string;
  frame_id: number;
  captured_at: number;
  received_at: number;
  completed_at: number;
  queue_wait_ms: number;
  image_quality: ImageQuality;
  predictions: Prediction[];
  observations: StructuredObservations;
  events: TelemetryEvent[];
}
export interface FrameDropped {
  type: "frame_dropped";
  frame_id: number;
  reason: "superseded" | "queue_full" | "invalid" | "no_consent";
}
export interface Explanation {
  type: "explanation";
  request_id: string;
  model_id: string;
  model_version: string;
  region: RegionName;
  method: string;
  target_class: string;
  target_probability: number;
  input_b64: string;
  heatmap_b64: string;
  latency_ms: number;
  caveat: string;
}
export interface ServerMetrics {
  type: "server_metrics";
  t: number;
  cpu_percent: number | null;
  rss_mb: number | null;
  frames_received: number;
  frames_processed: number;
  frames_dropped: number;
  frames_rejected: number;
  queue_depth: number;
  device: string;
}
export interface ServerPong {
  type: "pong";
  t: number;
  server_time: number;
}
export interface ServerError {
  type: "error";
  code: string;
  message: string;
  request_id?: string | null;
}
export type ServerMessage =
  | ServerHelloAck
  | InferenceResult
  | FrameDropped
  | Explanation
  | ServerMetrics
  | ServerPong
  | ServerError;

// ---- chat ----
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface ChatRequest {
  session_id: string;
  messages: ChatMessage[];
  user_reported_symptoms: string[];
  observations?: StructuredObservations | null;
}
export interface AssistantReply {
  message: string;
  follow_up_questions: string[];
  referenced_observations: string[];
  evidence_sufficient: boolean;
  suggests_professional: boolean;
}
export interface TraceStep {
  name: string;
  status: StageStatus;
  duration_ms: number;
  detail: Record<string, unknown>;
}
export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail: string;
}
export interface RetrievedDoc {
  doc_id: string;
  title: string;
  score: number;
  review_status: string;
}
export interface AgentTrace {
  provider: string;
  model: string;
  route: "standard" | "urgent_safety" | "diagnosis_request" | "insufficient_evidence" | "fallback";
  steps: TraceStep[];
  evidence: StructuredObservations | null;
  selected_evidence: string[];
  retrieval: RetrievedDoc[];
  context_preview: string;
  validation: ValidationCheck[];
  attempts: number;
  latency_ms: number;
  usage: Record<string, number>;
}
export interface ChatResponse {
  reply: AssistantReply;
  trace: AgentTrace;
  events: TelemetryEvent[];
}

// ---- sessions / longitudinal ----
export interface SessionCreated {
  session_id: string;
  created_at: number;
}
export interface DeletionReport {
  deleted_snapshots: number;
  deleted_files: number;
  deleted_session_state: boolean;
}
export interface SnapshotCreate {
  history_id: string;
  image_b64: string;
  landmarks: number[][];
  consent_store_images: boolean;
  consent_text_version: string;
  session_id?: string | null;
}
export interface SnapshotSummary {
  snapshot_id: string;
  history_id: string;
  created_at: number;
  quality: ImageQuality;
  lighting: Record<string, number>;
  observations: Observation[];
  regions: RegionName[];
}
export interface RegionComparison {
  region: RegionName;
  before_b64: string;
  after_b64: string;
  diff_b64: string;
  mean_abs_diff: number;
  lighting_delta: number;
  lighting_comparable: boolean;
  before_observation: Observation | null;
  after_observation: Observation | null;
}
export interface ComparisonResult {
  before: SnapshotSummary;
  after: SnapshotSummary;
  regions: RegionComparison[];
  caveats: string[];
}

/** Field names per message, verified against Pydantic by the backend contract test. */
export const PROTOCOL_FIELDS: Record<string, string[]> = {
  TelemetryEvent: ["session_id", "frame_id", "stage", "status", "origin", "started_at", "duration_ms", "input_type", "output_type", "model_id", "model_version", "message", "seq"],
  Prediction: ["model_id", "model_version", "model_tier", "region", "feature", "classes", "probabilities", "top_class", "top_probability", "positive_probability", "threshold", "decision", "decision_reason", "latency_ms", "input"],
  Observation: ["region", "feature", "confidence", "status", "present", "model_id", "model_version", "model_tier", "frames_aggregated"],
  StructuredObservations: ["image_quality", "quality_issues", "observations", "user_reported_symptoms", "medical_diagnosis_requested", "demo_mode", "generated_at"],
  ClientFrame: ["type", "frame_id", "captured_at", "quality", "regions", "client_events", "options"],
  InferenceResult: ["type", "session_id", "frame_id", "captured_at", "received_at", "completed_at", "queue_wait_ms", "image_quality", "predictions", "observations", "events"],
  Explanation: ["type", "request_id", "model_id", "model_version", "region", "method", "target_class", "target_probability", "input_b64", "heatmap_b64", "latency_ms", "caveat"],
  ServerMetrics: ["type", "t", "cpu_percent", "rss_mb", "frames_received", "frames_processed", "frames_dropped", "frames_rejected", "queue_depth", "device"],
  ModelInfo: ["model_id", "version", "tier", "feature", "regions", "classes", "positive_class", "input_size", "normalization", "backbone", "runtime", "default_threshold", "explainable", "status_message", "training_summary", "metrics"],
  AgentTrace: ["provider", "model", "route", "steps", "evidence", "selected_evidence", "retrieval", "context_preview", "validation", "attempts", "latency_ms", "usage"],
  AssistantReply: ["message", "follow_up_questions", "referenced_observations", "evidence_sufficient", "suggests_professional"],
};
