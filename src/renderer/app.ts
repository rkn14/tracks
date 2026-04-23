import type { ElectronApi, PanelState } from "@shared/types";
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

  // ── Analyse provisoire Library ↔ playlists (Engine DJ) ──
  const libraryAnalyzeBtn = document.getElementById("btn-library-analyze");
  const libraryAnalyzeOverlay = document.getElementById("library-analyze-overlay");
  const libraryAnalyzeText = document.getElementById("library-analyze-text");
  const closeLibraryAnalyze = (): void => {
    libraryAnalyzeOverlay?.setAttribute("hidden", "");
  };
  document.getElementById("library-analyze-close")?.addEventListener("click", closeLibraryAnalyze);
  libraryAnalyzeOverlay?.addEventListener("click", (e) => {
    if (e.target === libraryAnalyzeOverlay) closeLibraryAnalyze();
  });
  libraryAnalyzeOverlay?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLibraryAnalyze();
  });
  libraryAnalyzeBtn?.addEventListener("click", async () => {
    libraryAnalyzeBtn.setAttribute("disabled", "");
    try {
      const r = await electronApi.engineDj.analyzeLibraryPlaylists();
      if (libraryAnalyzeText) {
        libraryAnalyzeText.textContent = r.lines.join("\n");
      }
      libraryAnalyzeOverlay?.removeAttribute("hidden");
      libraryAnalyzeOverlay?.focus();
    } finally {
      libraryAnalyzeBtn.removeAttribute("disabled");
    }
  });

  // ── Audio player ─────────────────────────────
  new AudioPlayer(document.getElementById("player-section")!);
}
