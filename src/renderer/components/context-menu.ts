export interface ContextMenuItem {
  label: string;
  action: () => void;
  separator?: false;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

class ContextMenu {
  private el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "context-menu";
    document.body.appendChild(this.el);

    document.addEventListener("click", () => this.hide());
    document.addEventListener("contextmenu", () => this.hide());
    window.addEventListener("blur", () => this.hide());
  }

  show(entries: ContextMenuEntry[], x: number, y: number): void {
    this.el.innerHTML = "";

    for (const entry of entries) {
      if (entry.separator) {
        const sep = document.createElement("div");
        sep.className = "context-menu__separator";
        this.el.appendChild(sep);
        continue;
      }

      const item = document.createElement("button");
      item.className = "context-menu__item";
      item.textContent = entry.label;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this.hide();
        entry.action();
      });
      this.el.appendChild(item);
    }

    this.el.style.display = "flex";

    const rect = this.el.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 4;
    const maxY = window.innerHeight - rect.height - 4;
    this.el.style.left = `${Math.min(x, maxX)}px`;
    this.el.style.top = `${Math.min(y, maxY)}px`;
  }

  hide(): void {
    this.el.style.display = "none";
  }
}

export const contextMenu = new ContextMenu();
