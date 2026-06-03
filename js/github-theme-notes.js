/**
 * Commit study/themes/<themeId>/notes.md to GitHub.
 */

import { getGitHubToken, getGitHubRepo, isGitHubUploadAllowed } from "./github-auth.js";
import { getRepoFile, putRepoFile } from "./github-upload.js";
import {
  serializeThemeNotesMd,
  parseThemeNotesMd,
  emptyThemeSections,
  themeSectionsHaveBody,
  sectionPlainLength,
} from "./theme-notes-md.js";
import { getThemeEntry } from "./theme-store.js";

export async function fetchThemeNotesMdFromGitHub(themeId) {
  const path = `study/themes/${themeId}/notes.md`;
  const file = await getRepoFile(path);
  return file?.text ?? null;
}

export async function commitThemeNotesMdToGitHub(themeId, themeTitle, liveSections = null) {
  if (!(await isGitHubUploadAllowed())) {
    throw new Error("Connect GitHub first (repo owner only).");
  }
  const token = getGitHubToken();
  const { owner, name } = await getGitHubRepo();
  if (!token || !owner || !name) throw new Error("Connect GitHub first.");

  const path = `study/themes/${themeId}/notes.md`;
  const existing = await getRepoFile(path);
  const fromGit = existing?.text ? parseThemeNotesMd(existing.text) : emptyThemeSections();

  const local = liveSections || getThemeEntry(themeId).notes || {};
  const sections = { ...emptyThemeSections() };
  for (const sec of Object.keys(sections)) {
    const live = local[sec];
    sections[sec] = String(live ?? "").trim() ? live : fromGit[sec] || "";
  }

  if (!themeSectionsHaveBody(sections) && sectionPlainLength(existing?.text) > 40) {
    throw new Error(
      "Every section is empty — refusing to overwrite GitHub. Re-open the theme and re-type, then commit."
    );
  }

  const body = serializeThemeNotesMd(sections);
  const content = btoa(unescape(encodeURIComponent(body)));
  await putRepoFile(
    path,
    content,
    `Update CA theme notes: ${themeTitle || themeId}`,
    existing?.sha || null
  );

  return { path, sections };
}
