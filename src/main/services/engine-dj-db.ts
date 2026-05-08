import { statSync } from "fs";
import fs from "fs/promises";
import path from "path";
import Database from "better-sqlite3";
import { parseFile } from "music-metadata";
import type { IAudioMetadata, ICommonTagsResult } from "music-metadata";
import { STORE_KEYS } from "@shared/constants";
import type {
  DjAddLibraryFilesToPlaylistResult,
  DjAddPlaylistResult,
  DjAddTrackToPlaylistResult,
  DjDbConnectResult,
  DjImportTrackBatchToPlaylistsResult,
  DjSyncTreeNode,
  LibraryPlaylistAnalysisResult,
  LibraryTrackSyncIssue,
  DjPlaylistNode,
  DjPlaylistTrackMutationResult,
  DjPlaylistTrackRow,
} from "@shared/types";
import { listFolderAudio } from "./filesystem";
import { storeGet } from "./store";
import {
  isPathExcludedFromLibrary,
  libraryExcludeKeysForCompare,
  parseStoredLibraryExcludePaths,
} from "@shared/library-exclude-paths";

type SqliteDatabase = InstanceType<typeof Database>;

let db: SqliteDatabase | null = null;

export async function djDbClose(): Promise<void> {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
}

export async function djDbConnectFromStore(): Promise<DjDbConnectResult> {
  await djDbClose();
  const raw = await storeGet<string>(STORE_KEYS.ENGINE_DJ_DATABASE_PATH);
  const dbPath = raw?.trim() || "J:\\m.db";
  try {
    await fs.access(dbPath);
  } catch {
    return { ok: false, path: dbPath, error: "Fichier introuvable ou inaccessible" };
  }
  try {
    db = new Database(dbPath, { readonly: false, fileMustExist: true });
    return { ok: true, path: dbPath };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, path: dbPath, error: msg };
  }
}

function requireDb(): SqliteDatabase {
  if (!db) throw new Error("Base DJ non connectée");
  return db;
}

/** Ordre des playlists sœurs via `nextListId` (liste chaînée). */
function orderSiblingsByNextListId(nodes: DjPlaylistNode[]): DjPlaylistNode[] {
  if (nodes.length <= 1) return nodes;

  const byId = new Map<number, DjPlaylistNode>(nodes.map((n) => [n.id, n]));
  const ids = new Set(byId.keys());

  const pointedTo = new Set<number>();
  for (const n of nodes) {
    const next = n.nextListId;
    if (next != null && next !== 0 && ids.has(next)) {
      pointedTo.add(next);
    }
  }

  const heads = nodes.filter((n) => !pointedTo.has(n.id));
  let head: DjPlaylistNode | undefined;
  if (heads.length === 1) {
    head = heads[0];
  } else if (heads.length > 1) {
    heads.sort((a, b) => a.id - b.id);
    head = heads[0];
  } else {
    return nodes.slice().sort((a, b) => a.id - b.id);
  }

  const ordered: DjPlaylistNode[] = [];
  const seen = new Set<number>();
  let cur: DjPlaylistNode | undefined = head;
  while (cur && !seen.has(cur.id)) {
    ordered.push(cur);
    seen.add(cur.id);
    const nextId = cur.nextListId;
    if (nextId == null || nextId === 0 || !ids.has(nextId)) break;
    cur = byId.get(nextId);
    if (!cur || seen.has(cur.id)) break;
  }

  const rest = nodes.filter((n) => !seen.has(n.id));
  rest.sort((a, b) => a.id - b.id);
  ordered.push(...rest);
  return ordered;
}

function applyNextListOrder(nodes: DjPlaylistNode[]): void {
  for (const n of nodes) {
    if (n.children.length > 0) {
      n.children = orderSiblingsByNextListId(n.children);
      applyNextListOrder(n.children);
    }
  }
}

export function djDbGetPlaylistTree(): DjPlaylistNode[] {
  const d = requireDb();
  type Row = {
    id: number;
    title: string | null;
    parentListId: number | null;
    nextListId: number | null;
  };
  const rows = d
    .prepare(
      `SELECT id, title, parentListId, nextListId FROM Playlist
       WHERE parentListId IS NOT NULL
       ORDER BY id`,
    )
    .all() as Row[];

  const byId = new Map<number, DjPlaylistNode>();
  for (const r of rows) {
    const next =
      r.nextListId == null || r.nextListId === 0 ? null : r.nextListId;
    byId.set(r.id, {
      id: r.id,
      title: r.title,
      parentListId: r.parentListId,
      nextListId: next,
      children: [],
    });
  }

  const roots: DjPlaylistNode[] = [];
  for (const r of rows) {
    const node = byId.get(r.id)!;
    const pid = r.parentListId;
    if (pid == null || !byId.has(pid)) {
      roots.push(node);
    } else {
      byId.get(pid)!.children.push(node);
    }
  }

  if (roots.length > 1) {
    const reorderedRoots = orderSiblingsByNextListId(roots);
    roots.length = 0;
    roots.push(...reorderedRoots);
  }
  applyNextListOrder(roots);
  return roots;
}

function resolveTrackFilePath(
  libraryRoot: string,
  dbPath: string | null,
): string | null {
  const rel = dbPath?.trim();
  if (!rel) return null;
  const root = libraryRoot.trim();
  if (!root) return rel;
  return path.resolve(root, rel);
}

type PlaylistTrackQueryRow = DjPlaylistTrackRow & {
  nextEntityId: number | null;
};

/** Ordre d’affichage : chaîne `PlaylistEntity.nextEntityId` (sinon repli sur `id`). */
function orderPlaylistTracksByNextEntity(
  rows: PlaylistTrackQueryRow[],
): DjPlaylistTrackRow[] {
  if (rows.length <= 1) {
    return rows.map(({ nextEntityId: _n, ...r }) => r);
  }

  const byEntityId = new Map(rows.map((r) => [r.entityId, r]));
  const ids = new Set(rows.map((r) => r.entityId));

  const pointedTo = new Set<number>();
  for (const r of rows) {
    const next = r.nextEntityId;
    if (next != null && next !== 0 && ids.has(next)) {
      pointedTo.add(next);
    }
  }

  const heads = rows.filter((r) => !pointedTo.has(r.entityId));
  let head: PlaylistTrackQueryRow | undefined;
  if (heads.length === 1) {
    head = heads[0];
  } else if (heads.length > 1) {
    heads.sort((a, b) => a.entityId - b.entityId);
    head = heads[0];
  } else {
    return rows
      .slice()
      .sort((a, b) => a.entityId - b.entityId)
      .map(({ nextEntityId: _n, ...r }) => r);
  }

  const ordered: PlaylistTrackQueryRow[] = [];
  const seen = new Set<number>();
  let cur: PlaylistTrackQueryRow | undefined = head;
  while (cur && !seen.has(cur.entityId)) {
    ordered.push(cur);
    seen.add(cur.entityId);
    const nextId = cur.nextEntityId;
    if (nextId == null || nextId === 0 || !ids.has(nextId)) break;
    cur = byEntityId.get(nextId);
    if (!cur || seen.has(cur.entityId)) break;
  }

  const rest = rows.filter((r) => !seen.has(r.entityId));
  rest.sort((a, b) => a.entityId - b.entityId);
  ordered.push(...rest);

  return ordered.map(({ nextEntityId: _n, ...r }) => r);
}

function getPlaylistTrackNamesAndAbsPathsOrdered(
  d: SqliteDatabase,
  listId: number,
  libraryRootAbs: string,
): { names: string[]; absPaths: string[] } {
  const rows = d
    .prepare(
      `SELECT pe.id AS entityId, pe.nextEntityId AS nextEntityId,
              t.id AS trackId, t.title, t.artist, t.path, t.filename
       FROM PlaylistEntity pe
       JOIN Track t ON t.id = pe.trackId
       WHERE pe.listId = ?`,
    )
    .all(listId) as PlaylistTrackQueryRow[];
  const ordered = orderPlaylistTracksByNextEntity(rows);
  const root = path.resolve(libraryRootAbs);
  return {
    names: ordered.map((r) => {
      const fn = (r.filename ?? "").trim();
      if (fn) return fn;
      const p = (r.path ?? "").trim();
      if (p) {
        const base = path.basename(p.replace(/\\/g, path.sep));
        if (base) return base;
      }
      return "Sans nom";
    }),
    absPaths: ordered.map((r) => {
      const abs = resolveTrackAbsoluteFromRow(root, r.path, r.filename);
      return abs ? path.normalize(abs) : "";
    }),
  };
}

function buildDbSyncTreeNodes(
  d: SqliteDatabase,
  nodes: DjPlaylistNode[],
  libraryRootAbs: string,
): DjSyncTreeNode[] {
  return nodes.map((n) => {
    const { names, absPaths } = getPlaylistTrackNamesAndAbsPathsOrdered(
      d,
      n.id,
      libraryRootAbs,
    );
    return {
      id: n.id,
      title: n.title?.trim() || "Sans titre",
      children: buildDbSyncTreeNodes(d, n.children, libraryRootAbs),
      trackFileNames: names,
      trackAbsPaths: absPaths,
    };
  });
}

function collectDbTracksNotInLibrary(
  d: SqliteDatabase,
  libraryRoot: string,
): { trackId: number; fileName: string; absPath: string }[] {
  const root = path.resolve(libraryRoot.trim());
  const rows = d
    .prepare("SELECT id, path, filename FROM Track")
    .all() as { id: number; path: string | null; filename: string | null }[];
  const out: { trackId: number; fileName: string; absPath: string }[] = [];
  for (const t of rows) {
    const abs = resolveTrackAbsoluteFromRow(root, t.path, t.filename);
    let underLib = false;
    if (abs) {
      const rel = path.relative(root, path.normalize(abs));
      underLib = !rel.startsWith("..") && !path.isAbsolute(rel);
    }
    if (underLib) continue;
    const f =
      (t.filename ?? "").trim() ||
      (t.path ? path.basename(t.path.trim()) : "") ||
      "Sans nom";
    out.push({
      trackId: t.id,
      fileName: f,
      absPath: abs ? path.normalize(abs) : "",
    });
  }
  out.sort((a, b) =>
    a.fileName.localeCompare(b.fileName, "fr", { sensitivity: "base" }),
  );
  return out;
}

export async function djDbGetPlaylistTracks(
  listId: number,
): Promise<DjPlaylistTrackRow[]> {
  const d = requireDb();
  const libraryRoot =
    (await storeGet<string>(STORE_KEYS.LIBRARY_FOLDER))?.trim() ?? "";

  const rows = d
    .prepare(
      `SELECT pe.id AS entityId,
              pe.nextEntityId AS nextEntityId,
              t.id AS trackId,
              t.title,
              t.artist,
              t.path,
              t.filename
       FROM PlaylistEntity pe
       JOIN Track t ON t.id = pe.trackId
       WHERE pe.listId = ?`,
    )
    .all(listId) as PlaylistTrackQueryRow[];

  const ordered = orderPlaylistTracksByNextEntity(rows);

  if (!libraryRoot) {
    return ordered;
  }

  return ordered.map((r) => ({
    ...r,
    path: resolveTrackFilePath(libraryRoot, r.path),
  }));
}

function sqlNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/** Insère une playlist enfant (table `Playlist`, aligné sur la doc / Rekordbox). */
export function djDbAddChildPlaylist(
  parentListId: number,
  title: string,
): DjAddPlaylistResult {
  try {
    const d = requireDb();
    const t = title.trim();
    if (!t) {
      return { ok: false, error: "Titre vide" };
    }
    if (!Number.isFinite(parentListId) || parentListId < 1) {
      return { ok: false, error: "Playlist parente invalide" };
    }

    const parent = d
      .prepare("SELECT id FROM Playlist WHERE id = ?")
      .get(parentListId) as { id: number } | undefined;
    if (!parent) {
      return { ok: false, error: "Playlist parente introuvable" };
    }

    const now = sqlNow();

    const nextId = d.transaction(() => {
      const { nextId: nid } = d
        .prepare("SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM Playlist")
        .get() as { nextId: number };

      d.prepare(
        `INSERT INTO Playlist (id, title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported)
         VALUES (?, ?, ?, 1, 0, ?, 0)`,
      ).run(nid, t, parentListId, now);

      d.prepare("UPDATE Playlist SET lastEditTime = ? WHERE id = ?").run(
        now,
        parentListId,
      );

      const seqRow = d
        .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'Playlist'")
        .get() as { seq: number } | undefined;
      if (seqRow) {
        d.prepare(
          "UPDATE sqlite_sequence SET seq = ? WHERE name = 'Playlist'",
        ).run(nid);
      }

      return nid;
    })();

    return { ok: true, id: nextId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Playlists racine : `parentListId = 0` (comme le script `Add New Tracks.py` / Engine DJ).
 */
export function djDbAddRootPlaylist(title: string): DjAddPlaylistResult {
  try {
    const d = requireDb();
    const t = title.trim();
    if (!t) {
      return { ok: false, error: "Titre vide" };
    }
    const now = sqlNow();
    const nextId = d.transaction(() => {
      const { nextId: nid } = d
        .prepare("SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM Playlist")
        .get() as { nextId: number };

      d.prepare(
        `INSERT INTO Playlist (id, title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported)
         VALUES (?, ?, 0, 1, 0, ?, 0)`,
      ).run(nid, t, now);

      const seqRow = d
        .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'Playlist'")
        .get() as { seq: number } | undefined;
      if (seqRow) {
        d.prepare(
          "UPDATE sqlite_sequence SET seq = ? WHERE name = 'Playlist'",
        ).run(nid);
      }

      return nid;
    })();

    return { ok: true, id: nextId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

function findPlaylistIdByParentAndTitle(
  d: SqliteDatabase,
  parentListId: number,
  title: string,
): number | null {
  const t = title.trim();
  const row = d
    .prepare(
      `SELECT id FROM Playlist
       WHERE parentListId = ? AND LOWER(TRIM(COALESCE(title, ''))) = LOWER(?)
       LIMIT 1`,
    )
    .get(parentListId, t) as { id: number } | undefined;
  return row?.id ?? null;
}

/**
 * Crée au besoin toute la chaîne de playlists (titre = nom de chaque segment du chemin
 * relatif à la Library), comme l’analyse SYNC.
 */
export async function djDbEnsurePlaylistForLibraryFolder(
  folderAbsPath: string,
): Promise<DjAddPlaylistResult> {
  const libraryRoot = (await storeGet<string>(STORE_KEYS.LIBRARY_FOLDER))?.trim() ?? "";
  if (!libraryRoot) {
    return { ok: false, error: "Dossier Library non configuré (Paramètres)." };
  }
  const conn = await djDbConnectFromStore();
  if (!conn.ok) {
    return {
      ok: false,
      error: conn.error ?? "Base Engine DJ : connexion impossible.",
    };
  }
  const root = path.resolve(libraryRoot);
  const abs = path.resolve(folderAbsPath);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..")) {
    return { ok: false, error: "Le dossier n’est pas sous le dossier Library." };
  }
  const parts = rel.split(path.sep).filter((p) => p.length > 0);
  if (parts.length === 0) {
    return { ok: false, error: "Dossier racine Library : aucune playlist à associer." };
  }

  try {
    const d = requireDb();
    let parentId = 0;
    for (const segment of parts) {
      const found = findPlaylistIdByParentAndTitle(d, parentId, segment);
      if (found != null) {
        parentId = found;
        continue;
      }
      const res =
        parentId === 0
          ? djDbAddRootPlaylist(segment)
          : djDbAddChildPlaylist(parentId, segment);
      if (!res.ok || res.id == null) {
        return { ok: false, error: res.error ?? "Création de playlist refusée." };
      }
      parentId = res.id;
    }
    return { ok: true, id: parentId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

function getInformationDatabaseUuid(d: SqliteDatabase): string | null {
  const row = d
    .prepare("SELECT uuid FROM Information LIMIT 1")
    .get() as { uuid: string | null } | undefined;
  const u = row?.uuid?.trim();
  return u || null;
}

/**
 * Ajoute une piste existante (`Track.id`) à une playlist (`PlaylistEntity`),
 * en chaînant `nextEntityId` comme le fait la doc / scripts Rekordbox.
 */
export function djDbAddTrackToPlaylist(
  destListId: number,
  trackId: number,
): DjAddTrackToPlaylistResult {
  try {
    if (!Number.isFinite(destListId) || destListId < 1) {
      return { ok: false, error: "Playlist de destination invalide" };
    }
    if (!Number.isFinite(trackId) || trackId < 1) {
      return { ok: false, error: "Piste invalide" };
    }

    const d = requireDb();

    const listOk = d
      .prepare("SELECT id FROM Playlist WHERE id = ?")
      .get(destListId) as { id: number } | undefined;
    if (!listOk) {
      return { ok: false, error: "Playlist introuvable" };
    }

    const trackOk = d
      .prepare("SELECT id FROM Track WHERE id = ?")
      .get(trackId) as { id: number } | undefined;
    if (!trackOk) {
      return { ok: false, error: "Piste introuvable" };
    }

    const already = d
      .prepare(
        "SELECT 1 AS x FROM PlaylistEntity WHERE listId = ? AND trackId = ? LIMIT 1",
      )
      .get(destListId, trackId) as { x: number } | undefined;
    if (already) {
      return { ok: false, error: "Cette piste est déjà dans cette playlist." };
    }

    const databaseUuid = getInformationDatabaseUuid(d);
    if (!databaseUuid) {
      return {
        ok: false,
        error: "UUID de base introuvable (table Information).",
      };
    }

    const now = sqlNow();

    d.transaction(() => {
      const oldTail = d
        .prepare(
          `SELECT id FROM PlaylistEntity
           WHERE listId = ? AND IFNULL(nextEntityId, 0) = 0
           ORDER BY id DESC LIMIT 1`,
        )
        .get(destListId) as { id: number } | undefined;

      const { nextId: nid } = d
        .prepare(
          "SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM PlaylistEntity",
        )
        .get() as { nextId: number };

      d.prepare(
        `INSERT INTO PlaylistEntity (id, listId, trackId, databaseUuid, nextEntityId, membershipReference)
         VALUES (?, ?, ?, ?, 0, 0)`,
      ).run(nid, destListId, trackId, databaseUuid);

      if (oldTail && oldTail.id !== nid) {
        d.prepare("UPDATE PlaylistEntity SET nextEntityId = ? WHERE id = ?").run(
          nid,
          oldTail.id,
        );
      }

      d.prepare("UPDATE Playlist SET lastEditTime = ? WHERE id = ?").run(
        now,
        destListId,
      );

      const seqRow = d
        .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'PlaylistEntity'")
        .get() as { seq: number } | undefined;
      if (seqRow) {
        d.prepare(
          "UPDATE sqlite_sequence SET seq = ? WHERE name = 'PlaylistEntity'",
        ).run(nid);
      }
    })();

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Retire une entrée `PlaylistEntity` (la piste `Track` reste dans la base).
 * Répare le chaînage `nextEntityId`.
 */
export function djDbRemoveTrackFromPlaylist(
  listId: number,
  entityId: number,
): DjPlaylistTrackMutationResult {
  try {
    if (!Number.isFinite(listId) || listId < 1) {
      return { ok: false, error: "Playlist invalide" };
    }
    if (!Number.isFinite(entityId) || entityId < 1) {
      return { ok: false, error: "Entrée invalide" };
    }

    const d = requireDb();
    const now = sqlNow();

    d.transaction(() => {
      const row = d
        .prepare(
          "SELECT id, listId, nextEntityId FROM PlaylistEntity WHERE id = ?",
        )
        .get(entityId) as
        | { id: number; listId: number; nextEntityId: number | null }
        | undefined;
      if (!row || row.listId !== listId) {
        throw new Error("Entrée introuvable dans cette playlist.");
      }

      const nextVal =
        row.nextEntityId == null || row.nextEntityId === 0
          ? 0
          : row.nextEntityId;

      const prev = d
        .prepare(
          "SELECT id FROM PlaylistEntity WHERE listId = ? AND nextEntityId = ?",
        )
        .get(listId, entityId) as { id: number } | undefined;

      if (prev) {
        d.prepare("UPDATE PlaylistEntity SET nextEntityId = ? WHERE id = ?").run(
          nextVal,
          prev.id,
        );
      }

      d.prepare("DELETE FROM PlaylistEntity WHERE id = ?").run(entityId);
      d.prepare("UPDATE Playlist SET lastEditTime = ? WHERE id = ?").run(
        now,
        listId,
      );
    })();

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** Réécrit `nextEntityId` pour refléter l’ordre `entityIds` (tête → queue). */
export function djDbReorderPlaylistTracks(
  listId: number,
  entityIds: number[],
): DjPlaylistTrackMutationResult {
  try {
    if (!Number.isFinite(listId) || listId < 1) {
      return { ok: false, error: "Playlist invalide" };
    }
    if (!Array.isArray(entityIds) || entityIds.length === 0) {
      return { ok: false, error: "Ordre vide" };
    }

    const d = requireDb();

    const countRow = d
      .prepare(
        "SELECT COUNT(*) AS c FROM PlaylistEntity WHERE listId = ?",
      )
      .get(listId) as { c: number };
    if (countRow.c !== entityIds.length) {
      return {
        ok: false,
        error: "La liste ne correspond pas au contenu de la playlist.",
      };
    }

    const idSet = new Set(entityIds);
    if (idSet.size !== entityIds.length) {
      return { ok: false, error: "Identifiants dupliqués." };
    }

    const dbIds = d
      .prepare("SELECT id FROM PlaylistEntity WHERE listId = ?")
      .all(listId) as { id: number }[];
    const expected = new Set(dbIds.map((r) => r.id));
    for (const id of entityIds) {
      if (!expected.has(id)) {
        return { ok: false, error: "Entrée inconnue pour cette playlist." };
      }
    }

    const now = sqlNow();

    d.transaction(() => {
      for (let i = 0; i < entityIds.length; i++) {
        const next =
          i < entityIds.length - 1 ? entityIds[i + 1]! : 0;
        d.prepare(
          "UPDATE PlaylistEntity SET nextEntityId = ? WHERE id = ? AND listId = ?",
        ).run(next, entityIds[i]!, listId);
      }
      d.prepare("UPDATE Playlist SET lastEditTime = ? WHERE id = ?").run(
        now,
        listId,
      );
    })();

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

function pathsEqualCaseAware(a: string, b: string): boolean {
  const na = path.normalize(a);
  const nb = path.normalize(b);
  if (process.platform === "win32") {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

/** La colonne `Track.path` contient-elle déjà le nom de fichier (script Python : path + file dans une seule chaîne) ? */
function pathColumnIncludesFilename(pTrim: string, fTrim: string): boolean {
  if (!pTrim || !fTrim) return false;
  const base = path.basename(pTrim.replace(/\\/g, "/"));
  return pathsEqualCaseAware(base, fTrim);
}

/**
 * Reconstruit le chemin absolu disque à partir de `Track.path` + `Track.filename`
 * (évite de concaténer deux fois le nom si `path` est déjà complet, cf. `doc/Add New Tracks.py`).
 */
function resolveTrackAbsoluteFromRow(
  root: string,
  p: string | null,
  f: string | null,
): string | null {
  const pTrim = (p ?? "").trim();
  const fTrim = (f ?? "").trim();
  if (!pTrim && !fTrim) return null;
  if (!pTrim && fTrim) return path.normalize(path.resolve(root, fTrim));
  if (!fTrim) return path.normalize(path.resolve(root, pTrim));
  if (pathColumnIncludesFilename(pTrim, fTrim)) {
    return path.normalize(path.resolve(root, pTrim));
  }
  return path.normalize(path.resolve(root, pTrim, fTrim));
}

function pathVariantsForDb(s: string): string[] {
  const t = s.trim();
  if (!t) return [""];
  const out = new Set<string>();
  out.add(t);
  out.add(t.replace(/\\/g, "/"));
  out.add(t.replace(/\//g, "\\"));
  return [...out];
}

/**
 * Couples (path, filename) possibles en base (Engine DJ / script Python `../MIX/...`).
 */
function candidatePathFilenamePairs(relFwd: string, filename: string): Array<{ path: string; filename: string }> {
  const pairs: Array<{ path: string; filename: string }> = [];
  const seen = new Set<string>();
  const add = (p: string, fn: string) => {
    const k = `${p}\0${fn}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push({ path: p, filename: fn });
  };

  add(relFwd, filename);

  const dirOnly = path.posix.dirname(relFwd);
  if (dirOnly && dirOnly !== "." && dirOnly !== "") {
    add(dirOnly, filename);
  }

  add(`../MIX/${relFwd}`, filename);

  return pairs;
}

/**
 * Trouve `Track.id` pour un fichier absolu sous le dossier Library (paramètre).
 * Gère `Track.path` = dossier seul ou chemin relatif complet (dont nom de fichier), comme en base Rekordbox / script Python.
 */
function findTrackIdForLibraryFile(
  d: SqliteDatabase,
  libraryRoot: string,
  absolutePath: string,
): number | null {
  const root = path.resolve(libraryRoot.trim());
  const abs = path.resolve(absolutePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }

  const absNorm = path.normalize(abs);
  const filename = path.basename(absNorm);
  const relFwd = rel.replace(/\\/g, "/");

  const stmtExact = d.prepare(
    `SELECT id FROM Track WHERE path = ? AND LOWER(filename) = LOWER(?) LIMIT 1`,
  );

  for (const { path: pCol, filename: fnCol } of candidatePathFilenamePairs(
    relFwd,
    filename,
  )) {
    for (const pv of pathVariantsForDb(pCol)) {
      const row = stmtExact.get(pv, fnCol) as { id: number } | undefined;
      if (row) return row.id;
    }
  }

  const rows = d
    .prepare(
      `SELECT id, path, filename FROM Track WHERE LOWER(filename) = LOWER(?)`,
    )
    .all(filename) as { id: number; path: string | null; filename: string | null }[];

  for (const row of rows) {
    const resolved = resolveTrackAbsoluteFromRow(root, row.path, row.filename);
    if (resolved && pathsEqualCaseAware(resolved, absNorm)) {
      return row.id;
    }
  }
  return null;
}

/**
 * Ajoute des fichiers Library (chemins disque) à une playlist après résolution
 * des `Track.id` dans la base Engine DJ.
 */
export async function djDbAddLibraryFilesToPlaylist(
  destListId: number,
  filePaths: string[],
): Promise<DjAddLibraryFilesToPlaylistResult> {
  const failures: { path: string; error: string }[] = [];
  if (filePaths.length === 0) {
    return { ok: false, added: 0, failures: [], error: "Aucun fichier." };
  }

  const libraryRoot = (await storeGet<string>(STORE_KEYS.LIBRARY_FOLDER))?.trim() ?? "";
  if (!libraryRoot) {
    return {
      ok: false,
      added: 0,
      failures: [],
      error: "Dossier Library non configuré (Paramètres).",
    };
  }

  try {
    const d = requireDb();

    const listOk = d
      .prepare("SELECT id FROM Playlist WHERE id = ?")
      .get(destListId) as { id: number } | undefined;
    if (!listOk) {
      return {
        ok: false,
        added: 0,
        failures: [],
        error: "Playlist introuvable.",
      };
    }

    let added = 0;

    for (const fp of filePaths) {
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(fp);
      } catch {
        failures.push({ path: fp, error: "Fichier introuvable." });
        continue;
      }
      if (!st.isFile()) {
        failures.push({ path: fp, error: "Ce n'est pas un fichier." });
        continue;
      }

      const trackId = findTrackIdForLibraryFile(d, libraryRoot, fp);
      if (trackId == null) {
        failures.push({
          path: fp,
          error:
            "Piste introuvable dans la base Engine DJ (import ou chemin).",
        });
        continue;
      }

      const r = djDbAddTrackToPlaylist(destListId, trackId);
      if (!r.ok) {
        failures.push({
          path: fp,
          error: r.error ?? "Impossible d’ajouter la piste.",
        });
        continue;
      }
      added += 1;
    }

    return { ok: true, added, failures };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, added: 0, failures: [], error: msg };
  }
}

function getDefaultAlbumArtId(d: SqliteDatabase): number {
  const row = d
    .prepare("SELECT id FROM AlbumArt LIMIT 1")
    .get() as { id: number } | undefined;
  return row?.id ?? 1;
}

const META_TEXT_MAX = 2000;

function strMeta(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > META_TEXT_MAX ? t.slice(0, META_TEXT_MAX) : t;
}

function joinStringList(
  parts: string[] | undefined,
  separator: string,
): string | null {
  if (!parts?.length) return null;
  const out = parts.map((p) => p?.trim()).filter(Boolean);
  if (!out.length) return null;
  const s = out.join(separator);
  return strMeta(s);
}

/**
 * Titre normalisé d’une entrée `ICommonTagsResult['comment']` (liseuses ID3, etc.).
 */
function commentListToString(
  comments: ICommonTagsResult["comment"] | undefined,
): string | null {
  if (!comments?.length) return null;
  const textParts: string[] = [];
  for (const c of comments) {
    if (c == null) continue;
    const raw =
      typeof c === "object" && c !== null && "text" in c
        ? (c as { text?: unknown }).text
        : c;
    const t = String(raw ?? "")
      .trim();
    if (t) textParts.push(t);
  }
  if (!textParts.length) return null;
  return strMeta(textParts.join(" | "));
}

function artistFromCommon(c: ICommonTagsResult): string | null {
  if (c.artists?.length) {
    return joinStringList(c.artists, " / ");
  }
  return strMeta(c.artist);
}

function yearFromCommon(c: ICommonTagsResult): number {
  if (c.year != null && Number.isFinite(c.year) && c.year > 0) {
    return Math.min(3000, Math.max(0, Math.floor(c.year)));
  }
  const d = c.date?.trim() ?? c.releasedate?.trim() ?? c.originaldate?.trim();
  if (d) {
    const m = /^(\d{4})/.exec(d);
    if (m) {
      const y = parseInt(m[1]!, 10);
      if (Number.isFinite(y) && y > 0) return Math.min(3000, y);
    }
  }
  if (c.originalyear != null && Number.isFinite(c.originalyear) && c.originalyear > 0) {
    return Math.min(3000, Math.floor(c.originalyear));
  }
  return 0;
}

function ratingFromCommon(c: ICommonTagsResult): number {
  const r0 = c.rating?.[0];
  const v = r0?.rating;
  if (v == null || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v * 100)));
}

/**
 * Insère une entrée `Track` pour un fichier sous Library (métadonnées légères) puis
 * `findTrackIdForLibraryFile` la retrouve.
 */
async function insertNewTrackForLibraryFile(
  d: SqliteDatabase,
  libraryRoot: string,
  absFile: string,
): Promise<{ ok: true; trackId: number } | { ok: false; error: string }> {
  const root = path.resolve(libraryRoot.trim());
  const abs = path.resolve(absFile);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, error: "Fichier hors du dossier Library." };
  }
  const relFwd = rel.replace(/\\/g, "/");
  const filename = path.basename(abs);
  /**
   * `path` = chemin relatif complet (sous Library), avec `/`, comme le 1er couple de
   * `candidatePathFilenamePairs` + `findTrackIdForLibraryFile`. Ne pas n’y mettre que
   * le dossier : une UNIQUE sur `Track.path` ferait échouer toutes les pistes d’un
   * même répertoire (conflit) ou empêcherait de retrouver les lignes importées
   * ailleurs.
   */
  const pathCol = relFwd;
  const ext = path.extname(filename).replace(/^\./, "").toLowerCase();
  const fileType = ext || "mp3";

  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(abs);
  } catch {
    return { ok: false, error: "Fichier introuvable sur disque." };
  }
  if (!st.isFile()) {
    return { ok: false, error: "Ce n'est pas un fichier." };
  }

  let mm: IAudioMetadata | null = null;
  try {
    mm = await parseFile(abs, { skipCovers: true });
  } catch {
    mm = null;
  }

  const common = mm?.common;
  const format = mm?.format;

  let lengthSec = 0;
  if (format?.duration != null) {
    lengthSec = Math.max(0, Math.round(format.duration));
  }
  let bitrate: number | null = null;
  if (format?.bitrate != null) {
    bitrate = Math.round(format.bitrate / 1000) || null;
  }

  const title =
    (common?.title?.trim() && common.title.trim()) || filename;
  const artist = common ? artistFromCommon(common) : null;
  const album = strMeta(common?.album);
  const genre = joinStringList(common?.genre, ", ");
  const comment = common ? commentListToString(common.comment) : null;
  const label = strMeta(common?.label?.[0]);
  const composer = joinStringList(common?.composer, " / ");
  const remixer = joinStringList(common?.remixer, " / ");

  const year = common ? yearFromCommon(common) : 0;
  let bpm = 0;
  if (common?.bpm != null && Number.isFinite(common.bpm)) {
    bpm = Math.max(0, Math.round(common.bpm));
  }
  const bpmAnalyzed =
    bpm > 0 ? bpm : null;
  const rating = common ? ratingFromCommon(common) : 0;
  const keyId = 0;
  const titleNorm = strMeta(title) ?? title;
  const hasTextMeta = Boolean(
    (common?.title != null && common.title !== filename) ||
      artist ||
      album ||
      genre ||
      comment ||
      label ||
      composer ||
      remixer ||
      bpm > 0 ||
      year > 0 ||
      rating > 0,
  );

  const now = sqlNow();
  const originUuid = getInformationDatabaseUuid(d);
  if (!originUuid) {
    return { ok: false, error: "UUID de base (Information) introuvable." };
  }
  const albumArtId = getDefaultAlbumArtId(d);
  const fileBytes = st.size;
  const bitRateCol = bitrate ?? 0;

  try {
    const run = d
      .prepare(
        `INSERT INTO Track (
         playOrder, length, bpm, year, path, filename, bitrate, bpmAnalyzed, albumArtId, fileBytes,
         title, artist, album, genre, comment, label, composer, remixer, key, rating, albumArt,
         timeLastPlayed, isPlayed, fileType, isAnalyzed, dateCreated, dateAdded, isAvailable,
         isMetadataOfPackedTrackChanged, isPerfomanceDataOfPackedTrackChanged, playedIndicator, isMetadataImported, pdbImportKey, streamingSource, uri, isBeatGridLocked, originDatabaseUuid, originTrackId, streamingFlags, explicitLyrics, lastEditTime
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        null,
        lengthSec,
        bpm,
        year,
        pathCol,
        filename,
        bitRateCol,
        bpmAnalyzed,
        albumArtId,
        fileBytes,
        titleNorm,
        artist,
        album,
        genre,
        comment,
        label,
        composer,
        remixer,
        keyId,
        rating,
        null,
        null,
        0,
        fileType,
        0,
        now,
        now,
        1,
        0,
        0,
        0,
        hasTextMeta || bpm > 0 || year > 0 || rating > 0 ? 1 : 0,
        0,
        null,
        null,
        0,
        originUuid,
        null,
        0,
        0,
        now,
      );
    const id = Number(run.lastInsertRowid);
    if (!id || !Number.isFinite(id)) {
      return { ok: false, error: "Insertion Track : id invalide." };
    }
    return { ok: true, trackId: id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      /UNIQUE constraint failed/i.test(msg) &&
      /Track\.path/i.test(msg)
    ) {
      const again = findTrackIdForLibraryFile(d, libraryRoot, abs);
      if (again != null) {
        return { ok: true, trackId: again };
      }
    }
    return { ok: false, error: msg };
  }
}

/**
 * Pour chaque lot : résout ou importe chaque piste, puis l’ajoute à la playlist `listId`.
 */
export async function djDbImportTrackBatchToPlaylists(
  batches: { listId: number; filePaths: string[] }[],
): Promise<DjImportTrackBatchToPlaylistsResult> {
  const libraryRoot = (await storeGet<string>(STORE_KEYS.LIBRARY_FOLDER))?.trim() ?? "";
  if (!libraryRoot) {
    return {
      ok: false,
      added: 0,
      failures: [],
      error: "Dossier Library non configuré (Paramètres).",
    };
  }

  const failures: { path: string; listId: number; error: string }[] = [];
  let added = 0;

  let conn: Awaited<ReturnType<typeof djDbConnectFromStore>>;
  try {
    conn = await djDbConnectFromStore();
    if (!conn.ok) {
      return {
        ok: false,
        added: 0,
        failures: [],
        error: conn.error ?? "Base Engine DJ : connexion impossible.",
      };
    }
  } catch (e) {
    return {
      ok: false,
      added: 0,
      failures: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const d = requireDb();

  for (const batch of batches) {
    const { listId, filePaths: rawPaths } = batch;
    if (!Number.isFinite(listId) || listId < 1) {
      for (const p of rawPaths) {
        failures.push({ path: p, listId, error: "listId invalide." });
      }
      continue;
    }
    const listOk = d
      .prepare("SELECT id FROM Playlist WHERE id = ?")
      .get(listId) as { id: number } | undefined;
    if (!listOk) {
      for (const p of rawPaths) {
        failures.push({ path: p, listId, error: "Playlist introuvable." });
      }
      continue;
    }

    const seen = new Set<string>();
    for (const fp of rawPaths) {
      if (seen.has(fp)) continue;
      seen.add(fp);

      const abs = path.resolve(fp);
      let trackId = findTrackIdForLibraryFile(d, libraryRoot, abs);
      if (trackId == null) {
        const ins = await insertNewTrackForLibraryFile(d, libraryRoot, abs);
        if (!ins.ok) {
          failures.push({ path: fp, listId, error: ins.error });
          continue;
        }
        trackId = ins.trackId;
      }

      const r = djDbAddTrackToPlaylist(listId, trackId!);
      if (r.ok) {
        added += 1;
      } else {
        const err = r.error ?? "Impossible d’ajouter la piste.";
        if (err.includes("déjà") || err.includes("Cette piste est déjà")) {
          // déjà en playlist
        } else {
          failures.push({ path: fp, listId, error: err });
        }
      }
    }
  }

  return { ok: true, added, failures };
}

/**
 * Collecte chaque nœud playlist avec une clé = chaîne de titres depuis la racine
 * (même principe que le script `doc/Add New Tracks.py` : un dossier = un titre de playlist).
 */
function collectPlaylistPathEntries(
  nodes: DjPlaylistNode[],
  parentParts: string[] = [],
): { listId: number; pathKey: string; labelPath: string }[] {
  const out: { listId: number; pathKey: string; labelPath: string }[] = [];
  for (const n of nodes) {
    const title = (n.title?.trim() || "(sans titre)").replace(/\s+/g, " ");
    const parts = [...parentParts, title];
    const pathKey = parts.map((p) => p.toLowerCase()).join("/");
    out.push({ listId: n.id, pathKey, labelPath: parts.join(" / ") });
    out.push(...collectPlaylistPathEntries(n.children, parts));
  }
  return out;
}

type LibraryFolderRow = { relKey: string; absPath: string; filePaths: string[] };

/** 1er segment d’une clé de chemin playlist (ex. `house` pour `house/2024`). */
function rootSegmentFromPlaylistPathKey(pathKey: string): string {
  const i = pathKey.indexOf("/");
  return (i === -1 ? pathKey : pathKey.slice(0, i)).trim();
}

/**
 * Un dossier Library descend de ce segment racine (nom du 1er niveau sous la Library).
 */
function libraryHasRootFolderForSegment(
  folders: LibraryFolderRow[],
  rootSeg: string,
): boolean {
  if (!rootSeg) return false;
  for (const f of folders) {
    if (f.relKey === rootSeg || f.relKey.startsWith(`${rootSeg}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Garde l’arbre de playlists (et sous-arbres) seulement si le **1er segment** du
 * `pathKey` (même règle que `collectPlaylistPathEntries`) a un dossier Library
 * (ex. `playlistA/aaa/...` → on exclut toute la branche si `Library/playlistA/`
 * n’existe pas), même quand `playlistA` n’est pas une « racine » Engine
 * (enfant d’un conteneur, etc.).
 */
function prunePlaylistTreeByFirstLibrarySegment(
  nodes: DjPlaylistNode[],
  pathKeyByListId: Map<number, string>,
  folders: LibraryFolderRow[],
): DjPlaylistNode[] {
  const out: DjPlaylistNode[] = [];
  for (const n of nodes) {
    const pathKey = pathKeyByListId.get(n.id);
    if (pathKey == null) {
      continue;
    }
    const firstSeg = rootSegmentFromPlaylistPathKey(pathKey);
    if (!libraryHasRootFolderForSegment(folders, firstSeg)) {
      continue;
    }
    out.push({
      id: n.id,
      title: n.title,
      parentListId: n.parentListId,
      nextListId: n.nextListId,
      children: prunePlaylistTreeByFirstLibrarySegment(
        n.children,
        pathKeyByListId,
        folders,
      ),
    });
  }
  return out;
}

/** Parcours des dossiers sous la Library (hors racine) avec fichiers audio par dossier. */
async function walkLibraryAudioTree(
  libraryRootAbs: string,
  out: LibraryFolderRow[],
  excludeKeys: string[],
): Promise<void> {
  let top;
  try {
    top = await fs.readdir(libraryRootAbs, { withFileTypes: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Lecture du dossier Library : ${msg}`);
  }
  const sorted = top.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  for (const ent of sorted) {
    if (!ent.isDirectory()) continue;
    const childAbs = path.join(libraryRootAbs, ent.name);
    if (excludeKeys.length && isPathExcludedFromLibrary(childAbs, excludeKeys)) {
      continue;
    }
    await walkLibraryDir(childAbs, [ent.name], out, excludeKeys);
  }
}

async function walkLibraryDir(
  absPath: string,
  relSegments: string[],
  out: LibraryFolderRow[],
  excludeKeys: string[],
): Promise<void> {
  if (excludeKeys.length && isPathExcludedFromLibrary(absPath, excludeKeys)) {
    return;
  }
  const relKey = relSegments.map((s) => s.toLowerCase()).join("/");
  const audio = await listFolderAudio(absPath);
  out.push({
    relKey,
    absPath: absPath,
    filePaths: audio.map((a) => a.path),
  });
  let sub;
  try {
    sub = await fs.readdir(absPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of sub.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  )) {
    if (!ent.isDirectory()) continue;
    const childAbs = path.join(absPath, ent.name);
    if (excludeKeys.length && isPathExcludedFromLibrary(childAbs, excludeKeys)) {
      continue;
    }
    await walkLibraryDir(
      childAbs,
      [...relSegments, ent.name],
      out,
      excludeKeys,
    );
  }
}

function getTrackIdsInPlaylist(
  d: SqliteDatabase,
  listId: number,
  cache: Map<number, Set<number>>,
): Set<number> {
  let s = cache.get(listId);
  if (s) return s;
  const rows = d
    .prepare("SELECT trackId FROM PlaylistEntity WHERE listId = ?")
    .all(listId) as { trackId: number }[];
  s = new Set(rows.map((r) => r.trackId));
  cache.set(listId, s);
  return s;
}

/**
 * La **Library est la référence** : on signale d’abord les **playlists manquantes**
 * en base (dossier présent sur disque, pas de playlist de même chemin de titres).
 * Ensuite : pistes pour les seuls dossiers appariés.
 */
export async function djDbAnalyzeLibraryVsPlaylists(): Promise<LibraryPlaylistAnalysisResult> {
  const lines: string[] = [];
  const libraryRoot = (await storeGet<string>(STORE_KEYS.LIBRARY_FOLDER))?.trim() ?? "";
  const dbPathSetting =
    (await storeGet<string>(STORE_KEYS.ENGINE_DJ_DATABASE_PATH))?.trim() ?? "";
  const rawLibExclude = await storeGet<unknown>(STORE_KEYS.LIBRARY_EXCLUDE_PATHS);
  const libExcludeList = parseStoredLibraryExcludePaths(rawLibExclude);
  const libExcludeKeys = libraryExcludeKeysForCompare(libExcludeList);

  if (!libraryRoot) {
    const err = "Dossier Library non configuré (Paramètres).";
    return {
      ok: false,
      error: err,
      lines: [err],
      missingPlaylists: [],
      trackIssues: [],
      warnings: [],
    };
  }

  const conn = await djDbConnectFromStore();
  if (!conn.ok) {
    const e = conn.error ?? "connexion impossible";
    lines.push(`Base Engine DJ : ${e}`);
    lines.push(`Chemin : ${conn.path}`);
    return {
      ok: false,
      error: e,
      lines,
      missingPlaylists: [],
      trackIssues: [],
      warnings: [],
    };
  }

  try {
    const d = requireDb();
    const tree = djDbGetPlaylistTree();
    const plEntries = collectPlaylistPathEntries(tree);
    const playlistByPath = new Map<
      string,
      { listId: number; labelPath: string }
    >();
    const analysisWarnings: string[] = [];
    for (const e of plEntries) {
      if (playlistByPath.has(e.pathKey)) {
        const prev = playlistByPath.get(e.pathKey)!;
        const w = `Même clé d’arborescence pour deux playlists : « ${e.pathKey} » (listId ${prev.listId} et ${e.listId})`;
        analysisWarnings.push(w);
        lines.push(`⚠ ${w}`);
        continue;
      }
      playlistByPath.set(e.pathKey, { listId: e.listId, labelPath: e.labelPath });
    }

    const folders: LibraryFolderRow[] = [];
    try {
      await walkLibraryAudioTree(
        path.resolve(libraryRoot),
        folders,
        libExcludeKeys,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        error: msg,
        lines: [msg],
        missingPlaylists: [],
        trackIssues: [],
        warnings: [],
      };
    }

    const folderRelKeys = new Set(folders.map((f) => f.relKey));
    const pathKeyByListId = new Map<number, string>(
      plEntries.map((e) => [e.listId, e.pathKey] as [number, string]),
    );
    const treeInLibraryPathScope = prunePlaylistTreeByFirstLibrarySegment(
      tree,
      pathKeyByListId,
      folders,
    );
    const dbPlaylistsNotInLibrary = plEntries
      .filter((e) => {
        const rootSeg = rootSegmentFromPlaylistPathKey(e.pathKey);
        if (!libraryHasRootFolderForSegment(folders, rootSeg)) return false;
        return !folderRelKeys.has(e.pathKey);
      })
      .map((e) => ({ listId: e.listId, labelPath: e.labelPath }))
      .sort((a, b) =>
        a.labelPath.localeCompare(b.labelPath, "fr", { sensitivity: "base" }),
      );
    const dbPlaylistTree = buildDbSyncTreeNodes(
      d,
      treeInLibraryPathScope,
      path.resolve(libraryRoot),
    );
    const dbTracksNotInLibrary = collectDbTracksNotInLibrary(
      d,
      path.resolve(libraryRoot),
    );

    lines.push("=== Analyse : Library = référence → playlists Engine DJ ===");
    lines.push(
      "Pour chaque dossier sous le dossier Library, la base doit contenir une playlist",
    );
    lines.push("dont la chaîne de titres reprend le chemin (segments = noms de dossiers).");
    lines.push(`Dossier Library : ${path.resolve(libraryRoot)}`);
    if (libExcludeList.length) {
      lines.push(
        `Dossiers exclus (Paramètres) : ${libExcludeList.length} chemin(s) — non parcourus pour cette analyse.`,
      );
    }
    lines.push(
      `Base (paramètre) : ${dbPathSetting || conn.path} — ouverte : ${conn.path}`,
    );
    lines.push("");
    lines.push("— Playlists manquantes (par rapport à l’arborescence Library) —");

    const dirWithoutPl: { relKey: string; absPath: string; fileCount: number }[] =
      [];
    for (const f of folders) {
      if (!playlistByPath.has(f.relKey)) {
        dirWithoutPl.push({
          relKey: f.relKey,
          absPath: f.absPath,
          fileCount: f.filePaths.length,
        });
      }
    }
    dirWithoutPl.sort((a, b) => a.relKey.localeCompare(b.relKey, "fr"));
    const totalAudioInMissingPlFolders = dirWithoutPl.reduce(
      (s, x) => s + x.fileCount,
      0,
    );
    if (dirWithoutPl.length) {
      lines.push(
        `À créer ou renommer en base : ${dirWithoutPl.length} playlist(s) manquante(s) pour le(s) dossier(s) :`,
      );
      for (const x of dirWithoutPl) {
        const n =
          x.fileCount > 0
            ? `  (${x.fileCount} fichier(s) audio dans ce dossier)`
            : "";
        lines.push(`  ${x.absPath}${n}`);
      }
      if (totalAudioInMissingPlFolders) {
        lines.push(
          `  → ${totalAudioInMissingPlFolders} fichier(s) audio non rattaché(s) à une playlist (tant que celle-ci n’existe pas).`,
        );
      }
      lines.push("");
    } else {
      lines.push("Aucune playlist manquante : chaque dossier Library a une entrée en base.");
      lines.push("");
    }

    lines.push(
      `Compte : ${plEntries.length} playlist(s) dans l’arbre en base, ${folders.length} dossier(s) parcouru(s) sur disque.`,
    );
    lines.push("");

    lines.push(
      "— Pistes (vérification Track + entrée playlist, dossiers déjà appariés uniquement) —",
    );
    const trackCache = new Map<number, Set<number>>();
    const trackIssues: LibraryTrackSyncIssue[] = [];
    let missingDb = 0;
    let missingInList = 0;
    let okTracks = 0;

    for (const row of folders) {
      const pl = playlistByPath.get(row.relKey);
      if (!pl) continue;
      if (row.filePaths.length === 0) continue;
      for (const filePath of row.filePaths) {
        const trackId = findTrackIdForLibraryFile(d, libraryRoot, filePath);
        if (trackId == null) {
          missingDb += 1;
          trackIssues.push({
            filePath,
            kind: "not_in_db",
            listId: pl.listId,
          });
          lines.push(`  ${filePath}  [listId ${pl.listId}]`);
          continue;
        }
        const inList = getTrackIdsInPlaylist(
          d,
          pl.listId,
          trackCache,
        ).has(trackId);
        if (!inList) {
          missingInList += 1;
          trackIssues.push({
            filePath,
            kind: "not_in_playlist",
            listId: pl.listId,
            trackId,
          });
          lines.push(
            `  Piste en base mais pas dans la playlist : ${filePath}  (trackId ${trackId}, listId ${pl.listId})`,
          );
        } else {
          okTracks += 1;
        }
      }
    }

    if (missingDb === 0 && missingInList === 0) {
      lines.push(
        `Aucun écart sur les pistes (fichiers vérifiés : ${okTracks}).`,
      );
    } else {
      lines.push("");
      lines.push(
        `Résumé : ${okTracks} OK | ${missingDb} absent(s) de la base | ${missingInList} absent(s) de la playlist`,
      );
    }

    return {
      ok: true,
      lines,
      missingPlaylists: dirWithoutPl,
      trackIssues,
      warnings: analysisWarnings,
      dbPlaylistTree,
      dbPlaylistsNotInLibrary,
      dbTracksNotInLibrary,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lines.push(msg);
    return {
      ok: false,
      error: msg,
      lines,
      missingPlaylists: [],
      trackIssues: [],
      warnings: [],
    };
  }
}
