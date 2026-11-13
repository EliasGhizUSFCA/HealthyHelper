import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFS, loadPrefs, normalise, savePrefs } from "@/lib/mirrorPrefs";

describe("mirror prefs", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to analysis + age on (the start button states this)", () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toEqual({ analysis: true, age: true });
  });
  it("remembers a user's opt-out", () => {
    savePrefs({ analysis: true, age: false });
    expect(loadPrefs()).toEqual({ analysis: true, age: false });
  });
  it("age can never be on without analysis", () => {
    expect(normalise({ analysis: false, age: true })).toEqual({ analysis: false, age: false });
  });
  it("survives corrupt storage", () => {
    localStorage.setItem("ahm.mirror_prefs", "{not json");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});
