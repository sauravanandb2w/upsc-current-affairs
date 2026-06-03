/**
 * Commit notes.md to GitHub for a CA item.
 */

import { getGitHubToken, getGitHubRepo, isGitHubUploadAllowed } from "./github-auth.js";
import { getRepoFile, putRepoFile } from "./github-upload.js";
import {
  serializeNotesMd,
  parseNotesMd,
  mergeGitSectionsWithLocal,
  emptyGitSections,
  GIT_SECTIONS,
  SUMMARY_SECTION,
  sectionPlainLength,
  defaultNotesTemplate,
} from "./notes-md.js";
import {
  getCloudEntry,
  getGitNotesFromLocal,
  gitVisibleNoteValue,
  isFieldLocked,
  getLockedSnapshot,
} from "./ca-store.js";
import { noteHtmlForGitStorage } from "./rich-notes.js?v=29";
import { fieldIdForSection } from "./field-locks.js";
import { manifestFromItem, syncSearchIndexForItem } from "./github-publish.js";

function localSectionsRaw(itemId, liveSections = null, summaryLive = null) {
  const git = getGitNotesFromLocal(itemId) || getCloudEntry(itemId).gitNotes || {};
  const sections = {};
  for (const sec of GIT_SECTIONS) {
    const fid = fieldIdForSection(sec);
    const live = liveSections
      ? (liveSections[sec] ?? liveSections[fid] ?? git[sec] ?? git[fid] ?? "")
      : (git[sec] ?? git[fid] ?? "");
    sections[sec] = gitVisibleNoteValue(itemId, fid, live);
  }
  const summarySource =
    summaryLive ??
    (liveSections
      ? (liveSections.summary ?? liveSections[SUMMARY_SECTION] ?? getCloudEntry(itemId).summary ?? "")
      : getCloudEntry(itemId).summary || "");
  return {
    sections,
    summary: gitVisibleNoteValue(itemId, "summary", summarySource),
  };
}

/** Merge live editor values with existing notes.md so empty fields keep GitHub content (partial commit). */
function sectionsForCommit(itemId, liveSections = null, summaryLive = null, existingGitText = null) {
  const fromGit = existingGitText ? parseNotesMd(existingGitText) : { ...emptyGitSections(), [SUMMARY_SECTION]: "" };
  const { sections: localRaw, summary: localSummary } = localSectionsRaw(itemId, liveSections, summaryLive);
  const merged = mergeGitSectionsWithLocal(fromGit, localRaw);

  const out = {};
  for (const sec of GIT_SECTIONS) {
    const fid = fieldIdForSection(sec);
    const val = isFieldLocked(itemId, fid) ? getLockedSnapshot(itemId, fid) : merged[sec];
    out[sec] = noteHtmlForGitStorage(val);
  }

  const summaryMerged =
    sectionPlainLength(localSummary) > 0
      ? localSummary
      : isFieldLocked(itemId, "summary")
        ? getLockedSnapshot(itemId, "summary")
        : fromGit[SUMMARY_SECTION] || "";
  const summary = noteHtmlForGitStorage(summaryMerged);
  if (sectionPlainLength(summary) > 0) out[SUMMARY_SECTION] = summary;
  return out;
}

function localSectionsHaveContent(itemId, liveSections = null, summaryLive = null) {
  const { sections, summary } = localSectionsRaw(itemId, liveSections, summaryLive);
  if (sectionPlainLength(summary) > 0) return true;
  return Object.values(sections).some((v) => sectionPlainLength(v) > 0);
}

function sectionsHaveContent(sections) {
  return Object.values(sections).some((v) => sectionPlainLength(v) > 0);
}

function notesBodyIsEmpty(body, sections) {
  if (sectionsHaveContent(sections)) return false;
  const trimmed = String(body || "").trim();
  if (!trimmed) return true;
  return trimmed === defaultNotesTemplate().trim();
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
export async function commitNotesMdToGitHub(itemId, item, liveSections = null, summaryLive = null) {
  if (!(await isGitHubUploadAllowed())) {
    throw new Error("Connect GitHub first (repo owner only).");
  }
  const token = getGitHubToken();
  const { owner, name } = await getGitHubRepo();
  if (!token || !owner || !name) throw new Error("Connect GitHub first.");

  const path = `study/items/${itemId}/notes.md`;
  const existing = await getRepoFile(path);
  const sections = sectionsForCommit(itemId, liveSections, summaryLive, existing?.text ?? null);
  const body = serializeNotesMd(sections, { includeSummary: Boolean(sections[SUMMARY_SECTION]) });

  if (
    notesBodyIsEmpty(body, sections) &&
    !localSectionsHaveContent(itemId, liveSections, summaryLive) &&
    existing?.text &&
    sectionPlainLength(existing.text) > 40
  ) {
    throw new Error(
      "Every note section is empty on this screen — refusing to overwrite GitHub. Hard-refresh, open the item again, or re-type, then commit. Partial commits (some sections filled, others empty) are fine."
    );
  }

  const content = btoa(unescape(encodeURIComponent(body)));
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
