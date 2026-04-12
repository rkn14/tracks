import type { FileEntry, Volume, ElectronApi } from "@shared/types";
import { AUDIO_EXTENSIONS } from "@shared/types";
import {
  contextMenu,
  type ContextMenuEntry,
} from "./context-menu";
import { showPrompt, showConfirm, showAlert, showConvertDialog, showMetaIADialog, showAutoFolderDialog } from "./dialogs";
import { STORE_KEYS } from "@shared/constants";
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
  private selectedEntries: Set<FileEntry> = new Set();

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
    const leftButtons = this.panelId === "left"
      ? `<button class="fe-btn fe-btn--convert" data-action="convert" title="Convertir WAV / AIFF / FLAC → MP3">MP3</button>` +
        `<button class="fe-btn fe-btn--meta-ia" data-action="meta-ia" title="Récupérer les genres via IA">META IA</button>` +
        `<button class="fe-btn fe-btn--autofolder" data-action="autofolder" title="Organiser les MP3 par artiste">Auto Folder</button>`
      : "";

    this.el.innerHTML = `
      <div class="fe-toolbar">
        <input class="fe-path" type="text" spellcheck="false" />
        <button class="fe-btn fe-btn--refresh" data-action="refresh" title="Rafraîchir">&#x21BB;</button>
        <button class="fe-btn fe-btn--mkdir" data-action="mkdir" title="Nouveau dossier">&#x1F4C1;+</button>
        ${leftButtons}
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

    this.el.querySelector('[data-action="refresh"]')
      ?.addEventListener("click", () => this.refresh());
    this.el.querySelector('[data-action="mkdir"]')
      ?.addEventListener("click", () => this.createFolder());
    this.btnConvert?.addEventListener("click", () => this.convertToMp3());
    this.el.querySelector('[data-action="meta-ia"]')
      ?.addEventListener("click", () => this.metaIA());
    this.el.querySelector('[data-action="autofolder"]')
      ?.addEventListener("click", () => this.autoFolder());
    this.pathInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.selectPath(this.pathInput.value.trim());
    });

    this.initDividerResize();
    this.initDropZone();

    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Delete") {
        if (this.selectedEntries.size > 0) {
          e.preventDefault();
          this.promptDeleteSelection();
        } else if (this.selectedNode) {
          e.preventDefault();
          this.promptDeleteNode(this.selectedNode);
        }
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown" ||
          e.key === "ArrowLeft" || e.key === "ArrowRight") {
        this.handleTreeKeyboard(e);
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

  private async handleDrop(
    sourcePaths: string[],
    destDir: string,
    sourceId: string,
  ): Promise<void> {
    let copied = 0;
    const errors: string[] = [];

    for (const p of sourcePaths) {
      try {
        await this.api.fs.copy(p, destDir);
        copied++;
        try { await this.api.fs.delete(p); } catch { /* best effort */ }
      } catch (err) {
        errors.push(`${p.replace(/.*[\\/]/, "")}: ${err}`);
      }
    }

    const otherPanelId: PanelId = sourceId as PanelId;
    await this.refresh();
    eventBus.emit("refresh-panel", { panelId: otherPanelId });

    if (errors.length > 0) {
      await showAlert(
        `${copied} fichier(s) déplacé(s).\n\nErreurs :\n${errors.join("\n")}`,
      );
    }
  }

  private initDropZone(): void {
    const dropTarget = this.contentEl;

    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("text/x-source-panel")) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
      dropTarget.classList.add("fe-drop-target");
    };

    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget && dropTarget.contains(e.relatedTarget as Node)) return;
      dropTarget.classList.remove("fe-drop-target");
    };

    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      dropTarget.classList.remove("fe-drop-target");

      const raw = e.dataTransfer?.getData("application/x-tracks-files");
      const sourceId = e.dataTransfer?.getData("text/x-source-panel");
      if (!raw || sourceId === this.panelId || !this.currentPath) return;

      await this.handleDrop(JSON.parse(raw), this.currentPath, sourceId);
    };

    dropTarget.addEventListener("dragover", onDragOver);
    dropTarget.addEventListener("dragleave", onDragLeave);
    dropTarget.addEventListener("drop", onDrop);

    this.treeEl.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("text/x-source-panel")) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    });

    this.treeEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      const target = (e.target as HTMLElement).closest(".fe-tree-item");
      if (target) target.classList.remove("fe-drop-target");

      const raw = e.dataTransfer?.getData("application/x-tracks-files");
      const sourceId = e.dataTransfer?.getData("text/x-source-panel");
      if (!raw || sourceId === this.panelId) return;

      const treeItem = (e.target as HTMLElement).closest<HTMLElement>(".fe-tree-item");
      const destPath = treeItem?.dataset.nodePath;
      if (!destPath) return;

      await this.handleDrop(JSON.parse(raw), destPath, sourceId);
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
    if (!this.currentPath) return;

    let target = this.currentPath;
    while (target) {
      const ok = await this.api.fs.exists(target);
      if (ok) break;
      const parent = target.replace(/[\\/][^\\/]+$/, "");
      if (parent === target) break;
      target = parent;
    }

    if (target !== this.currentPath) {
      this.currentPath = target;
      this.persist(target);
      await this.expandToPath(target);
      const node = this.findNode(target);
      if (node) this.selectedNode = node;
    }

    await this.loadContent(this.currentPath);

    if (this.selectedNode) {
      this.selectedNode.loaded = false;
      await this.loadChildren(this.selectedNode);
    }
    this.renderTree();
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

  private getVisibleNodes(nodes?: TreeNode[]): TreeNode[] {
    const result: TreeNode[] = [];
    for (const node of nodes ?? this.treeRoots) {
      result.push(node);
      if (node.expanded && node.children.length > 0) {
        result.push(...this.getVisibleNodes(node.children));
      }
    }
    return result;
  }

  private handleTreeKeyboard(e: KeyboardEvent): void {
    if (!this.selectedNode) return;

    e.preventDefault();

    if (e.key === "ArrowRight") {
      if (!this.selectedNode.expanded) {
        this.toggleNode(this.selectedNode);
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      if (this.selectedNode.expanded) {
        this.toggleNode(this.selectedNode);
      }
      return;
    }

    const visible = this.getVisibleNodes();
    const idx = visible.indexOf(this.selectedNode);
    if (idx === -1) return;

    const nextIdx = e.key === "ArrowUp" ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= visible.length) return;

    this.onNodeSelect(visible[nextIdx]);
  }

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
    row.dataset.nodePath = node.path;
    row.addEventListener("click", () => this.onNodeSelect(node));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onTreeContextMenu(node, e.clientX, e.clientY);
    });

    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      e.dataTransfer!.setData("application/x-tracks-files", JSON.stringify([node.path]));
      e.dataTransfer!.setData("text/x-source-panel", this.panelId);
      e.dataTransfer!.effectAllowed = "copy";

      const ghost = document.createElement("div");
      ghost.className = "fe-drag-ghost";
      ghost.textContent = node.name;
      document.body.appendChild(ghost);
      e.dataTransfer!.setDragImage(ghost, 0, 0);
      requestAnimationFrame(() => ghost.remove());
    });

    row.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("text/x-source-panel")) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      row.classList.add("fe-drop-target");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("fe-drop-target");
    });
    row.addEventListener("drop", () => {
      row.classList.remove("fe-drop-target");
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
    this.selectedEntries.clear();
    this.lastClickedIndex = -1;
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

    row.addEventListener("click", (e) => {
      this.selectEntry(entry, row, e);
    });
    row.addEventListener("dblclick", () => {
      if (audioExtSet.has(entry.extension.toLowerCase())) {
        eventBus.emit("play-file", { filePath: entry.path });
      }
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.selectedEntries.has(entry)) {
        this.selectEntry(entry, row, e);
      }
      this.onContextMenu(entry, e.clientX, e.clientY);
    });

    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      if (!this.selectedEntries.has(entry)) {
        this.selectEntry(entry, row);
      }
      const paths = [...this.selectedEntries].map((en) => en.path);
      e.dataTransfer!.setData("application/x-tracks-files", JSON.stringify(paths));
      e.dataTransfer!.setData("text/x-source-panel", this.panelId);
      e.dataTransfer!.effectAllowed = "copy";

      const ghost = document.createElement("div");
      ghost.className = "fe-drag-ghost";
      ghost.textContent = `${paths.length} fichier(s)`;
      document.body.appendChild(ghost);
      e.dataTransfer!.setDragImage(ghost, 0, 0);
      requestAnimationFrame(() => ghost.remove());
    });

    return row;
  }

  // ── Interactions ───────────────────────────────

  private lastClickedIndex = -1;

  private selectEntry(entry: FileEntry, row: HTMLElement, e?: MouseEvent): void {
    const files = this.entries.filter((en) => !en.isDirectory);
    const index = files.indexOf(entry);

    if (e?.ctrlKey || e?.metaKey) {
      if (this.selectedEntries.has(entry)) {
        this.selectedEntries.delete(entry);
        row.classList.remove("is-selected");
      } else {
        this.selectedEntries.add(entry);
        row.classList.add("is-selected");
      }
    } else if (e?.shiftKey && this.lastClickedIndex >= 0) {
      const start = Math.min(this.lastClickedIndex, index);
      const end = Math.max(this.lastClickedIndex, index);
      this.selectedEntries.clear();
      this.contentEl
        .querySelectorAll(".fe-row.is-selected")
        .forEach((el) => el.classList.remove("is-selected"));
      const rows = this.contentEl.querySelectorAll(".fe-row");
      for (let i = start; i <= end; i++) {
        this.selectedEntries.add(files[i]);
        rows[i]?.classList.add("is-selected");
      }
    } else {
      this.selectedEntries.clear();
      this.contentEl
        .querySelectorAll(".fe-row.is-selected")
        .forEach((el) => el.classList.remove("is-selected"));
      this.selectedEntries.add(entry);
      row.classList.add("is-selected");
    }

    this.lastClickedIndex = index;
    this.selectedEntry = entry;
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
      action: () => {
        if (this.selectedEntries.size > 1 && this.selectedEntries.has(entry)) {
          this.promptDeleteSelection();
        } else {
          this.promptDelete(entry);
        }
      },
    });

    contextMenu.show(items, x, y);
  }

  private async createFolder(): Promise<void> {
    if (!this.currentPath) {
      await showAlert("Sélectionnez d'abord un dossier.");
      return;
    }
    const name = await showPrompt("Nom du nouveau dossier :");
    if (!name) return;
    const sep = this.currentPath.includes("/") ? "/" : "\\";
    const newPath = this.currentPath + sep + name;
    try {
      await this.api.fs.mkdir(newPath);

      if (this.selectedNode) {
        this.selectedNode.loaded = false;
        await this.loadChildren(this.selectedNode);
      }

      await this.selectPath(newPath);
    } catch (err) {
      await showAlert(`Erreur lors de la création du dossier : ${err}`);
    }
  }

  private async promptRename(entry: FileEntry): Promise<void> {
    const newName = await showPrompt("Nouveau nom :", entry.name);
    if (!newName || newName === entry.name) return;
    try {
      await this.api.fs.rename(entry.path, newName);

      if (entry.isDirectory) {
        const parentDir = entry.path.substring(0, entry.path.lastIndexOf(entry.name)).replace(/[\\/]+$/, "");
        const newDirPath = parentDir + (parentDir.endsWith("\\") || parentDir.endsWith("/") ? "" : "\\") + newName;

        if (this.currentPath === entry.path || this.currentPath.startsWith(entry.path + "\\") || this.currentPath.startsWith(entry.path + "/")) {
          this.currentPath = this.currentPath.replace(entry.path, newDirPath);
        }

        if (this.selectedNode) {
          this.updateNodePaths(this.treeRoots, entry.path, newDirPath);
          this.renderTree();
        }
      }

      await this.refreshBoth();
    } catch (err) {
      await showAlert(`Erreur lors du renommage : ${err}`);
    }
  }

  private updateNodePaths(nodes: TreeNode[], oldPrefix: string, newPrefix: string): void {
    for (const node of nodes) {
      if (node.path === oldPrefix) {
        node.path = newPrefix;
        node.name = newPrefix.split(/[\\/]/).pop() ?? node.name;
      } else if (node.path.startsWith(oldPrefix + "\\") || node.path.startsWith(oldPrefix + "/")) {
        node.path = newPrefix + node.path.substring(oldPrefix.length);
      }
      if (node.children.length > 0) {
        this.updateNodePaths(node.children, oldPrefix, newPrefix);
      }
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
      await this.api.fs.copy(entry.path, otherPath);
      try { await this.api.fs.delete(entry.path); } catch { /* best effort */ }
      await this.refreshBoth();
    } catch (err) {
      await showAlert(`Erreur lors de la copie : ${err}`);
    }
  }

  private async promptDeleteSelection(): Promise<void> {
    const entries = [...this.selectedEntries];
    if (entries.length === 0) return;

    const msg = entries.length === 1
      ? `Supprimer « ${entries[0].name} » ?\nLe fichier sera déplacé dans la corbeille.`
      : `Supprimer ${entries.length} fichier(s) ?\nIls seront déplacés dans la corbeille.`;

    const confirmed = await showConfirm(msg);
    if (!confirmed) return;

    const errors: string[] = [];
    for (const entry of entries) {
      try {
        await this.api.fs.delete(entry.path);
      } catch (err) {
        errors.push(`${entry.name}: ${err}`);
      }
    }
    this.selectedEntries.clear();
    await this.refreshBoth();
    if (errors.length > 0) {
      await showAlert(`Erreurs :\n${errors.join("\n")}`);
    }
  }

  private async promptDeleteNode(node: TreeNode): Promise<void> {
    const confirmed = await showConfirm(
      `Supprimer le dossier « ${node.name} » ?\nIl sera déplacé dans la corbeille.`,
    );
    if (!confirmed) return;
    try {
      await this.api.fs.delete(node.path);
      await this.refreshBoth();
    } catch (err) {
      await showAlert(`Erreur lors de la suppression : ${err}`);
    }
  }

  private async promptDelete(entry: FileEntry): Promise<void> {
    const confirmed = await showConfirm(
      `Supprimer « ${entry.name} » ?\nLe fichier sera déplacé dans la corbeille.`,
    );
    if (!confirmed) return;
    try {
      await this.api.fs.delete(entry.path);
      await this.refreshBoth();
    } catch (err) {
      await showAlert(`Erreur lors de la suppression : ${err}`);
    }
  }

  private async refreshBoth(): Promise<void> {
    const otherPanelId: PanelId = this.panelId === "left" ? "right" : "left";
    await this.refresh();
    eventBus.emit("refresh-panel", { panelId: otherPanelId });
  }

  // ── Auto Folder ───────────────────────────────

  private async autoFolder(): Promise<void> {
    if (!this.currentPath) {
      await showAlert("Sélectionnez d'abord un dossier.");
      return;
    }

    const mp3Files = await this.api.fs.listMp3(this.currentPath);
    if (mp3Files.length === 0) {
      await showAlert("Aucun fichier MP3 dans ce dossier.");
      return;
    }

    const artistMap = new Map<string, { name: string; path: string }[]>();
    let skipped = 0;

    for (const file of mp3Files) {
      const meta = await this.api.audio.getMetadata(file.path);
      const artist = meta.artist?.trim();
      if (!artist) {
        skipped++;
        continue;
      }
      if (!artistMap.has(artist)) artistMap.set(artist, []);
      artistMap.get(artist)!.push(file);
    }

    if (artistMap.size === 0) {
      await showAlert("Aucun MP3 avec un artiste renseigné.");
      return;
    }

    const entries = [...artistMap.entries()]
      .map(([artist, files]) => ({ artist, count: files.length }))
      .sort((a, b) => a.artist.localeCompare(b.artist));

    const confirmed = await showAutoFolderDialog(entries, mp3Files.length, skipped);
    if (!confirmed) return;

    let moved = 0;
    const errors: string[] = [];
    const sep = this.currentPath.includes("/") ? "/" : "\\";

    for (const [artist, files] of artistMap) {
      const folderName = artist.replace(/[<>:"/\\|?*]/g, "_");
      const folderPath = this.currentPath + sep + folderName;

      const exists = await this.api.fs.exists(folderPath);
      if (!exists) {
        try {
          await this.api.fs.mkdir(folderPath);
        } catch (err) {
          errors.push(`Dossier "${folderName}": ${err}`);
          continue;
        }
      }

      for (const file of files) {
        try {
          await this.api.fs.move(file.path, folderPath);
          moved++;
        } catch (err) {
          errors.push(`${file.name}: ${err}`);
        }
      }
    }

    await this.refreshBoth();

    const summary = [`${moved} fichier(s) déplacé(s).`];
    if (skipped > 0) summary.push(`${skipped} fichier(s) sans artiste ignoré(s).`);
    if (errors.length > 0) summary.push(`\nErreurs :\n${errors.join("\n")}`);
    await showAlert(summary.join("\n"));
  }

  // ── META IA ────────────────────────────────────

  private async metaIA(): Promise<void> {
    if (!this.currentPath) {
      await showAlert("Sélectionnez d'abord un dossier.");
      return;
    }

    const mp3Files = await this.api.fs.listMp3(this.currentPath);
    if (mp3Files.length === 0) {
      await showAlert("Aucun fichier MP3 dans ce dossier.");
      return;
    }

    const [meta, genres] = await Promise.all([
      this.api.audio.getMetadata(mp3Files[0].path),
      this.api.fs.getAllGenres(this.currentPath),
    ]);

    const result = await showMetaIADialog({
      artist: meta.artist ?? "",
      album: meta.album ?? "",
      genres,
      mp3Files,
    });

    if (!result) return;

    if (result.retrieveGenres) {
      const [apiKey, promptTemplate] = await Promise.all([
        this.api.store.get<string>(STORE_KEYS.OPENAI_API_KEY),
        this.api.store.get<string>(STORE_KEYS.GENRE_PROMPT),
      ]);

      if (!apiKey) {
        await showAlert("Clé API OpenAI non configurée.\nAllez dans Paramètres (⚙) pour la renseigner.");
        return;
      }
      if (!promptTemplate) {
        await showAlert("Prompt non configuré.\nAllez dans Paramètres (⚙) pour renseigner le « Retrieve Genre Prompt ».");
        return;
      }

      const prompt = promptTemplate
        .replace(/\{\{artist_name\}\}/g, meta.artist ?? "")
        .replace(/\{\{album_name\}\}/g, meta.album ?? "");

      try {
        const aiResult = await this.api.audio.fetchGenres(prompt, apiKey);

        if (aiResult.genres.length === 0) {
          await showAlert("L'IA n'a retourné aucun genre.");
          return;
        }

        const confirmMsg =
          `Genres proposés par l'IA :\n${aiResult.genres.join(", ")}\n\n` +
          `Certitude : ${aiResult.certaintyPercentage} %\n` +
          `${aiResult.comment}\n\n` +
          `Les genres existants seront conservés, seuls les nouveaux seront ajoutés.\n` +
          `Appliquer à ${mp3Files.length} fichier(s) ?`;

        const confirmed = await showConfirm(confirmMsg);
        if (!confirmed) return;

        const count = await this.api.audio.writeGenres(this.currentPath, aiResult.genres);
        await showAlert(
          `Genres ajoutés : ${aiResult.genres.join(", ")}\n\n${count} fichier(s) mis à jour.`,
        );
        await this.refresh();
      } catch (err) {
        await showAlert(`Erreur META IA : ${err}`);
      }
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
