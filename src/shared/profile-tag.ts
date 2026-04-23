import type { EssentiaAnalysis, ProfileScores } from "./types";
import { defaultProfileScores, normalizeProfileScores } from "./profile-scores";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const LEGACY_SCORE_KEYS = new Set([
  "global",
  "quantizedGroovy",
  "melodicRhythmic",
  "darkLight",
  "softHard",
]);

const NEW_SCORE_KEYS: (keyof ProfileScores)[] = [
  "general",
  "energy",
  "groove",
  "melodic",
  "dark",
  "hard",
  "happy",
];

function hasLegacyScoreKeys(obj: Record<string, unknown>): boolean {
  for (const k of Object.keys(obj)) {
    if (LEGACY_SCORE_KEYS.has(k)) return true;
  }
  return false;
}

function isValidCurrentScoresShape(
  obj: Record<string, unknown>,
): obj is Record<keyof ProfileScores, unknown> {
  for (const k of NEW_SCORE_KEYS) {
    if (!(k in obj)) return false;
  }
  for (const key of Object.keys(obj)) {
    if (!NEW_SCORE_KEYS.includes(key as keyof ProfileScores)) {
      if (key === "essentia") continue;
      return false;
    }
  }
  for (const k of NEW_SCORE_KEYS) {
    const v = obj[k];
    if (v === null || v === undefined) return false;
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && v.trim() !== ""
          ? Number(v)
          : NaN;
    if (!Number.isFinite(n)) return false;
  }
  return true;
}

function normalizeEssentia(raw: unknown): EssentiaAnalysis | undefined {
  if (!isRecord(raw)) return undefined;
  const bpmRaw = raw.bpm;
  const keyRaw = raw.key;
  const bpm =
    typeof bpmRaw === "number" &&
    Number.isFinite(bpmRaw) &&
    bpmRaw > 0
      ? Math.round(bpmRaw * 10) / 10
      : typeof bpmRaw === "string" &&
          Number.isFinite(Number(bpmRaw)) &&
          Number(bpmRaw) > 0
        ? Math.round(Number(bpmRaw) * 10) / 10
        : undefined;
  const key =
    typeof keyRaw === "string" && keyRaw.trim() ? keyRaw.trim() : undefined;
  const out: EssentiaAnalysis = {};
  if (bpm !== undefined) out.bpm = bpm;
  if (key !== undefined) out.key = key;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Lit le JSON profil. Si l’ancien format (6 clés) ou un JSON partiel/étrange : scores remis à zéro.
 */
export function parseProfileTagJson(str: string): {
  scores: ProfileScores;
  essentia?: EssentiaAnalysis;
} {
  const trimmed = str.trim();
  if (!trimmed) {
    return { scores: defaultProfileScores() };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) {
      return { scores: defaultProfileScores() };
    }

    let scoresRaw: Record<string, unknown>;
    if (isRecord(parsed.scores)) {
      scoresRaw = parsed.scores;
    } else if (
      isRecord(parsed) &&
      (typeof (parsed as Record<string, unknown>).general === "number" ||
        typeof (parsed as Record<string, unknown>).general === "string" ||
        typeof (parsed as Record<string, unknown>).global === "number")
    ) {
      scoresRaw = parsed;
    } else {
      return { scores: defaultProfileScores() };
    }

    if (hasLegacyScoreKeys(scoresRaw)) {
      const essentia = normalizeEssentia(parsed.essentia);
      return essentia
        ? { scores: defaultProfileScores(), essentia }
        : { scores: defaultProfileScores() };
    }

    if (!isValidCurrentScoresShape(scoresRaw)) {
      const essentia = normalizeEssentia(parsed.essentia);
      return essentia
        ? { scores: defaultProfileScores(), essentia }
        : { scores: defaultProfileScores() };
    }

    const scores = normalizeProfileScores(
      scoresRaw as unknown as Partial<ProfileScores>,
    );
    const essentia = normalizeEssentia(parsed.essentia);
    return essentia ? { scores, essentia } : { scores };
  } catch {
    return { scores: defaultProfileScores() };
  }
}

export function serializeProfileTag(
  scores: ProfileScores,
  essentia?: EssentiaAnalysis,
): string {
  const payload: Record<string, unknown> = { scores };
  if (essentia && (essentia.bpm !== undefined || essentia.key !== undefined)) {
    payload.essentia = {
      ...(essentia.bpm !== undefined ? { bpm: essentia.bpm } : {}),
      ...(essentia.key !== undefined ? { key: essentia.key } : {}),
    };
  }
  return JSON.stringify(payload);
}
