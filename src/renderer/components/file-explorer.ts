import type { FileEntry, Volume, ElectronApi } from "@shared/types";
import { AUDIO_EXTENSIONS } from "@shared/types";
import {
  contextMenu,
  type ContextMenuEntry,
} from "./context-menu";
import { showPrompt, showConfirm, showAlert } from "./dialogs";
import { eventBus } from "../lib/event-bus";

type PanelId = "left" | "right";

const audioExtSet = new Set<string>(AUDIO_EXTENSIONS as readonly string[]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(1)} Go`;
}

export class FileExplorer {
  private api: ElectronApi;
  private panelId: PanelId;
  private el: HTMLElement;

  private currentPath = "";
  private history: string[] = [];
  private historyIndex = -1;
  private entries: FileEntry[] = [];
  private volumes: Volume[] = [];
  private loading = false;

  private pathInput!: HTMLInputElement;
  private fileList!: HTMLElement;
  private btnBack!: HTMLButtonElement;
  private btnForward!: HTMLButtonElement;
  private btnUp!: HTMLButtonElement;
  private btnConvert!: HTMLButtonElement | null;

  constructor(container: HTMLElement, panelId: PanelId) {
    this.api = window.electronApi;
    this.panelId = panelId;
    this.el = container;
    this.buildShell();
  }

  private buildShell(): void {
    const convertBtn = this.panelId === "left"
      ? `<button class="fe-btn fe-btn--convert" data-action="convert" title="Convertir WAV / AIFF / FLAC → MP3">MP3</button>`
      : "";

    this.el.innerHTML = `
      <div class="fe-toolbar">
        <button class="fe-btn" data-action="back" title="Précédent" disabled>&#x2190;</button>
        <button class="fe-btn" data-action="forward" title="Suivant" disabled>&#x2192;</button>
        <button class="fe-btn" data-action="up" title="Dossier parent" disabled>&#x2191;</button>
        <input class="fe-path" type="text" spellcheck="false" />
        ${convertBtn}
      </div>
      <div class="fe-list"></div>
    `;

    this.btnBack = this.el.querySelector('[data-action="back"]')!;
    this.btnForward = this.el.querySelector('[data-action="forward"]')!;
    this.btnUp = this.el.querySelector('[data-action="up"]')!;
    this.pathInput = this.el.querySelector(".fe-path")!;
    this.fileList = this.el.querySelector(".fe-list")!;

    this.btnConvert = this.el.querySelector('[data-action="convert"]');

    this.btnBack.addEventListener("click", () => this.goBack());
    this.btnForward.addEventListener("click", () => this.goForward());
    this.btnUp.addEventListener("click", () => this.goUp());
    this.btnConvert?.addEventListener("click", () => this.convertToMp3());
    this.pathInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.navigateTo(this.pathInput.value.trim());
    });
  }

  // ── Public API ─────────────────────────────────

  async init(savedPath?: string): Promise<void> {
    try {
      this.volumes = await this.api.fs.listVolumes();
    } catch {
      this.volumes = [];
    }

    try {
      const startPath = savedPath || (await this.api.fs.getHome());
      await this.navigateTo(startPath);
    } catch {
      this.showVolumes();
    }
  }

  getCurrentPath(): string {
    return this.currentPath;
  }

  /** Re-read the current directory without touching history. */
  async refresh(): Promise<void> {
    if (this.currentPath) {
      await this.loadDirectory(this.currentPath);
    } else {
      this.showVolumes();
    }
  }

  /** Navigate to a new path (pushes to history). */
  async navigateTo(dirPath: string): Promise<void> {
    if (!dirPath) {
      this.showVolumes();
      return;
    }
    if (this.loading) return;

    try {
      await this.loadDirectory(dirPath);
      this.pushHistory(dirPath);
      this.persist(dirPath);
    } catch {
      this.showVolumes();
    }
  }

  // ── Core loading ───────────────────────────────

  private async loadDirectory(dirPath: string): Promise<void> {
    this.loading = true;
    try {
      this.entries = await this.api.fs.readDirectory(dirPath);
      this.currentPath = dirPath;
      this.pathInput.value = dirPath;
      this.el.dataset.currentPath = dirPath;
      this.renderEntries();
      this.updateNavButtons();
    } finally {
      this.loading = false;
    }
  }

  private pushHistory(dirPath: string): void {
    if (this.historyIndex >= 0 && this.history[this.historyIndex] === dirPath) {
      return;
    }
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(dirPath);
    this.historyIndex = this.history.length - 1;
    this.updateNavButtons();
  }

  private persist(dirPath: string): void {
    this.api.store
      .set(this.panelId + "Panel", { currentPath: dirPath })
      .catch(() => {});
  }

  // ── Navigation helpers ─────────────────────────

  private async goBack(): Promise<void> {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    try {
      await this.loadDirectory(this.history[this.historyIndex]);
      this.updateNavButtons();
      this.persist(this.history[this.historyIndex]);
    } catch {
      this.showVolumes();
    }
  }

  private async goForward(): Promise<void> {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    try {
      await this.loadDirectory(this.history[this.historyIndex]);
      this.updateNavButtons();
      this.persist(this.history[this.historyIndex]);
    } catch {
      this.showVolumes();
    }
  }

  private goUp(): void {
    if (!this.currentPath) return;
    const sep = this.currentPath.includes("/") ? "/" : "\\";
    const parts = this.currentPath.split(sep).filter(Boolean);
    if (parts.length <= 1) {
      this.showVolumes();
      return;
    }
    parts.pop();
    let parent = parts.join(sep);
    const isWindows = sep === "\\" || parent.includes(":");
    if (!isWindows) {
      parent = "/" + parent;
    } else if (parent.endsWith(":")) {
      parent += "\\";
    }
    this.navigateTo(parent);
  }

  // ── Rendering ──────────────────────────────────

  private showVolumes(): void {
    this.currentPath = "";
    this.pathInput.value = "";
    this.entries = [];
    this.el.dataset.currentPath = "";
    this.updateNavButtons();

    this.fileList.innerHTML = "";
    for (const vol of this.volumes) {
      const row = this.createRow(
        {
          name: vol.label ? `${vol.label} (${vol.name})` : vol.name,
          path: vol.path,
          isDirectory: true,
          size: vol.sizeBytes ?? 0,
          modifiedAt: 0,
          extension: "",
        },
        "💾",
      );
      this.fileList.appendChild(row);
    }
  }

  private renderEntries(): void {
    this.fileList.innerHTML = "";

    if (this.entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "fe-empty";
      empty.textContent = "Dossier vide (aucun dossier ou fichier audio)";
      this.fileList.appendChild(empty);
      return;
    }

    for (const entry of this.entries) {
      const icon = entry.isDirectory ? "📁" : "🎵";
      this.fileList.appendChild(this.createRow(entry, icon));
    }
  }

  private createRow(entry: FileEntry, icon: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "fe-row";
    row.dataset.path = entry.path;

    const iconSpan = document.createElement("span");
    iconSpan.className = "fe-row__icon";
    iconSpan.textContent = icon;

    const nameSpan = document.createElement("span");
    nameSpan.className = "fe-row__name";
    nameSpan.textContent = entry.name;

    const sizeSpan = document.createElement("span");
    sizeSpan.className = "fe-row__size";
    sizeSpan.textContent =
      !entry.isDirectory && entry.size > 0 ? formatSize(entry.size) : "";

    const extSpan = document.createElement("span");
    extSpan.className = "fe-row__ext";
    extSpan.textContent = !entry.isDirectory
      ? entry.extension.toUpperCase().slice(1)
      : "";

    row.append(iconSpan, nameSpan, sizeSpan, extSpan);

    row.addEventListener("dblclick", () => this.onDoubleClick(entry));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onContextMenu(entry, e.clientX, e.clientY);
    });

    return row;
  }

  // ── Interactions ───────────────────────────────

  private onDoubleClick(entry: FileEntry): void {
    if (entry.isDirectory) {
      this.navigateTo(entry.path);
    } else if (audioExtSet.has(entry.extension.toLowerCase())) {
      eventBus.emit("play-file", { filePath: entry.path });
    }
  }

  private onContextMenu(entry: FileEntry, x: number, y: number): void {
    const items: ContextMenuEntry[] = [];

    if (!entry.isDirectory) {
      items.push({
        label: "▶  Lire",
        action: () => eventBus.emit("play-file", { filePath: entry.path }),
      });
      items.push({ separator: true });
    }

    items.push({
      label: "📂  Voir dans l'explorateur",
      action: () => this.api.fs.showInExplorer(entry.path),
    });
    items.push({ separator: true });

    items.push({
      label: "✏️  Renommer",
      action: () => this.promptRename(entry),
    });
    items.push({
      label: "📦  Déplacer vers l'autre panneau",
      action: () => this.moveToOtherPanel(entry),
    });
    items.push({ separator: true });

    items.push({
      label: "🗑️  Supprimer",
      action: () => this.promptDelete(entry),
    });

    contextMenu.show(items, x, y);
  }

  private async promptRename(entry: FileEntry): Promise<void> {
    const newName = await showPrompt("Nouveau nom :", entry.name);
    if (!newName || newName === entry.name) return;
    try {
      await this.api.fs.rename(entry.path, newName);
      await this.refresh();
    } catch (err) {
      await showAlert(`Erreur lors du renommage : ${err}`);
    }
  }

  private async moveToOtherPanel(entry: FileEntry): Promise<void> {
    const otherPanelId: PanelId =
      this.panelId === "left" ? "right" : "left";
    const otherEl = document.getElementById(`panel-${otherPanelId}`);
    const otherPath = otherEl?.dataset.currentPath;

    if (!otherPath) {
      await showAlert("L'autre panneau n'est pas dans un dossier.");
      return;
    }

    try {
      await this.api.fs.move(entry.path, otherPath);
      await this.refresh();
      eventBus.emit("refresh-panel", { panelId: otherPanelId });
    } catch (err) {
      await showAlert(`Erreur lors du déplacement : ${err}`);
    }
  }

  private async promptDelete(entry: FileEntry): Promise<void> {
    const confirmed = await showConfirm(
      `Supprimer « ${entry.name} » ?\nLe fichier sera déplacé dans la corbeille.`,
    );
    if (!confirmed) return;
    try {
      await this.api.fs.delete(entry.path);
      await this.refresh();
    } catch (err) {
      await showAlert(`Erreur lors de la suppression : ${err}`);
    }
  }

  private progressEl: HTMLElement | null = null;

  private showProgress(text: string): void {
    if (!this.progressEl) {
      this.progressEl = document.createElement("div");
      this.progressEl.className = "fe-progress";
      this.el.appendChild(this.progressEl);
    }
    this.progressEl.textContent = text;
  }

  private hideProgress(): void {
    this.progressEl?.remove();
    this.progressEl = null;
  }

  private async convertToMp3(): Promise<void> {
    if (!this.currentPath) {
      await showAlert("Naviguez d'abord dans un dossier.");
      return;
    }

    const convertible = this.entries.filter(
      (e) =>
        !e.isDirectory &&
        [".wav", ".aiff", ".aif", ".flac"].includes(e.extension.toLowerCase()),
    );

    if (convertible.length === 0) {
      await showAlert("Aucun fichier WAV, AIFF ou FLAC dans ce dossier.");
      return;
    }

    const ok = await showConfirm(
      `Convertir ${convertible.length} fichier(s) en MP3 (320 kbps) ?\n\n` +
        convertible.map((f) => f.name).join("\n"),
    );
    if (!ok) return;

    if (this.btnConvert) {
      this.btnConvert.disabled = true;
      this.btnConvert.textContent = "⏳";
    }

    this.showProgress("Préparation…");

    const unsubscribe = this.api.audio.onConvertProgress((p) => {
      this.showProgress(
        `Conversion ${p.current}/${p.total} — ${p.fileName}`,
      );
    });

    try {
      const result = await this.api.audio.convertToMp3(this.currentPath);
      unsubscribe();
      this.hideProgress();

      const lines: string[] = [];
      if (result.converted > 0)
        lines.push(`✓ ${result.converted} fichier(s) converti(s)`);
      if (result.skipped > 0)
        lines.push(`– ${result.skipped} ignoré(s) (MP3 déjà présent)`);
      if (result.errors.length > 0)
        lines.push(`\n✗ Erreurs :\n${result.errors.join("\n")}`);

      await showAlert(lines.join("\n") || "Aucun fichier à convertir.");
      await this.refresh();

      if (result.sourceFiles.length > 0) {
        const names = result.sourceFiles
          .map((f) => f.replace(/.*[\\/]/, ""))
          .join("\n");
        const del = await showConfirm(
          `Supprimer les ${result.sourceFiles.length} fichier(s) source ?\n` +
            "(Ils seront déplacés dans la corbeille)\n\n" +
            names,
        );
        if (del) {
          for (const src of result.sourceFiles) {
            try {
              await this.api.fs.delete(src);
            } catch {
              /* best effort */
            }
          }
          await this.refresh();
        }
      }
    } catch (err) {
      unsubscribe();
      this.hideProgress();
      await showAlert(`Erreur de conversion : ${err}`);
    } finally {
      if (this.btnConvert) {
        this.btnConvert.disabled = false;
        this.btnConvert.textContent = "MP3";
      }
    }
  }

  private updateNavButtons(): void {
    this.btnBack.disabled = this.historyIndex <= 0;
    this.btnForward.disabled =
      this.historyIndex >= this.history.length - 1;
    this.btnUp.disabled = !this.currentPath;
  }
}
