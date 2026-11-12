export const fmt = (v: number | null | undefined, digits = 1) => (v == null || Number.isNaN(v) ? "—" : v.toFixed(digits));
export const pct = (v: number | null | undefined, digits = 0) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
export const humanize = (s: string) => s.replace(/_/g, " ");
export const regionLabel = (r: string) =>
  ({
    lips: "Lips",
    left_eye: "Left eye",
    right_eye: "Right eye",
    nose: "Nose",
    skin_forehead: "Forehead",
    skin_left_cheek: "Left cheek",
    skin_right_cheek: "Right cheek",
  })[r] ?? humanize(r);
export const featureLabel = (f: string) => humanize(f.replace(/^visible_/, "visible "));
