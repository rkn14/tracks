function createOverlay(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  document.body.appendChild(overlay);
  return overlay;
}

function createBox(overlay: HTMLElement): HTMLElement {
  const box = document.createElement("div");
  box.className = "dialog-box";
  overlay.appendChild(box);
  return box;
}

function addButtons(
  box: HTMLElement,
  buttons: { label: string; primary?: boolean; action: () => void }[],
): void {
  const row = document.createElement("div");
  row.className = "dialog-buttons";
  for (const btn of buttons) {
    const el = document.createElement("button");
    el.className = btn.primary ? "dialog-btn dialog-btn--primary" : "dialog-btn";
    el.textContent = btn.label;
    el.addEventListener("click", btn.action);
    row.appendChild(el);
  }
  box.appendChild(row);
}

export function showPrompt(
  message: string,
  defaultValue = "",
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = createOverlay();
    const box = createBox(overlay);

    const label = document.createElement("div");
    label.className = "dialog-message";
    label.textContent = message;

    const input = document.createElement("input");
    input.className = "dialog-input";
    input.type = "text";
    input.value = defaultValue;
    input.spellcheck = false;

    box.appendChild(label);
    box.appendChild(input);

    const close = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };

    addButtons(box, [
      { label: "Annuler", action: () => close(null) },
      { label: "OK", primary: true, action: () => close(input.value) },
    ]);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") close(input.value);
      if (e.key === "Escape") close(null);
    });

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

export function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = createOverlay();
    const box = createBox(overlay);

    const msg = document.createElement("div");
    msg.className = "dialog-message";
    msg.textContent = message;
    box.appendChild(msg);

    const close = (value: boolean) => {
      overlay.remove();
      resolve(value);
    };

    addButtons(box, [
      { label: "Annuler", action: () => close(false) },
      { label: "Confirmer", primary: true, action: () => close(true) },
    ]);

    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(false);
    });
    overlay.tabIndex = 0;
    requestAnimationFrame(() => overlay.focus());
  });
}

export interface ConvertDialogResult {
  files: string[];
  deleteSource: boolean;
}

export function showConvertDialog(
  fileNames: { name: string; path: string }[],
): Promise<ConvertDialogResult | null> {
  return new Promise((resolve) => {
    const overlay = createOverlay();
    const box = createBox(overlay);
    box.style.maxHeight = "70vh";
    box.style.overflow = "hidden";
    box.style.display = "flex";
    box.style.flexDirection = "column";

    const title = document.createElement("div");
    title.className = "dialog-message";
    title.textContent = `Convertir en MP3 (320 kbps) — ${fileNames.length} fichier(s)`;
    title.style.fontWeight = "700";
    box.appendChild(title);

    const list = document.createElement("div");
    list.className = "dialog-checklist";

    const checkboxes: { cb: HTMLInputElement; path: string }[] = [];

    for (const file of fileNames) {
      const row = document.createElement("label");
      row.className = "dialog-check-row";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.className = "dialog-checkbox";

      const span = document.createElement("span");
      span.className = "dialog-check-label";
      span.textContent = file.name;

      row.append(cb, span);
      list.appendChild(row);
      checkboxes.push({ cb, path: file.path });
    }

    box.appendChild(list);

    const optRow = document.createElement("label");
    optRow.className = "dialog-check-row dialog-check-row--option";

    const deleteCb = document.createElement("input");
    deleteCb.type = "checkbox";
    deleteCb.checked = false;
    deleteCb.className = "dialog-checkbox";

    const optLabel = document.createElement("span");
    optLabel.className = "dialog-check-label";
    optLabel.textContent = "Supprimer les fichiers sources après conversion";

    optRow.append(deleteCb, optLabel);
    box.appendChild(optRow);

    const close = (value: ConvertDialogResult | null) => {
      overlay.remove();
      resolve(value);
    };

    addButtons(box, [
      { label: "Annuler", action: () => close(null) },
      {
        label: "Convertir",
        primary: true,
        action: () => {
          const selected = checkboxes
            .filter((c) => c.cb.checked)
            .map((c) => c.path);
          if (selected.length === 0) {
            close(null);
          } else {
            close({ files: selected, deleteSource: deleteCb.checked });
          }
        },
      },
    ]);

    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(null);
    });
    overlay.tabIndex = 0;
    requestAnimationFrame(() => overlay.focus());
  });
}

export function showAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = createOverlay();
    const box = createBox(overlay);

    const msg = document.createElement("div");
    msg.className = "dialog-message";
    msg.textContent = message;
    box.appendChild(msg);

    const close = () => {
      overlay.remove();
      resolve();
    };

    addButtons(box, [{ label: "OK", primary: true, action: close }]);

    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") close();
    });
    overlay.tabIndex = 0;
    requestAnimationFrame(() => overlay.focus());
  });
}
