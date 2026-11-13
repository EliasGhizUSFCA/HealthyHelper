/**
 * Seamless product suggestions: one-tap chips, and chips derived from what the mirror noticed.
 * Pure functions (unit-tested). Observations only become suggestions — nothing is fetched until the user
 * has switched product ideas on.
 */
import type { Observation } from "./protocol";

export interface Chip {
  key: string;
  label: string;
  mode: "skincare" | "makeup";
  concern: string;
  /** observation key ("region:feature") this chip came from, if any */
  fromObservation?: string;
}

export const QUICK_CHIPS: Chip[] = [
  { key: "lips", label: "Lip balm", mode: "skincare", concern: "dry_lips" },
  { key: "moist", label: "Moisturiser", mode: "skincare", concern: "general_moisture" },
  { key: "sensitive", label: "Sensitive skin", mode: "skincare", concern: "sensitive_skin" },
  { key: "blemish", label: "Blemish-prone", mode: "skincare", concern: "blemish_prone" },
  { key: "spf", label: "Sunscreen", mode: "skincare", concern: "sun_protection" },
  { key: "concealer", label: "Concealer", mode: "makeup", concern: "spot_coverage" },
  { key: "tint", label: "Skin tint", mode: "makeup", concern: "light_coverage" },
  { key: "foundation", label: "Foundation", mode: "makeup", concern: "even_coverage" },
];

/** feature → skincare concern + neutral wording (appearance only, no judgement) */
const FROM_FEATURE: Record<string, { concern: string; label: string }> = {
  "lips:visible_dryness": { concern: "dry_lips", label: "Lip care" },
  visible_flaking: { concern: "surface_dryness", label: "Moisturisers" },
  visible_redness: { concern: "visible_redness", label: "Soothing skincare" },
  visible_blemishes: { concern: "blemish_prone", label: "Blemish-prone skincare" },
  visible_shine: { concern: "oiliness", label: "Oil-control skincare" },
};

export function chipsFromObservations(obs: Observation[] | undefined): Chip[] {
  const out: Chip[] = [];
  const seen = new Set<string>();
  for (const o of obs ?? []) {
    if (o.status !== "accepted" || !o.present) continue;
    const key = `${o.region}:${o.feature}`;
    const m = FROM_FEATURE[key] ?? (o.region.startsWith("skin_") || o.region === "nose" ? FROM_FEATURE[o.feature] : undefined);
    if (!m || seen.has(m.concern)) continue;
    seen.add(m.concern);
    out.push({ key: `obs:${m.concern}`, label: m.label, mode: "skincare", concern: m.concern, fromObservation: key });
  }
  return out;
}

export function chipRequest(chip: Chip, opts: { fragranceFree: boolean; budget: number | null }) {
  return {
    mode: chip.mode,
    concern: chip.concern,
    include_observations: chip.fromObservation ? [chip.fromObservation] : [],
    fragrance_free: opts.fragranceFree,
    budget_max: opts.budget,
    limit: 5,
    explain: true,
  };
}
