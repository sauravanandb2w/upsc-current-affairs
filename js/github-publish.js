/**
 * Publish and update CA items on git via GitHub API (no terminal).
 */

import { isGitHubConnected, isGitHubUploadAllowed } from "./github-auth.js";
import { getRepoFile, putRepoFile } from "./github-upload.js";
import { GIT_SECTIONS, serializeNotesMd, defaultNotesTemplate } from "./notes-md.js";
import { getCloudEntry, getGitNotesFromLocal, gitVisibleNoteValue } from "./ca-store.js";
import { noteHtmlToPlainText } from "./rich-notes.js";
import { fieldIdForSection } from "./field-locks.js";

const INDEX_PATH = "data/index.json";
const SEARCH_INDEX_PATH = "data/search-index.json";

function textToBase64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

export function manifestFromItem(item) {
  return {
    id: item.id,
    date: item.date,
    title: item.title,
    status: item.status || "to-study",
    gsPapers: [...(item.gsPapers || [])].sort(),
    tags: item.tags || [],
    threads: item.threads || [],
    images: item.images || [],
    sources: item.sources || [],
    links: item.links || [],
  };
}

export function buildSearchTextForItem(itemId, item = {}) {
  const git = getGitNotesFromLocal(itemId) || getCloudEntry(itemId).gitNotes || {};
  const parts = [
    item.title,
    item.id,
    ...(item.tags || []),
    ...(item.threads || []),
    noteHtmlToPlainText(gitVisibleNoteValue(itemId, "summary", getCloudEntry(itemId).summary || item.summary || "")),
  ];
  for (const sec of GIT_SECTIONS) {
    const fid = fieldIdForSection(sec);
    parts.push(noteHtmlToPlainText(gitVisibleNoteValue(itemId, fid, git[sec] ?? git[fid] ?? "")));
  }
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

function searchIndexEntryForItem(itemId, item) {
  return {
    title: item.title || "",
    date: item.date || "",
    tags: item.tags || [],
    threads: item.threads || [],
    text: buildSearchTextForItem(itemId, item),
  };
}

function mergeSourcesForSave(gitSources = [], itemSources = []) {
  const fileSources = (gitSources || []).filter((s) => s?.file?.storage === "git");
  const urlSources = (itemSources || []).filter((s) => s?.url && !s?.file?.storage);
  const seen = new Set();
  const out = [...fileSources];
  for (const source of urlSources) {
    const key = source.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function notesBodyForItem(itemId) {
  const git = getGitNotesFromLocal(itemId) || getCloudEntry(itemId).gitNotes || {};
  const sections = {};
  for (const sec of GIT_SECTIONS) {
    const fid = fieldIdForSection(sec);
    sections[sec] = noteHtmlToPlainText(gitVisibleNoteValue(itemId, fid, git[sec] ?? git[fid] ?? ""));
  }
  const summary = noteHtmlToPlainText(
    gitVisibleNoteValue(itemId, "summary", getCloudEntry(itemId).summary || "")
  );
  const hasGit = Object.values(sections).some((v) => String(v).trim());
  if (!summary.trim() && !hasGit) return defaultNotesTemplate();
  if (summary.trim()) sections["Summary / story"] = summary;
  return serializeNotesMd(sections, { includeSummary: Boolean(summary.trim()) });
}

async function readSearchIndexFile() {
  const file = await getRepoFile(SEARCH_INDEX_PATH);
  let data = { generatedAt: null, entries: {} };
  if (file?.text) {
    try {
      data = JSON.parse(file.text);
    } catch {
      /* rebuild */
    }
  }
  if (!data.entries || typeof data.entries !== "object") data.entries = {};
  return { file, data };
}

export async function syncSearchIndexForItem(itemId, item, itemTitle) {
  const { file, data } = await readSearchIndexFile();
  const entry = searchIndexEntryForItem(itemId, item);
  data.entries[itemId] = entry;
  data.generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  await putRepoFile(
    SEARCH_INDEX_PATH,
    textToBase64(`${JSON.stringify(data, null, 2)}\n`),
    `Update search index: ${itemTitle || itemId}`,
    file?.sha || null
  );
  return entry;
}

async function upsertIndexEntry(manifest, itemId, messageTitle) {
  const indexFile = await getRepoFile(INDEX_PATH);
  let indexData = { generatedAt: new Date().toISOString(), count: 0, items: [] };
  if (indexFile?.text) {
    try {
      indexData = JSON.parse(indexFile.text);
    } catch {
      /* rebuild index */
    }
  }

  const items = (indexData.items || []).filter((row) => row.id !== itemId);
  items.push({ ...manifest, _folder: itemId });
  items.sort(
    (a, b) =>
      (b.date || "").localeCompare(a.date || "") || (b.id || "").localeCompare(a.id || "")
  );

  const payload = {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    count: items.length,
    items,
  };

  await putRepoFile(
    INDEX_PATH,
    textToBase64(`${JSON.stringify(payload, null, 2)}\n`),
    `Update index: ${messageTitle}`,
    indexFile?.sha || null
  );
}

/**
 * Create manifest + notes.md + update index and search index in the repo.
 * @param {object} item draft item from local-meta
 */
export async function publishDraftToGitHub(item) {
  if (!isGitHubConnected()) {
    throw new Error("Connect GitHub in the header first.");
  }
  if (!(await isGitHubUploadAllowed())) {
    throw new Error("Publishing is restricted to the repo owner account.");
  }

  const itemId = item.id;
  const manifest = manifestFromItem(item);
  const manifestPath = `study/items/${itemId}/manifest.json`;
  const notesPath = `study/items/${itemId}/notes.md`;

  const existingManifest = await getRepoFile(manifestPath);
  if (existingManifest) {
    throw new Error(`Already in git: ${itemId}. Open the item to edit, or change title/date.`);
  }

  await putRepoFile(
    manifestPath,
    textToBase64(`${JSON.stringify(manifest, null, 2)}\n`),
    `Add CA: ${item.title}`
  );

  const existingNotes = await getRepoFile(notesPath);
  if (!existingNotes) {
    await putRepoFile(notesPath, textToBase64(notesBodyForItem(itemId)), `Add CA notes: ${item.title}`);
  }

  await upsertIndexEntry(manifest, itemId, item.title);
  const searchEntry = await syncSearchIndexForItem(itemId, manifest, item.title);

  return { itemId, manifestPath, indexPath: INDEX_PATH, searchEntry };
}

/**
 * Update manifest + index + search index for an item already in git.
 * @param {object} item merged item (status, tags, links, sources, etc.)
 */
export async function savePublishedItemToGitHub(item) {
  if (!isGitHubConnected()) {
    throw new Error("Connect GitHub in the header first.");
  }
  if (!(await isGitHubUploadAllowed())) {
    throw new Error("Saving is restricted to the repo owner account.");
  }

  const itemId = item.id;
  const manifestPath = `study/items/${itemId}/manifest.json`;
  const existing = await getRepoFile(manifestPath);
  if (!existing) {
    throw new Error("Not in git yet. Use Publish to GitHub first.");
  }

  let gitData = {};
  try {
    gitData = JSON.parse(existing.text);
  } catch {
    gitData = {};
  }

  const manifest = manifestFromItem(item);
  manifest.images = gitData.images || manifest.images || [];
  manifest.sources = mergeSourcesForSave(gitData.sources, item.sources);

  await putRepoFile(
    manifestPath,
    textToBase64(`${JSON.stringify(manifest, null, 2)}\n`),
    `Update CA: ${item.title}`,
    existing.sha
  );

  await upsertIndexEntry(manifest, itemId, item.title);
  const searchEntry = await syncSearchIndexForItem(itemId, manifest, item.title);

  return { itemId, manifest, searchEntry };
}
