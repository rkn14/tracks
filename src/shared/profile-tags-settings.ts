import { STORE_KEYS } from "./constants";
import { isProfileTagKey, PROFILE_TAG_AXES } from "./profile-scores";

/** Liste par défaut (12 axes intégrés) si aucun réglage enregistré. */
export const DEFAULT_PROFILE_TAGS_AVAILABLE: readonly string[] = PROFILE_TAG_AXES;

/**
 * Valide / déduplique la liste issue du store (axes intégrés + slugs personnalisés).
 * Tableau vide → 12 axes par défaut.
 */
export function normalizeProfileTagsAvailable(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...PROFILE_TAG_AXES];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string" && isProfileTagKey(x) && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out.length > 0 ? out : [...PROFILE_TAG_AXES];
}

export async function loadProfileTagsAvailable(
  get: <T>(key: string) => Promise<T | undefined>,
): Promise<string[]> {
  const raw = await get<string[]>(STORE_KEYS.PROFILE_TAGS_AVAILABLE);
  return normalizeProfileTagsAvailable(raw);
}

/** Liste enregistrée = défaut (12 axes, ordre canon). */
export function isProfileTagsListDefault(list: string[]): boolean {
  if (list.length !== PROFILE_TAG_AXES.length) return false;
  return PROFILE_TAG_AXES.every((a, i) => list[i] === a);
}
