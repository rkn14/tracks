import { STORE_KEYS } from "@shared/constants";
import {
  mergeProfileTagColorsWithDefaults,
  profileTagColorCssVarName,
} from "@shared/profile-tag-colors";
import { loadProfileTagsAvailable } from "@shared/profile-tags-settings";

/**
 * Charge la liste des tags et les couleurs ; pose les variables sur <code>:root</code>.
 */
export async function loadAndApplyProfileTagTheme(
  get: <T>(key: string) => Promise<T | undefined>,
): Promise<void> {
  const [tagIds, rawColors] = await Promise.all([
    loadProfileTagsAvailable(get),
    get<Record<string, string>>(STORE_KEYS.PROFILE_TAG_COLORS),
  ]);
  const colors = mergeProfileTagColorsWithDefaults(rawColors, tagIds);
  applyProfileTagColorsToRoot(colors);
}

export function applyProfileTagColorsToRoot(colors: Record<string, string>): void {
  const root = document.documentElement;
  for (const [id, hex] of Object.entries(colors)) {
    root.style.setProperty(profileTagColorCssVarName(id), hex);
  }
}
