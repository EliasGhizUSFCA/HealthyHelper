/**
 * Annotation criteria shown to labellers. Labels describe what is VISIBLE in the crop,
 * never a diagnosis. "Can't judge" is always allowed and is excluded from training.
 */
export interface GuideEntry {
  title: string;
  positive: string;
  negative: string;
  criteria: string[];
}

export const ANNOTATION_GUIDE: Record<string, GuideEntry> = {
  lip_dryness: {
    title: "Lip dryness",
    positive: "Visible dryness",
    negative: "No clear dryness",
    criteria: ["Visible flaking, peeling or cracks on the lip surface", "Matte, rough-looking texture across much of the lip", "Ignore lipstick/gloss shine — use “can't judge” if makeup hides the surface"],
  },
  eye_redness: {
    title: "Eye-white redness",
    positive: "Visible redness",
    negative: "No clear redness",
    criteria: ["Pink/red tint or clearly visible red vessels on the white of the eye", "Judge the sclera only, not the eyelid", "Use “can't judge” if the eye is closed, blurred or the white isn't visible"],
  },
  nasal_redness: {
    title: "Redness around the nose",
    positive: "Visible redness",
    negative: "No clear redness",
    criteria: ["Redder patches on the nose or around the nostrils compared with nearby skin", "Compare with the cheeks in the same lighting, not with an ideal skin tone"],
  },
  skin_flaking: {
    title: "Skin flaking / dryness",
    positive: "Visible flaking",
    negative: "No clear flaking",
    criteria: ["Visible flakes, peeling or rough dry patches", "Pores and fine hair are not flaking"],
  },
  skin_blemishes: {
    title: "Spots / blemishes (acne-like)",
    positive: "Visible spots",
    negative: "No clear spots",
    criteria: ["One or more raised bumps, whiteheads, or red spots", "Freckles, moles and flat marks are NOT spots", "Describe what you see — don't decide whether it is acne"],
  },
  skin_redness: {
    title: "Skin redness / irritation",
    positive: "Visible redness",
    negative: "No clear redness",
    criteria: ["Patches noticeably redder than the surrounding skin", "Even warm lighting across the whole crop is not redness — use “can't judge” if the white balance is off"],
  },
  skin_shine: {
    title: "Skin shine / oiliness",
    positive: "Visible shine",
    negative: "No clear shine",
    criteria: ["Bright specular highlights or a greasy-looking sheen", "A single hard light can create shine on any skin — note lighting in metadata"],
  },
  undereye_darkness: {
    title: "Darkness under the eyes",
    positive: "Visibly darker",
    negative: "Not clearly darker",
    criteria: ["Under-eye skin clearly darker than the cheek just below it", "Shadows from overhead light count as “can't judge”", "Natural skin tone differences are expected — this is appearance only"],
  },
};
