/** Browser-only drafts and status overrides (until git push / GitHub OAuth). */

import { isValidIsoDate } from "./date-picker.js";

const LS_DRAFTS = "ca-drafts:v1";
const LS_STATUS = "ca-status:v1";
const LS_DATE = "ca-date:v1";

/** @type {object[]} */
let drafts = [];

/** @type {Record<string, string>} */
let statusOverrides = {};

/** @type {Record<string, string>} */
let dateOverrides = {};

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
  try {
    dateOverrides = JSON.parse(localStorage.getItem(LS_DATE) || "{}");
    if (!dateOverrides || typeof dateOverrides !== "object") dateOverrides = {};
  } catch {
    dateOverrides = {};
  }
}

function persistDateOverrides() {
  localStorage.setItem(LS_DATE, JSON.stringify(dateOverrides));
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

export function clearStatusOverride(itemId) {
  if (!itemId || !(itemId in statusOverrides)) return;
  delete statusOverrides[itemId];
  persistStatus();
}

export function applyStatus(item) {
  const override = statusOverrides[item.id];
  if (override) return { ...item, status: override };
  return item;
}

export function getDateOverride(itemId) {
  return dateOverrides[itemId] || null;
}

export function setDateOverride(itemId, date) {
  if (!itemId || !isValidIsoDate(date)) return;
  dateOverrides[itemId] = date;
  persistDateOverrides();
}

export function clearDateOverride(itemId) {
  if (!itemId || !(itemId in dateOverrides)) return;
  delete dateOverrides[itemId];
  persistDateOverrides();
}

function applyDate(item) {
  const override = dateOverrides[item.id];
  if (isValidIsoDate(override)) return { ...item, date: override };
  return item;
}

function applyLocalMeta(item) {
  return applyDate(applyStatus(item));
}

export function mergeWithDrafts(indexItems) {
  const byId = new Map();
  for (const item of indexItems || []) {
    byId.set(item.id, applyLocalMeta({ ...item }));
  }
  for (const draft of drafts) {
    if (!byId.has(draft.id)) {
      byId.set(draft.id, applyLocalMeta({ ...draft }));
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
  if (!isValidIsoDate(date)) throw new Error("Pick a valid date from the calendar");

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

export function updateDraftItem(itemId, patch) {
  const idx = drafts.findIndex((d) => d.id === itemId);
  if (idx < 0) return null;
  drafts[idx] = { ...drafts[idx], ...patch };
  persistDrafts();
  return drafts[idx];
}

function shellQuote(value) {
  const s = String(value);
  if (!/[\s"'\\]/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function draftCliCommand(item) {
  const tags = (item.tags || []).map((t) => ` --tag ${shellQuote(t)}`).join("");
  const threads = (item.threads || []).map((t) => ` --thread ${shellQuote(t)}`).join("");
  const gs = (item.gsPapers || []).map((g) => ` --gs ${shellQuote(g)}`).join("");
  const title = shellQuote(item.title);
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
