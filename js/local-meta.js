/** Browser-only drafts and status overrides (until git push / GitHub OAuth). */

const LS_DRAFTS = "ca-drafts:v1";
const LS_STATUS = "ca-status:v1";

/** @type {object[]} */
let drafts = [];

/** @type {Record<string, string>} */
let statusOverrides = {};

export function loadLocalMeta() {
  try {
    drafts = JSON.parse(localStorage.getItem(LS_DRAFTS) || "[]");
    if (!Array.isArray(drafts)) drafts = [];
  } catch {
    drafts = [];
  }
  try {
    statusOverrides = JSON.parse(localStorage.getItem(LS_STATUS) || "{}");
    if (!statusOverrides || typeof statusOverrides !== "object") statusOverrides = {};
  } catch {
    statusOverrides = {};
  }
}

function persistDrafts() {
  localStorage.setItem(LS_DRAFTS, JSON.stringify(drafts));
}

function persistStatus() {
  localStorage.setItem(LS_STATUS, JSON.stringify(statusOverrides));
}

export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

export function makeItemId(date, title) {
  return `${date}-${slugify(title)}`;
}

export function getDrafts() {
  return drafts.slice();
}

export function isDraftItem(item) {
  return Boolean(item?._draft);
}

export function getStatusOverride(itemId) {
  return statusOverrides[itemId] || null;
}

export function setStatusOverride(itemId, status) {
  if (!itemId) return;
  statusOverrides[itemId] = status;
  persistStatus();
}

export function applyStatus(item) {
  const override = statusOverrides[item.id];
  if (override) return { ...item, status: override };
  return item;
}

export function mergeWithDrafts(indexItems) {
  const byId = new Map();
  for (const item of indexItems || []) {
    byId.set(item.id, applyStatus({ ...item }));
  }
  for (const draft of drafts) {
    if (!byId.has(draft.id)) {
      byId.set(draft.id, applyStatus({ ...draft }));
    }
  }
  return [...byId.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

/**
 * @param {{ title: string, date: string, tags?: string[], threads?: string[], gsPapers?: number[], links?: object[], sources?: object[] }} input
 */
export function addDraftItem(input) {
  const title = String(input.title || "").trim();
  const date = String(input.date || "").trim();
  if (!title || !date) throw new Error("Title and date are required");

  const id = makeItemId(date, title);
  if (drafts.some((d) => d.id === id)) {
    throw new Error("An item with this date and title already exists on this device");
  }

  const item = {
    id,
    date,
    title,
    status: "to-study",
    gsPapers: [...new Set(input.gsPapers || [])].sort(),
    tags: input.tags || [],
    threads: input.threads || [],
    images: [],
    sources: input.sources || [],
    links: input.links || [],
    _draft: true,
    _createdAt: new Date().toISOString(),
  };

  drafts.unshift(item);
  persistDrafts();
  return item;
}

export function removeDraft(itemId) {
  const before = drafts.length;
  drafts = drafts.filter((d) => d.id !== itemId);
  if (drafts.length !== before) persistDrafts();
}

export function draftCliCommand(item) {
  const tags = (item.tags || []).map((t) => ` --tag ${t}`).join("");
  const threads = (item.threads || []).map((t) => ` --thread ${t}`).join("");
  const gs = (item.gsPapers || []).map((g) => ` --gs ${g}`).join("");
  const title = item.title.includes(" ") ? `"${item.title.replace(/"/g, '\\"')}"` : item.title;
  return `python3 scripts/add-item.py ${title} --date ${item.date}${tags}${threads}${gs}`;
}

export function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
