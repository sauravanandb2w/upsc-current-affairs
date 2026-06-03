/** Parse and serialize study/themes/<id>/notes.md (Mains theme workspace). */

import { noteValueToMarkdown } from "./note-markdown.js";

export const THEME_SECTIONS = [
  "Summary",
  "Static connection",
  "Exam corner",
  "Miscellaneous",
  "Conclusion",
  "Quotes",
  "Current affairs linkages",
  "Value material",
];

const THEME_HEADERS = new Set(THEME_SECTIONS);

export function sectionPlainLength(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_~`#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

export function emptyThemeSections() {
  return Object.fromEntries(THEME_SECTIONS.map((k) => [k, ""]));
}

export function parseThemeNotesMd(text) {
  const sections = { ...emptyThemeSections() };
  let current = null;
  const buf = [];

  const flush = () => {
    if (current != null) sections[current] = buf.join("\n").trim();
    buf.length = 0;
  };

  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      const header = line.slice(3).trim();
      if (THEME_HEADERS.has(header)) {
        flush();
        current = header;
        continue;
      }
    }
    if (current != null) buf.push(line);
  }
  flush();
  return sections;
}

export function normalizeThemeSections(sections) {
  if (!sections || typeof sections !== "object") return emptyThemeSections();
  const out = { ...emptyThemeSections(), ...sections };
  for (const key of THEME_SECTIONS) {
    if (out[key]) out[key] = noteValueToMarkdown(out[key]);
  }
  return out;
}

export function serializeThemeNotesMd(sections) {
  const parts = [];
  for (const key of THEME_SECTIONS) {
    const body = noteValueToMarkdown(sections[key] || "").trim();
    parts.push(`## ${key}`, "", body || "", "");
  }
  return parts.join("\n").trimEnd() + "\n";
}

export function themeSectionsHaveBody(sections) {
  return THEME_SECTIONS.some((sec) => sectionPlainLength(sections?.[sec]) > 0);
}
