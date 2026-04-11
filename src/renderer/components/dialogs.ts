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
