/** Theme (light / dark) + note box S/M/L for CA Desk */

import {
  getNoteEditorSize,
  setNoteEditorSize,
  initNoteEditorSize,
  NOTE_EDITOR_SIZES,
} from "./rich-notes.js?v=29";

const THEME_KEY = "upsc-ca-theme";

export function initTheme() {
  initNoteEditorSize();
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  return theme;
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  return next;
}

export function bindThemeToggle(btn) {
  btn?.addEventListener("click", toggleTheme);
}

export function bindNoteSizeControl(control) {
  if (!control) return;
  syncNoteSizeUi(control, getNoteEditorSize());
  control.querySelectorAll(".note-size-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const size = setNoteEditorSize(btn.dataset.noteSize);
      syncNoteSizeUi(control, size);
    });
  });
}

function syncNoteSizeUi(control, size) {
  control.querySelectorAll(".note-size-btn").forEach((btn) => {
    const active = btn.dataset.noteSize === size;
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.title = NOTE_EDITOR_SIZES[btn.dataset.noteSize]?.scale
      ? `Box size ${btn.dataset.noteSize.toUpperCase()}`
      : "";
  });
}
