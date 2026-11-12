import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCameraSupport, mapCameraError } from "@/lib/camera";

describe("mapCameraError", () => {
  it.each([
    ["NotAllowedError", "permission_denied"],
    ["PermissionDeniedError", "permission_denied"],
    ["SecurityError", "permission_denied"],
    ["NotFoundError", "no_camera"],
    ["NotReadableError", "camera_busy"],
    ["OverconstrainedError", "constraints"],
    ["AbortError", "aborted"],
    ["InsecureContextError", "insecure_context"],
    ["SomethingElse", "unknown"],
  ])("%s -> %s", (name, kind) => {
    const e = mapCameraError(Object.assign(new Error("x"), { name }));
    expect(e.kind).toBe(kind);
    expect(e.message.length).toBeGreaterThan(10);
  });
  it("handles non-error values", () => {
    expect(mapCameraError(null).kind).toBe("unknown");
    expect(mapCameraError("boom").kind).toBe("unknown");
  });
});

describe("checkCameraSupport", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("rejects insecure contexts", () => {
    vi.stubGlobal("isSecureContext", false);
    expect(checkCameraSupport()?.kind).toBe("insecure_context");
  });
  it("rejects missing mediaDevices", () => {
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    expect(checkCameraSupport()?.kind).toBe("unsupported");
  });
  it("passes when getUserMedia exists", () => {
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: () => Promise.resolve() }, configurable: true });
    expect(checkCameraSupport()).toBeNull();
  });
});
