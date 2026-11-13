import { describe, expect, it } from "vitest";
import { isBenignMediapipeLog } from "@/lib/landmarker";

describe("isBenignMediapipeLog", () => {
  it("drops MediaPipe informational lines", () => {
    expect(isBenignMediapipeLog(["INFO: Created TensorFlow Lite XNNPACK delegate for CPU."])).toBe(true);
    expect(isBenignMediapipeLog(["I1113 00:08:54.094000 2136208 gl_context.cc:1118] OpenGL error checking is disabled"])).toBe(true);
  });
  it("keeps real errors", () => {
    expect(isBenignMediapipeLog(["E1113 00:08:54.094000 1 graph.cc:1] Failed to load model"])).toBe(false);
    expect(isBenignMediapipeLog(["TypeError: x is undefined"])).toBe(false);
    expect(isBenignMediapipeLog([new Error("INFO: not a string")])).toBe(false);
  });
});
