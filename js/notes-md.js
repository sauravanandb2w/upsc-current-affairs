/** Parse and serialize study/items/<id>/notes.md (git-only sections). */

import { fieldIdForSection } from "./field-locks.js";

export const GIT_SECTIONS = [
  "Facts",
  "Static connection",
  "GS paper fit",
  "Exam angle",
  "Miscellaneous",
];

export const SUMMARY_SECTION = "Summary / story";

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

/** Git notes.md as base; browser/Supabase overrides only non-empty sections. */
export function mergeGitSectionsWithLocal(fromGit, local) {
  const merged = { ...emptyGitSections(), ...fromGit };
  if (!local || typeof local !== "object") return merged;
  for (const sec of GIT_SECTIONS) {
    const fid = fieldIdForSection(sec);
    const val = local[sec] ?? local[fid];
    if (val != null && sectionPlainLength(val) > 0) merged[sec] = coalesceNoteText(val, merged[sec]);
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
      flush();
      current = line.slice(3).trim();
    } else if (current != null) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

export function serializeNotesMd(sections, { includeSummary = false } = {}) {
  const order = includeSummary ? [SUMMARY_SECTION, ...GIT_SECTIONS] : GIT_SECTIONS;
  const parts = [];
  for (const key of order) {
    const body = (sections[key] || "").trim();
    parts.push(`## ${key}`, "", body || "", "");
  }
  return parts.join("\n").trimEnd() + "\n";
}

export function defaultNotesTemplate() {
  return serializeNotesMd(emptyGitSections());
}
