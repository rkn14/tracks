import {
  isProfileTagAxis,
  isProfileTagKey,
  isValidCustomProfileTagId,
  PROFILE_TAG_AXES,
} from "./profile-scores";

/** @deprecated alias — identifiant de tag (intégré ou personnalisé). */
export type ProfileTagId = string;

const MAX_SLUG = 32;

/**
 * Saisie libre → identifiant personnalisé (hors 12 intégrés, hors <code>general</code>).
 * Renvoie `undefined` si vide, confondu avec un intégré, ou format invalide.
 */
export function slugifyCustomTagInput(raw: string): string | undefined {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (t.length === 0) return undefined;
  const trimmed =
    t.length > MAX_SLUG
      ? t.slice(0, MAX_SLUG).replace(/_+$/g, "")
      : t;
  if (trimmed.length === 0) return undefined;
  if (isProfileTagAxis(trimmed) || trimmed === "general") return undefined;
  return isValidCustomProfileTagId(trimmed) ? trimmed : undefined;
}

export { isValidCustomProfileTagId, isProfileTagKey };

/** Tri pour persistance : d’abord les 12 intégrés (ordre canon), puis le reste dans l’ordre d’apparition. */
export function orderActiveTagIdsForStorage(ids: string[]): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  for (const a of PROFILE_TAG_AXES) {
    if (set.has(a)) out.push(a);
  }
  for (const id of ids) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function collectTagIdUniverse(
  availableIds: string[],
  bufferedScoreKeys: string[],
  bufferedActive: string[],
): Set<string> {
  const s = new Set<string>([...PROFILE_TAG_AXES, ...availableIds, ...bufferedActive]);
  for (const k of bufferedScoreKeys) {
    if (k !== "general" && isProfileTagKey(k)) s.add(k);
  }
  return s;
}
