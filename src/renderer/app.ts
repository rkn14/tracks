import type { ElectronApi, PanelState } from "@shared/types";
import { STORE_KEYS } from "@shared/constants";
import { FileExplorer } from "./components/file-explorer";
import { AudioPlayer } from "./components/audio-player";
import { eventBus } from "./lib/event-bus";

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

  const openSettings = async () => {
    const [savedKey, savedPrompt, savedLibrary] = await Promise.all([
      electronApi.store.get<string>(STORE_KEYS.OPENAI_API_KEY),
      electronApi.store.get<string>(STORE_KEYS.GENRE_PROMPT),
      electronApi.store.get<string>(STORE_KEYS.LIBRARY_FOLDER),
    ]);
    openaiInput.value = savedKey ?? "";
    genrePromptInput.value = savedPrompt ?? "";
    libraryInput.value = savedLibrary ?? "";
    settingsOverlay.hidden = false;
  };

  const closeSettings = () => {
    settingsOverlay.hidden = true;
  };

  let rightPanel: FileExplorer | null = null;

  const saveSettings = async () => {
    const newLibrary = libraryInput.value.trim();
    await Promise.all([
      electronApi.store.set(STORE_KEYS.OPENAI_API_KEY, openaiInput.value.trim()),
      electronApi.store.set(STORE_KEYS.GENRE_PROMPT, genrePromptInput.value),
      electronApi.store.set(STORE_KEYS.LIBRARY_FOLDER, newLibrary),
    ]);
    if (rightPanel && newLibrary) {
      await rightPanel.setLockedRoot(newLibrary);
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

  // ── Left panel tabs ─────────────────────────
  const panelTabBtns = document.querySelectorAll<HTMLButtonElement>(".panel-tabs__btn");
  const panelTabPages = document.querySelectorAll<HTMLElement>(".panel-tab-page");

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
  const leftState = await electronApi.store.get<PanelState>(
    STORE_KEYS.LEFT_PANEL,
  );
  const savedLibrary = await electronApi.store.get<string>(
    STORE_KEYS.LIBRARY_FOLDER,
  );

  // ── File explorers ───────────────────────────
  const leftPanel = new FileExplorer(
    document.getElementById("panel-left")!,
    "left",
  );
  rightPanel = new FileExplorer(
    document.getElementById("panel-right")!,
    "right",
  );

  await leftPanel.init(leftState?.currentPath);
  await rightPanel.init();
  if (savedLibrary) {
    await rightPanel.setLockedRoot(savedLibrary);
  }

  // After a move/delete, the other panel asks to be refreshed
  eventBus.on("refresh-panel", ({ panelId }) => {
    if (panelId === "left") leftPanel.refresh();
    else rightPanel.refresh();
  });

  // ── Audio player ─────────────────────────────
  new AudioPlayer(document.getElementById("player-section")!);
}
