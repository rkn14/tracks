import type { EssentiaAnalysis, ProfileScores } from "./types";
import {
  defaultProfileScores,
  isProfileTagKey,
  normalizeProfileScores,
  profileScoresForPersistence,
} from "./profile-scores";
import { orderActiveTagIdsForStorage } from "./profile-tag-ids";

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

const NEW_SCORE_KEYS = [
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

function hasLegacyScoreKeys(obj: Record<string, unknown>): boolean {
  for (const k of Object.keys(obj)) {
    if (LEGACY_SCORE_KEYS.has(k)) return true;
  }
  return false;
}

/** `general` obligatoire ; autres clés = 12 axes intégrés et/ou tags personnalisés (slug). */
function isValidScoresObject(obj: Record<string, unknown>): boolean {
  const g = obj.general;
  const gNum =
    typeof g === "number"
      ? g
      : typeof g === "string" && g.trim() !== ""
        ? Number(g)
        : NaN;
  if (!Number.isFinite(gNum)) return false;
  for (const key of Object.keys(obj)) {
    if (key === "general") continue;
    const isBuiltIn = (NEW_SCORE_KEYS as readonly string[]).includes(key);
    if (!isBuiltIn && !isProfileTagKey(key)) return false;
    const v = obj[key];
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

function deriveActiveProfileTagsFromScores(scores: ProfileScores): string[] {
  return Object.keys(scores)
    .filter((k) => k !== "general" && isProfileTagKey(k) && (scores[k] ?? 0) > 0)
    .filter((k, i, a) => a.indexOf(k) === i);
}

function parseActiveProfileTags(
  root: Record<string, unknown>,
  scores: ProfileScores,
): string[] {
  if ("activeProfileTags" in root) {
    const raw = root.activeProfileTags;
    if (Array.isArray(raw)) {
      const out: string[] = [];
      for (const t of raw) {
        if (typeof t === "string" && isProfileTagKey(t) && !out.includes(t)) {
          out.push(t);
        }
      }
      return orderActiveTagIdsForStorage(out);
    }
  }
  return orderActiveTagIdsForStorage(deriveActiveProfileTagsFromScores(scores));
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
  activeProfileTags: string[];
} {
  const trimmed = str.trim();
  if (!trimmed) {
    return {
      scores: defaultProfileScores(),
      activeProfileTags: [],
    };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRecord(parsed)) {
      return {
        scores: defaultProfileScores(),
        activeProfileTags: [],
      };
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
      return {
        scores: defaultProfileScores(),
        activeProfileTags: parseActiveProfileTags(
          parsed,
          defaultProfileScores(),
        ),
      };
    }

    if (hasLegacyScoreKeys(scoresRaw)) {
      const essentia = normalizeEssentia(parsed.essentia);
      return essentia
        ? {
            scores: defaultProfileScores(),
            essentia,
            activeProfileTags: parseActiveProfileTags(
              parsed,
              defaultProfileScores(),
            ),
          }
        : {
            scores: defaultProfileScores(),
            activeProfileTags: parseActiveProfileTags(
              parsed,
              defaultProfileScores(),
            ),
          };
    }

    if (!isValidScoresObject(scoresRaw)) {
      const essentia = normalizeEssentia(parsed.essentia);
      return essentia
        ? {
            scores: defaultProfileScores(),
            essentia,
            activeProfileTags: parseActiveProfileTags(
              parsed,
              defaultProfileScores(),
            ),
          }
        : {
            scores: defaultProfileScores(),
            activeProfileTags: parseActiveProfileTags(
              parsed,
              defaultProfileScores(),
            ),
          };
    }

    const scoresNorm = normalizeProfileScores(
      scoresRaw as unknown as Partial<ProfileScores>,
    );
    const activeProfileTags = parseActiveProfileTags(parsed, scoresNorm);
    const scores = profileScoresForPersistence(
      scoresNorm,
      scoresNorm.general,
    );
    const essentia = normalizeEssentia(parsed.essentia);
    return {
      scores,
      activeProfileTags,
      ...(essentia ? { essentia } : {}),
    };
  } catch {
    return {
      scores: defaultProfileScores(),
      activeProfileTags: [],
    };
  }
}

export function serializeProfileTag(
  scores: ProfileScores,
  essentia?: EssentiaAnalysis,
  activeProfileTags?: string[],
): string {
  const payload: Record<string, unknown> = { scores };
  if (activeProfileTags && activeProfileTags.length > 0) {
    payload.activeProfileTags = activeProfileTags;
  }
  if (essentia && (essentia.bpm !== undefined || essentia.key !== undefined)) {
    payload.essentia = {
      ...(essentia.bpm !== undefined ? { bpm: essentia.bpm } : {}),
      ...(essentia.key !== undefined ? { key: essentia.key } : {}),
    };
  }
  return JSON.stringify(payload);
}
