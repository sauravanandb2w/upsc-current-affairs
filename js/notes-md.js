/** Parse and serialize study/items/<id>/notes.md (git-only sections). */

import { fieldIdForSection } from "./field-locks.js";
import { noteMarkdownForStorage } from "./note-markdown.js";

export const GIT_SECTIONS = [
  "Facts",
  "Static connection",
  "GS paper fit",
  "Exam angle",
  "Miscellaneous",
];

export const SUMMARY_SECTION = "Summary / story";

const NOTES_MD_SECTION_HEADERS = new Set([SUMMARY_SECTION, ...GIT_SECTIONS]);

export function sectionPlainLength(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_~`#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

function coalesceNoteText(...candidates) {
  for (const value of candidates) {
    if (sectionPlainLength(value) > 0) return String(value ?? "");
  }
  return String(candidates[candidates.length - 1] ?? "");
}

/** Git notes.md as base; browser/Supabase overrides only non-empty sections (drafting). */
export function mergeGitSectionsWithLocal(fromGit, local) {
  const merged = emptyGitSections();
  for (const sec of GIT_SECTIONS) {
    merged[sec] = noteMarkdownForStorage(fromGit?.[sec] || "");
  }
  if (!local || typeof local !== "object") return merged;
  for (const sec of GIT_SECTIONS) {
    const fid = fieldIdForSection(sec);
    const val = local[sec] ?? local[fid];
    if (val != null && sectionPlainLength(val) > 0) {
      merged[sec] = noteMarkdownForStorage(coalesceNoteText(val, merged[sec]));
    }
  }
  return merged;
}

export function emptyGitSections() {
  return Object.fromEntries(GIT_SECTIONS.map((k) => [k, ""]));
}

export function parseNotesMd(text) {
  const sections = { ...emptyGitSections(), [SUMMARY_SECTION]: "" };
  let current = null;
  const buf = [];

  const flush = () => {
    if (current != null) {
      sections[current] = buf.join("\n").trim();
    }
    buf.length = 0;
  };

  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      const header = line.slice(3).trim();
      if (NOTES_MD_SECTION_HEADERS.has(header)) {
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

export function normalizeParsedGitSections(sections) {
  if (!sections || typeof sections !== "object") return { ...emptyGitSections(), [SUMMARY_SECTION]: "" };
  const out = { ...sections };
  for (const key of [SUMMARY_SECTION, ...GIT_SECTIONS]) {
    if (out[key]) out[key] = noteMarkdownForStorage(out[key]);
  }
  return out;
}

export function gitSectionsHaveBody(sections) {
  return GIT_SECTIONS.some((sec) => sectionPlainLength(sections?.[sec]) > 0);
}

export function serializeNotesMd(sections, { includeSummary = false } = {}) {
  const order = includeSummary ? [SUMMARY_SECTION, ...GIT_SECTIONS] : GIT_SECTIONS;
  const parts = [];
  for (const key of order) {
    const body = noteMarkdownForStorage(sections[key] || "");
    parts.push(`## ${key}`, "", body || "", "");
  }
  return parts.join("\n").trimEnd() + "\n";
}

export function defaultNotesTemplate() {
  return serializeNotesMd(emptyGitSections());
}
