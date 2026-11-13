import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { describeObservation } from "@/components/Mirror/ObservationCards";
import { HeatmapViewer } from "@/components/HeatmapViewer/HeatmapViewer";
import type { Observation } from "@/lib/protocol";

const base: Observation = { region: "lips", feature: "visible_dryness", confidence: 0.8, status: "accepted", present: true, model_id: "m", model_version: "1", model_tier: "demo", frames_aggregated: 5 };

describe("describeObservation", () => {
  it("never phrases accepted findings as diagnoses", () => {
    const d = describeObservation(base);
    expect(d.tone).toBe("seen");
    expect(d.headline.toLowerCase()).toContain("may show");
    for (const s of [d.headline, d.detail]) expect(s.toLowerCase()).not.toMatch(/you (are|have) |dehydrat|diagnos/);
  });
  it("maps each status to plain language", () => {
    expect(describeObservation({ ...base, present: false }).tone).toBe("clear");
    expect(describeObservation({ ...base, status: "inconclusive" }).headline).toMatch(/can't tell/i);
    expect(describeObservation({ ...base, status: "abstained" }).headline).toMatch(/not analysed/i);
    expect(describeObservation({ ...base, status: "unavailable" }).headline).toMatch(/not available/i);
  });
});

describe("HeatmapViewer", () => {
  it("labels attribution as approximate and hides heatmap when toggled off", () => {
    const { rerender } = render(<HeatmapViewer input="data:image/png;base64,AA" heatmap="data:image/png;base64,BB" opacity={0.4} show label="lips" />);
    expect(screen.getByText(/approximate attribution/i)).toBeInTheDocument();
    expect(screen.getByAltText("lips Grad-CAM heatmap")).toHaveStyle({ opacity: "0.4" });
    rerender(<HeatmapViewer input="data:image/png;base64,AA" heatmap="data:image/png;base64,BB" opacity={0.4} show={false} label="lips" />);
    expect(screen.queryByAltText("lips Grad-CAM heatmap")).toBeNull();
  });
});
