import { describe, expect, it } from "vitest";
import { readiness } from "@/components/Dataset/LabelApp";
import { describeObservation } from "@/components/Mirror/ObservationCards";
import type { DatasetModelStats, Observation } from "@/lib/protocol";

const stats = (p: Partial<DatasetModelStats>): DatasetModelStats => ({
  model_id: "skin_blemishes", feature: "visible_blemishes", regions: ["skin_chin"], samples: 0, labelled: 0, usable: 0, positive: 0, negative: 0,
  excluded_cannot_judge_or_tie: 0, subjects: 0, sessions: 0, annotators: [], agreement_pairs: [], mean_kappa: null, ...p,
});

describe("readiness", () => {
  it("mirrors the backend training minimums and validation gate", () => {
    const r = readiness(stats({ positive: 12, negative: 9, subjects: 1 }));
    expect(r.map((x) => x.ok)).toEqual([false, false, false, false]);
    const ok = readiness(stats({ positive: 400, negative: 400, subjects: 120, mean_kappa: 0.72 }));
    expect(ok.every((x) => x.ok)).toBe(true);
  });
});

describe("describeObservation (new features)", () => {
  const base: Observation = { region: "skin_chin", feature: "visible_blemishes", confidence: 0.9, status: "accepted", present: true,
    model_id: "skin_blemishes", model_version: "x", model_tier: "experimental", frames_aggregated: 5 };
  it("describes appearance, never a condition", () => {
    const d = describeObservation(base);
    expect(d.headline).toBe("Your chin may show spots or blemishes");
    expect(d.headline.toLowerCase()).not.toContain("acne");
  });
  it("uses a natural phrase for under-eye regions", () => {
    const d = describeObservation({ ...base, region: "left_undereye", feature: "visible_darkness", model_id: "undereye_darkness" });
    expect(d.headline).toBe("The area under your left eye may show darker-looking skin");
  });
});
