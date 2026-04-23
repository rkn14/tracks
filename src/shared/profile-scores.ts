import type { ProfileScores, ProfileTagAxis } from "./types";

/** Pas de 20, de 0 (aucune étoile) à 100 (5 étoiles). */
export const PROFILE_SCORE_STEPS = [0, 20, 40, 60, 80, 100] as const;

const CUSTOM_TAG_RE = /^[a-z0-9](?:[a-z0-9_]{0,30}[a-z0-9])?$/;

const KEYS = [
  "general",
  "energy",
  "groove",
  "melodic",
  "dark",
  "hard",
  "happy",
  "emotion",
  "jazzy",
  "tribal",
  "latin",
  "acid",
  "ambient",
] as const;
/** Axes notés « tags » (hors la note General). */
export const PROFILE_TAG_AXES: readonly ProfileTagAxis[] = [
  "energy",
  "groove",
  "melodic",
  "dark",
  "hard",
  "happy",
  "emotion",
  "jazzy",
  "tribal",
  "latin",
  "acid",
  "ambient",
];

export function isProfileTagAxis(s: string): s is ProfileTagAxis {
  return (PROFILE_TAG_AXES as readonly string[]).includes(s);
}

/** Tag personnalisé (slug) hors 12 axes, hors `general`. */
export function isValidCustomProfileTagId(s: string): boolean {
  if (s.length === 0 || s.length > 32) return false;
  if (s === "general") return false;
  if (isProfileTagAxis(s)) return false;
  return CUSTOM_TAG_RE.test(s);
}

export function isProfileTagKey(s: string): boolean {
  return isProfileTagAxis(s) || isValidCustomProfileTagId(s);
}

function snapToStep(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const c = Math.max(0, Math.min(100, Math.round(n)));
  const step = 20;
  return Math.round(c / step) * step;
}

export function defaultProfileScores(): ProfileScores {
  return {
    general: 0,
    energy: 0,
    groove: 0,
    melodic: 0,
    dark: 0,
    hard: 0,
    happy: 0,
    emotion: 0,
    jazzy: 0,
    tribal: 0,
    latin: 0,
    acid: 0,
    ambient: 0,
  } as ProfileScores;
}

/**
 * Clés reconnues : `general`, les 12 axes, et un nombre quelconque de slugs de tags personnalisés
 * validés (voir <code>isValidCustomProfileTagId</code>).
 */
export function normalizeProfileScores(
  raw: Partial<ProfileScores> | undefined,
): ProfileScores {
  const d = defaultProfileScores();
  if (!raw) return d;
  const src = raw as Record<string, unknown>;
  const out: ProfileScores = { ...d } as ProfileScores;
  for (const k of KEYS) {
    const v = src[k];
    out[k] = snapToStep(
      v === undefined ? 0 : typeof v === "string" ? Number(v) : (v as number),
    );
  }
  for (const k of Object.keys(src)) {
    if ((KEYS as readonly string[]).includes(k)) continue;
    if (!isValidCustomProfileTagId(k)) continue;
    const v = src[k];
    out[k] = snapToStep(
      v === undefined ? 0 : typeof v === "string" ? Number(v) : (v as number),
    );
  }
  return out;
}

/**
 * Conserve seulement la note <code>general</code> ; met tous les tags à 0.
 * La sélection de tags (on/off) est dans <code>activeProfileTags</code>, pas dans des scores par tag.
 */
export function profileScoresForPersistence(
  s: ProfileScores,
  general0to100: number,
): ProfileScores {
  const o: Record<string, number> = { ...s, general: general0to100 };
  for (const k of Object.keys(o)) {
    if (k === "general") continue;
    if (isProfileTagKey(k)) o[k] = 0;
  }
  return normalizeProfileScores(o as ProfileScores);
}

export const profileScoreKeyList: readonly string[] = KEYS;
