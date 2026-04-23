import type { ProfileScores } from "./types";

/** Pas de 20, de 0 (aucune étoile) à 100 (5 étoiles). */
export const PROFILE_SCORE_STEPS = [0, 20, 40, 60, 80, 100] as const;

const KEYS: (keyof ProfileScores)[] = [
  "general",
  "energy",
  "groove",
  "melodic",
  "dark",
  "hard",
  "happy",
];

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
  };
}

/**
 * N’accepte qu’un objet de scores valide (uniquement les clés actuelles, sans anciennes clés).
 * Sinon, les données héritées doivent être invalidées ailleurs (voir profile-tag).
 */
export function normalizeProfileScores(
  raw: Partial<ProfileScores> | undefined,
): ProfileScores {
  const d = defaultProfileScores();
  if (!raw) return d;
  const out: ProfileScores = { ...d };
  for (const k of KEYS) {
    const v = raw[k];
    out[k] = snapToStep(
      v === undefined ? 0 : typeof v === "string" ? Number(v) : v,
    );
  }
  return out;
}

export const profileScoreKeyList: readonly (keyof ProfileScores)[] = KEYS;
