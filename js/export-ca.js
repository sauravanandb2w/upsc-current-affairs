import { getAllCloudDataForExport, getCloudEntry, getGitNotesFromLocal, getItemMeta } from "./ca-store.js";
import { GIT_SECTIONS } from "./notes-md.js";
import { noteHtmlToPlainText } from "./rich-notes.js?v=28";
import { getFlashcards } from "./flashcards.js";
import { effectiveItemDate, isValidIsoDate } from "./date-picker.js";

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function exportDateLabel(item) {
  const d = effectiveItemDate(item);
  return d ? d : "Date unknown";
}

export function exportCaAsJson(items) {
  const { cloudCache, metaCache } = getAllCloudDataForExport();
  const payload = {
    exportedAt: new Date().toISOString(),
    items: items.map((item) => ({
      ...item,
      date: exportDateLabel(item),
      cloud: cloudCache[item.id] || null,
      meta: metaCache[item.id] || null,
      gitNotesLocal: getGitNotesFromLocal(item.id),
    })),
    flashcards: getFlashcards(),
  };
  downloadBlob(`upsc-ca-backup-${stamp()}.json`, JSON.stringify(payload, null, 2), "application/json");
}

export function exportCaAsMarkdown(items, { year = null, month = null, fromDate = null, toDate = null } = {}) {
  let filtered = items.slice();
  if (year) filtered = filtered.filter((i) => effectiveItemDate(i).startsWith(String(year)));
  if (month) filtered = filtered.filter((i) => effectiveItemDate(i).startsWith(month));
  if (fromDate && isValidIsoDate(fromDate)) {
    filtered = filtered.filter((i) => {
      const d = effectiveItemDate(i);
      return d && d >= fromDate && (!toDate || d <= toDate);
    });
  }
  filtered.sort((a, b) => effectiveItemDate(a).localeCompare(effectiveItemDate(b)));

  const lines = [
    "# UPSC Current Affairs — backup",
    "",
    `Exported: ${new Date().toISOString()}`,
    `Items: ${filtered.length}`,
    "",
  ];

  for (const item of filtered) {
    const cloud = getCloudEntry(item.id);
    const git = getGitNotesFromLocal(item.id) || cloud.gitNotes || {};
    const meta = getItemMeta(item.id);
    lines.push(`## ${exportDateLabel(item)} — ${item.title}`, "");
    if (meta.starred) lines.push("★ Starred", "");
    if (cloud.summary) {
      lines.push("### Summary", "", noteHtmlToPlainText(cloud.summary), "");
    }
    for (const sec of GIT_SECTIONS) {
      const body = git[sec] ? noteHtmlToPlainText(git[sec]) : "";
      if (body.trim()) lines.push(`### ${sec}`, "", body, "");
    }
    if (item.tags?.length) lines.push(`*Tags:* ${item.tags.join(", ")}`, "");
    lines.push("---", "");
  }

  const suffix = month || year || (fromDate ? `${fromDate}-to-${toDate || stamp()}` : "all");
  downloadBlob(`upsc-ca-${suffix}-${stamp()}.md`, lines.join("\n"), "text/markdown;charset=utf-8");
}

export function bindExportButtons(jsonBtn, mdBtn, getItems) {
  jsonBtn?.addEventListener("click", () => exportCaAsJson(getItems()));
  mdBtn?.addEventListener("click", () => exportCaAsMarkdown(getItems()));
}

export function bindMonthlyExportBtn(btn, getItems) {
  btn?.addEventListener("click", () => {
    const month = prompt("Month (YYYY-MM):", new Date().toISOString().slice(0, 7));
    if (!month) return;
    exportCaAsMarkdown(getItems(), { month });
  });
}
