/**
 * Commit notes.md to GitHub for a CA item.
 */

import { getGitHubToken, getGitHubRepo, isGitHubUploadAllowed } from "./github-auth.js";
import { getRepoFile, putRepoFile } from "./github-upload.js";
import { serializeNotesMd, GIT_SECTIONS } from "./notes-md.js";
import { getCloudEntry, getGitNotesFromLocal } from "./ca-store.js";
import { noteHtmlToPlainText } from "./rich-notes.js";
import { manifestFromItem, syncSearchIndexForItem } from "./github-publish.js";

function sectionsForCommit(itemId) {
  const git = getGitNotesFromLocal(itemId) || getCloudEntry(itemId).gitNotes || {};
  const out = {};
  for (const sec of GIT_SECTIONS) {
    out[sec] = noteHtmlToPlainText(git[sec] || "");
  }
  const summary = noteHtmlToPlainText(getCloudEntry(itemId).summary || "");
  if (summary.trim()) out["Summary / story"] = summary;
  return out;
}

/**
 * @param {string} itemId
 * @param {object} item merged item (title, date, tags, …)
 */
export async function commitNotesMdToGitHub(itemId, item) {
  if (!(await isGitHubUploadAllowed())) {
    throw new Error("Connect GitHub first (repo owner only).");
  }
  const token = getGitHubToken();
  const { owner, name } = await getGitHubRepo();
  if (!token || !owner || !name) throw new Error("Connect GitHub first.");

  const path = `study/items/${itemId}/notes.md`;
  const sections = sectionsForCommit(itemId);
  const body = serializeNotesMd(sections, { includeSummary: Boolean(sections["Summary / story"]) });
  const content = btoa(unescape(encodeURIComponent(body)));

  const existing = await getRepoFile(path);
  await putRepoFile(
    path,
    content,
    `Update CA notes: ${item.title || itemId}`,
    existing?.sha || null
  );

  const meta = manifestFromItem(item);
  const searchEntry = await syncSearchIndexForItem(itemId, meta, item.title || itemId);

  return { path, searchEntry };
}
