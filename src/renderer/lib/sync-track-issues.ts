import type { LibraryTrackSyncIssue } from "@shared/types";

export type TrackIssueFolderNode = {
  segment: string;
  children: Map<string, TrackIssueFolderNode>;
  files: LibraryTrackSyncIssue[];
};

function pathDirname(filePath: string): string {
  const n = filePath.replace(/\\/g, "/");
  if (/^([A-Za-z]:\/)([^/]+)$/.test(n)) {
    return n.slice(0, 2);
  }
  const i = n.lastIndexOf("/");
  if (i < 0) return "";
  if (i === 0) return "/";
  return n.slice(0, i);
}

export function pathBasename(filePath: string): string {
  const n = filePath.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i < 0 ? n : n.slice(i + 1);
}

function folderPathToSegments(dirPath: string): string[] {
  const n = dirPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!n) return [];
  const win = n.match(/^([A-Za-z]:)(?:\/(.*))?$/);
  if (win) {
    const drive = win[1];
    const rest = win[2];
    if (rest == null || rest === "") return [drive];
    return [drive, ...rest.split("/").filter(Boolean)];
  }
  if (n.startsWith("/")) {
    return n.split("/").filter(Boolean);
  }
  return n.split("/").filter(Boolean);
}

function sortByBasename(
  a: LibraryTrackSyncIssue,
  b: LibraryTrackSyncIssue,
): number {
  return pathBasename(a.filePath).localeCompare(pathBasename(b.filePath), "fr", {
    sensitivity: "base",
  });
}

export function buildTrackIssueFolderTree(
  issues: LibraryTrackSyncIssue[],
): TrackIssueFolderNode {
  const root: TrackIssueFolderNode = {
    segment: "",
    children: new Map(),
    files: [],
  };
  for (const issue of issues) {
    const dir = pathDirname(issue.filePath);
    const segs = folderPathToSegments(dir);
    if (segs.length === 0) {
      root.files.push(issue);
      continue;
    }
    let cur = root;
    for (const seg of segs) {
      if (!cur.children.has(seg)) {
        cur.children.set(seg, {
          segment: seg,
          children: new Map(),
          files: [],
        });
      }
      cur = cur.children.get(seg)!;
    }
    cur.files.push(issue);
  }
  sortTreeFiles(root);
  return root;
}

function sortTreeFiles(node: TrackIssueFolderNode): void {
  node.files.sort(sortByBasename);
  for (const c of node.children.values()) {
    sortTreeFiles(c);
  }
}

export function sortFolderChildKeys(
  m: Map<string, TrackIssueFolderNode>,
): string[] {
  return [...m.keys()].sort((a, b) =>
    a.localeCompare(b, "fr", { sensitivity: "base" }),
  );
}

/** Vrai si ce dossier (ou un sous-dossier) contient au moins une piste en écart. */
export function folderNodeHasTrackIssues(n: TrackIssueFolderNode): boolean {
  if (n.files.length > 0) return true;
  for (const c of n.children.values()) {
    if (folderNodeHasTrackIssues(c)) return true;
  }
  return false;
}
