/**
 * Upload cuttings / PDFs to study/items/{id}/ via GitHub Contents API.
 */

import { getGitHubRepo, getGitHubToken, isGitHubUploadAllowed } from "./github-auth.js";

const API = "https://api.github.com";
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const PDF_EXT = new Set([".pdf"]);

async function assertUploadAllowed() {
  if (!(await isGitHubUploadAllowed())) {
    throw new Error("Upload restricted to the repo owner.");
  }
}

function apiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function slugify(name) {
  const base = name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "file";
}

function normalizeImageExt(file) {
  let ext = (file.name.match(/\.[^.]+$/)?.[0] || ".jpg").toLowerCase();
  if (ext === ".jpeg") ext = ".jpg";
  if (!IMAGE_EXT.has(ext)) ext = ".jpg";
  return ext;
}

function normalizePdfExt(file) {
  const ext = (file.name.match(/\.[^.]+$/)?.[0] || ".pdf").toLowerCase();
  return PDF_EXT.has(ext) ? ext : ".pdf";
}

async function bufferToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function encodeRepoPath(path) {
  return path
    .replace(/^\//, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function decodeFileContent(data) {
  if (data.encoding !== "base64") return data.content ?? null;
  try {
    return decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
  } catch {
    return null;
  }
}

export async function getRepoFile(path) {
  const token = getGitHubToken();
  const { owner, name } = await getGitHubRepo();
  if (!token || !owner || !name) throw new Error("Connect GitHub first.");

  const res = await fetch(`${API}/repos/${owner}/${name}/contents/${encodeRepoPath(path)}`, {
    headers: apiHeaders(token),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub read failed (${res.status})`);
  }

  const data = await res.json();
  return { sha: data.sha, text: decodeFileContent(data), raw: data };
}

async function getRepoFileSha(path) {
  const token = getGitHubToken();
  const { owner, name } = await getGitHubRepo();
  if (!token || !owner || !name) throw new Error("Connect GitHub first.");

  const res = await fetch(`${API}/repos/${owner}/${name}/contents/${encodeRepoPath(path)}`, {
    headers: apiHeaders(token),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub read failed (${res.status})`);
  }

  const data = await res.json();
  return data.sha;
}

export async function putRepoFile(path, base64Content, message, sha = null) {
  const token = getGitHubToken();
  const { owner, name } = await getGitHubRepo();
  if (!token || !owner || !name) throw new Error("Connect GitHub first.");

  const body = { message, content: base64Content, branch: "main" };
  if (sha) body.sha = sha;

  const res = await fetch(`${API}/repos/${owner}/${name}/contents/${encodeRepoPath(path)}`, {
    method: "PUT",
    headers: { ...apiHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub upload failed (${res.status})`);
  }

  return res.json();
}

export async function deleteRepoFile(path, sha, message) {
  const token = getGitHubToken();
  const { owner, name } = await getGitHubRepo();
  if (!token || !owner || !name) throw new Error("Connect GitHub first.");

  const res = await fetch(`${API}/repos/${owner}/${name}/contents/${encodeRepoPath(path)}`, {
    method: "DELETE",
    headers: { ...apiHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch: "main" }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub delete failed (${res.status})`);
  }

  return res.json();
}

function basename(path) {
  return path.replace(/^\.\//, "").split("/").pop() || path;
}

async function loadCaManifest(itemId, fallbackManifest) {
  const folder = `study/items/${itemId}`;
  const manifestPath = `${folder}/manifest.json`;
  const file = await getRepoFile(manifestPath);
  if (!file) {
    return {
      path: manifestPath,
      sha: null,
      data: fallbackManifest ? { ...fallbackManifest } : { id: itemId, images: [], sources: [] },
    };
  }
  try {
    return { path: manifestPath, sha: file.sha, data: JSON.parse(file.text) };
  } catch {
    return { path: manifestPath, sha: file.sha, data: { id: itemId, images: [], sources: [] } };
  }
}

async function saveManifest(manifestPath, sha, data, commitMessage) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + "\n")));
  await putRepoFile(manifestPath, content, commitMessage, sha);
}

function stripDraftFields(item) {
  const { _draft, _createdAt, _folder, ...rest } = item;
  return rest;
}

function removeImageEntry(images, targetFile) {
  const key = basename(targetFile);
  return (images || []).filter((item) => {
    const file = typeof item === "string" ? item : item?.file;
    if (!file) return true;
    return file !== targetFile && basename(file) !== key;
  });
}

function removeSourceByPath(sources, targetFile) {
  const key = basename(targetFile);
  return (sources || []).filter((src) => {
    const path = src?.file?.path || "";
    return basename(path) !== key && path !== targetFile;
  });
}

/** Upload newspaper cutting / image to study/items/{id}/ */
export async function uploadCaItemImage(itemId, file, fallbackManifest) {
  await assertUploadAllowed();
  const ext = normalizeImageExt(file);
  const destName = `${slugify(file.name)}${ext}`;
  const folder = `study/items/${itemId}`;
  const filePath = `${folder}/${destName}`;

  const manifest = await loadCaManifest(itemId, stripDraftFields(fallbackManifest || {}));
  manifest.data.id = manifest.data.id || itemId;
  const images = manifest.data.images || [];
  const listed = images.map((i) => (typeof i === "string" ? i : i?.file)).filter(Boolean);
  if (!listed.includes(destName)) {
    manifest.data.images = [...images, destName];
  }

  const b64 = await bufferToBase64(file);
  await putRepoFile(filePath, b64, `Add CA cutting ${itemId}/${destName}`);
  await saveManifest(manifest.path, manifest.sha, manifest.data, `Update manifest ${itemId}`);

  return { path: filePath, name: destName };
}

/** Small PDFs in git; large magazines → paste Drive link in sources instead */
const PDF_MAX_BYTES = 25 * 1024 * 1024;

export async function uploadCaItemPdf(itemId, file, fallbackManifest) {
  await assertUploadAllowed();
  if (file.size > PDF_MAX_BYTES) {
    throw new Error(
      "PDF too large for in-app git upload (max 25 MB). Paste a Google Drive link in Sources instead — keeps the repo fast."
    );
  }

  const ext = normalizePdfExt(file);
  const destName = `${slugify(file.name)}${ext}`;
  const folder = `study/items/${itemId}`;
  const filePath = `${folder}/${destName}`;

  const manifest = await loadCaManifest(itemId, stripDraftFields(fallbackManifest || {}));
  manifest.data.id = manifest.data.id || itemId;
  manifest.data.sources = manifest.data.sources || [];

  const exists = manifest.data.sources.some((s) => s?.file?.path === destName);
  if (!exists) {
    manifest.data.sources.push({
      type: "magazine",
      name: file.name.replace(/\.[^.]+$/, ""),
      date: manifest.data.date || new Date().toISOString().slice(0, 10),
      url: "",
      file: { storage: "git", path: destName },
    });
  }

  const b64 = await bufferToBase64(file);
  await putRepoFile(filePath, b64, `Add CA PDF ${itemId}/${destName}`);
  await saveManifest(manifest.path, manifest.sha, manifest.data, `Update manifest ${itemId}`);

  return { path: filePath, name: destName };
}

export async function deleteCaItemImage(itemId, fileName, fallbackManifest) {
  await assertUploadAllowed();
  const cleanName = basename(fileName);
  const folder = `study/items/${itemId}`;
  const filePath = `${folder}/${cleanName}`;

  const fileSha = await getRepoFileSha(filePath);
  if (!fileSha) throw new Error("Image not found in repo.");

  const manifest = await loadCaManifest(itemId, stripDraftFields(fallbackManifest || {}));
  manifest.data.images = removeImageEntry(manifest.data.images, cleanName);

  await deleteRepoFile(filePath, fileSha, `Remove CA cutting ${itemId}/${cleanName}`);
  await saveManifest(manifest.path, manifest.sha, manifest.data, `Update manifest ${itemId}`);
  return { name: cleanName };
}

export async function deleteCaItemPdf(itemId, fileName, fallbackManifest) {
  await assertUploadAllowed();
  const cleanName = basename(fileName);
  const folder = `study/items/${itemId}`;
  const filePath = `${folder}/${cleanName}`;

  const fileSha = await getRepoFileSha(filePath);
  if (!fileSha) throw new Error("PDF not found in repo.");

  const manifest = await loadCaManifest(itemId, stripDraftFields(fallbackManifest || {}));
  manifest.data.sources = removeSourceByPath(manifest.data.sources, cleanName);

  await deleteRepoFile(filePath, fileSha, `Remove CA PDF ${itemId}/${cleanName}`);
  await saveManifest(manifest.path, manifest.sha, manifest.data, `Update manifest ${itemId}`);
  return { name: cleanName };
}

// ——— Mains themes: study/themes/<themeId>/ ———

async function loadThemeManifest(themeId, fallbackManifest) {
  const folder = `study/themes/${themeId}`;
  const manifestPath = `${folder}/manifest.json`;
  const file = await getRepoFile(manifestPath);
  if (!file) {
    return {
      path: manifestPath,
      sha: null,
      data: fallbackManifest
        ? { ...fallbackManifest }
        : { id: themeId, images: [], sources: [], links: [] },
    };
  }
  try {
    return { path: manifestPath, sha: file.sha, data: JSON.parse(file.text) };
  } catch {
    return { path: manifestPath, sha: file.sha, data: { id: themeId, images: [], sources: [], links: [] } };
  }
}

export async function uploadThemeImage(themeId, file, fallbackManifest) {
  await assertUploadAllowed();
  const ext = normalizeImageExt(file);
  const destName = `${slugify(file.name)}${ext}`;
  const folder = `study/themes/${themeId}`;
  const filePath = `${folder}/${destName}`;

  const manifest = await loadThemeManifest(themeId, fallbackManifest || {});
  manifest.data.id = manifest.data.id || themeId;
  const images = manifest.data.images || [];
  const listed = images.map((i) => (typeof i === "string" ? i : i?.file)).filter(Boolean);
  if (!listed.includes(destName)) manifest.data.images = [...images, destName];

  const b64 = await bufferToBase64(file);
  await putRepoFile(filePath, b64, `Add theme cutting ${themeId}/${destName}`);
  await saveManifest(manifest.path, manifest.sha, manifest.data, `Update theme manifest ${themeId}`);

  return { path: filePath, name: destName };
}

export async function uploadThemePdf(themeId, file, fallbackManifest) {
  await assertUploadAllowed();
  if (file.size > PDF_MAX_BYTES) {
    throw new Error(
      "PDF too large for in-app git upload (max 25 MB). Paste a Google Drive link in Sources instead."
    );
  }

  const ext = normalizePdfExt(file);
  const destName = `${slugify(file.name)}${ext}`;
  const folder = `study/themes/${themeId}`;
  const filePath = `${folder}/${destName}`;

  const manifest = await loadThemeManifest(themeId, fallbackManifest || {});
  manifest.data.id = manifest.data.id || themeId;
  manifest.data.sources = manifest.data.sources || [];

  const exists = manifest.data.sources.some((s) => s?.file?.path === destName);
  if (!exists) {
    manifest.data.sources.push({
      type: "magazine",
      name: file.name.replace(/\.[^.]+$/, ""),
      date: new Date().toISOString().slice(0, 10),
      url: "",
      file: { storage: "git", path: destName },
    });
  }

  const b64 = await bufferToBase64(file);
  await putRepoFile(filePath, b64, `Add theme PDF ${themeId}/${destName}`);
  await saveManifest(manifest.path, manifest.sha, manifest.data, `Update theme manifest ${themeId}`);

  return { path: filePath, name: destName };
}

export async function deleteThemeImage(themeId, fileName, fallbackManifest) {
  await assertUploadAllowed();
  const cleanName = basename(fileName);
  const folder = `study/themes/${themeId}`;
  const filePath = `${folder}/${cleanName}`;

  const fileSha = await getRepoFileSha(filePath);
  if (!fileSha) throw new Error("Image not found in repo.");

  const manifest = await loadThemeManifest(themeId, fallbackManifest || {});
  manifest.data.images = removeImageEntry(manifest.data.images, cleanName);

  await deleteRepoFile(filePath, fileSha, `Remove theme cutting ${themeId}/${cleanName}`);
  await saveManifest(manifest.path, manifest.sha, manifest.data, `Update theme manifest ${themeId}`);
  return { name: cleanName };
}

export async function deleteThemePdf(themeId, fileName, fallbackManifest) {
  await assertUploadAllowed();
  const cleanName = basename(fileName);
  const folder = `study/themes/${themeId}`;
  const filePath = `${folder}/${cleanName}`;

  const fileSha = await getRepoFileSha(filePath);
  if (!fileSha) throw new Error("PDF not found in repo.");

  const manifest = await loadThemeManifest(themeId, fallbackManifest || {});
  manifest.data.sources = removeSourceByPath(manifest.data.sources, cleanName);

  await deleteRepoFile(filePath, fileSha, `Remove theme PDF ${themeId}/${cleanName}`);
  await saveManifest(manifest.path, manifest.sha, manifest.data, `Update theme manifest ${themeId}`);
  return { name: cleanName };
}

export async function fetchThemeManifestFromGitHub(themeId) {
  const path = `study/themes/${themeId}/manifest.json`;
  const file = await getRepoFile(path);
  if (!file?.text) return null;
  try {
    return JSON.parse(file.text);
  } catch {
    return null;
  }
}
