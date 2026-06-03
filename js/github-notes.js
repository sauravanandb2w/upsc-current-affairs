/**
 * Commit notes.md to GitHub for a CA item.
 */

import { getGitHubToken, getGitHubRepo, isGitHubUploadAllowed } from "./github-auth.js";
import { getRepoFile, putRepoFile } from "./github-upload.js";
import { serializeNotesMd, GIT_SECTIONS } from "./notes-md.js";
import { getCloudEntry, getGitNotesFromLocal, gitVisibleNoteValue } from "./ca-store.js";
import { noteHtmlForGitStorage } from "./rich-notes.js?v=28";
import { fieldIdForSection } from "./field-locks.js";
import { manifestFromItem, syncSearchIndexForItem } from "./github-publish.js";

function sectionsForCommit(itemId, liveSections = null) {
  const git = getGitNotesFromLocal(itemId) || getCloudEntry(itemId).gitNotes || {};
  const out = {};
  for (const sec of GIT_SECTIONS) {
    const fid = fieldIdForSection(sec);
    const live = liveSections
      ? (liveSections[sec] ?? liveSections[fid] ?? git[sec] ?? git[fid] ?? "")
      : (git[sec] ?? git[fid] ?? "");
    out[sec] = noteHtmlForGitStorage(gitVisibleNoteValue(itemId, fid, live));
  }
  const summaryLive = liveSections
    ? (liveSections.summary ?? liveSections["Summary / story"] ?? getCloudEntry(itemId).summary ?? "")
    : (getCloudEntry(itemId).summary || "");
  const summary = noteHtmlForGitStorage(gitVisibleNoteValue(itemId, "summary", summaryLive));
  if (summary.trim()) out["Summary / story"] = summary;
  return out;
}

/** Read notes.md from the repo via GitHub API (immediate after commit). */
export async function fetchNotesMdFromGitHub(itemId) {
  const path = `study/items/${itemId}/notes.md`;
  const file = await getRepoFile(path);
  return file?.text ?? null;
}

/**
 * @param {string} itemId
 * @param {object} item merged item (title, date, tags, …)
 * @param {object|null} liveSections optional live editor sections (section name keys)
 */
export async function commitNotesMdToGitHub(itemId, item, liveSections = null) {
  if (!(await isGitHubUploadAllowed())) {
    throw new Error("Connect GitHub first (repo owner only).");
  }
  const token = getGitHubToken();
  const { owner, name } = await getGitHubRepo();
  if (!token || !owner || !name) throw new Error("Connect GitHub first.");

  const path = `study/items/${itemId}/notes.md`;
  const sections = sectionsForCommit(itemId, liveSections);
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
  const searchEntry = await syncSearchIndexForItem(itemId, meta, item.title || itemId, {
    includeNoteText: true,
  });

  return { path, searchEntry };
}
