import type { FileEntry, Volume, ElectronApi } from "@shared/types";
import { AUDIO_EXTENSIONS } from "@shared/types";
import {
  contextMenu,
  type ContextMenuEntry,
} from "./context-menu";
import { showPrompt, showConfirm, showAlert, showConvertDialog } from "./dialogs";
import { eventBus } from "../lib/event-bus";

type PanelId = "left" | "right";

const audioExtSet = new Set<string>(AUDIO_EXTENSIONS as readonly string[]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(1)} Go`;
}

// ── Tree node ───────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  expanded: boolean;
  loaded: boolean;
  children: TreeNode[];
}

// ── FileExplorer ────────────────────────────────

export class FileExplorer {
  private api: ElectronApi;
  private panelId: PanelId;
  private el: HTMLElement;

  private currentPath = "";
  private entries: FileEntry[] = [];
  private volumes: Volume[] = [];
  private loading = false;

  private treeRoots: TreeNode[] = [];
  private selectedNode: TreeNode | null = null;
  private selectedEntry: FileEntry | null = null;

  private treeEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private pathInput!: HTMLInputElement;
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
        <input class="fe-path" type="text" spellcheck="false" />
        ${convertBtn}
      </div>
      <div class="fe-body">
        <div class="fe-tree"></div>
        <div class="fe-divider"></div>
        <div class="fe-content"></div>
      </div>
    `;

    this.pathInput = this.el.querySelector(".fe-path")!;
    this.treeEl = this.el.querySelector(".fe-tree")!;
    this.contentEl = this.el.querySelector(".fe-content")!;
    this.btnConvert = this.el.querySelector('[data-action="convert"]');

    this.btnConvert?.addEventListener("click", () => this.convertToMp3());
    this.pathInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.selectPath(this.pathInput.value.trim());
    });

    this.initDividerResize();

    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Delete" && this.selectedEntry) {
        e.preventDefault();
        this.promptDelete(this.selectedEntry);
      }
    });
    this.el.tabIndex = -1;
  }

  private initDividerResize(): void {
    const divider = this.el.querySelector<HTMLElement>(".fe-divider")!;
    const body = this.el.querySelector<HTMLElement>(".fe-body")!;

    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(80, Math.min(startWidth + delta, body.clientWidth - 100));
      body.style.gridTemplateColumns = `${newWidth}px 3px 1fr`;
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
      startWidth = this.treeEl.getBoundingClientRect().width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  // ── Public API ─────────────────────────────────

  async init(savedPath?: string): Promise<void> {
    try {
      this.volumes = await this.api.fs.listVolumes();
    } catch {
      this.volumes = [];
    }

    this.treeRoots = this.volumes.map((v) => ({
      name: v.label ? `${v.label} (${v.name})` : v.name,
      path: v.path,
      expanded: false,
      loaded: false,
      children: [],
    }));

    const startPath = savedPath || (await this.api.fs.getHome().catch(() => ""));

    if (startPath) {
      await this.expandToPath(startPath);
      const node = this.findNode(startPath);
      if (node) {
        this.selectedNode = node;
        if (!node.loaded) await this.loadChildren(node);
        node.expanded = true;
      }
      try {
        await this.loadContent(startPath);
      } catch {
        /* folder may no longer exist */
      }
      this.renderTree();
    } else {
      this.renderTree();
    }
  }

  getCurrentPath(): string {
    return this.currentPath;
  }

  async refresh(): Promise<void> {
    if (this.currentPath) {
      await this.loadContent(this.currentPath);
      if (this.selectedNode) {
        this.selectedNode.loaded = false;
        await this.loadChildren(this.selectedNode);
      }
      this.renderTree();
    }
  }

  async selectPath(dirPath: string): Promise<void> {
    if (!dirPath || this.loading) return;
    try {
      await this.loadContent(dirPath);
      this.persist(dirPath);
      await this.expandToPath(dirPath);

      const node = this.findNode(dirPath);
      if (node) this.selectedNode = node;
      this.renderTree();
    } catch {
      /* ignore */
    }
  }

  // ── Tree operations ────────────────────────────

  private async loadChildren(node: TreeNode): Promise<void> {
    if (node.loaded) return;
    try {
      const entries = await this.api.fs.readDirectory(node.path);
      node.children = entries
        .filter((e) => e.isDirectory)
        .map((e) => ({
          name: e.name,
          path: e.path,
          expanded: false,
          loaded: false,
          children: [],
        }));
      node.loaded = true;
    } catch {
      node.children = [];
      node.loaded = true;
    }
  }

  private async toggleNode(node: TreeNode): Promise<void> {
    if (!node.expanded) {
      await this.loadChildren(node);
      node.expanded = true;
    } else {
      node.expanded = false;
    }
    this.renderTree();
  }

  private async onNodeSelect(node: TreeNode): Promise<void> {
    this.selectedNode = node;
    await this.loadContent(node.path);
    this.persist(node.path);

    if (!node.loaded) {
      await this.loadChildren(node);
    }
    if (!node.expanded) {
      node.expanded = true;
    }
    this.renderTree();
  }

  private findNode(targetPath: string, roots?: TreeNode[]): TreeNode | null {
    const normalized = targetPath.replace(/[\\/]+$/, "").toLowerCase();
    for (const node of roots ?? this.treeRoots) {
      if (node.path.replace(/[\\/]+$/, "").toLowerCase() === normalized) {
        return node;
      }
      const found = this.findNode(targetPath, node.children);
      if (found) return found;
    }
    return null;
  }

  private async expandToPath(targetPath: string): Promise<void> {
    const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
    const target = norm(targetPath);
    let nodes = this.treeRoots;

    // Find root volume
    const root = nodes.find((n) => target.startsWith(norm(n.path)));
    if (!root) return;

    if (!root.loaded) await this.loadChildren(root);
    root.expanded = true;

    // Walk down the path
    const relative = targetPath.slice(root.path.length);
    const sep = root.path.includes("/") ? "/" : "\\";
    const segments = relative.split(/[\\/]/).filter(Boolean);

    let current = root;
    for (const seg of segments) {
      const child = current.children.find(
        (c) => c.name.toLowerCase() === seg.toLowerCase(),
      );
      if (!child) break;

      if (!child.loaded) await this.loadChildren(child);
      child.expanded = true;
      current = child;
    }
  }

  // ── Tree rendering ─────────────────────────────

  private renderTree(): void {
    this.treeEl.innerHTML = "";
    for (const root of this.treeRoots) {
      this.treeEl.appendChild(this.createTreeItem(root, 0));
    }
    const selected = this.treeEl.querySelector(".is-selected");
    selected?.scrollIntoView({ block: "nearest" });
  }

  private createTreeItem(node: TreeNode, depth: number): HTMLElement {
    const frag = document.createDocumentFragment() as unknown as HTMLElement;
    const wrapper = document.createElement("div");

    const row = document.createElement("div");
    row.className = "fe-tree-item";
    if (this.selectedNode === node) row.classList.add("is-selected");
    row.style.paddingLeft = `${8 + depth * 16}px`;

    const arrow = document.createElement("span");
    arrow.className = "fe-tree-arrow";
    if (node.loaded && node.children.length === 0) {
      arrow.classList.add("fe-tree-arrow--empty");
    } else if (node.expanded) {
      arrow.classList.add("fe-tree-arrow--open");
    }
    arrow.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleNode(node);
    });

    const label = document.createElement("span");
    label.className = "fe-tree-label";
    label.textContent = node.name;

    row.append(arrow, label);
    row.addEventListener("click", () => this.onNodeSelect(node));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onTreeContextMenu(node, e.clientX, e.clientY);
    });

    wrapper.appendChild(row);

    if (node.expanded) {
      for (const child of node.children) {
        wrapper.appendChild(this.createTreeItem(child, depth + 1));
      }
    }

    return wrapper;
  }

  private onTreeContextMenu(node: TreeNode, x: number, y: number): void {
    const entry: FileEntry = {
      name: node.name,
      path: node.path,
      isDirectory: true,
      size: 0,
      modifiedAt: 0,
      extension: "",
    };
    this.onContextMenu(entry, x, y);
  }

  // ── Content loading ────────────────────────────

  private async loadContent(dirPath: string): Promise<void> {
    this.loading = true;
    this.selectedEntry = null;
    try {
      this.entries = await this.api.fs.readDirectory(dirPath);
      this.currentPath = dirPath;
      this.pathInput.value = dirPath;
      this.el.dataset.currentPath = dirPath;
      this.renderContent();
    } finally {
      this.loading = false;
    }
  }

  private persist(dirPath: string): void {
    this.api.store
      .set(this.panelId + "Panel", { currentPath: dirPath })
      .catch(() => {});
  }

  // ── Content rendering ──────────────────────────

  private renderContent(): void {
    this.contentEl.innerHTML = "";

    const files = this.entries.filter((e) => !e.isDirectory);

    if (files.length === 0) {
      const empty = document.createElement("div");
      empty.className = "fe-empty";
      empty.textContent = "Aucun fichier audio";
      this.contentEl.appendChild(empty);
      return;
    }

    for (const entry of files) {
      this.contentEl.appendChild(this.createFileRow(entry));
    }
  }

  private createFileRow(entry: FileEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "fe-row";
    row.dataset.path = entry.path;

    const iconSpan = document.createElement("span");
    iconSpan.className = "fe-row__icon";
    iconSpan.textContent = "🎵";

    const nameSpan = document.createElement("span");
    nameSpan.className = "fe-row__name";
    nameSpan.textContent = entry.name;

    const sizeSpan = document.createElement("span");
    sizeSpan.className = "fe-row__size";
    sizeSpan.textContent = entry.size > 0 ? formatSize(entry.size) : "";

    const extSpan = document.createElement("span");
    extSpan.className = "fe-row__ext";
    extSpan.textContent = entry.extension.toUpperCase().slice(1);

    row.append(iconSpan, nameSpan, sizeSpan, extSpan);

    row.addEventListener("click", () => {
      this.selectEntry(entry, row);
    });
    row.addEventListener("dblclick", () => {
      if (audioExtSet.has(entry.extension.toLowerCase())) {
        eventBus.emit("play-file", { filePath: entry.path });
      }
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selectEntry(entry, row);
      this.onContextMenu(entry, e.clientX, e.clientY);
    });

    return row;
  }

  // ── Interactions ───────────────────────────────

  private selectEntry(entry: FileEntry, row: HTMLElement): void {
    this.selectedEntry = entry;
    this.contentEl
      .querySelectorAll(".fe-row.is-selected")
      .forEach((el) => el.classList.remove("is-selected"));
    row.classList.add("is-selected");
    this.el.focus();
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

  // ── Convert to MP3 (queue-based) ───────────────

  private convertQueue: { path: string; deleteSource: boolean }[] = [];
  private converting = false;
  private progressEl: HTMLElement | null = null;
  private convertedCount = 0;
  private convertTotalCount = 0;
  private convertErrors: string[] = [];

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
      await showAlert("Sélectionnez d'abord un dossier.");
      return;
    }

    const convertible = await this.api.fs.listConvertible(this.currentPath);

    if (convertible.length === 0) {
      await showAlert("Aucun fichier WAV, AIFF ou FLAC dans ce dossier ni ses sous-dossiers.");
      return;
    }

    const result = await showConvertDialog(convertible);
    if (!result) return;

    for (const filePath of result.files) {
      this.convertQueue.push({
        path: filePath,
        deleteSource: result.deleteSource,
      });
    }
    this.convertTotalCount += result.files.length;

    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.converting) return;
    this.converting = true;

    while (this.convertQueue.length > 0) {
      const item = this.convertQueue.shift()!;
      const fileName = item.path.replace(/.*[\\/]/, "");
      this.convertedCount++;
      this.showProgress(
        `Conversion ${this.convertedCount}/${this.convertTotalCount} — ${fileName}`,
      );

      const res = await this.api.audio.convertFile(item.path);

      if (res.ok && item.deleteSource) {
        try {
          await this.api.fs.delete(res.sourcePath);
        } catch {
          /* best effort */
        }
      }

      if (!res.ok && res.error) {
        this.convertErrors.push(`${fileName}: ${res.error}`);
      }
    }

    this.hideProgress();
    this.converting = false;

    const lines: string[] = [];
    lines.push(`✓ ${this.convertedCount - this.convertErrors.length} fichier(s) converti(s)`);
    if (this.convertErrors.length > 0) {
      lines.push(`\n✗ Erreurs :\n${this.convertErrors.join("\n")}`);
    }

    const summary = lines.join("\n");
    this.convertedCount = 0;
    this.convertTotalCount = 0;
    this.convertErrors = [];

    await this.refresh();
    await showAlert(summary);
  }
}
