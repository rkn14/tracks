/**
 * Chemins absolus à masquer sous le dossier Library (paramètre) :
 * comparaison normalisée (séparateurs /, fin de slash, casse Windows).
 */

export function normalizePathKey(p: string): string {
  return p.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

/** `absPath` correspond à une racine exclue ou est un sous-dossier / fichier sous celle-ci. */
export function isPathExcludedFromLibrary(
  absPath: string,
  excludeRootKeys: readonly string[],
): boolean {
  const k = normalizePathKey(absPath);
  for (const ex of excludeRootKeys) {
    if (!ex) continue;
    if (k === ex || k.startsWith(`${ex}/`)) return true;
  }
  return false;
}

/** Déduplication + nettoyage pour stockage / comparaison. */
export function normalizeLibraryExcludePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t) continue;
    const k = normalizePathKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t.replace(/[\\/]+$/, ""));
  }
  return out;
}

export function libraryExcludeKeysForCompare(paths: readonly string[]): string[] {
  return normalizeLibraryExcludePaths(paths).map((p) => normalizePathKey(p));
}

export function parseStoredLibraryExcludePaths(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return normalizeLibraryExcludePaths(raw as string[]);
  }
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw) as unknown;
      if (Array.isArray(j)) {
        return normalizeLibraryExcludePaths(j as string[]);
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}
