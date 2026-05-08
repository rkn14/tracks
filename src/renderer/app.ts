import type {
  DjSyncTreeNode,
  ElectronApi,
  LibraryPlaylistAnalysisResult,
  LibraryTrackSyncIssue,
  PanelState,
} from "@shared/types";
import { STORE_KEYS } from "@shared/constants";
import {
  getProfileTagLabel,
  resolveProfileTagIdFromUserInput,
} from "@shared/profile-tag-labels";
import { PROFILE_TAG_AXES } from "@shared/profile-scores";
import {
  defaultProfileTagColorHex,
  mergeProfileTagColorsWithDefaults,
} from "@shared/profile-tag-colors";
import {
  loadProfileTagsAvailable,
  normalizeProfileTagsAvailable,
} from "@shared/profile-tags-settings";
import { loadAndApplyProfileTagTheme } from "./lib/profile-tag-theme";
import { FileExplorer } from "./components/file-explorer";
import { PlaylistsPanel } from "./components/playlists-panel";
import { AudioPlayer } from "./components/audio-player";
import { eventBus } from "./lib/event-bus";
import {
  normalizeLibraryExcludePaths,
  parseStoredLibraryExcludePaths,
} from "@shared/library-exclude-paths";
import type { TrackIssueFolderNode } from "./lib/sync-track-issues";
import {
  buildTrackIssueFolderTree,
  folderNodeHasTrackIssues,
  pathBasename,
  sortFolderChildKeys,
} from "./lib/sync-track-issues";
import { contextMenu, type ContextMenuEntry } from "./components/context-menu";
declare global {
  interface Window {
    electronApi: ElectronApi;
  }
}

export async function initApp(): Promise<void> {
  const { electronApi } = window;

  // ── Title bar controls ───────────────────────
  document
    .getElementById("btn-minimize")
    ?.addEventListener("click", () => electronApi.window.minimize());
  document
    .getElementById("btn-maximize")
    ?.addEventListener("click", () => electronApi.window.maximize());
  document
    .getElementById("btn-close")
    ?.addEventListener("click", () => electronApi.window.close());

  // ── Settings panel ────────────────────────────
  const settingsOverlay = document.getElementById("settings-overlay")!;
  const libraryInput = document.getElementById("input-library-folder") as HTMLInputElement;
  const engineDjDbInput = document.getElementById("input-engine-dj-db") as HTMLInputElement;
  const openaiInput = document.getElementById("input-openai-key") as HTMLInputElement;
  const genrePromptInput = document.getElementById("input-genre-prompt") as HTMLTextAreaElement;

  // Tab switching
  const tabs = settingsOverlay.querySelectorAll<HTMLButtonElement>(".settings-tab");
  const pages = settingsOverlay.querySelectorAll<HTMLElement>(".settings-page");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("is-active"));
      pages.forEach((p) => p.classList.remove("is-active"));
      tab.classList.add("is-active");
      const target = tab.dataset.tab!;
      settingsOverlay.querySelector(`.settings-page[data-page="${target}"]`)?.classList.add("is-active");
    });
  });

  // Browse library folder
  document.getElementById("btn-browse-library")?.addEventListener("click", async () => {
    const folder = await electronApi.dialog.selectFolder("Sélectionner le dossier Library");
    if (folder) libraryInput.value = folder;
  });

  const defaultEngineDjDb = "J:\\m.db";

  const playlistsPanel = new PlaylistsPanel(
    document.getElementById("panel-playlists")!,
  );

  let profileTagsDraft: string[] = [];
  let profileTagColorsDraft: Record<string, string> = {};
  let libraryExcludeDraft: string[] = [];
  const profileTagsListEl = document.getElementById("settings-profile-tags-list");
  const profileTagAddInput = document.getElementById("settings-profile-tag-add") as
    | HTMLInputElement
    | null;
  const profileTagAddError = document.getElementById("settings-profile-tag-add-error") as
    | HTMLParagraphElement
    | null;
  const profileTagAddBtn = document.getElementById("btn-profile-tag-add") as
    | HTMLButtonElement
    | null;
  const libraryExcludeListEl = document.getElementById("settings-library-exclude-list");
  const libraryExcludeInput = document.getElementById("settings-library-exclude-input") as
    | HTMLInputElement
    | null;
  const libraryExcludeBrowseBtn = document.getElementById("btn-library-exclude-browse");
  const libraryExcludeAddBtn = document.getElementById("btn-library-exclude-add");

  const profileTagSuggestions = document.getElementById("settings-profile-tag-suggestions");
  if (profileTagSuggestions && profileTagSuggestions.childElementCount === 0) {
    for (const axis of PROFILE_TAG_AXES) {
      const oLabel = document.createElement("option");
      oLabel.value = getProfileTagLabel(axis);
      profileTagSuggestions.appendChild(oLabel);
      const oId = document.createElement("option");
      oId.value = axis;
      profileTagSuggestions.appendChild(oId);
    }
  }

  const setProfileTagAddError = (message: string | null): void => {
    if (!profileTagAddError) return;
    if (message) {
      profileTagAddError.textContent = message;
      profileTagAddError.hidden = false;
    } else {
      profileTagAddError.textContent = "";
      profileTagAddError.hidden = true;
    }
  };

  const tryAddProfileTagFromInput = (): void => {
    if (!profileTagAddInput || profileTagAddInput.disabled) return;
    setProfileTagAddError(null);
    const resolved = resolveProfileTagIdFromUserInput(profileTagAddInput.value);
    if (resolved === undefined) {
      setProfileTagAddError(
        "Critère non reconnu : axe connu (ex. energy, Groove) ou tag personnalisé (ex. mon_vibe, 1–32 car. : a-z, 0-9, _).",
      );
      return;
    }
    if (profileTagsDraft.includes(resolved)) {
      setProfileTagAddError("Ce critère est déjà dans la liste.");
      return;
    }
    profileTagsDraft.push(resolved);
    profileTagColorsDraft[resolved] = defaultProfileTagColorHex(resolved);
    profileTagAddInput.value = "";
    renderSettingsProfileTagsList();
  };

  const renderSettingsProfileTagsList = (): void => {
    if (!profileTagsListEl) return;
    profileTagsListEl.replaceChildren();
    for (const axis of profileTagsDraft) {
      const li = document.createElement("li");
      li.className = "settings-profile-tag-row";
      li.dataset.profileTag = axis;
      const name = document.createElement("span");
      name.className = "settings-profile-tag-name";
      name.textContent = getProfileTagLabel(axis);
      const colorIn = document.createElement("input");
      colorIn.type = "color";
      colorIn.className = "settings-profile-tag-color";
      colorIn.dataset.profileTag = axis;
      colorIn.value =
        profileTagColorsDraft[axis] ?? defaultProfileTagColorHex(axis);
      colorIn.title = "Couleur du tag (lecteur et listes)";
      colorIn.setAttribute("aria-label", `Couleur de ${getProfileTagLabel(axis)}`);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-profile-tag-remove";
      btn.dataset.profileTag = axis;
      btn.title = "Retirer de la liste";
      btn.setAttribute("aria-label", `Retirer ${getProfileTagLabel(axis)}`);
      btn.textContent = "\u2715";
      li.append(name, colorIn, btn);
      profileTagsListEl.appendChild(li);
    }
    if (profileTagAddInput && profileTagAddBtn) {
      profileTagAddInput.disabled = false;
      profileTagAddBtn.disabled = false;
    }
  };

  const renderSettingsLibraryExcludeList = (): void => {
    if (!libraryExcludeListEl) return;
    libraryExcludeListEl.replaceChildren();
    for (let i = 0; i < libraryExcludeDraft.length; i++) {
      const p = libraryExcludeDraft[i]!;
      const li = document.createElement("li");
      li.className = "settings-profile-tag-row";
      const name = document.createElement("span");
      name.className = "settings-profile-tag-name";
      name.textContent = p;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-profile-tag-remove";
      btn.dataset.libraryExcludeIndex = String(i);
      btn.title = "Retirer";
      btn.setAttribute("aria-label", `Retirer ${p}`);
      btn.textContent = "\u2715";
      li.append(name, btn);
      libraryExcludeListEl.appendChild(li);
    }
  };

  const tryAddLibraryExcludeFromInput = (): void => {
    if (!libraryExcludeInput) return;
    const t = libraryExcludeInput.value.trim();
    if (!t) return;
    const before = libraryExcludeDraft.length;
    libraryExcludeDraft = normalizeLibraryExcludePaths([
      ...libraryExcludeDraft,
      t,
    ]);
    if (libraryExcludeDraft.length === before) {
      libraryExcludeInput.value = "";
      return;
    }
    libraryExcludeInput.value = "";
    renderSettingsLibraryExcludeList();
  };

  libraryExcludeListEl?.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>(
      ".settings-profile-tag-remove",
    );
    if (!t?.dataset.libraryExcludeIndex) return;
    const idx = parseInt(t.dataset.libraryExcludeIndex, 10);
    if (Number.isNaN(idx) || idx < 0) return;
    libraryExcludeDraft.splice(idx, 1);
    renderSettingsLibraryExcludeList();
  });

  libraryExcludeBrowseBtn?.addEventListener("click", async () => {
    const folder = await electronApi.dialog.selectFolder(
      "Dossier à exclure du panneau Library",
    );
    if (folder && libraryExcludeInput) libraryExcludeInput.value = folder;
  });

  libraryExcludeAddBtn?.addEventListener("click", () => {
    tryAddLibraryExcludeFromInput();
  });

  libraryExcludeInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      tryAddLibraryExcludeFromInput();
    }
  });

  profileTagsListEl?.addEventListener("input", (e) => {
    const t = e.target;
    if (
      !(
        t instanceof HTMLInputElement &&
        t.classList.contains("settings-profile-tag-color")
      )
    ) {
      return;
    }
    const id = t.dataset.profileTag;
    if (!id) return;
    profileTagColorsDraft[id] = t.value;
  });

  profileTagsListEl?.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>(
      ".settings-profile-tag-remove",
    );
    if (!t?.dataset.profileTag) return;
    const axis = t.dataset.profileTag;
    if (!axis) return;
    profileTagsDraft = profileTagsDraft.filter((a) => a !== axis);
    delete profileTagColorsDraft[axis];
    renderSettingsProfileTagsList();
  });

  profileTagAddBtn?.addEventListener("click", () => {
    tryAddProfileTagFromInput();
  });

  profileTagAddInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      tryAddProfileTagFromInput();
    }
  });

  profileTagAddInput?.addEventListener("input", () => {
    setProfileTagAddError(null);
  });

  const openSettings = async () => {
    const [
      savedKey,
      savedPrompt,
      savedLibrary,
      savedEngineDjDb,
      savedProfileTags,
      rawTagColors,
      rawLibraryExclude,
    ] = await Promise.all([
      electronApi.store.get<string>(STORE_KEYS.OPENAI_API_KEY),
      electronApi.store.get<string>(STORE_KEYS.GENRE_PROMPT),
      electronApi.store.get<string>(STORE_KEYS.LIBRARY_FOLDER),
      electronApi.store.get<string>(STORE_KEYS.ENGINE_DJ_DATABASE_PATH),
      loadProfileTagsAvailable((key) => electronApi.store.get(key)),
      electronApi.store.get<Record<string, string>>(STORE_KEYS.PROFILE_TAG_COLORS),
      electronApi.store.get(STORE_KEYS.LIBRARY_EXCLUDE_PATHS),
    ]);
    openaiInput.value = savedKey ?? "";
    genrePromptInput.value = savedPrompt ?? "";
    libraryInput.value = savedLibrary ?? "";
    engineDjDbInput.value = savedEngineDjDb?.trim() || defaultEngineDjDb;
    libraryExcludeDraft = parseStoredLibraryExcludePaths(rawLibraryExclude);
    renderSettingsLibraryExcludeList();
    if (libraryExcludeInput) libraryExcludeInput.value = "";
    profileTagsDraft = [...savedProfileTags];
    profileTagColorsDraft = mergeProfileTagColorsWithDefaults(
      rawTagColors,
      profileTagsDraft,
    );
    if (profileTagAddInput) {
      profileTagAddInput.value = "";
      profileTagAddInput.disabled = false;
    }
    setProfileTagAddError(null);
    renderSettingsProfileTagsList();
    settingsOverlay.hidden = false;
  };

  const closeSettings = () => {
    settingsOverlay.hidden = true;
  };

  let rightPanel: FileExplorer | null = null;

  const saveSettings = async () => {
    const newLibrary = libraryInput.value.trim();
    const engineDjDb = engineDjDbInput.value.trim() || defaultEngineDjDb;
    const previousProfileTags = await loadProfileTagsAvailable((key) =>
      electronApi.store.get(key),
    );
    const profileTagsToStore = normalizeProfileTagsAvailable(profileTagsDraft);
    const tagColorsToStore = mergeProfileTagColorsWithDefaults(
      profileTagColorsDraft,
      profileTagsToStore,
    );
    const profileTagsChanged =
      previousProfileTags.length !== profileTagsToStore.length ||
      previousProfileTags.some((a, i) => a !== profileTagsToStore[i]);
    const libExcludeToStore = normalizeLibraryExcludePaths(libraryExcludeDraft);
    await Promise.all([
      electronApi.store.set(STORE_KEYS.OPENAI_API_KEY, openaiInput.value.trim()),
      electronApi.store.set(STORE_KEYS.GENRE_PROMPT, genrePromptInput.value),
      electronApi.store.set(STORE_KEYS.LIBRARY_FOLDER, newLibrary),
      electronApi.store.set(STORE_KEYS.ENGINE_DJ_DATABASE_PATH, engineDjDb),
      electronApi.store.set(STORE_KEYS.PROFILE_TAGS_AVAILABLE, profileTagsToStore),
      electronApi.store.set(STORE_KEYS.PROFILE_TAG_COLORS, tagColorsToStore),
      electronApi.store.set(STORE_KEYS.LIBRARY_EXCLUDE_PATHS, libExcludeToStore),
    ]);
    await loadAndApplyProfileTagTheme((key) => electronApi.store.get(key));
    if (rightPanel && newLibrary) {
      await rightPanel.setLockedRoot(newLibrary);
    }
    if (rightPanel) {
      rightPanel.setLibraryExcludePaths(libExcludeToStore);
      await rightPanel.refresh();
    }
    await playlistsPanel.reconnect();
    if (profileTagsChanged) {
      eventBus.emit("profile-tags-available-changed", {});
    }
    closeSettings();
  };

  document.getElementById("btn-settings")?.addEventListener("click", openSettings);
  document.getElementById("settings-close")?.addEventListener("click", closeSettings);
  document.getElementById("settings-cancel")?.addEventListener("click", closeSettings);
  document.getElementById("settings-save")?.addEventListener("click", saveSettings);

  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });
  settingsOverlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettings();
  });

  // ── Left panel tabs (cibler uniquement la barre gauche ; le panneau droit n’a qu’un libellé)
  const panelTabBtns = document.querySelectorAll<HTMLButtonElement>(
    "#panel-tabs-left .panel-tabs__btn",
  );
  const panelTabPages = document.querySelectorAll<HTMLElement>(
    "#panel-left, #panel-playlists",
  );

  panelTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      panelTabBtns.forEach((b) => b.classList.remove("is-active"));
      panelTabPages.forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      const target = btn.dataset.panelTab!;
      document.querySelector(`.panel-tab-page[data-panel-page="${target}"]`)?.classList.add("is-active");
    });
  });

  // ── Restore saved state ──────────────────────
  const [leftState, savedLibrary, rawLibraryExcludePaths] = await Promise.all([
    electronApi.store.get<PanelState>(STORE_KEYS.LEFT_PANEL),
    electronApi.store.get<string>(STORE_KEYS.LIBRARY_FOLDER),
    electronApi.store.get(STORE_KEYS.LIBRARY_EXCLUDE_PATHS),
  ]);

  await loadAndApplyProfileTagTheme((key) => electronApi.store.get(key));

  // ── File explorers ───────────────────────────
  const leftPanel = new FileExplorer(
    document.getElementById("panel-left")!,
    "left",
  );
  rightPanel = new FileExplorer(
    document.getElementById("panel-right")!,
    "right",
  );
  rightPanel.setLibraryExcludePaths(
    parseStoredLibraryExcludePaths(rawLibraryExcludePaths),
  );

  await leftPanel.init(leftState?.currentPath);
  await rightPanel.init();
  if (savedLibrary) {
    await rightPanel.setLockedRoot(savedLibrary);
  }

  await playlistsPanel.init();

  // After a move/delete, the other panel asks to be refreshed
  eventBus.on("refresh-panel", ({ panelId }) => {
    if (panelId === "left") leftPanel.refresh();
    else rightPanel.refresh();
  });

  // ── SYNC (même analyse `djDbAnalyzeLibraryVsPlaylists` : listes + rapport texte) ──
  const syncBtn = document.getElementById("btn-library-analyze");
  const syncOverlay = document.getElementById("sync-overlay");
  const syncLoading = document.getElementById("sync-loading");
  const syncContent = document.getElementById("sync-content");
  const syncError = document.getElementById("sync-error");
  const syncWarningsBlock = document.getElementById("sync-warnings-block");
  const syncWarningsList = document.getElementById("sync-warnings-list");
  const syncMissingPlaylists = document.getElementById("sync-missing-playlists");
  const syncMissingPlaylistsEmpty = document.getElementById("sync-missing-playlists-empty");
  const syncTrackIssues = document.getElementById("sync-track-issues");
  const syncTrackIssuesEmpty = document.getElementById("sync-track-issues-empty");
  const syncDbTree = document.getElementById("sync-db-tree");
  const syncDbOrphanPlaylists = document.getElementById(
    "sync-db-orphan-playlists",
  );
  const syncDbOrphanTracks = document.getElementById("sync-db-orphan-tracks");
  const syncDbOrphanPlEmpty = document.getElementById(
    "sync-db-orphan-pl-empty",
  );
  const syncDbOrphanTracksEmpty = document.getElementById(
    "sync-db-orphan-tracks-empty",
  );

  const renderSyncDbTreeNode = (n: DjSyncTreeNode): HTMLLIElement => {
    const li = document.createElement("li");
    li.className = "sync-db-tree__node";

    const hasExpandableContent =
      n.trackFileNames.length > 0 || n.children.length > 0;

    if (hasExpandableContent) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sync-db-tree__row";
      row.setAttribute("aria-expanded", "false");

      const chevron = document.createElement("span");
      chevron.className = "sync-db-tree__chevron";
      chevron.setAttribute("aria-hidden", "true");

      const titleSpan = document.createElement("span");
      titleSpan.className = "sync-db-tree__playlist-title";
      titleSpan.textContent = n.title;

      row.append(chevron, titleSpan);

      const body = document.createElement("div");
      body.className = "sync-db-tree__node-body";
      body.hidden = true;

      for (let i = 0; i < n.trackFileNames.length; i++) {
        const tr = document.createElement("div");
        tr.className = "sync-db-tree__track";
        tr.textContent = n.trackFileNames[i]!;
        const ap = n.trackAbsPaths[i];
        if (ap) tr.setAttribute("data-explorer-path", ap);
        body.appendChild(tr);
      }
      if (n.children.length) {
        const ul = document.createElement("ul");
        ul.className = "sync-db-tree__list sync-db-tree__list--nested";
        for (const c of n.children) {
          ul.appendChild(renderSyncDbTreeNode(c));
        }
        body.appendChild(ul);
      }

      li.append(row, body);
    } else {
      const row = document.createElement("div");
      row.className = "sync-db-tree__row sync-db-tree__row--leaf";
      const titleSpan = document.createElement("span");
      titleSpan.className = "sync-db-tree__playlist-title";
      titleSpan.textContent = n.title;
      row.appendChild(titleSpan);
      li.appendChild(row);
    }

    return li;
  };

  const renderSyncDbTree = (
    container: HTMLElement,
    nodes: DjSyncTreeNode[],
  ): void => {
    container.replaceChildren();
    if (nodes.length === 0) {
      const p = document.createElement("p");
      p.className = "sync-list-empty";
      p.textContent = "Aucune playlist";
      container.appendChild(p);
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "sync-db-tree__list";
    ul.setAttribute("role", "group");
    for (const n of nodes) {
      ul.appendChild(renderSyncDbTreeNode(n));
    }
    container.appendChild(ul);
  };

  syncDbTree?.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "button.sync-db-tree__row",
    );
    if (!row || !syncDbTree?.contains(row)) return;
    const body = row.nextElementSibling;
    if (!body || !body.classList.contains("sync-db-tree__node-body")) return;
    const expanded = row.getAttribute("aria-expanded") === "true";
    const next = !expanded;
    row.setAttribute("aria-expanded", String(next));
    (body as HTMLElement).hidden = !next;
  });

  const formatTrackIssueMeta = (t: LibraryTrackSyncIssue): string =>
    t.kind === "not_in_playlist"
      ? `Piste en base, absente de la playlist — trackId ${t.trackId}, listId ${t.listId}`
      : "";

  const renderTrackIssueFileRow = (t: LibraryTrackSyncIssue): HTMLLIElement => {
    const li = document.createElement("li");
    li.className = "sync-lib-issues-file";
    li.title = t.filePath;
    li.setAttribute("data-explorer-path", t.filePath);
    li.dataset.listId = String(t.listId);
    const textCol = document.createElement("div");
    textCol.className = "sync-lib-issues-file__text";
    const nameEl = document.createElement("span");
    nameEl.className = "sync-list__path";
    nameEl.textContent = pathBasename(t.filePath);
    textCol.appendChild(nameEl);
    const metaLine = formatTrackIssueMeta(t);
    if (metaLine) {
      const meta = document.createElement("span");
      meta.className = "sync-list__meta";
      meta.textContent = metaLine;
      textCol.appendChild(meta);
    }
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className =
      "sync-btn-add-to-db sync-btn-add-issues-file sync-btn-add-to-db--compact dialog-btn dialog-btn--primary";
    addBtn.textContent = "add track to database";
    li.append(textCol, addBtn);
    return li;
  };

  const renderTrackIssueFolderNode = (
    node: TrackIssueFolderNode,
  ): HTMLLIElement => {
    const li = document.createElement("li");
    li.className = "sync-lib-issues-node";
    const header = document.createElement("div");
    header.className = "sync-lib-issues-folder-header";
    const row = document.createElement("button");
    row.type = "button";
    row.className = "sync-lib-issues-folder-row";
    row.setAttribute("aria-expanded", "true");
    const chev = document.createElement("span");
    chev.className = "sync-db-tree__chevron";
    chev.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "sync-lib-issues-folder-label";
    label.textContent = node.segment;
    row.append(chev, label);
    header.appendChild(row);
    if (folderNodeHasTrackIssues(node)) {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className =
        "sync-btn-add-to-db sync-btn-add-issues-folder sync-btn-add-to-db--compact dialog-btn dialog-btn--primary";
      addBtn.textContent = "add tracks to database";
      header.appendChild(addBtn);
    }
    const body = document.createElement("div");
    body.className = "sync-lib-issues-folder-body";
    const inner = document.createElement("ul");
    inner.className = "sync-lib-issues-nested";
    for (const k of sortFolderChildKeys(node.children)) {
      const ch = node.children.get(k);
      if (ch) inner.appendChild(renderTrackIssueFolderNode(ch));
    }
    for (const issue of node.files) {
      inner.appendChild(renderTrackIssueFileRow(issue));
    }
    body.appendChild(inner);
    li.append(header, body);
    return li;
  };

  const renderTrackIssuesTree = (
    container: HTMLUListElement,
    issues: LibraryTrackSyncIssue[],
  ): void => {
    container.replaceChildren();
    if (issues.length === 0) return;
    const root = buildTrackIssueFolderTree(issues);
    for (const k of sortFolderChildKeys(root.children)) {
      const n = root.children.get(k);
      if (n) container.appendChild(renderTrackIssueFolderNode(n));
    }
    for (const t of root.files) {
      container.appendChild(renderTrackIssueFileRow(t));
    }
  };

  syncTrackIssues?.addEventListener("click", (e) => {
    const addFileBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "button.sync-btn-add-issues-file",
    );
    if (addFileBtn && syncTrackIssues?.contains(addFileBtn)) {
      e.preventDefault();
      e.stopPropagation();
      const fileLi = addFileBtn.closest<HTMLLIElement>("li.sync-lib-issues-file");
      const p = fileLi?.getAttribute("data-explorer-path");
      const listIdS = fileLi?.dataset?.listId;
      if (!p || listIdS == null) return;
      const listId = parseInt(listIdS, 10);
      if (!Number.isFinite(listId)) return;
      void importTrackIssueBatches(
        [{ listId, filePaths: [p] }],
        addFileBtn,
      );
      return;
    }
    const addFolderBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "button.sync-btn-add-issues-folder",
    );
    if (addFolderBtn && syncTrackIssues?.contains(addFolderBtn)) {
      e.preventDefault();
      e.stopPropagation();
      const wrap = addFolderBtn.closest("li.sync-lib-issues-node");
      const body = wrap?.querySelector(".sync-lib-issues-folder-body");
      if (!body) return;
      const fileLis = body.querySelectorAll<HTMLLIElement>(".sync-lib-issues-file");
      const byList = new Map<number, string[]>();
      for (const li of fileLis) {
        const fp = li.getAttribute("data-explorer-path");
        const listIdS = li.dataset.listId;
        if (!fp || listIdS == null) continue;
        const id = parseInt(listIdS, 10);
        if (!Number.isFinite(id)) continue;
        let arr = byList.get(id);
        if (!arr) {
          arr = [];
          byList.set(id, arr);
        }
        if (!arr.includes(fp)) arr.push(fp);
      }
      if (byList.size === 0) return;
      const batches = [...byList.entries()].map(
        ([listId, filePaths]) => ({
          listId,
          filePaths,
        }),
      );
      void importTrackIssueBatches(batches, addFolderBtn);
      return;
    }
    const row = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "button.sync-lib-issues-folder-row",
    );
    if (!row || !syncTrackIssues?.contains(row)) return;
    const li = row.closest("li.sync-lib-issues-node");
    const body = li?.querySelector(".sync-lib-issues-folder-body");
    if (!body || !body.classList.contains("sync-lib-issues-folder-body")) return;
    const expanded = row.getAttribute("aria-expanded") === "true";
    const next = !expanded;
    row.setAttribute("aria-expanded", String(next));
    (body as HTMLElement).hidden = !next;
  });

  const closeSync = (): void => {
    syncOverlay?.setAttribute("hidden", "");
  };

  const fillSyncFromResult = (r: LibraryPlaylistAnalysisResult): void => {
    const missing = r.missingPlaylists ?? [];
    const issues = r.trackIssues ?? [];
    const warnings = r.warnings ?? [];
    const dbTree = r.dbPlaylistTree ?? [];
    const orphanPl = r.dbPlaylistsNotInLibrary ?? [];
    const orphanTr = r.dbTracksNotInLibrary ?? [];

    if (syncDbTree) {
      renderSyncDbTree(syncDbTree, dbTree);
    }

    if (syncDbOrphanPlaylists && syncDbOrphanPlEmpty) {
      syncDbOrphanPlaylists.replaceChildren();
      for (const p of orphanPl) {
        const li = document.createElement("li");
        li.textContent = p.labelPath;
        syncDbOrphanPlaylists.appendChild(li);
      }
      syncDbOrphanPlEmpty.toggleAttribute("hidden", orphanPl.length > 0);
    }

    if (syncDbOrphanTracks && syncDbOrphanTracksEmpty) {
      syncDbOrphanTracks.replaceChildren();
      for (const t of orphanTr) {
        const li = document.createElement("li");
        li.textContent = t.fileName;
        if (t.absPath) li.setAttribute("data-explorer-path", t.absPath);
        syncDbOrphanTracks.appendChild(li);
      }
      syncDbOrphanTracksEmpty.toggleAttribute("hidden", orphanTr.length > 0);
    }

    if (syncWarningsBlock && syncWarningsList) {
      syncWarningsList.replaceChildren();
      if (warnings.length) {
        syncWarningsBlock.removeAttribute("hidden");
        for (const w of warnings) {
          const li = document.createElement("li");
          li.textContent = w;
          syncWarningsList.appendChild(li);
        }
      } else {
        syncWarningsBlock.setAttribute("hidden", "");
      }
    }

    if (syncMissingPlaylists && syncMissingPlaylistsEmpty) {
      syncMissingPlaylists.replaceChildren();
      for (const p of missing) {
        const li = document.createElement("li");
        li.className = "sync-missing-row";
        li.setAttribute("data-explorer-path", p.absPath);
        const textCol = document.createElement("div");
        textCol.className = "sync-missing-row__text";
        const pathEl = document.createElement("span");
        pathEl.className = "sync-list__path";
        pathEl.textContent = p.absPath;
        textCol.appendChild(pathEl);
        if (p.fileCount > 0) {
          const meta = document.createElement("span");
          meta.className = "sync-list__meta";
          meta.textContent = `${p.fileCount} fichier(s) audio dans ce dossier`;
          textCol.appendChild(meta);
        }
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className =
          "sync-btn-add-to-db sync-btn-add-to-db--compact dialog-btn dialog-btn--primary";
        addBtn.textContent = "add tracks to database";
        addBtn.dataset.folderPath = p.absPath;
        li.append(textCol, addBtn);
        syncMissingPlaylists.appendChild(li);
      }
      syncMissingPlaylistsEmpty.toggleAttribute("hidden", missing.length > 0);
    }

    if (syncTrackIssues && syncTrackIssuesEmpty) {
      renderTrackIssuesTree(
        syncTrackIssues as HTMLUListElement,
        issues,
      );
      syncTrackIssuesEmpty.toggleAttribute("hidden", issues.length > 0);
    }
  };

  async function importTrackIssueBatches(
    batches: { listId: number; filePaths: string[] }[],
    button: HTMLButtonElement,
  ): Promise<void> {
    syncError?.setAttribute("hidden", "");
    if (syncError) syncError.textContent = "";
    button.disabled = true;
    try {
      const res = await electronApi.engineDj.importTrackBatchToPlaylists({
        batches,
      });
      if (!res.ok) {
        if (syncError) {
          syncError.textContent =
            res.error ?? "Import des pistes en base impossible.";
          syncError.removeAttribute("hidden");
        }
        return;
      }
      if (res.failures.length && syncError) {
        const lines = res.failures
          .slice(0, 8)
          .map((f) => `${f.path} (playlist ${f.listId}) : ${f.error}`);
        syncError.textContent = [
          `${res.added} piste(s) traitée(s). ${res.failures.length} échec(s) :`,
          ...lines,
          res.failures.length > 8 ? "…" : "",
        ]
          .filter(Boolean)
          .join("\n");
        syncError.removeAttribute("hidden");
      }
      await playlistsPanel.reconnect();
      const r = await electronApi.engineDj.analyzeLibraryPlaylists();
      if (!r.ok) {
        if (syncError) {
          syncError.textContent = r.error ?? r.lines.join("\n");
          syncError.removeAttribute("hidden");
        }
        return;
      }
      fillSyncFromResult(r);
    } finally {
      button.disabled = false;
    }
  }

  syncMissingPlaylists?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      ".sync-btn-add-to-db",
    );
    if (!btn || !syncMissingPlaylists?.contains(btn)) return;
    const folderPath = btn.dataset.folderPath;
    if (!folderPath) return;
    void (async () => {
      syncError?.setAttribute("hidden", "");
      if (syncError) syncError.textContent = "";
      btn.disabled = true;
      try {
        const res = await electronApi.engineDj.ensureLibraryPlaylist({
          folderAbsPath: folderPath,
        });
        if (!res.ok) {
          if (syncError) {
            syncError.textContent =
              res.error ?? "Échec de la création de la (des) playlist(s).";
            syncError.removeAttribute("hidden");
          }
          return;
        }
        await playlistsPanel.reconnect();
        const r = await electronApi.engineDj.analyzeLibraryPlaylists();
        if (!r.ok) {
          if (syncError) {
            syncError.textContent = r.error ?? r.lines.join("\n");
            syncError.removeAttribute("hidden");
          }
          return;
        }
        fillSyncFromResult(r);
      } finally {
        btn.disabled = false;
      }
    })();
  });

  const openSync = (): void => {
    syncOverlay?.removeAttribute("hidden");
    syncLoading?.removeAttribute("hidden");
    syncContent?.setAttribute("hidden", "");
    syncError?.setAttribute("hidden", "");
    if (syncError) syncError.textContent = "";
    syncOverlay?.focus();

    void (async () => {
      syncBtn?.setAttribute("disabled", "");
      try {
        const r = await electronApi.engineDj.analyzeLibraryPlaylists();
        syncLoading?.setAttribute("hidden", "");
        if (!r.ok) {
          if (syncError) {
            syncError.textContent = r.error ?? r.lines.join("\n");
            syncError.removeAttribute("hidden");
          }
          return;
        }
        fillSyncFromResult(r);
        syncContent?.removeAttribute("hidden");
      } catch (e) {
        syncLoading?.setAttribute("hidden", "");
        if (syncError) {
          syncError.textContent = e instanceof Error ? e.message : String(e);
          syncError.removeAttribute("hidden");
        }
      } finally {
        syncBtn?.removeAttribute("disabled");
      }
    })();
  };

  document.getElementById("sync-close")?.addEventListener("click", closeSync);
  syncOverlay?.addEventListener("contextmenu", (e) => {
    if (syncOverlay?.hasAttribute("hidden")) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-explorer-path]",
    );
    const pathToShow = el?.getAttribute("data-explorer-path")?.trim();
    if (!pathToShow) return;
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuEntry[] = [
      {
        label: "Afficher dans l'Explorateur",
        action: () => {
          electronApi.fs.showInExplorer(pathToShow);
        },
      },
    ];
    contextMenu.show(items, e.clientX, e.clientY);
  });

  syncOverlay?.addEventListener("click", (e) => {
    if (e.target === syncOverlay) closeSync();
  });
  syncOverlay?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSync();
  });
  syncBtn?.addEventListener("click", openSync);

  // ── Audio player ─────────────────────────────
  new AudioPlayer(document.getElementById("player-section")!);
}
