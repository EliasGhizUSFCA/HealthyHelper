/**
 * Health Mirror preferences: what "Start camera" switches on. Both default ON (the start button says so);
 * if the user turns one off, that choice is remembered in this browser.
 */
export interface MirrorPrefs {
  analysis: boolean;
  age: boolean;
}
const KEY = "ahm.mirror_prefs";
export const DEFAULT_PREFS: MirrorPrefs = { analysis: true, age: true };

export function loadPrefs(): MirrorPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<MirrorPrefs>;
    return { analysis: p.analysis !== false, age: p.age !== false };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: MirrorPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Age needs analysis (it is computed on the server from a crop): turning analysis off also turns age off. */
export function normalise(p: MirrorPrefs): MirrorPrefs {
  return { analysis: p.analysis, age: p.analysis && p.age };
}
