import type { DjPlaylistNode, DjPlaylistTrackRow, ElectronApi } from "@shared/types";
import { contextMenu, type ContextMenuEntry } from "./context-menu";
import { showAlert, showConfirm, showPrompt } from "./dialogs";
import { eventBus } from "../lib/event-bus";

declare global {
  interface Window {
    electronApi: ElectronApi;
  }
}

interface PlaylistTreeUiState {
  /** Ids des playlists affichées comme dossiers `<details>` ouverts. */
  openFolderIds: Set<number>;
  /** Playlist sélectionnée dans l’arbre (surbrillance). */
  selectedListId: number | null;
}

/** Payload drag : piste Engine DJ à copier vers une autre playlist. */
const TRACK_TO_PLAYLIST_DRAG_MIME =
  "application/x-tracks-dj-playlist-track";

interface TrackDragPayload {
  trackId: number;
  sourceListId: number;
  entityId: number;
}

export class PlaylistsPanel {
  private readonly api = window.electronApi;
  private readonly root: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly colsBody: HTMLElement;
  private readonly leftPane: HTMLElement;
  private readonly treeEl: HTMLElement;
  private readonly tracksEl: HTMLElement;
  /** Playlist dont les pistes sont affichées à droite (pour rafraîchir après drop). */
  private viewedPlaylistId: number | null = null;
  /** Pendant un drag depuis la liste de pistes (`getData` est vide en `dragover`). */
  private activeTrackDrag: TrackDragPayload | null = null;

  constructor(container: HTMLElement) {
    container.replaceChildren();
    this.root = document.createElement("div");
    this.root.className = "dj-playlists";
    this.root.innerHTML = `
      <div class="dj-playlists__banner" hidden></div>
      <div class="dj-playlists__cols fe-body">
        <section class="dj-playlists__pane dj-playlists__pane--tree" aria-label="Playlists">
          <header class="dj-playlists__pane-head">Playlists</header>
          <div class="fe-tree dj-pl-tree"></div>
        </section>
        <div class="fe-divider" aria-hidden="true"></div>
        <section class="dj-playlists__pane dj-playlists__pane--tracks" aria-label="Pistes">
          <header class="dj-playlists__pane-head">Pistes</header>
          <div class="fe-content dj-pl-tracks"></div>
        </section>
      </div>
    `;
    container.append(this.root);
    this.banner = this.root.querySelector(".dj-playlists__banner")!;
    this.colsBody = this.root.querySelector(".dj-playlists__cols")!;
    this.leftPane = this.root.querySelector(".dj-playlists__pane--tree")!;
    this.treeEl = this.root.querySelector(".dj-pl-tree")!;
    this.tracksEl = this.root.querySelector(".dj-pl-tracks")!;

    this.root.tabIndex = -1;
    this.root.addEventListener("keydown", (e) => {
      if (e.key !== "Delete") return;
      if ((e.target as HTMLElement).closest("input, textarea, select")) {
        return;
      }
      const row = this.tracksEl.querySelector<HTMLElement>(
        ".fe-row--playlist-tracks.is-selected[data-entity-id]",
      );
      if (!row?.dataset.entityId || this.viewedPlaylistId == null) return;
      e.preventDefault();
      void this.promptRemoveSelectedPlaylistTrack(row);
    });

    this.initDividerResize();
    this.initTrackToPlaylistDnD();
    this.initPlaylistTrackReorderDnD();

    this.root.addEventListener("mousedown", (e) => {
      if (!this.root.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      this.root.focus({ preventScroll: true });
    });

    this.treeEl.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-list-id]",
      );
      if (!t?.dataset.listId) return;
      const id = Number(t.dataset.listId);
      if (!Number.isFinite(id)) return;
      void this.selectPlaylist(id, t);
    });

    this.treeEl.addEventListener("contextmenu", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-list-id]",
      );
      if (!t?.dataset.listId) return;
      e.preventDefault();
      e.stopPropagation();
      const parentListId = Number(t.dataset.listId);
      if (!Number.isFinite(parentListId)) return;

      const items: ContextMenuEntry[] = [
        {
          label: "➕  Ajouter une playlist",
          action: () => {
            void this.promptAddChildPlaylist(parentListId);
          },
        },
      ];
      contextMenu.show(items, e.clientX, e.clientY);
    });
  }

  private clearTrackDropHighlight(): void {
    this.treeEl
      .querySelectorAll(".fe-tree-item.fe-drop-target")
      .forEach((el) => el.classList.remove("fe-drop-target"));
  }

  private clearReorderDropIndicator(): void {
    this.tracksEl
      .querySelectorAll(
        ".fe-row--playlist-tracks.dj-pl-track-drop-before, .fe-row--playlist-tracks.dj-pl-track-drop-after",
      )
      .forEach((el) => {
        el.classList.remove("dj-pl-track-drop-before", "dj-pl-track-drop-after");
      });
  }

  private parseTrackDragPayload(raw: string): TrackDragPayload | null {
    try {
      const o = JSON.parse(raw) as {
        trackId?: unknown;
        sourceListId?: unknown;
        entityId?: unknown;
      };
      const trackId = Number(o.trackId);
      const sourceListId = Number(o.sourceListId);
      const entityId = Number(o.entityId);
      if (
        !Number.isFinite(trackId) ||
        !Number.isFinite(sourceListId) ||
        !Number.isFinite(entityId)
      ) {
        return null;
      }
      return { trackId, sourceListId, entityId };
    } catch {
      return null;
    }
  }

  private collectVisibleEntityIds(): number[] {
    return [
      ...this.tracksEl.querySelectorAll<HTMLElement>(
        ".fe-row--playlist-tracks[data-entity-id]",
      ),
    ]
      .map((el) => Number(el.dataset.entityId))
      .filter((id) => Number.isFinite(id));
  }

  private reorderIntentAt(
    clientX: number,
    clientY: number,
  ): { targetEntityId: number; before: boolean } | "append" | null {
    const payload = this.activeTrackDrag;
    if (
      !payload ||
      this.viewedPlaylistId == null ||
      payload.sourceListId !== this.viewedPlaylistId
    ) {
      return null;
    }

    const topEl = document.elementFromPoint(clientX, clientY) as
      | HTMLElement
      | null;
    const row = topEl?.closest<HTMLElement>(
      ".fe-row--playlist-tracks[data-entity-id]",
    );
    if (row && this.tracksEl.contains(row)) {
      const targetEntityId = Number(row.dataset.entityId);
      if (!Number.isFinite(targetEntityId)) return null;
      const rect = row.getBoundingClientRect();
      const before = clientY < rect.top + rect.height / 2;
      return { targetEntityId, before };
    }

    if (topEl && this.tracksEl.contains(topEl)) {
      return "append";
    }
    return null;
  }

  private reorderEntityArray(
    orderedIds: number[],
    dragId: number,
    targetId: number,
    before: boolean,
  ): number[] | null {
    if (dragId === targetId) return null;
    const arr = [...orderedIds];
    const fromIdx = arr.indexOf(dragId);
    if (fromIdx < 0) return null;
    arr.splice(fromIdx, 1);
    const tIdx = arr.indexOf(targetId);
    if (tIdx < 0) return null;
    const insertAt = before ? tIdx : tIdx + 1;
    arr.splice(insertAt, 0, dragId);
    return arr;
  }

  private initPlaylistTrackReorderDnD(): void {
    this.tracksEl.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes(TRACK_TO_PLAYLIST_DRAG_MIME)) return;
      const payload = this.activeTrackDrag;
      if (
        !payload ||
        this.viewedPlaylistId == null ||
        payload.sourceListId !== this.viewedPlaylistId
      ) {
        return;
      }

      this.clearReorderDropIndicator();
      this.clearTrackDropHighlight();

      const intent = this.reorderIntentAt(e.clientX, e.clientY);
      if (intent == null) return;

      if (intent === "append") {
        const rows = this.tracksEl.querySelectorAll<HTMLElement>(
          ".fe-row--playlist-tracks[data-entity-id]",
        );
        const last = rows[rows.length - 1];
        if (last) last.classList.add("dj-pl-track-drop-after");
      } else {
        const row = this.tracksEl.querySelector<HTMLElement>(
          `.fe-row--playlist-tracks[data-entity-id="${intent.targetEntityId}"]`,
        );
        if (row) {
          row.classList.add(
            intent.before
              ? "dj-pl-track-drop-before"
              : "dj-pl-track-drop-after",
          );
        }
      }

      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });

    this.tracksEl.addEventListener("dragleave", (e) => {
      if (!e.dataTransfer?.types.includes(TRACK_TO_PLAYLIST_DRAG_MIME)) return;
      const related = e.relatedTarget as Node | null;
      if (related && this.tracksEl.contains(related)) return;
      this.clearReorderDropIndicator();
    });

    this.tracksEl.addEventListener("drop", (e) => {
      if (!e.dataTransfer?.types.includes(TRACK_TO_PLAYLIST_DRAG_MIME)) return;
      const raw = e.dataTransfer.getData(TRACK_TO_PLAYLIST_DRAG_MIME);
      const payload =
        this.parseTrackDragPayload(raw) ?? this.activeTrackDrag;
      if (!payload) return;
      if (this.viewedPlaylistId !== payload.sourceListId) return;

      e.preventDefault();
      e.stopPropagation();
      this.clearReorderDropIndicator();

      void this.applyPlaylistTrackReorderDrop(e, payload);
    });
  }

  private async applyPlaylistTrackReorderDrop(
    e: DragEvent,
    payload: TrackDragPayload,
  ): Promise<void> {
    const listId = this.viewedPlaylistId;
    if (listId == null) return;

    const original = this.collectVisibleEntityIds();
    if (original.length === 0) return;

    const intent = this.reorderIntentAt(e.clientX, e.clientY);
    if (intent == null) return;

    let next: number[] | null = null;
    if (intent === "append") {
      if (original[original.length - 1] === payload.entityId) return;
      next = original.filter((id) => id !== payload.entityId);
      next.push(payload.entityId);
    } else {
      if (intent.targetEntityId === payload.entityId) return;
      next = this.reorderEntityArray(
        original,
        payload.entityId,
        intent.targetEntityId,
        intent.before,
      );
    }

    if (
      !next ||
      (next.length === original.length &&
        next.every((id, i) => id === original[i]))
    ) {
      return;
    }

    const result = await this.api.engineDj.reorderPlaylistTracks({
      listId,
      entityIds: next,
    });
    if (!result.ok) {
      await showAlert(result.error ?? "Impossible de réordonner les pistes.");
      return;
    }
    try {
      await this.refreshViewedPlaylistTracksIfShowing(listId);
    } catch (err) {
      await showAlert(err instanceof Error ? err.message : String(err));
    }
  }

  private async promptRemoveSelectedPlaylistTrack(
    row: HTMLElement,
  ): Promise<void> {
    const listId = this.viewedPlaylistId;
    if (listId == null) return;
    const entityId = Number(row.dataset.entityId);
    if (!Number.isFinite(entityId)) return;

    const title =
      row.querySelector(".fe-row__name")?.textContent?.trim() || "cette piste";

    const confirmed = await showConfirm(
      `Retirer « ${title} » de la playlist ?\nLe fichier audio ne sera pas supprimé du disque.`,
    );
    if (!confirmed) return;

    const result = await this.api.engineDj.removeTrackFromPlaylist({
      listId,
      entityId,
    });
    if (!result.ok) {
      await showAlert(result.error ?? "Impossible de retirer la piste.");
      return;
    }
    try {
      await this.refreshViewedPlaylistTracksIfShowing(listId);
    } catch (err) {
      await showAlert(err instanceof Error ? err.message : String(err));
    }
  }

  private initTrackToPlaylistDnD(): void {
    this.treeEl.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes(TRACK_TO_PLAYLIST_DRAG_MIME)) return;

      const leaf = (e.target as HTMLElement).closest<HTMLElement>(
        ".fe-tree-item[data-list-id]",
      );
      this.clearTrackDropHighlight();
      this.clearReorderDropIndicator();

      const payload = this.activeTrackDrag;

      if (!leaf?.dataset.listId) {
        e.dataTransfer.dropEffect = "none";
        return;
      }

      const destListId = Number(leaf.dataset.listId);
      if (!Number.isFinite(destListId)) {
        e.dataTransfer.dropEffect = "none";
        return;
      }

      if (!payload) {
        e.dataTransfer.dropEffect = "none";
        return;
      }

      if (destListId === payload.sourceListId) {
        e.dataTransfer.dropEffect = "none";
        return;
      }

      leaf.classList.add("fe-drop-target");
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    this.treeEl.addEventListener("dragleave", (e) => {
      if (!e.dataTransfer?.types.includes(TRACK_TO_PLAYLIST_DRAG_MIME)) return;
      const related = e.relatedTarget as Node | null;
      if (related && this.treeEl.contains(related)) return;
      this.clearTrackDropHighlight();
      this.clearReorderDropIndicator();
    });

    this.treeEl.addEventListener("drop", (e) => {
      if (!e.dataTransfer?.types.includes(TRACK_TO_PLAYLIST_DRAG_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      this.clearTrackDropHighlight();
      this.clearReorderDropIndicator();

      const raw = e.dataTransfer.getData(TRACK_TO_PLAYLIST_DRAG_MIME);
      const payload =
        this.parseTrackDragPayload(raw) ?? this.activeTrackDrag;
      if (!payload) return;

      const leaf = (e.target as HTMLElement).closest<HTMLElement>(
        ".fe-tree-item[data-list-id]",
      );
      if (!leaf?.dataset.listId) return;

      const destListId = Number(leaf.dataset.listId);
      if (!Number.isFinite(destListId)) return;
      if (destListId === payload.sourceListId) return;

      void this.applyTrackDropToPlaylist(payload.trackId, destListId);
    });
  }

  private async applyTrackDropToPlaylist(
    trackId: number,
    destListId: number,
  ): Promise<void> {
    const result = await this.api.engineDj.addTrackToPlaylist({
      destListId,
      trackId,
    });
    if (!result.ok) {
      await showAlert(result.error ?? "Impossible d’ajouter la piste.");
      return;
    }
    try {
      await this.refreshViewedPlaylistTracksIfShowing(destListId);
    } catch (err) {
      await showAlert(err instanceof Error ? err.message : String(err));
    }
  }

  private async refreshViewedPlaylistTracksIfShowing(
    destListId: number,
  ): Promise<void> {
    if (this.viewedPlaylistId !== destListId) return;
    const sel = this.treeEl.querySelector<HTMLElement>(
      ".fe-tree-item.is-selected[data-list-id]",
    );
    if (!sel?.dataset.listId) return;
    const id = Number(sel.dataset.listId);
    if (id !== destListId) return;
    await this.selectPlaylist(destListId, sel);
  }

  private async promptAddChildPlaylist(parentListId: number): Promise<void> {
    const name = await showPrompt("Nom de la nouvelle playlist :");
    const title = name?.trim();
    if (!title) return;

    const result = await this.api.engineDj.addChildPlaylist({
      parentListId,
      title,
    });
    if (!result.ok) {
      await showAlert(result.error ?? "Impossible d'ajouter la playlist.");
      return;
    }

    try {
      await this.refreshTreePreservingUi([parentListId]);
    } catch (err) {
      await showAlert(err instanceof Error ? err.message : String(err));
    }
  }

  private async refreshTreePreservingUi(
    extraOpenFolderIds?: number[],
  ): Promise<void> {
    const ui = this.snapshotTreeUiState();
    if (extraOpenFolderIds) {
      for (const id of extraOpenFolderIds) {
        ui.openFolderIds.add(id);
      }
    }
    const tree = await this.api.engineDj.getPlaylistTree();
    this.renderTree(tree);
    this.restoreTreeUiState(ui);
  }

  private snapshotTreeUiState(): PlaylistTreeUiState {
    const openFolderIds = new Set<number>();
    this.treeEl.querySelectorAll<HTMLDetailsElement>("details.dj-pl-folder").forEach(
      (det) => {
        if (!det.open) return;
        const sum = det.querySelector("summary[data-list-id]") as
          | HTMLElement
          | null;
        const sid = sum?.dataset.listId;
        if (sid != null && Number.isFinite(Number(sid))) {
          openFolderIds.add(Number(sid));
        }
      },
    );

    const selEl = this.treeEl.querySelector(
      ".fe-tree-item.is-selected",
    ) as HTMLElement | null;
    const sel = selEl?.dataset.listId;
    const selectedListId =
      sel != null && Number.isFinite(Number(sel)) ? Number(sel) : null;

    return { openFolderIds, selectedListId };
  }

  private restoreTreeUiState(state: PlaylistTreeUiState): void {
    this.treeEl.querySelectorAll<HTMLDetailsElement>("details.dj-pl-folder").forEach(
      (det) => {
        const sum = det.querySelector("summary[data-list-id]") as
          | HTMLElement
          | null;
        const sid = sum?.dataset.listId;
        if (sid != null && state.openFolderIds.has(Number(sid))) {
          det.open = true;
        }
      },
    );

    if (state.selectedListId == null) return;
    const el = this.treeEl.querySelector<HTMLElement>(
      `[data-list-id="${state.selectedListId}"]`,
    );
    if (!el) return;

    let n: HTMLElement | null = el;
    while (n) {
      if (n instanceof HTMLDetailsElement && n.classList.contains("dj-pl-folder")) {
        n.open = true;
      }
      n = n.parentElement;
    }

    el.classList.add("is-selected");
  }

  private initDividerResize(): void {
    const divider = this.root.querySelector<HTMLElement>(".fe-divider")!;

    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(
        80,
        Math.min(startWidth + delta, this.colsBody.clientWidth - 100),
      );
      this.colsBody.style.gridTemplateColumns = `${newWidth}px 3px 1fr`;
    };

    const onMouseUp = () => {
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    divider.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startWidth = this.leftPane.getBoundingClientRect().width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  async init(): Promise<void> {
    await this.reconnect();
  }

  async reconnect(): Promise<void> {
    this.viewedPlaylistId = null;
    this.clearSelectionHighlight();
    this.banner.hidden = true;
    this.banner.textContent = "";

    const res = await this.api.engineDj.connect();
    if (!res.ok) {
      this.banner.textContent = `Base DJ : ${res.error ?? "erreur"} — ${res.path}`;
      this.banner.hidden = false;
      this.treeEl.replaceChildren();
      this.showTracksPlaceholder("Connectez une base valide dans Paramètres → Engine DJ.");
      return;
    }

    try {
      const tree = await this.api.engineDj.getPlaylistTree();
      this.renderTree(tree);
      this.showTracksPlaceholder("Sélectionnez une playlist à gauche.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.banner.textContent = `Lecture des playlists : ${msg}`;
      this.banner.hidden = false;
      this.treeEl.replaceChildren();
      this.showTracksPlaceholder(msg);
    }
  }

  private clearSelectionHighlight(): void {
    this.treeEl
      .querySelectorAll(".fe-tree-item.is-selected")
      .forEach((el) => el.classList.remove("is-selected"));
  }

  private renderTree(nodes: DjPlaylistNode[]): void {
    this.treeEl.replaceChildren();
    if (nodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "fe-empty";
      empty.textContent = "Aucune playlist dans cette base.";
      this.treeEl.appendChild(empty);
      return;
    }
    for (const n of nodes) {
      this.treeEl.appendChild(this.renderNode(n, 0));
    }
  }

  private renderNode(node: DjPlaylistNode, depth: number): HTMLElement {
    if (node.children.length > 0) {
      const det = document.createElement("details");
      det.className = "dj-pl-folder";
      const sum = document.createElement("summary");
      sum.className = "fe-tree-item";
      sum.style.paddingLeft = `${8 + depth * 16}px`;
      sum.dataset.listId = String(node.id);
      const arrow = document.createElement("span");
      arrow.className = "fe-tree-arrow";
      const label = document.createElement("span");
      label.className = "fe-tree-label";
      label.textContent = node.title?.trim() || "(sans titre)";
      sum.append(arrow, label);
      const inner = document.createElement("div");
      inner.className = "dj-pl-folder__kids";
      for (const c of node.children) {
        inner.appendChild(this.renderNode(c, depth + 1));
      }
      det.append(sum, inner);
      return det;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fe-tree-item dj-pl-tree-leaf";
    btn.style.paddingLeft = `${8 + depth * 16}px`;
    btn.dataset.listId = String(node.id);
    const leafArrow = document.createElement("span");
    leafArrow.className = "fe-tree-arrow fe-tree-arrow--empty";
    const leafLabel = document.createElement("span");
    leafLabel.className = "fe-tree-label";
    leafLabel.textContent = node.title?.trim() || "(sans titre)";
    btn.append(leafArrow, leafLabel);
    return btn;
  }

  private showTracksPlaceholder(text: string): void {
    this.tracksEl.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "fe-empty";
    empty.textContent = text;
    this.tracksEl.appendChild(empty);
  }

  private async selectPlaylist(listId: number, sourceEl: HTMLElement): Promise<void> {
    this.viewedPlaylistId = listId;
    this.clearSelectionHighlight();
    sourceEl.classList.add("is-selected");

    this.tracksEl.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "fe-empty";
    loading.textContent = "Chargement…";
    this.tracksEl.appendChild(loading);

    try {
      const rows = await this.api.engineDj.getPlaylistTracks(listId);
      this.tracksEl.replaceChildren();
      if (rows.length === 0) {
        this.showTracksPlaceholder("Cette liste ne contient aucune piste.");
        return;
      }
      for (const row of rows) {
        this.tracksEl.appendChild(this.renderTrackRow(row, listId));
      }
      this.root.focus({ preventScroll: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.showTracksPlaceholder(msg);
    }
  }

  private renderTrackRow(
    row: DjPlaylistTrackRow,
    sourceListId: number,
  ): HTMLElement {
    const el = document.createElement("div");
    el.className = "fe-row fe-row--playlist-tracks";
    el.draggable = true;
    el.dataset.trackId = String(row.trackId);
    el.dataset.sourceListId = String(sourceListId);
    el.dataset.entityId = String(row.entityId);
    const path = row.path?.trim() ?? "";
    if (path) {
      el.title = path;
    }

    const iconSpan = document.createElement("span");
    iconSpan.className = "fe-row__icon";
    iconSpan.textContent = "🎵";

    const titleSpan = document.createElement("span");
    titleSpan.className = "fe-row__name";
    titleSpan.textContent = row.title?.trim() || "—";

    const artistSpan = document.createElement("span");
    artistSpan.className = "fe-row__size fe-row__size--playlist";
    artistSpan.textContent = row.artist?.trim() || "—";

    const fileSpan = document.createElement("span");
    fileSpan.className = "fe-row__ext fe-row__ext--playlist";
    const fn = row.filename?.trim();
    fileSpan.textContent = fn || (path ? path.split(/[/\\]/).pop() ?? "" : "");

    el.append(iconSpan, titleSpan, artistSpan, fileSpan);

    el.addEventListener("dragstart", (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const payload: TrackDragPayload = {
        trackId: row.trackId,
        sourceListId,
        entityId: row.entityId,
      };
      this.activeTrackDrag = payload;
      dt.setData(TRACK_TO_PLAYLIST_DRAG_MIME, JSON.stringify(payload));
      dt.effectAllowed = "copyMove";
    });

    el.addEventListener("dragend", () => {
      this.activeTrackDrag = null;
      this.clearTrackDropHighlight();
      this.clearReorderDropIndicator();
    });

    el.addEventListener("click", () => {
      this.tracksEl.querySelectorAll(".fe-row.is-selected").forEach((r) => {
        r.classList.remove("is-selected");
      });
      el.classList.add("is-selected");
    });

    if (path) {
      el.addEventListener("dblclick", () => {
        eventBus.emit("play-file", { filePath: path });
      });
    }

    return el;
  }
}
