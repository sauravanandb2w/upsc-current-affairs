/**
 * Mains Themes — GS I–IV + Essay, structured notes + git materials.
 */

import { assetUrl } from "./paths.js";
import {
  THEME_SECTIONS,
  parseThemeNotesMd,
  normalizeThemeSections,
  emptyThemeSections,
} from "./theme-notes-md.js";
import {
  getThemeEntry,
  updateThemeNotes,
  updateThemeLinks,
  updateThemeSources,
  flushThemeSavesNow,
} from "./theme-store.js";
import {
  renderGitHubConnectHint,
  renderGitHubUploadButton,
  bindThemeMaterialsUploads,
} from "./github-upload-ui.js";
import {
  commitThemeNotesMdToGitHub,
  fetchThemeNotesMdFromGitHub,
} from "./github-theme-notes.js";
import { fetchThemeManifestFromGitHub } from "./github-upload.js";
import { isGitHubConnected } from "./github-auth.js";
import {
  getMergedThemesForPaper,
  findThemeById,
  addCustomTheme,
  addCustomCategory,
  getCategoriesForPaper,
  themesInCategory,
  countThemesInCategory,
  isCustomCategory,
} from "./theme-catalog.js";

const PAPER_TABS = [
  { key: "1", label: "GS Paper I", short: "GS I" },
  { key: "2", label: "GS Paper II", short: "GS II" },
  { key: "3", label: "GS Paper III", short: "GS III" },
  { key: "4", label: "GS Paper IV", short: "GS IV" },
  { key: "essay", label: "Essay", short: "Essay" },
];

function renderPaperTabs(paperKey) {
  return `
    <nav class="paper-tabs themes-paper-tabs" aria-label="GS papers" data-active-paper="${escapeHtml(paperKey)}">
      ${PAPER_TABS.map(
        (p) =>
          `<button type="button" class="paper-tab paper-tab--${escapeHtml(p.key)}${p.key === paperKey ? " active" : ""}" data-theme-paper="${escapeHtml(p.key)}">${escapeHtml(p.short)}</button>`
      ).join("")}
    </nav>`;
}

function bindPaperTabClicks(ctx, root = document) {
  root.querySelectorAll("[data-theme-paper]").forEach((btn) => {
    btn.addEventListener("click", () => ctx.navigate("themes", null, btn.dataset.themePaper, null));
  });
}

let themesIndex = null;
let themeDetailRenderSeq = 0;

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function loadThemesIndex(url) {
  const urls = [url];
  const cdn = "https://cdn.jsdelivr.net/gh/sauravanandb2w/upsc-current-affairs@main/data/themes-index.json";
  if (!urls.includes(cdn)) urls.push(cdn);

  let lastErr = null;
  for (const u of urls) {
    try {
      const res = await fetch(u, { cache: "no-cache" });
      if (!res.ok) throw new Error(`themes-index.json (${res.status})`);
      themesIndex = await res.json();
      return themesIndex;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Could not load themes-index.json");
}

/** Load catalog if needed; show loading/error in main. Returns true when ready. */
export async function ensureThemesCatalogLoaded(mainEl, indexUrl) {
  if (themesIndex) return true;
  if (mainEl) mainEl.innerHTML = `<p class="muted">Loading themes…</p>`;
  try {
    await loadThemesIndex(indexUrl);
    return true;
  } catch (err) {
    if (mainEl) {
      mainEl.innerHTML = `<p class="error">Could not load theme catalog — ${escapeHtml(err.message || String(err))}. Hard refresh (Cmd+Shift+R) to load v56+.</p>`;
    }
    return false;
  }
}

export function getThemesIndex() {
  return themesIndex;
}

export function themeById(themeId) {
  return findThemeById(themeId, themesIndex, PAPER_TABS);
}

function themesForPaper(paperKey) {
  return getMergedThemesForPaper(paperKey, themesIndex);
}

function parentGroupsForPaper(paperKey) {
  return getCategoriesForPaper(paperKey, themesIndex);
}

function renderThemeBreadcrumb(paperLabel, category, { showCategory = true } = {}) {
  const parts = [paperLabel];
  if (showCategory && category) parts.push(category);
  return parts.map((p) => `<span>${escapeHtml(p)}</span>`).join('<span class="theme-crumb-sep">›</span>');
}

function defaultThemeManifest(theme, paperKey) {
  return {
    id: theme.id,
    paper: paperKey,
    title: theme.name,
    parent: theme.parent || "",
    images: [],
    sources: [],
    links: [],
  };
}

async function fetchThemeNotesMd(themeId) {
  if (isGitHubConnected()) {
    try {
      const fromApi = await fetchThemeNotesMdFromGitHub(themeId);
      if (fromApi) return fromApi;
    } catch {
      /* CDN fallback */
    }
  }
  try {
    const res = await fetch(assetUrl(`study/themes/${themeId}/notes.md`), { cache: "no-cache" });
    if (res.ok) return await res.text();
  } catch {
    /* none */
  }
  return null;
}

async function loadThemeManifest(themeId, theme, paperKey) {
  let manifest = defaultThemeManifest(theme, paperKey);
  if (isGitHubConnected()) {
    try {
      const fromGit = await fetchThemeManifestFromGitHub(themeId);
      if (fromGit) manifest = { ...manifest, ...fromGit };
    } catch {
      /* use default */
    }
  } else {
    try {
      const res = await fetch(assetUrl(`study/themes/${themeId}/manifest.json`), { cache: "no-cache" });
      if (res.ok) manifest = { ...manifest, ...(await res.json()) };
    } catch {
      /* default */
    }
  }
  return manifest;
}

function mergeThemeNotes(themeId, mdText) {
  const fromGit = normalizeThemeSections(parseThemeNotesMd(mdText || ""));
  const local = getThemeEntry(themeId).notes || {};
  const merged = emptyThemeSections();
  for (const sec of THEME_SECTIONS) {
    merged[sec] = String(local[sec] ?? "").trim() ? local[sec] : fromGit[sec] || "";
  }
  return merged;
}

function renderThemeGallery(themeId, images) {
  if (!images?.length) {
    return `<p class="muted small">No cuttings yet — upload below (GitHub).</p>`;
  }
  return images
    .map((img) => {
      const name = typeof img === "string" ? img : img?.file || "";
      const src = assetUrl(`study/themes/${themeId}/${name}`);
      return `
        <figure class="gallery-item">
          <button type="button" class="github-delete-btn hidden" data-file="${escapeHtml(name)}" data-file-kind="image" title="Delete from git">×</button>
          <img src="${escapeHtml(src)}" alt="" loading="lazy" />
          <figcaption class="small muted">${escapeHtml(name)}</figcaption>
        </figure>`;
    })
    .join("");
}

function renderThemePdfList(themeId, pdfs) {
  if (!pdfs.length) {
    return `<p class="muted small">No PDFs in git — upload below or paste a Drive link in Sources.</p>`;
  }
  return pdfs
    .map((src) => {
      const path = src.file.path;
      const href = assetUrl(`study/themes/${themeId}/${path}`);
      return `
        <div class="pdf-row">
          <a class="pdf-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">📄 ${escapeHtml(src.name || path)}</a>
          <button type="button" class="github-delete-btn btn-ghost btn-sm hidden" data-file="${escapeHtml(path)}" data-file-kind="pdf">Delete</button>
        </div>`;
    })
    .join("");
}

function renderLinkRibbon(links) {
  if (!links?.length) return `<span class="muted small">No quick links yet.</span>`;
  return links
    .filter((l) => l?.url)
    .map(
      (l) =>
        `<a class="link-chip" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label || l.url)}</a>`
    )
    .join("");
}

/**
 * @param {object} ctx
 * @param {string} ctx.paperKey
 * @param {(view: string, themeId?: string) => void} ctx.navigate
 * @param {(s: string) => string} ctx.escapeHtml
 * @param {HTMLElement} ctx.main
 * @param {string|null} ctx.userId
 */
export function renderThemesHub(ctx) {
  if (!themesIndex) {
    ctx.main.innerHTML = `<p class="muted">Loading themes…</p>`;
    return;
  }

  const paperKey = ctx.paperKey || "1";
  const paperMeta = themesIndex?.[paperKey];
  const themeParent = ctx.themeParent || null;

  if (!themeParent) {
    renderThemeCategoriesHub(ctx, paperKey, paperMeta);
  } else {
    renderThemesInCategoryHub(ctx, paperKey, paperMeta, themeParent);
  }
}

function renderThemeCategoriesHub(ctx, paperKey, paperMeta) {
  const categories = getCategoriesForPaper(paperKey, themesIndex);
  const totalThemes = themesForPaper(paperKey).length;

  ctx.main.innerHTML = `
    <div class="themes-hub-panel theme-panel-enter" data-active-paper="${escapeHtml(paperKey)}">
    <section class="themes-hero">
      <h2>Mains themes</h2>
      <p class="muted">Pick a syllabus area, then open themes inside it.</p>
      <button type="button" class="btn-primary btn-sm" id="addCategoryBtn">+ Add area</button>
    </section>
    ${renderPaperTabs(paperKey)}
    <p class="themes-breadcrumb muted small">${renderThemeBreadcrumb(paperMeta?.label || "", null, { showCategory: false })}</p>
    <p class="themes-paper-desc muted small">${categories.length} areas · ${totalThemes} theme${totalThemes === 1 ? "" : "s"}</p>
    <div class="themes-category-grid theme-stagger-grid">
      ${categories
        .map((cat) => {
          const n = countThemesInCategory(paperKey, cat, themesIndex);
          const custom = isCustomCategory(paperKey, cat);
          return `
        <button type="button" class="theme-category-card${custom ? " theme-category-card--custom" : ""}" data-theme-category="${escapeHtml(cat)}">
          <span class="theme-category-name">${escapeHtml(cat)}${custom ? ' <span class="theme-custom-badge">custom</span>' : ""}</span>
          <span class="theme-category-count muted small">${n} theme${n === 1 ? "" : "s"}</span>
        </button>`;
        })
        .join("")}
    </div>
    <dialog class="add-theme-dialog" id="addCategoryDialog">
      <form method="dialog" class="add-theme-form" id="addCategoryForm">
        <h3>Add area — ${escapeHtml(paperMeta?.label || paperKey)}</h3>
        <p class="muted small">Creates a new syllabus bucket (e.g. <strong>World History</strong>). Custom areas stay on this browser until added to <code>data/themes-index.json</code> in git.</p>
        <label class="add-theme-field">
          <span>Area name</span>
          <input type="text" id="addCategoryName" required placeholder="e.g. Post-colonial Africa" />
        </label>
        <p class="add-theme-error hidden" id="addCategoryError"></p>
        <div class="add-theme-actions">
          <button type="button" class="btn-ghost btn-sm" id="addCategoryCancel">Cancel</button>
          <button type="submit" class="btn-primary btn-sm">Add &amp; open</button>
        </div>
      </form>
    </dialog>
    </div>`;

  bindPaperTabClicks(ctx, ctx.main);
  ctx.main.querySelectorAll("[data-theme-category]").forEach((btn) => {
    btn.addEventListener("click", () =>
      ctx.navigate("themes", null, paperKey, btn.dataset.themeCategory)
    );
  });

  bindAddCategoryDialog(ctx, paperKey);
}

function renderThemesInCategoryHub(ctx, paperKey, paperMeta, themeParent) {
  const themes = themesInCategory(paperKey, themeParent, themesIndex);
  const parentOptions = parentGroupsForPaper(paperKey);

  ctx.main.innerHTML = `
    <div class="themes-hub-panel theme-panel-enter" data-active-paper="${escapeHtml(paperKey)}">
    <button type="button" class="btn-ghost back-btn theme-back-enter" id="themeCategoryBackBtn">← All areas</button>
    <section class="themes-hero">
      <h2>${escapeHtml(themeParent)}</h2>
      <p class="muted">${escapeHtml(paperMeta?.label || "")} — pick a theme or add your own.</p>
      <button type="button" class="btn-primary btn-sm" id="addThemeBtn">+ Add theme here</button>
    </section>
    ${renderPaperTabs(paperKey)}
    <p class="themes-breadcrumb muted small">${renderThemeBreadcrumb(paperMeta?.label || "", themeParent)}</p>
    <p class="themes-paper-desc muted small">${themes.length} theme${themes.length === 1 ? "" : "s"} in this area</p>
    ${
      themes.length
        ? `<div class="themes-cards themes-cards--flat theme-stagger-grid">
            ${themes
              .map(
                (t) => `
              <button type="button" class="theme-card" data-open-theme="${escapeHtml(t.id)}">
                <span class="theme-card-name">${escapeHtml(t.name)}${t.custom ? ' <span class="theme-custom-badge">custom</span>' : ""}</span>
              </button>`
              )
              .join("")}
          </div>`
        : `<p class="muted">No themes in this area yet. Click <strong>+ Add theme here</strong>.</p>`
    }
    <dialog class="add-theme-dialog" id="addThemeDialog">
      <form method="dialog" class="add-theme-form" id="addThemeForm">
        <h3>Add theme — ${escapeHtml(themeParent)}</h3>
        <p class="muted small">Saved under <strong>${escapeHtml(paperMeta?.label || paperKey)} › ${escapeHtml(themeParent)}</strong>. Custom themes stay on this browser until added to <code>data/themes-index.json</code> in git.</p>
        <label class="add-theme-field">
          <span>Theme name</span>
          <input type="text" id="addThemeName" required placeholder="e.g. Cold War alliances in news" />
        </label>
        <input type="hidden" id="addThemeParent" value="${escapeHtml(themeParent)}" />
        <label class="add-theme-field">
          <span>Keywords (optional)</span>
          <input type="text" id="addThemeKeywords" placeholder="search tags…" />
        </label>
        <p class="add-theme-error hidden" id="addThemeError"></p>
        <div class="add-theme-actions">
          <button type="button" class="btn-ghost btn-sm" id="addThemeCancel">Cancel</button>
          <button type="submit" class="btn-primary btn-sm">Add &amp; open</button>
        </div>
      </form>
    </dialog>
    </div>`;

  document.getElementById("themeCategoryBackBtn")?.addEventListener("click", () => {
    ctx.navigate("themes", null, paperKey, null);
  });

  bindPaperTabClicks(ctx, ctx.main);
  ctx.main.querySelectorAll("[data-open-theme]").forEach((btn) => {
    btn.addEventListener("click", () => ctx.navigate("theme", btn.dataset.openTheme));
  });

  bindAddThemeDialog(ctx, paperKey, themeParent, parentOptions);
}

function bindAddCategoryDialog(ctx, paperKey) {
  const dialog = document.getElementById("addCategoryDialog");
  const nameInput = document.getElementById("addCategoryName");
  document.getElementById("addCategoryBtn")?.addEventListener("click", () => {
    if (nameInput) nameInput.value = "";
    document.getElementById("addCategoryError")?.classList.add("hidden");
    dialog?.showModal();
    nameInput?.focus();
  });
  document.getElementById("addCategoryCancel")?.addEventListener("click", () => dialog?.close());
  document.getElementById("addCategoryForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const errEl = document.getElementById("addCategoryError");
    try {
      const category = addCustomCategory(paperKey, nameInput?.value, themesIndex);
      dialog?.close();
      ctx.navigate("themes", null, paperKey, category);
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || String(err);
        errEl.classList.remove("hidden");
      }
    }
  });
}

function bindAddThemeDialog(ctx, paperKey, defaultParent, _parentOptions) {
  const dialog = document.getElementById("addThemeDialog");
  document.getElementById("addThemeBtn")?.addEventListener("click", () => dialog?.showModal());
  document.getElementById("addThemeCancel")?.addEventListener("click", () => dialog?.close());
  document.getElementById("addThemeForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const errEl = document.getElementById("addThemeError");
    try {
      const theme = addCustomTheme(
        paperKey,
        {
          name: document.getElementById("addThemeName")?.value,
          parent: document.getElementById("addThemeParent")?.value || defaultParent,
          keywords: document.getElementById("addThemeKeywords")?.value,
        },
        themesIndex
      );
      dialog?.close();
      ctx.navigate("theme", theme.id);
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || String(err);
        errEl.classList.remove("hidden");
      }
    }
  });
}

/**
 * @param {object} ctx — same as renderThemesHub + themeId
 */
export async function renderThemeDetail(ctx) {
  const themeId = ctx.themeId;
  const theme = themeById(themeId);
  if (!theme) {
    ctx.main.innerHTML = `<p class="muted">Theme not found.</p>`;
    return;
  }

  const renderSeq = ++themeDetailRenderSeq;
  const paperKey = theme.paperKey;
  const entry = getThemeEntry(themeId);
  const mdText = await fetchThemeNotesMd(themeId);
  const manifest = await loadThemeManifest(themeId, theme, paperKey);
  if (renderSeq !== themeDetailRenderSeq || ctx.stateView !== "theme" || ctx.stateThemeId !== themeId) return;

  const notes = mergeThemeNotes(themeId, mdText);
  const gitPdfs = (manifest.sources || []).filter((s) => s?.file?.storage === "git" && s?.file?.path);
  const manifestJson = JSON.stringify(manifest).replace(/"/g, "&quot;");
  const userId = ctx.userId;

  ctx.main.innerHTML = `
    <button type="button" class="btn-ghost back-btn" id="themeBackBtn">← ${escapeHtml(theme.parent || "Themes")}</button>
    <article class="item-spread theme-spread">
      <header class="item-header">
        <p class="muted small">${escapeHtml(theme.paperLabel)} · ${escapeHtml(theme.parent || "")}</p>
        <h2>${escapeHtml(theme.name)}</h2>
      </header>

      <section class="materials-block git-zone">
        <h4 class="materials-subhead">Quick links</h4>
        <div class="link-ribbon" id="themeLinkRibbon">${renderLinkRibbon(entry.links)}</div>
        <div id="themeLinksEditor" class="links-editor"></div>
        <button type="button" class="btn-ghost btn-sm" id="themeAddLinkBtn">+ Add link</button>
      </section>

      <section class="materials-block git-zone git-zone--materials">
        <h4 class="materials-subhead">Sources &amp; PDF links</h4>
        <p class="muted small">Reports, magazines. Large PDFs → paste Drive URL here.</p>
        <div id="themeSourcesList" class="sources-list"></div>
        <button type="button" class="btn-ghost btn-sm" id="themeAddSourceBtn">+ Add source</button>
        <button type="button" class="btn-ghost btn-sm" id="themeAddPdfLinkBtn">+ Paste PDF / Drive link</button>
      </section>

      <section class="materials-block materials-uploads git-zone">
        <h4 class="materials-subhead">Cuttings &amp; photos <span class="git-zone-badge git-zone-badge--inline">Git upload</span></h4>
        ${renderGitHubConnectHint()}
        <div class="materials-gallery gallery">${renderThemeGallery(themeId, manifest.images)}</div>
        <div class="upload-row">
          ${renderGitHubUploadButton("theme-image", { "theme-id": themeId, "theme-manifest": manifestJson })}
        </div>
      </section>

      <section class="materials-block materials-uploads git-zone">
        <h4 class="materials-subhead">Small PDF in git <span class="git-zone-badge git-zone-badge--inline">Git upload</span></h4>
        <div class="materials-pdfs">${renderThemePdfList(themeId, gitPdfs)}</div>
        <div class="upload-row">
          ${renderGitHubUploadButton("theme-pdf", { "theme-id": themeId, "theme-manifest": manifestJson })}
        </div>
      </section>

      <section class="notes-panel theme-notes-panel git-zone">
        <div class="git-zone-head">
          <span class="git-zone-badge git-zone-badge--notes">Theme notes → GitHub</span>
          <span class="git-zone-hint muted small">Markdown textareas — syncs to Supabase while typing; commit archives to notes.md</span>
        </div>
        ${THEME_SECTIONS.map(
          (sec) => `
          <div class="note-field theme-note-field">
            <label class="note-label">${escapeHtml(sec)}</label>
            <textarea class="theme-note-input" data-theme-section="${escapeHtml(sec)}" rows="5" placeholder="${escapeHtml(sec)}"></textarea>
          </div>`
        ).join("")}
        <div class="git-zone-actions git-zone-actions--notes">
          <button type="button" class="btn-git-notes btn-sm" id="themeCommitNotesBtn">Commit notes.md → GitHub</button>
          <button type="button" class="btn-ghost btn-sm" id="themeRefreshNotesBtn">Refresh notes from GitHub</button>
        </div>
      </section>
    </article>`;

  const liveNotes = { ...notes };
  ctx.main.querySelectorAll(".theme-note-input").forEach((ta) => {
    const sec = ta.dataset.themeSection;
    ta.value = notes[sec] || "";
    ta.addEventListener("input", () => {
      liveNotes[sec] = ta.value;
      updateThemeNotes(themeId, liveNotes, userId);
    });
  });

  mountThemeLinksEditor(ctx, themeId, userId, [...(entry.links || [])]);
  mountThemeSourcesEditor(ctx, themeId, userId, [...(entry.sources || [])], manifest);

  const reload = () => renderThemeDetail(ctx);

  bindThemeMaterialsUploads(ctx.main, themeId, manifest, reload);

  document.getElementById("themeBackBtn")?.addEventListener("click", () => {
    ctx.navigate("themes", null, paperKey, theme.parent || null);
  });

  document.getElementById("themeCommitNotesBtn")?.addEventListener("click", async () => {
    try {
      await flushThemeSavesNow();
      const { path } = await commitThemeNotesMdToGitHub(themeId, theme.name, liveNotes);
      alert(`Committed ${path} to GitHub.`);
      reload();
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById("themeRefreshNotesBtn")?.addEventListener("click", async () => {
    try {
      const fresh = await fetchThemeNotesMd(themeId);
      if (!fresh) throw new Error("No notes.md on GitHub yet — commit first.");
      const parsed = normalizeThemeSections(parseThemeNotesMd(fresh));
      updateThemeNotes(themeId, parsed, userId);
      reload();
      alert("Loaded notes from GitHub.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });
}

function mountThemeLinksEditor(ctx, themeId, userId, links) {
  const root = document.getElementById("themeLinksEditor");
  if (!root) return;

  const render = () => {
    root.innerHTML = links
      .map(
        (link, idx) => `
      <div class="editor-row" data-idx="${idx}">
        <input type="text" class="link-label" placeholder="Label" value="${ctx.escapeHtml(link.label || "")}" />
        <input type="url" class="link-url" placeholder="https://..." value="${ctx.escapeHtml(link.url || "")}" />
        <select class="link-kind">${LINK_KINDS.map((k) => `<option value="${k}" ${link.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select>
        <button type="button" class="btn-ghost btn-sm link-remove">×</button>
      </div>`
      )
      .join("");

    root.querySelectorAll(".editor-row").forEach((row) => {
      const idx = Number(row.dataset.idx);
      const sync = () => {
        links[idx] = {
          label: row.querySelector(".link-label")?.value || "",
          url: row.querySelector(".link-url")?.value || "",
          kind: row.querySelector(".link-kind")?.value || "other",
          addedAt: links[idx]?.addedAt || new Date().toISOString().slice(0, 10),
        };
        updateThemeLinks(themeId, links, userId);
        const ribbon = document.getElementById("themeLinkRibbon");
        if (ribbon) ribbon.innerHTML = renderLinkRibbon(links);
      };
      row.querySelectorAll("input, select").forEach((inp) => inp.addEventListener("input", sync));
      row.querySelector(".link-remove")?.addEventListener("click", () => {
        links.splice(idx, 1);
        updateThemeLinks(themeId, links, userId);
        render();
        const ribbon = document.getElementById("themeLinkRibbon");
        if (ribbon) ribbon.innerHTML = renderLinkRibbon(links);
      });
    });
  };

  render();
  document.getElementById("themeAddLinkBtn")?.addEventListener("click", () => {
    links.push({ label: "", url: "", kind: "news", addedAt: new Date().toISOString().slice(0, 10) });
    updateThemeLinks(themeId, links, userId);
    render();
  });
}

function mountThemeSourcesEditor(ctx, themeId, userId, sources, manifest) {
  const root = document.getElementById("themeSourcesList");
  if (!root) return;
  const today = new Date().toISOString().slice(0, 10);

  const render = () => {
    root.innerHTML = sources
      .map(
        (src, idx) => `
      <div class="source-row editor-row" data-idx="${idx}">
        <select class="src-type">
          ${["newspaper", "magazine", "pib", "govt-site", "article", "report", "video", "other"]
            .map((t) => `<option ${src.type === t ? "selected" : ""}>${t}</option>`)
            .join("")}
        </select>
        <input class="src-name" placeholder="Name" value="${ctx.escapeHtml(src.name || "")}" />
        <input class="src-date" type="date" value="${ctx.escapeHtml(src.date && /^\d{4}-\d{2}-\d{2}$/.test(src.date) ? src.date : today)}" />
        <input class="src-url" type="url" placeholder="URL or Drive" value="${ctx.escapeHtml(src.url || "")}" />
        <button type="button" class="btn-ghost btn-sm src-remove">×</button>
      </div>`
      )
      .join("");

    root.querySelectorAll(".source-row").forEach((row) => {
      const idx = Number(row.dataset.idx);
      const sync = () => {
        sources[idx] = {
          type: row.querySelector(".src-type")?.value || "other",
          name: row.querySelector(".src-name")?.value || "",
          date: row.querySelector(".src-date")?.value || today,
          url: row.querySelector(".src-url")?.value || "",
          file: sources[idx]?.file,
        };
        updateThemeSources(themeId, sources, userId);
      };
      row.querySelectorAll("input, select").forEach((inp) => inp.addEventListener("input", sync));
      row.querySelector(".src-remove")?.addEventListener("click", () => {
        sources.splice(idx, 1);
        updateThemeSources(themeId, sources, userId);
        render();
      });
    });
  };

  render();
  document.getElementById("themeAddSourceBtn")?.addEventListener("click", () => {
    sources.push({ type: "newspaper", name: "", date: today, url: "" });
    updateThemeSources(themeId, sources, userId);
    render();
  });
  document.getElementById("themeAddPdfLinkBtn")?.addEventListener("click", () => {
    sources.push({ type: "magazine", name: "PDF / Drive", date: today, url: "" });
    updateThemeSources(themeId, sources, userId);
    render();
  });
}
