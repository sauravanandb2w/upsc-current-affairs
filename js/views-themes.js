/**
 * Mains Themes — GS I–IV + Essay, structured notes + git materials.
 */

import { assetUrl } from "./paths.js";
import { withLoading } from "./loading.js";
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
  isThemeFieldLocked,
  lockThemeField,
  unlockThemeField,
  pickThemeNoteValue,
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
  addCustomSubcategory,
  getCategoriesForPaper,
  getSubcategoriesForCategory,
  getThemesForSubcategory,
  getThemesForCategory,
  countThemesInCategory,
  countThemesInSubcategory,
  isCustomCategory,
  isCustomSubcategory,
  themeFieldIdForSection,
} from "./theme-catalog.js";
import {
  renderRichNoteEditorHtml,
  bindRichNoteEditor,
  readNoteFieldValue,
  writeNoteFieldValue,
  applyNoteEditorHeightsIn,
  setRichNoteLocked,
} from "./rich-notes.js";

const PAPER_TABS = [
  { key: "1", label: "GS Paper I", short: "GS I" },
  { key: "2", label: "GS Paper II", short: "GS II" },
  { key: "3", label: "GS Paper III", short: "GS III" },
  { key: "4", label: "GS Paper IV", short: "GS IV" },
  { key: "essay", label: "Essay", short: "Essay" },
];

function bindOpenThemeClicks(ctx, root = document) {
  root.querySelectorAll("[data-open-theme]").forEach((btn) => {
    btn.addEventListener("click", () => ctx.navigate("theme", btn.dataset.openTheme));
  });
}

/** Scrollable list of user themes — shown on paper & category hubs. */
function renderYourThemesPanel(themes, { title = "Your themes", compact = false, hidePath = false } = {}) {
  if (!themes.length) return "";
  return `
    <section class="your-themes-panel${compact ? " your-themes-panel--compact" : ""}" aria-label="${escapeHtml(title)}">
      <div class="your-themes-head">
        <h3 class="your-themes-title">${escapeHtml(title)} <span class="your-themes-count">${themes.length}</span></h3>
        <span class="muted small your-themes-hint">Scroll · tap to open</span>
      </div>
      <div class="your-themes-scroll" role="list">
        ${themes
          .map(
            (t) => `
          <button type="button" class="your-theme-row" data-open-theme="${escapeHtml(t.id)}" role="listitem">
            <span class="your-theme-name">${escapeHtml(t.name)}</span>
            ${hidePath ? "" : `<span class="your-theme-path muted small">${escapeHtml(t.category)} › ${escapeHtml(t.subcategoryName || t.subcategory)}</span>`}
          </button>`
          )
          .join("")}
      </div>
    </section>`;
}

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
    btn.addEventListener("click", () => navThemes(ctx, btn.dataset.themePaper, null, null));
  });
}

let themesIndex = null;
let themeDetailRenderSeq = 0;

const LOCK_ICON_OPEN = `<svg class="note-lock-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M15 11V5a4 4 0 0 1 3 0"/></svg>`;
const LOCK_ICON_CLOSED = `<svg class="note-lock-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

function navThemes(ctx, paperKey, category = null, subcategory = null) {
  ctx.navigate("themes", null, paperKey, { category, subcategory });
}

export function flushThemeNoteEditorsFromDom(themeId, userId = null) {
  if (!themeId) return;
  const entry = getThemeEntry(themeId);
  const notes = { ...entry.notes };
  document.querySelectorAll(".theme-notes-panel .note-field[data-theme-section]").forEach((fieldEl) => {
    const sec = fieldEl.dataset.themeSection;
    if (sec) notes[sec] = readNoteFieldValue(fieldEl);
  });
  updateThemeNotes(themeId, notes, userId);
}

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
      mainEl.innerHTML = `<p class="error">Could not load theme catalog — ${escapeHtml(err.message || String(err))}. Hard refresh (Cmd+Shift+R) to load v57+.</p>`;
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

function renderThemeBreadcrumb(paperLabel, category, subcategoryName) {
  const parts = [paperLabel];
  if (category) parts.push(category);
  if (subcategoryName) parts.push(subcategoryName);
  return parts.map((p) => `<span>${escapeHtml(p)}</span>`).join('<span class="theme-crumb-sep">›</span>');
}

function renderThemeNoteLabelRow(label, themeId, fieldId) {
  const locked = isThemeFieldLocked(themeId, fieldId);
  const lockBtn = `<span class="note-lock-wrap" title="Lock = keep editing locally; locked text won't go to GitHub until you unlock">
        <button type="button" class="note-lock-btn${locked ? " note-lock-btn--locked" : ""}" data-theme-lock-field="${escapeHtml(fieldId)}" aria-pressed="${locked ? "true" : "false"}">${locked ? LOCK_ICON_CLOSED : LOCK_ICON_OPEN}</button>
      </span>`;
  return `<div class="note-label-row"><span class="note-label">${escapeHtml(label)}</span>${lockBtn}</div>`;
}

function bindThemeNoteLocks(root, themeId) {
  root.querySelectorAll("[data-theme-lock-field]").forEach((btn) => {
    const fieldId = btn.dataset.themeLockField;
    const field = btn.closest(".note-field");
    const editor = field?.querySelector(".rich-note-editor");
    setRichNoteLocked(editor, isThemeFieldLocked(themeId, fieldId));
    btn.addEventListener("click", () => {
      const locked = isThemeFieldLocked(themeId, fieldId);
      if (locked) {
        unlockThemeField(themeId, fieldId);
      } else {
        lockThemeField(themeId, fieldId, readNoteFieldValue(field));
      }
      setRichNoteLocked(editor, isThemeFieldLocked(themeId, fieldId));
      btn.innerHTML = isThemeFieldLocked(themeId, fieldId) ? LOCK_ICON_CLOSED : LOCK_ICON_OPEN;
      btn.classList.toggle("note-lock-btn--locked", isThemeFieldLocked(themeId, fieldId));
    });
  });
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
  const category = ctx.themeCategory || null;
  const subcategory = ctx.themeSubcategory || null;

  if (!category) {
    renderThemeCategoriesHub(ctx, paperKey, paperMeta);
  } else if (!subcategory) {
    renderThemeSubcategoriesHub(ctx, paperKey, paperMeta, category);
  } else {
    renderThemesInSubcategoryHub(ctx, paperKey, paperMeta, category, subcategory);
  }
}

function renderThemeCategoriesHub(ctx, paperKey, paperMeta) {
  const categories = getCategoriesForPaper(paperKey, themesIndex);
  const totalThemes = themesForPaper(paperKey).length;

  ctx.main.innerHTML = `
    <div class="themes-hub-panel theme-panel-enter" data-active-paper="${escapeHtml(paperKey)}">
    <section class="themes-hero">
      <h2>Mains themes</h2>
      <p class="muted">Pick a category, then a subcategory — you add your own themes inside.</p>
      <button type="button" class="btn-primary btn-sm" id="addCategoryBtn">+ Add category</button>
    </section>
    ${renderPaperTabs(paperKey)}
    <p class="themes-breadcrumb muted small">${renderThemeBreadcrumb(paperMeta?.label || "", null, null)}</p>
    <p class="themes-paper-desc muted small">${categories.length} categories · ${totalThemes} your theme${totalThemes === 1 ? "" : "s"}</p>
    ${renderYourThemesPanel(themesForPaper(paperKey), { title: "Your themes in this paper" })}
    <h3 class="themes-section-label">Browse syllabus</h3>
    <div class="themes-category-grid theme-stagger-grid">
      ${categories
        .map((cat) => {
          const subs = getSubcategoriesForCategory(paperKey, cat, themesIndex).length;
          const n = countThemesInCategory(paperKey, cat, themesIndex);
          const custom = isCustomCategory(paperKey, cat);
          return `
        <button type="button" class="theme-category-card${custom ? " theme-category-card--custom" : ""}" data-theme-category="${escapeHtml(cat)}">
          <span class="theme-category-name">${escapeHtml(cat)}${custom ? ' <span class="theme-custom-badge">custom</span>' : ""}</span>
          <span class="theme-category-count muted small">${subs} sub · ${n} theme${n === 1 ? "" : "s"}</span>
        </button>`;
        })
        .join("")}
    </div>
    ${renderAddCategoryDialog(paperMeta, paperKey)}
    </div>`;

  bindPaperTabClicks(ctx, ctx.main);
  bindOpenThemeClicks(ctx, ctx.main);
  ctx.main.querySelectorAll("[data-theme-category]").forEach((btn) => {
    btn.addEventListener("click", () => navThemes(ctx, paperKey, btn.dataset.themeCategory, null));
  });
  bindAddCategoryDialog(ctx, paperKey);
}

function renderThemeSubcategoriesHub(ctx, paperKey, paperMeta, category) {
  const subcategories = getSubcategoriesForCategory(paperKey, category, themesIndex);
  const categoryThemes = getThemesForCategory(paperKey, category, themesIndex);

  ctx.main.innerHTML = `
    <div class="themes-hub-panel theme-panel-enter" data-active-paper="${escapeHtml(paperKey)}">
    <button type="button" class="btn-ghost back-btn theme-back-enter" id="themeCategoryBackBtn">← All categories</button>
    <section class="themes-hero">
      <h2>${escapeHtml(category)}</h2>
      <p class="muted">${escapeHtml(paperMeta?.label || "")} — pick a subcategory, then add themes.</p>
      <button type="button" class="btn-primary btn-sm" id="addSubcategoryBtn">+ Add subcategory</button>
    </section>
    ${renderPaperTabs(paperKey)}
    <p class="themes-breadcrumb muted small">${renderThemeBreadcrumb(paperMeta?.label || "", category, null)}</p>
    <p class="themes-paper-desc muted small">${subcategories.length} subcategories · ${categoryThemes.length} theme${categoryThemes.length === 1 ? "" : "s"} here</p>
    ${renderYourThemesPanel(categoryThemes, { title: "Your themes in this category", compact: true })}
    <h3 class="themes-section-label">Subcategories</h3>
    <div class="themes-category-grid theme-stagger-grid">
      ${subcategories
        .map((sub) => {
          const n = countThemesInSubcategory(paperKey, category, sub.id, themesIndex);
          const custom = sub.custom || isCustomSubcategory(paperKey, category, sub.id);
          return `
        <button type="button" class="theme-category-card theme-category-card--sub${custom ? " theme-category-card--custom" : ""}" data-theme-subcategory="${escapeHtml(sub.id)}">
          <span class="theme-category-name">${escapeHtml(sub.name)}${custom ? ' <span class="theme-custom-badge">custom</span>' : ""}</span>
          <span class="theme-category-count muted small">${n} theme${n === 1 ? "" : "s"}</span>
        </button>`;
        })
        .join("")}
    </div>
    <dialog class="add-theme-dialog" id="addSubcategoryDialog">
      <form method="dialog" class="add-theme-form" id="addSubcategoryForm">
        <h3>Add subcategory — ${escapeHtml(category)}</h3>
        <p class="muted small">e.g. <strong>Ancient &amp; Medieval India</strong> under Indian History.</p>
        <label class="add-theme-field">
          <span>Subcategory name</span>
          <input type="text" id="addSubcategoryName" required placeholder="e.g. Gupta period" />
        </label>
        <p class="add-theme-error hidden" id="addSubcategoryError"></p>
        <div class="add-theme-actions">
          <button type="button" class="btn-ghost btn-sm" id="addSubcategoryCancel">Cancel</button>
          <button type="submit" class="btn-primary btn-sm">Add &amp; open</button>
        </div>
      </form>
    </dialog>
    </div>`;

  document.getElementById("themeCategoryBackBtn")?.addEventListener("click", () => navThemes(ctx, paperKey, null, null));
  bindPaperTabClicks(ctx, ctx.main);
  bindOpenThemeClicks(ctx, ctx.main);
  ctx.main.querySelectorAll("[data-theme-subcategory]").forEach((btn) => {
    btn.addEventListener("click", () => navThemes(ctx, paperKey, category, btn.dataset.themeSubcategory));
  });
  bindAddSubcategoryDialog(ctx, paperKey, category);
}

function renderThemesInSubcategoryHub(ctx, paperKey, paperMeta, category, subcategoryId) {
  const sub = getSubcategoriesForCategory(paperKey, category, themesIndex).find((s) => s.id === subcategoryId);
  const subName = sub?.name || subcategoryId;
  const themes = getThemesForSubcategory(paperKey, category, subcategoryId, themesIndex);

  ctx.main.innerHTML = `
    <div class="themes-hub-panel theme-panel-enter" data-active-paper="${escapeHtml(paperKey)}">
    <button type="button" class="btn-ghost back-btn theme-back-enter" id="themeSubcategoryBackBtn">← ${escapeHtml(category)}</button>
    <section class="themes-hero">
      <h2>${escapeHtml(subName)}</h2>
      <p class="muted">Your themes in this subcategory — add notes, cuttings, and PDFs.</p>
      <button type="button" class="btn-primary btn-sm" id="addThemeBtn">+ Add theme</button>
    </section>
    ${renderPaperTabs(paperKey)}
    <p class="themes-breadcrumb muted small">${renderThemeBreadcrumb(paperMeta?.label || "", category, subName)}</p>
    <p class="themes-paper-desc muted small">${themes.length} theme${themes.length === 1 ? "" : "s"}</p>
    ${
      themes.length
        ? renderYourThemesPanel(themes, { title: "Themes here", compact: true, hidePath: true })
        : `<p class="muted">No themes yet. Click <strong>+ Add theme</strong> to create one.</p>`
    }
    <dialog class="add-theme-dialog" id="addThemeDialog">
      <form method="dialog" class="add-theme-form" id="addThemeForm">
        <h3>Add theme — ${escapeHtml(subName)}</h3>
        <p class="muted small">${escapeHtml(paperMeta?.label || paperKey)} › ${escapeHtml(category)} › ${escapeHtml(subName)}</p>
        <label class="add-theme-field">
          <span>Theme name</span>
          <input type="text" id="addThemeName" required placeholder="e.g. Harappan trade routes" />
        </label>
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

  document.getElementById("themeSubcategoryBackBtn")?.addEventListener("click", () => navThemes(ctx, paperKey, category, null));
  bindPaperTabClicks(ctx, ctx.main);
  bindOpenThemeClicks(ctx, ctx.main);
  bindAddThemeDialog(ctx, paperKey, category, subcategoryId);
}

function renderAddCategoryDialog(paperMeta, paperKey) {
  return `
    <dialog class="add-theme-dialog" id="addCategoryDialog">
      <form method="dialog" class="add-theme-form" id="addCategoryForm">
        <h3>Add category — ${escapeHtml(paperMeta?.label || paperKey)}</h3>
        <p class="muted small">Top-level syllabus bucket (e.g. <strong>Indian History</strong>).</p>
        <label class="add-theme-field">
          <span>Category name</span>
          <input type="text" id="addCategoryName" required placeholder="e.g. Indian History" />
        </label>
        <p class="add-theme-error hidden" id="addCategoryError"></p>
        <div class="add-theme-actions">
          <button type="button" class="btn-ghost btn-sm" id="addCategoryCancel">Cancel</button>
          <button type="submit" class="btn-primary btn-sm">Add &amp; open</button>
        </div>
      </form>
    </dialog>`;
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
      navThemes(ctx, paperKey, category, null);
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || String(err);
        errEl.classList.remove("hidden");
      }
    }
  });
}

function bindAddSubcategoryDialog(ctx, paperKey, category) {
  const dialog = document.getElementById("addSubcategoryDialog");
  const nameInput = document.getElementById("addSubcategoryName");
  document.getElementById("addSubcategoryBtn")?.addEventListener("click", () => {
    if (nameInput) nameInput.value = "";
    document.getElementById("addSubcategoryError")?.classList.add("hidden");
    dialog?.showModal();
    nameInput?.focus();
  });
  document.getElementById("addSubcategoryCancel")?.addEventListener("click", () => dialog?.close());
  document.getElementById("addSubcategoryForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const errEl = document.getElementById("addSubcategoryError");
    try {
      const sub = addCustomSubcategory(paperKey, category, nameInput?.value, themesIndex);
      dialog?.close();
      navThemes(ctx, paperKey, category, sub.id);
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || String(err);
        errEl.classList.remove("hidden");
      }
    }
  });
}

function bindAddThemeDialog(ctx, paperKey, category, subcategoryId) {
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
          category,
          subcategory: subcategoryId,
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
  const fromGit = normalizeThemeSections(parseThemeNotesMd(mdText || ""));

  ctx.main.innerHTML = `
    <button type="button" class="btn-ghost back-btn theme-back-enter" id="themeBackBtn">← ${escapeHtml(theme.subcategoryName || "Themes")}</button>
    <article class="item-spread theme-spread">
      <header class="item-header theme-detail-header">
        <p class="muted small">${escapeHtml(theme.paperLabel)} · ${escapeHtml(theme.category || "")} · ${escapeHtml(theme.subcategoryName || "")}</p>
        <h2>${escapeHtml(theme.name)}</h2>
      </header>

      <section class="materials-panel git-zone git-zone--materials theme-materials-panel">
        <h3 class="section-label git-zone-section-label">Materials — links, cuttings, PDFs</h3>
        ${renderGitHubConnectHint()}

        <div class="materials-block">
          <h4 class="materials-subhead">Quick links</h4>
          <div class="link-ribbon" id="themeLinkRibbon">${renderLinkRibbon(entry.links)}</div>
          <div id="themeLinksEditor" class="links-editor"></div>
          <button type="button" class="btn-ghost btn-sm" id="themeAddLinkBtn">+ Add link</button>
        </div>

        <div class="materials-block git-zone git-zone--materials">
          <h4 class="materials-subhead">Sources &amp; PDF links</h4>
          <p class="muted small">Reports, magazines. Large PDFs → paste Drive URL here.</p>
          <div id="themeSourcesList" class="sources-list"></div>
          <button type="button" class="btn-ghost btn-sm" id="themeAddSourceBtn">+ Add source</button>
          <button type="button" class="btn-ghost btn-sm" id="themeAddPdfLinkBtn">+ Paste PDF / Drive link</button>
        </div>

        <div class="materials-block materials-uploads git-zone">
          <h4 class="materials-subhead">Cuttings &amp; photos <span class="git-zone-badge git-zone-badge--inline">Git upload</span></h4>
          <div class="materials-gallery gallery">${renderThemeGallery(themeId, manifest.images)}</div>
          <div class="upload-row">
            ${renderGitHubUploadButton("theme-image", { "theme-id": themeId, "theme-manifest": manifestJson })}
          </div>
        </div>

        <div class="materials-block materials-uploads git-zone">
          <h4 class="materials-subhead">Small PDF in git <span class="git-zone-badge git-zone-badge--inline">Git upload</span></h4>
          <div class="materials-pdfs">${renderThemePdfList(themeId, gitPdfs)}</div>
          <div class="upload-row">
            ${renderGitHubUploadButton("theme-pdf", { "theme-id": themeId, "theme-manifest": manifestJson })}
          </div>
        </div>
      </section>

      <section class="notes-panel theme-notes-panel item-notes-panel git-zone git-zone--notes">
        <div class="git-zone-head">
          <span class="git-zone-badge git-zone-badge--notes">Theme notes → GitHub</span>
          <span class="git-zone-hint muted small">Summary, static linkages, exam corner… → notes.md</span>
        </div>
        <p class="note-locks-help muted small">Toolbar: <strong>bold</strong>, lists, tables. <strong>Padlock</strong> = locked fields skip GitHub commit. Box height: <strong>S/M/L</strong> in header.</p>
        ${THEME_SECTIONS.map((sec) => {
          const fid = themeFieldIdForSection(sec);
          const locked = isThemeFieldLocked(themeId, fid);
          return `
          <div class="note-field git-notes-field theme-note-field${locked ? " note-field--locked" : ""}" data-theme-section="${escapeHtml(sec)}">
            ${renderThemeNoteLabelRow(sec, themeId, fid)}
            ${renderRichNoteEditorHtml({ "data-theme-field-id": fid, "data-theme-section": sec }, { placeholder: sec, rows: 5 })}
          </div>`;
        }).join("")}
        <div class="git-zone-actions git-zone-actions--notes">
          <button type="button" class="btn-git-notes btn-sm" id="themeCommitNotesBtn">Commit notes.md → GitHub</button>
          <button type="button" class="btn-ghost btn-sm" id="themeRefreshNotesBtn">Refresh notes from GitHub</button>
        </div>
      </section>
    </article>`;

  const liveNotes = { ...notes };
  ctx.main.querySelectorAll(".theme-note-field[data-theme-section]").forEach((fieldEl) => {
    const sec = fieldEl.dataset.themeSection;
    const fid = themeFieldIdForSection(sec);
    const gitVal = fromGit[sec] || "";
    const val = notes[sec] || gitVal || "";
    writeNoteFieldValue(fieldEl, val);
    bindRichNoteEditor(fieldEl.querySelector(".rich-note-editor"), {
      onInput: () => {
        liveNotes[sec] = readNoteFieldValue(fieldEl);
        updateThemeNotes(themeId, liveNotes, userId);
      },
    });
    if (isThemeFieldLocked(themeId, fid)) {
      setRichNoteLocked(fieldEl.querySelector(".rich-note-editor"), true);
    }
  });
  bindThemeNoteLocks(ctx.main, themeId);
  applyNoteEditorHeightsIn(ctx.main);

  mountThemeLinksEditor(ctx, themeId, userId, [...(entry.links || [])]);
  mountThemeSourcesEditor(ctx, themeId, userId, [...(entry.sources || [])], manifest);

  const reload = () => renderThemeDetail(ctx);

  bindThemeMaterialsUploads(ctx.main, themeId, manifest, reload);

  document.getElementById("themeBackBtn")?.addEventListener("click", () => {
    navThemes(ctx, paperKey, theme.category, theme.subcategory);
  });

  document.getElementById("themeCommitNotesBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("themeCommitNotesBtn");
    try {
      let path = "";
      await withLoading("Committing theme notes…", async () => {}, {
        button: btn,
        steps: [
          {
            label: "Preparing notes…",
            run: async () => {
              flushThemeNoteEditorsFromDom(themeId, userId);
              await flushThemeSavesNow();
            },
          },
          {
            label: "Uploading to GitHub…",
            run: async () => {
              const commitSections = { ...emptyThemeSections() };
              for (const sec of THEME_SECTIONS) {
                const fid = themeFieldIdForSection(sec);
                const fieldEl = ctx.main.querySelector(`[data-theme-section="${sec}"]`);
                const live = fieldEl ? readNoteFieldValue(fieldEl) : liveNotes[sec];
                commitSections[sec] = pickThemeNoteValue(themeId, fid, live, fromGit[sec] || "");
              }
              ({ path } = await commitThemeNotesMdToGitHub(themeId, theme.name, commitSections));
            },
          },
        ],
      });
      alert(`Committed ${path} to GitHub.`);
      reload();
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById("themeRefreshNotesBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("themeRefreshNotesBtn");
    try {
      await withLoading("Loading theme notes…", async () => {
        const fresh = await fetchThemeNotesMd(themeId);
        if (!fresh) throw new Error("No notes.md on GitHub yet — commit first.");
        const parsed = normalizeThemeSections(parseThemeNotesMd(fresh));
        updateThemeNotes(themeId, parsed, userId);
      }, { button: btn });
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
