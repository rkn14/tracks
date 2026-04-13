import type { EssentiaAnalysis, ProfileScores } from "./types";
import { defaultProfileScores, normalizeProfileScores } from "./profile-scores";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

/** Lit le JSON du TXXX profil (scores + analyse Essentia optionnelle). */
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

    let scoresRaw: unknown;
    if (isRecord(parsed.scores)) {
      scoresRaw = parsed.scores;
    } else if (
      typeof parsed.global === "number" ||
      typeof parsed.global === "string"
    ) {
      scoresRaw = parsed;
    } else {
      scoresRaw = {};
    }

    const scores = normalizeProfileScores(
      scoresRaw as Partial<ProfileScores>,
    );
    const essentia = normalizeEssentia(parsed.essentia);

    return essentia ? { scores, essentia } : { scores };
  } catch {
    return { scores: defaultProfileScores() };
  }
}

/** Sérialise pour le TXXX `tracks.app/profileScores`. */
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
