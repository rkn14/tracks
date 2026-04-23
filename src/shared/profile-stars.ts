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
