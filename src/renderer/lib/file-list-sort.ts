export type FileListFolderSortKey = "name" | "tags" | "rating" | "duration" | "ext";

export type FileListPlaylistSortKey = FileListFolderSortKey | "order";

const num = (v: string | undefined): number =>
  v === undefined || v === "" ? 0 : Number(v);

/**
 * Tri des lignes (dataset déjà alimenté sur <code>.fe-row</code>).
 */
export function compareFolderListRows(
  a: HTMLElement,
  b: HTMLElement,
  key: FileListFolderSortKey,
  dir: number,
): number {
  const m = dir;
  switch (key) {
    case "name": {
      const sa = a.dataset.sortNameLower ?? "";
      const sb = b.dataset.sortNameLower ?? "";
      return m * sa.localeCompare(sb, "fr", { sensitivity: "base" });
    }
    case "ext": {
      const sa = a.dataset.sortExt ?? "";
      const sb = b.dataset.sortExt ?? "";
      return m * sa.localeCompare(sb, "fr", { sensitivity: "base" });
    }
    case "duration":
      return m * (num(a.dataset.sortDuration) - num(b.dataset.sortDuration));
    case "rating":
      return m * (num(a.dataset.sortRating) - num(b.dataset.sortRating));
    case "tags": {
      const ca = num(a.dataset.sortTagCount);
      const cb = num(b.dataset.sortTagCount);
      if (ca !== cb) return m * (ca - cb);
      const ka = a.dataset.sortTagsKey ?? "";
      const kb = b.dataset.sortTagsKey ?? "";
      return m * ka.localeCompare(kb, "fr", { sensitivity: "base" });
    }
  }
}

export function comparePlaylistListRows(
  a: HTMLElement,
  b: HTMLElement,
  key: FileListPlaylistSortKey,
  dir: number,
): number {
  if (key === "order") {
    return dir * (num(a.dataset.sortOrder) - num(b.dataset.sortOrder));
  }
  return compareFolderListRows(a, b, key, dir);
}

export function fileListSortTiebreakName(
  a: HTMLElement,
  b: HTMLElement,
): number {
  const sa = a.dataset.sortNameLower ?? "";
  const sb = b.dataset.sortNameLower ?? "";
  return sa.localeCompare(sb, "fr", { sensitivity: "base" });
}
