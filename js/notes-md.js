/** Parse and serialize study/items/<id>/notes.md (git-only sections). */

export const GIT_SECTIONS = [
  "Facts",
  "Static connection",
  "GS paper fit",
  "Exam angle",
  "Miscellaneous",
];

export const SUMMARY_SECTION = "Summary / story";

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
