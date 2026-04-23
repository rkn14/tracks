import { profileTagColorCssVarName } from "@shared/profile-tag-colors";
import {
  formatActiveTagsForListRow,
  orderedActiveProfileTagIds,
} from "@shared/profile-stars";
import { getProfileTagLabel } from "@shared/profile-tag-labels";

/** Première lettre affichable (prise sur le libellé), pour pastille ronde dans les listes. */
function firstLetterOfTagLabel(label: string): string {
  const t = label.trim();
  if (!t) return "\u2014";
  const ch = [...t][0] ?? "\u2014";
  return ch.toLocaleUpperCase("fr");
}

/**
 * Remplit le conteneur listes avec des pastilles colorées (même thème « actif » que le lecteur).
 */
export function fillListRowActiveTagsContainer(
  el: HTMLElement,
  activeProfileTags: string[] | undefined | null,
): void {
  el.replaceChildren();
  for (const id of orderedActiveProfileTagIds(activeProfileTags)) {
    const span = document.createElement("span");
    span.className = "fe-row__active-tag";
    span.style.setProperty(
      "--pt",
      `var(${profileTagColorCssVarName(id)})`,
    );
    const full = getProfileTagLabel(id);
    span.textContent = firstLetterOfTagLabel(full);
    span.title = full;
    span.setAttribute("aria-label", full);
    el.appendChild(span);
  }
  const line = formatActiveTagsForListRow(activeProfileTags);
  el.setAttribute("aria-label", line ? `Tags : ${line}` : "");
}
