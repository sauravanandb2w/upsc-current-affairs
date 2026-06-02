/** Resolve repo-root paths for GitHub Pages and local dev. */

let repoBaseCache = null;

export function repoBase() {
  if (repoBaseCache !== null) return repoBaseCache;

  const script = document.querySelector('script[src*="app.js"]');
  if (script?.src) {
    try {
      const url = new URL(script.src, location.href);
      const base = url.pathname.replace(/\/js\/app\.js.*$/, "");
      repoBaseCache = base === "/" ? "" : base;
      return repoBaseCache;
    } catch {
      /* fall through */
    }
  }

  if (location.hostname.endsWith(".github.io")) {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length >= 1 && parts[0] !== "oauth") {
      repoBaseCache = `/${parts[0]}`;
      return repoBaseCache;
    }
  }

  repoBaseCache = "";
  return repoBaseCache;
}

function githubRepoSlugForCdn() {
  const meta = document.querySelector('meta[name="ca-github-repo"]');
  if (meta?.content?.trim()) return meta.content.trim();
  const base = repoBase();
  if (!base) return null;
  const repo = base.replace(/^\//, "");
  return repo ? `sauravanandb2w/${repo}` : null;
}

function githubBranchForCdn() {
  return document.querySelector('meta[name="ca-github-branch"]')?.content?.trim() || "main";
}

function jsdelivrStudyUrl(path, query = "") {
  const slug = githubRepoSlugForCdn();
  if (!slug) return null;
  return `https://cdn.jsdelivr.net/gh/${slug}@${githubBranchForCdn()}/${path}${query}`;
}

export function assetUrl(relativePath) {
  const raw = String(relativePath || "");
  const qIndex = raw.indexOf("?");
  const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const query = qIndex >= 0 ? raw.slice(qIndex) : "";
  const path = pathPart.replace(/^\//, "");

  if (
    typeof location !== "undefined" &&
    location.hostname.endsWith(".github.io") &&
    path.startsWith("study/")
  ) {
    const cdn = jsdelivrStudyUrl(path, query);
    if (cdn) return cdn;
  }

  const base = repoBase();
  const resolved = base ? `${base}/${path}`.replace(/\/+/g, "/") : path;
  return `${resolved}${query}`;
}
