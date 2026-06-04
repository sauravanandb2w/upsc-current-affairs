/**
 * Lightweight rich text for synced note fields (stores Markdown).
 * Ported from upsc-mains-pyq — CA uses separate localStorage key.
 */

import {
  markdownToEditorHtml,
  noteValueToMarkdown,
  noteToPlainText as noteMarkdownToPlainText,
  noteMarkdownForStorage,
  noteMarkdownFromEditorHtml,
  renderMarkdownToSafeHtml,
} from "./note-markdown.js";

const ALLOWED_TAGS = new Set([
  "b", "strong", "i", "em", "u", "s", "strike", "br", "p", "div", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td", "blockquote", "pre", "code", "hr",
  "h1", "h2", "h3", "h4",
]);

const ALLOWED_CELL_STYLES = new Set(["background-color", "color", "background"]);

export function looksLikeNoteHtml(value) {
  return /<[a-z][\s\S]*>/i.test(String(value ?? ""));
}

export function noteHtmlToPlainText(html) {
  return noteMarkdownToPlainText(html, sanitizeNoteHtml);
}

/** Read-only markdown → safe HTML (tables, lists, bold). */
export function renderNoteMarkdownHtml(value) {
  return renderMarkdownToSafeHtml(value, sanitizeNoteHtml);
}

export function noteValueHasContent(value) {
  return Boolean(noteHtmlToPlainText(String(value ?? "")).trim());
}

export function sanitizeNoteHtml(dirty) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(dirty ?? "");
  const out = document.createElement("div");

  function copySafeStyles(fromEl, toEl) {
    const raw = String(fromEl.getAttribute("style") || "");
    if (!raw.trim()) return;
    const kept = raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => {
        const key = part.split(":")[0]?.trim().toLowerCase();
        return ALLOWED_CELL_STYLES.has(key);
      });
    if (kept.length) toEl.setAttribute("style", kept.join("; "));
  }

  function spanSemanticTag(node) {
    const style = String(node.getAttribute("style") || "");
    const weight = node.style?.fontWeight || "";
    const isBold =
      weight === "bold" ||
      Number(weight) >= 600 ||
      /font-weight:\s*(bold|[6-9]00)/i.test(style);
    const isItalic =
      node.style?.fontStyle === "italic" || /font-style:\s*italic/i.test(style);
    const isUnderline =
      String(node.style?.textDecoration || "").includes("underline") ||
      /text-decoration:[^;]*underline/i.test(style);
    if (isBold) return "strong";
    if (isItalic) return "em";
    if (isUnderline) return "u";
    return null;
  }

  function appendClean(parent, node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) parent.appendChild(document.createTextNode(node.textContent));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();

    if (tag === "span") {
      const semantic = spanSemanticTag(node);
      if (semantic) {
        const el = document.createElement(semantic);
        node.childNodes.forEach((child) => appendClean(el, child));
        if (el.childNodes.length) parent.appendChild(el);
        return;
      }
      node.childNodes.forEach((child) => appendClean(parent, child));
      return;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      node.childNodes.forEach((child) => appendClean(parent, child));
      return;
    }

    const el = document.createElement(tag);
    if (tag === "td" || tag === "th") copySafeStyles(node, el);
    node.childNodes.forEach((child) => appendClean(el, child));
    if (tag === "br" || el.childNodes.length || tag === "li" || tag === "td" || tag === "th") {
      parent.appendChild(el);
    }
  }

  tpl.content.childNodes.forEach((child) => appendClean(out, child));
  return out.innerHTML;
}

function escapeTextToHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function plainTextToNoteHtml(text) {
  const s = String(text ?? "");
  if (!s) return "";
  if (looksLikeNoteHtml(s)) return sanitizeNoteHtml(s);
  return s
    .split(/\n/)
    .map((line) => (line.trim() ? `<p>${escapeTextToHtml(line)}</p>` : "<p><br></p>"))
    .join("");
}

/** Normalize stored note (Markdown or legacy HTML) for the rich editor. */
export function noteStorageToEditorHtml(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return markdownToEditorHtml(raw, sanitizeNoteHtml);
}

/** Markdown-only storage for notes.md and Supabase (no HTML). */
export function noteHtmlForGitStorage(value) {
  return noteMarkdownForStorage(value);
}

export { noteMarkdownForStorage, noteValueToMarkdown };

export function setRichNoteContent(editor, raw) {
  if (!editor) return;
  const s = String(raw ?? "");
  if (!s.trim()) {
    editor.innerHTML = "";
    return;
  }
  // Display Git/Supabase markdown as-is; canonicalize only on save (getRichNoteContent).
  editor.innerHTML = markdownToEditorHtml(s, sanitizeNoteHtml);
}

export function getRichNoteContent(editor) {
  if (!editor) return "";
  return readEditorMarkdown(editor);
}

/** Read visible editor content as Markdown (no dedupe — safe for typing + commit). */
export function readEditorMarkdown(editor) {
  if (!editor) return "";
  const html = editor.innerHTML.trim();
  if (!html || html === "<br>") return "";
  const plain = String(editor.innerText || "").replace(/\u00a0/g, " ").trim();
  if (!plain) return "";
  const sanitized = sanitizeNoteHtml(html);
  const md = noteMarkdownFromEditorHtml(sanitized).trim();
  return md || plain;
}

export function renderRichNoteToolbar() {
  const buttons = [
    { cmd: "bold", label: "B", title: "Bold" },
    { cmd: "italic", label: "I", title: "Italic" },
    { cmd: "underline", label: "U", title: "Underline" },
    { sep: true },
    { cmd: "insertUnorderedList", label: "•", title: "Bullet list" },
    { cmd: "insertOrderedList", label: "1.", title: "Numbered list" },
    { sep: true },
    { cmd: "removeFormat", label: "⌫", title: "Clear formatting" },
  ];
  return `<div class="rich-note-toolbar" role="toolbar">${buttons
    .map((b) =>
      b.sep
        ? `<span class="rich-note-toolbar-sep"></span>`
        : `<button type="button" class="rich-note-tool" data-cmd="${b.cmd}" title="${b.title}">${b.label}</button>`
    )
    .join("")}</div>`;
}

const NOTE_EDITOR_HEIGHT_REM = { 2: 22, 3: 26, 4: 30, 5: 34, 6: 38, 8: 44, 10: 52, 12: 56 };

export const NOTE_EDITOR_SIZE_KEY = "upsc-ca-note-editor-size";

export const NOTE_EDITOR_SIZES = {
  s: { label: "S", scale: 0.4 },
  m: { label: "M", scale: 0.7 },
  l: { label: "L", scale: 1 },
};

export function getNoteEditorSize() {
  const stored = localStorage.getItem(NOTE_EDITOR_SIZE_KEY);
  return stored && NOTE_EDITOR_SIZES[stored] ? stored : "m";
}

export function setNoteEditorSize(size) {
  if (!NOTE_EDITOR_SIZES[size]) return getNoteEditorSize();
  localStorage.setItem(NOTE_EDITOR_SIZE_KEY, size);
  document.documentElement.dataset.noteEditorSize = size;
  applyNoteEditorHeightsIn(document);
  return size;
}

export function initNoteEditorSize() {
  const size = getNoteEditorSize();
  document.documentElement.dataset.noteEditorSize = size;
  return size;
}

export function noteEditorHeightRem(rows = 4, size = getNoteEditorSize()) {
  const base = NOTE_EDITOR_HEIGHT_REM[rows] ?? 28;
  const scale = NOTE_EDITOR_SIZES[size]?.scale ?? NOTE_EDITOR_SIZES.m.scale;
  return Math.round(base * scale * 10) / 10;
}

export function applyNoteEditorHeightsIn(root = document) {
  root.querySelectorAll(".rich-note[data-rows]").forEach((el) => {
    const rows = Number(el.dataset.rows) || 4;
    el.style.setProperty("--note-editor-height", `${noteEditorHeightRem(rows)}rem`);
  });
}

export function renderRichNoteEditorHtml(dataAttrs = {}, { placeholder = "", rows = 4 } = {}) {
  const attrs = Object.entries(dataAttrs)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");
  const heightRem = noteEditorHeightRem(rows);
  return `<div class="rich-note" data-rows="${rows}" style="--note-editor-height: ${heightRem}rem">
    ${renderRichNoteToolbar()}
    <div class="rich-note-scroll">
      <div class="rich-note-editor" contenteditable="true" role="textbox" spellcheck="true"
        data-placeholder="${String(placeholder).replace(/"/g, "&quot;")}" ${attrs}></div>
    </div>
  </div>`;
}

export function bindRichNoteToolbar(toolbar, editor) {
  if (!toolbar || !editor) return;
  toolbar.querySelectorAll(".rich-note-tool[data-cmd]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      editor.focus();
      try {
        document.execCommand(btn.dataset.cmd, false, null);
      } catch {
        /* ignore */
      }
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}

export function bindRichNoteEditor(editor, { onInput } = {}) {
  if (!editor) return;
  bindRichNoteToolbar(editor.closest(".rich-note")?.querySelector(".rich-note-toolbar"), editor);
  editor.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const map = { b: "bold", i: "italic", u: "underline" };
    const cmd = map[e.key.toLowerCase()];
    if (!cmd) return;
    e.preventDefault();
    try {
      document.execCommand(cmd, false, null);
    } catch {
      /* ignore */
    }
  });
  editor.addEventListener("input", () => onInput?.(getRichNoteContent(editor)));
  editor.addEventListener("blur", () => onInput?.(getRichNoteContent(editor)));
}

export function setRichNoteLocked(editor, locked) {
  if (!editor) return;
  editor.setAttribute("contenteditable", locked ? "false" : "true");
  editor.classList.toggle("rich-note-editor--locked", locked);
  editor.closest(".note-field")?.classList.toggle("note-field--locked", locked);
}

export function syncRichNoteLockState(fieldEl, locked) {
  setRichNoteLocked(fieldEl?.querySelector(".rich-note-editor"), locked);
}

export function readNoteFieldValue(fieldEl) {
  const editor = fieldEl?.querySelector(".rich-note-editor");
  if (!editor) return "";
  return readEditorMarkdown(editor);
}

export function writeNoteFieldValue(fieldEl, value) {
  setRichNoteContent(fieldEl?.querySelector(".rich-note-editor"), value);
}
