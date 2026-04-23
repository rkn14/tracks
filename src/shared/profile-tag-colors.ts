import type { ProfileTagAxis } from "./types";
import { isProfileTagAxis, isProfileTagKey } from "./profile-scores";

/**
 * Couleur d’accent par défaut par axe (alignée sur l’ancien thème du lecteur).
 */
export const DEFAULT_PROFILE_TAG_COLORS: Readonly<
  Record<ProfileTagAxis, string>
> = {
  energy: "#fb923c",
  groove: "#4ade80",
  melodic: "#60a5fa",
  dark: "#94a3b8",
  hard: "#f472b6",
  happy: "#22d3ee",
  emotion: "#e879f9",
  jazzy: "#fbbf24",
  tribal: "#d4a574",
  latin: "#fb7185",
  acid: "#bef264",
  ambient: "#93c5fd",
};

/** Accent par défaut pour un tag personnalisé (slug). */
export const DEFAULT_CUSTOM_PROFILE_TAG_COLOR = "#a78bfa";

export function defaultProfileTagColorHex(id: string): string {
  if (isProfileTagAxis(id)) return DEFAULT_PROFILE_TAG_COLORS[id];
  return DEFAULT_CUSTOM_PROFILE_TAG_COLOR;
}

/** Nom de variable CSS sur :root (id = slug ou axe intégré). */
export function profileTagColorCssVarName(id: string): string {
  return `--profile-tag-color-${id}`;
}

export function profileTagColorVarRef(id: string): string {
  return `var(${profileTagColorCssVarName(id)})`;
}

export function isValidProfileTagColorHex(s: string): boolean {
  const t = s.trim();
  return (
    /^#[0-9A-Fa-f]{3}$/.test(t) ||
    /^#[0-9A-Fa-f]{6}$/.test(t) ||
    /^#[0-9A-Fa-f]{8}$/.test(t)
  );
}

export function normalizeProfileTagColorHex(s: string): string {
  const t = s.trim();
  if (/^#[0-9A-Fa-f]{3}$/.test(t)) {
    const r = t[1]!;
    const g = t[2]!;
    const b = t[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return t.toLowerCase();
}

/**
 * Fusionne le store avec des valeurs par défaut pour chaque id de `tagIds`.
 */
export function mergeProfileTagColorsWithDefaults(
  raw: unknown,
  tagIds: readonly string[],
): Record<string, string> {
  const fromStore =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const out: Record<string, string> = {};
  for (const id of tagIds) {
    if (!isProfileTagKey(id)) continue;
    const v = fromStore[id];
    const s = typeof v === "string" ? v.trim() : "";
    out[id] =
      s && isValidProfileTagColorHex(s)
        ? normalizeProfileTagColorHex(s)
        : defaultProfileTagColorHex(id);
  }
  return out;
}
