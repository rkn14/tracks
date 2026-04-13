import type { ProfileScores } from "./types";

export function defaultProfileScores(): ProfileScores {
  return {
    global: 50,
    energy: 50,
    quantizedGroovy: 50,
    melodicRhythmic: 50,
    darkLight: 50,
    softHard: 50,
  };
}

function clampScore(n: number): number {
  if (Number.isNaN(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function normalizeProfileScores(
  raw: Partial<ProfileScores> | undefined,
): ProfileScores {
  const d = defaultProfileScores();
  if (!raw) return d;
  return {
    global: clampScore(raw.global ?? d.global),
    energy: clampScore(raw.energy ?? d.energy),
    quantizedGroovy: clampScore(raw.quantizedGroovy ?? d.quantizedGroovy),
    melodicRhythmic: clampScore(raw.melodicRhythmic ?? d.melodicRhythmic),
    darkLight: clampScore(raw.darkLight ?? d.darkLight),
    softHard: clampScore(raw.softHard ?? d.softHard),
  };
}
