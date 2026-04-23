import { isProfileTagAxis, PROFILE_TAG_AXES } from "./profile-scores";
import { slugifyCustomTagInput } from "./profile-tag-ids";
import type { ProfileTagAxis } from "./types";

/** Libellés d’affichage des 12 axes intégrés (UI). */
export const PROFILE_TAG_LABELS: Record<ProfileTagAxis, string> = {
  energy: "Energy",
  groove: "Groove",
  melodic: "Melodic",
  dark: "Dark",
  hard: "Hard",
  happy: "Happy",
  emotion: "Emotion",
  jazzy: "Jazzy",
  tribal: "Tribal",
  latin: "Latin",
  acid: "Acid",
  ambient: "Ambient",
};

export function getProfileTagLabel(id: string): string {
  if (isProfileTagAxis(id)) return PROFILE_TAG_LABELS[id as ProfileTagAxis];
  return formatCustomTagLabelForDisplay(id);
}

function formatCustomTagLabelForDisplay(slug: string): string {
  return slug
    .split(/_+/g)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Saisie utilisateur → identifiant (axe intégré ou tag personnalisé slug).
 */
export function resolveProfileTagIdFromUserInput(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (isProfileTagAxis(t)) return t;
  const lower = t.toLowerCase();
  for (const axis of PROFILE_TAG_AXES) {
    if (axis === lower) return axis;
  }
  for (const axis of PROFILE_TAG_AXES) {
    if (PROFILE_TAG_LABELS[axis].toLowerCase() === lower) return axis;
  }
  return slugifyCustomTagInput(t);
}

/** @deprecated utiliser <code>resolveProfileTagIdFromUserInput</code> */
export const resolveProfileTagFromInput = resolveProfileTagIdFromUserInput;
