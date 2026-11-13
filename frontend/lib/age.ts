/**
 * Apparent-age helpers. Privacy rules enforced here (and unit-tested):
 *  - the whole-face crop is ONLY sent when the user enabled age estimation;
 *  - the estimate is never persisted; the confirmed range lives in memory only;
 *  - the confirmed range (never the estimate) is the only age sent to /api/recommendations.
 */
import type { RegionCrop, RegionName } from "./protocol";
import { CONFIRMABLE_AGE_RANGES } from "./catalog";

export type ConfirmableRange = (typeof CONFIRMABLE_AGE_RANGES)[number];

/** Drop the `face` crop unless the user opted in. */
export function filterRegionsForAge<T extends { region: RegionName }>(regions: T[], enableAge: boolean): T[] {
  return enableAge ? regions : regions.filter((r) => r.region !== "face");
}
export const gateFrameRegions = (regions: RegionCrop[], enableAge: boolean) => filterRegionsForAge(regions, enableAge);

export interface AgeState {
  enabled: boolean;
  /** none: nothing decided yet; confirmed/corrected: user-provided range; skipped: user declined to confirm */
  status: "none" | "confirmed" | "corrected" | "skipped";
  confirmedRange: ConfirmableRange | null;
}

export type AgeAction =
  | { type: "enable" }
  | { type: "disable" }
  | { type: "confirm"; range: ConfirmableRange }
  | { type: "correct"; range: ConfirmableRange }
  | { type: "skip" }
  | { type: "reset" };

export const INITIAL_AGE: AgeState = { enabled: false, status: "none", confirmedRange: null };

export function ageReducer(s: AgeState, a: AgeAction): AgeState {
  switch (a.type) {
    case "enable":
      return { ...s, enabled: true };
    case "disable":
      // Disabling turns estimation off AND forgets any confirmed range.
      return { ...INITIAL_AGE };
    case "confirm":
      return isConfirmable(a.range) ? { ...s, status: "confirmed", confirmedRange: a.range } : s;
    case "correct":
      return isConfirmable(a.range) ? { ...s, status: "corrected", confirmedRange: a.range } : s;
    case "skip":
      return { ...s, status: "skipped", confirmedRange: null };
    case "reset":
      return { ...s, status: "none", confirmedRange: null };
  }
}

export function isConfirmable(r: string): r is ConfirmableRange {
  return (CONFIRMABLE_AGE_RANGES as readonly string[]).includes(r);
}

/** The only age value ever attached to a recommendation request. */
export function ageForRecommendation(s: AgeState): string | null {
  return s.status === "confirmed" || s.status === "corrected" ? s.confirmedRange : null;
}

const MODEL_RANGE_LABEL: Record<string, string> = {
  under_20: "under 20",
  "20_29": "20–29",
  "30_39": "30–39",
  "40_49": "40–49",
  "50_59": "50–59",
  "60_plus": "60+",
};
export const modelRangeLabel = (r: string) => MODEL_RANGE_LABEL[r] ?? r.replace(/_/g, "–");
export const confirmableLabel = (r: string) =>
  ({ under_18: "Under 18", "18_24": "18–24", "25_34": "25–34", "35_44": "35–44", "45_54": "45–54", "55_plus": "55+" })[r] ?? r;

/** "appears 20–39" from the plausible span (broad, never a single number). */
export function spanLabel(ranges: string[]): string {
  if (!ranges.length) return "—";
  const first = modelRangeLabel(ranges[0]);
  const last = modelRangeLabel(ranges[ranges.length - 1]);
  if (ranges.length === 1) return first;
  const lo = first.split("–")[0].replace("under ", "<");
  const hi = last.includes("–") ? last.split("–")[1] : last;
  return `${lo}–${hi}`.replace("<20–", "under ").replace("–60+", "+");
}

/** Suggest a confirmable range from the model's expected age, or null when the estimate cannot support one. */
export function suggestConfirmable(expectedYears: number | null | undefined): ConfirmableRange | null {
  if (expectedYears == null || !Number.isFinite(expectedYears)) return null;
  if (expectedYears < 20) return null; // the model cannot separate minors from young adults — the user must choose
  if (expectedYears < 25) return "18_24";
  if (expectedYears < 35) return "25_34";
  if (expectedYears < 45) return "35_44";
  if (expectedYears < 55) return "45_54";
  return "55_plus";
}

export function uncertaintyLabel(entropyBits: number | null | undefined): "low" | "medium" | "high" | "unknown" {
  if (entropyBits == null) return "unknown";
  return entropyBits < 1.0 ? "low" : entropyBits < 1.8 ? "medium" : "high";
}
