import { isProfileTagKey } from "./profile-scores";
import { getProfileTagLabel } from "./profile-tag-labels";
import { orderActiveTagIdsForStorage } from "./profile-tag-ids";

/** Ids de tags actifs, ordre persistance, pour les listes. */
export function orderedActiveProfileTagIds(
  activeProfileTags: string[] | undefined | null,
): string[] {
  if (!activeProfileTags?.length) return [];
  return orderActiveTagIdsForStorage(
    activeProfileTags.filter(
      (id) => id !== "general" && isProfileTagKey(id),
    ),
  );
}

/**
 * Tags actifs (hors <code>general</code>) pour une ligne de liste : libellés, séparés par « · ».
 * Vide si aucun tag.
 */
export function formatActiveTagsForListRow(
  activeProfileTags: string[] | undefined | null,
): string {
  const ordered = orderedActiveProfileTagIds(activeProfileTags);
  if (ordered.length === 0) return "";
  return ordered.map((id) => getProfileTagLabel(id)).join(" \u00b7 ");
}

/**
 * Note « general » (0–100, pas 20) : uniquement des ★ pleines (ex. 40 → ★★).
 * 0 ou absence de note : chaîne vide.
 */
export function formatGeneralRowStars(
  general0to100: number | undefined | null,
): string {
  const nRaw =
    general0to100 === undefined ||
    general0to100 === null ||
    !Number.isFinite(general0to100)
      ? 0
      : Math.min(5, Math.max(0, Math.round(general0to100 / 20)));
  if (nRaw === 0) return "";
  return "\u2605".repeat(nRaw);
}

export function isProfileScorableFilePath(filePath: string): boolean {
  return /\.(mp3|flac)$/i.test(filePath);
}

/** Comparaison souple Windows (slash / antislash, casse). */
export function audioPathsEqual(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}
