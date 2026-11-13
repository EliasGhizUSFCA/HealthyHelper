import { describe, expect, it } from "vitest";
import { chipRequest, chipsFromObservations, QUICK_CHIPS } from "@/lib/suggest";
import type { Observation } from "@/lib/protocol";

const o = (region: Observation["region"], feature: string, status: Observation["status"] = "accepted", present: boolean | null = true): Observation => ({
  region, feature, status, present, confidence: 0.9, model_id: "m", model_version: "v", model_tier: "demo", frames_aggregated: 5,
});

describe("chipsFromObservations", () => {
  it("only accepted, present observations become suggestions, deduplicated by concern", () => {
    const chips = chipsFromObservations([
      o("lips", "visible_dryness"),
      o("skin_left_cheek", "visible_redness"),
      o("skin_right_cheek", "visible_redness"),
      o("skin_chin", "visible_blemishes", "inconclusive", null),
      o("nose", "visible_flaking", "accepted", false),
    ]);
    expect(chips.map((c) => c.concern)).toEqual(["dry_lips", "visible_redness"]);
    expect(chips[0].fromObservation).toBe("lips:visible_dryness");
  });
  it("never suggests products for under-eye darkness or eye redness", () => {
    expect(chipsFromObservations([o("left_undereye", "visible_darkness"), o("left_eye", "visible_redness")])).toEqual([]);
  });
  it("labels are neutral (no appearance judgements)", () => {
    for (const c of [...QUICK_CHIPS, ...chipsFromObservations([o("lips", "visible_dryness"), o("skin_chin", "visible_blemishes")])]) {
      expect(c.label.toLowerCase()).not.toMatch(/fix|hide|flaw|problem|bad/);
    }
  });
});

describe("chipRequest", () => {
  it("includes the observation only for observation chips and passes preferences", () => {
    const [chip] = chipsFromObservations([o("lips", "visible_dryness")]);
    expect(chipRequest(chip, { fragranceFree: true, budget: 20 })).toMatchObject({
      mode: "skincare", concern: "dry_lips", include_observations: ["lips:visible_dryness"], fragrance_free: true, budget_max: 20,
    });
    expect(chipRequest(QUICK_CHIPS[0], { fragranceFree: false, budget: null }).include_observations).toEqual([]);
  });
});
