import { statSync } from "fs";
import fs from "fs/promises";
import path from "path";
import Database from "better-sqlite3";
import { STORE_KEYS } from "@shared/constants";
import type {
  DjAddLibraryFilesToPlaylistResult,
  DjAddPlaylistResult,
  DjAddTrackToPlaylistResult,
  DjDbConnectResult,
  DjPlaylistNode,
  DjPlaylistTrackMutationResult,
  DjPlaylistTrackRow,
} from "@shared/types";
import { storeGet } from "./store";

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

/**
 * Trouve `Track.id` pour un fichier absolu sous le dossier Library (paramètre),
 * en comparant avec `path.join(libraryRoot, Track.path, Track.filename)`.
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
  const rows = d
    .prepare(
      `SELECT id, path, filename FROM Track WHERE LOWER(filename) = LOWER(?)`,
    )
    .all(filename) as { id: number; path: string | null; filename: string | null }[];

  for (const row of rows) {
    const p = (row.path ?? "").trim();
    const f = (row.filename ?? "").trim();
    const candidate = path.normalize(path.join(root, p, f));
    if (pathsEqualCaseAware(candidate, absNorm)) {
      return row.id;
    }
    const relDb = path.join(p, f);
    if (pathsEqualCaseAware(path.normalize(rel), path.normalize(relDb))) {
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
