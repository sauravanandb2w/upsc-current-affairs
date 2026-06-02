/**
 * Publish a browser draft CA item to git via GitHub API (no terminal).
 */

import { isGitHubConnected, isGitHubUploadAllowed } from "./github-auth.js";
import { getRepoFile, putRepoFile } from "./github-upload.js";
import { GIT_SECTIONS, serializeNotesMd, defaultNotesTemplate } from "./notes-md.js";
import { getCloudEntry, getGitNotesFromLocal } from "./ca-store.js";
import { noteHtmlToPlainText } from "./rich-notes.js";

function textToBase64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

function manifestFromItem(item) {
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

function notesBodyForItem(itemId) {
  const git = getGitNotesFromLocal(itemId) || getCloudEntry(itemId).gitNotes || {};
  const sections = {};
  for (const sec of GIT_SECTIONS) {
    sections[sec] = noteHtmlToPlainText(git[sec] || "");
  }
  const summary = noteHtmlToPlainText(getCloudEntry(itemId).summary || "");
  const hasGit = Object.values(sections).some((v) => String(v).trim());
  if (!summary.trim() && !hasGit) return defaultNotesTemplate();
  if (summary.trim()) sections["Summary / story"] = summary;
  return serializeNotesMd(sections, { includeSummary: Boolean(summary.trim()) });
}

/**
 * Create manifest + notes.md + update data/index.json in the repo.
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
  const indexPath = "data/index.json";

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

  const indexFile = await getRepoFile(indexPath);
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
    indexPath,
    textToBase64(`${JSON.stringify(payload, null, 2)}\n`),
    `Update index: ${item.title}`,
    indexFile?.sha || null
  );

  return { itemId, manifestPath, indexPath };
}
