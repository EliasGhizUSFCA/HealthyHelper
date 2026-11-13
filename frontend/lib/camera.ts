export type CameraErrorKind =
  | "permission_denied"
  | "no_camera"
  | "camera_busy"
  | "insecure_context"
  | "unsupported"
  | "constraints"
  | "aborted"
  | "unknown";

export interface CameraError {
  kind: CameraErrorKind;
  message: string;
}

const MESSAGES: Record<CameraErrorKind, string> = {
  permission_denied:
    "Camera permission was denied. Allow camera access in your browser's site settings, then try again.",
  no_camera: "No camera was found. Connect a webcam and try again.",
  camera_busy: "The camera is in use by another application or could not be started. Close other apps using it and retry.",
  insecure_context: "Camera access requires a secure connection (HTTPS or localhost).",
  unsupported: "This browser does not support camera access (MediaDevices API unavailable).",
  constraints: "The camera does not support the requested resolution.",
  aborted: "Camera start was interrupted. Please try again.",
  unknown: "The camera could not be started.",
};

export function mapCameraError(err: unknown): CameraError {
  const name = (err as { name?: string } | null)?.name ?? "";
  let kind: CameraErrorKind = "unknown";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      kind = "permission_denied";
      break;
    case "NotFoundError":
    case "DevicesNotFoundError":
      kind = "no_camera";
      break;
    case "NotReadableError":
    case "TrackStartError":
      kind = "camera_busy";
      break;
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      kind = "constraints";
      break;
    case "AbortError":
      kind = "aborted";
      break;
    case "InsecureContextError":
      kind = "insecure_context";
      break;
    case "UnsupportedError":
      kind = "unsupported";
      break;
  }
  return { kind, message: MESSAGES[kind] };
}

export function checkCameraSupport(): CameraError | null {
  if (typeof window === "undefined") return { kind: "unsupported", message: MESSAGES.unsupported };
  if (window.isSecureContext === false) return { kind: "insecure_context", message: MESSAGES.insecure_context };
  if (!navigator.mediaDevices?.getUserMedia) return { kind: "unsupported", message: MESSAGES.unsupported };
  return null;
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const unsupported = checkCameraSupport();
  if (unsupported) throw Object.assign(new Error(unsupported.message), { name: unsupported.kind === "insecure_context" ? "InsecureContextError" : "UnsupportedError" });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user", frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}
