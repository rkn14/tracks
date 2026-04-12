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
  const openaiInput = document.getElementById("input-openai-key") as HTMLInputElement;
  const genrePromptInput = document.getElementById("input-genre-prompt") as HTMLTextAreaElement;

  const openSettings = async () => {
    const [savedKey, savedPrompt] = await Promise.all([
      electronApi.store.get<string>(STORE_KEYS.OPENAI_API_KEY),
      electronApi.store.get<string>(STORE_KEYS.GENRE_PROMPT),
    ]);
    openaiInput.value = savedKey ?? "";
    genrePromptInput.value = savedPrompt ?? "";
    settingsOverlay.hidden = false;
  };

  const closeSettings = () => {
    settingsOverlay.hidden = true;
  };

  const saveSettings = async () => {
    await Promise.all([
      electronApi.store.set(STORE_KEYS.OPENAI_API_KEY, openaiInput.value.trim()),
      electronApi.store.set(STORE_KEYS.GENRE_PROMPT, genrePromptInput.value),
    ]);
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

  // ── Restore saved state ──────────────────────
  const leftState = await electronApi.store.get<PanelState>(
    STORE_KEYS.LEFT_PANEL,
  );
  const rightState = await electronApi.store.get<PanelState>(
    STORE_KEYS.RIGHT_PANEL,
  );

  // ── File explorers ───────────────────────────
  const leftPanel = new FileExplorer(
    document.getElementById("panel-left")!,
    "left",
  );
  const rightPanel = new FileExplorer(
    document.getElementById("panel-right")!,
    "right",
  );

  await Promise.all([
    leftPanel.init(leftState?.currentPath),
    rightPanel.init(rightState?.currentPath),
  ]);

  // After a move/delete, the other panel asks to be refreshed
  eventBus.on("refresh-panel", ({ panelId }) => {
    if (panelId === "left") leftPanel.refresh();
    else rightPanel.refresh();
  });

  // ── Audio player ─────────────────────────────
  new AudioPlayer(document.getElementById("player-section")!);
}
