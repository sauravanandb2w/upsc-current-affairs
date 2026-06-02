import { assetUrl, repoBase } from "./paths.js";
import {
  parseNotesMd,
  GIT_SECTIONS,
  emptyGitSections,
  defaultNotesTemplate,
  mergeGitSectionsWithLocal,
  SUMMARY_SECTION,
} from "./notes-md.js";
import {
  hydrateCloudFromLocal,
  loadAllCloudNotes,
  mergeCloudWithManifest,
  getCloudEntry,
  updateCloudField,
  getGitNotesFromLocal,
  saveGitNotesToLocal,
  getItemMeta,
  toggleStar,
  markRevised,
  isFieldLocked,
  lockNoteField,
  unlockNoteField,
  pickNoteValue,
} from "./ca-store.js";
import {
  initSupabase,
  isSupabaseConfigured,
  onAuthStateChange,
  getSession,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signOut,
} from "./supabase-client.js";
import {
  loadLocalMeta,
  mergeWithDrafts,
  addDraftItem,
  isDraftItem,
  setStatusOverride,
  removeDraft,
  clearStatusOverride,
  updateDraftItem,
  draftCliCommand,
  downloadTextFile,
} from "./local-meta.js";
import { initGitHubUploadConfig, isGitHubConnected } from "./github-auth.js";
import {
  renderGitHubConnectHint,
  renderGitHubUploadButton,
  bindGitHubHeaderButton,
  bindAllMaterialsUploads,
} from "./github-upload-ui.js";
import { fieldIdForSection } from "./field-locks.js";
import {
  renderRichNoteEditorHtml,
  bindRichNoteEditor,
  writeNoteFieldValue,
  readNoteFieldValue,
  setRichNoteLocked,
  noteHtmlToPlainText,
  plainTextToNoteHtml,
} from "./rich-notes.js";
import { initTheme, bindThemeToggle, bindNoteSizeControl } from "./theme.js";
import { bindExportButtons } from "./export-ca.js";
import { loadFlashcards, loadFlashcardsLocal, generateFlashcardsFromItem } from "./flashcards.js";
import { commitNotesMdToGitHub, fetchNotesMdFromGitHub } from "./github-notes.js";
import { publishDraftToGitHub, savePublishedItemToGitHub } from "./github-publish.js";
import {
  loadSearchIndex,
  setSearchIndexEntry,
  matchesSearch as matchItemSearch,
  bindSearchAutocomplete,
} from "./search.js";
import {
  renderToday,
  renderCalendar,
  renderThreadDiff,
  renderDrill,
  renderMonthly,
  todayIso,
  isoDaysAgo,
  startOfMonthIso,
} from "./views.js";
import { mountDatePicker, mountDateField, formatDisplayDate } from "./date-picker.js";
import { renderActivityDashboard } from "./activity-dashboard.js";
import {
  recordCaNoteActivity,
  recordCaAddActivity,
  recordCaViewActivity,
  recordCaStatusActivity,
  recordCaStarActivity,
} from "./activity-tracker.js";
import {
  collectAllTags,
  collectAllThreads,
  renderTagSelectOptions,
  renderThreadSelectOptions,
} from "./filter-options.js";

const LINK_KINDS = [
  "news",
  "pib",
  "govt-site",
  "magazine",
  "article",
  "video",
  "report",
  "other",
];

const STATUS_OPTIONS = [
  { value: "to-study", label: "To study" },
  { value: "studied", label: "Studied" },
  { value: "revise", label: "Revise" },
];

const state = {
  items: [],
  session: null,
  view: "today",
  itemId: null,
  topicYear: new Date().getFullYear(),
  topicTag: "",
  topicThread: "",
  searchQuery: "",
  reviseFrom: isoDaysAgo(7),
  reviseTo: todayIso(),
  reviseTag: "",
  calendarMonth: todayIso().slice(0, 7),
  threadDiff: "2025-rbi-monetary-policy",
  monthlyMonth: todayIso().slice(0, 7),
  pendingDraftId: null,
  drillIndex: 0,
};

const el = {
  syncBadge: document.getElementById("syncBadge"),
  main: document.getElementById("main"),
  nav: document.getElementById("mainNav"),
  globalSearch: document.getElementById("globalSearch"),
  searchSuggestions: document.getElementById("searchSuggestions"),
  searchCombobox: document.getElementById("searchCombobox"),
  addItemBtn: document.getElementById("addItemBtn"),
  addItemDialog: document.getElementById("addItemDialog"),
  addItemForm: document.getElementById("addItemForm"),
  addItemError: document.getElementById("addItemError"),
  addItemCancel: document.getElementById("addItemCancel"),
  draftExportDialog: document.getElementById("draftExportDialog"),
  authDialog: document.getElementById("authDialog"),
  authForm: document.getElementById("authForm"),
  authEmail: document.getElementById("authEmail"),
  authPassword: document.getElementById("authPassword"),
  authError: document.getElementById("authError"),
  authSubmitBtn: document.getElementById("authSubmitBtn"),
  authGoogleBtn: document.getElementById("authGoogleBtn"),
  authConfigNote: document.getElementById("authConfigNote"),
  authArea: document.getElementById("authArea"),
  githubConnectBtn: document.getElementById("githubConnectBtn"),
  themeToggle: document.getElementById("themeToggle"),
  noteSizeControl: document.getElementById("noteSizeControl"),
  exportJsonBtn: document.getElementById("exportJsonBtn"),
  exportMdBtn: document.getElementById("exportMdBtn"),
};

const LOCK_ICON_OPEN = `<svg class="note-lock-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M15 11V5a4 4 0 0 1 3 0"/></svg>`;
const LOCK_ICON_CLOSED = `<svg class="note-lock-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

const searchDeps = {
  getCloudEntry,
  getGitNotesFromLocal,
};

function matchesSearch(item, query) {
  return matchItemSearch(item, query, searchDeps);
}

function viewCtx() {
  return {
    state,
    el,
    escapeHtml,
    mergedItems,
    matchesSearch,
    deskStats,
    renderItemCard,
    openAddDialog,
    getGitSections,
    bindReviseTodayClicks,
  };
}

function bindReviseTodayClicks() {
  document.querySelectorAll(".revise-today-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.reviseType === "card") navigate("drill");
      else navigate("item", btn.dataset.id || btn.dataset.itemId);
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function gsBadges(papers) {
  return (papers || [])
    .map((p) => `<span class="badge badge-gs">GS${escapeHtml(p)}</span>`)
    .join("");
}

function tagBadges(tags) {
  return (tags || [])
    .map((t) => `<span class="badge badge-tag">${escapeHtml(t)}</span>`)
    .join("");
}

function statusClass(status) {
  if (status === "studied") return "status-studied";
  if (status === "revise") return "status-revise";
  return "status-todo";
}

function statusLabel(status) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.label || status;
}

function mergedItems() {
  return mergeWithDrafts(state.items).map((item) => mergeCloudWithManifest(item));
}

function itemById(id) {
  return mergedItems().find((i) => i.id === id);
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function filterByDateRange(items, from, to) {
  return items.filter((item) => {
    const d = item.date || "";
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function filterByTopic(items) {
  const year = state.topicYear;
  const tag = (state.topicTag || "").trim().toLowerCase();
  const thread = (state.topicThread || "").trim();
  return items.filter((item) => {
    const d = item.date || "";
    if (year && !d.startsWith(String(year))) return false;
    if (tag && !(item.tags || []).some((t) => t.toLowerCase() === tag)) return false;
    if (thread && !(item.threads || []).includes(thread)) return false;
    return true;
  });
}

function deskStats(items) {
  const weekAgo = isoDaysAgo(7);
  return {
    total: items.length,
    thisWeek: items.filter((i) => (i.date || "") >= weekAgo).length,
    todo: items.filter((i) => i.status === "to-study").length,
    revise: items.filter((i) => i.status === "revise").length,
  };
}

function renderLinkRibbon(links) {
  if (!links?.length) {
    return `<p class="muted small">No links yet.</p>`;
  }
  return links
    .map((link) => {
      const kind = link.kind || "other";
      const url = link.url || "#";
      const label = link.label || url;
      return `<a class="link-chip link-${escapeHtml(kind)}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
    })
    .join("");
}

function renderItemCard(item, { showSummary = true, compact = false } = {}) {
  const cloud = getCloudEntry(item.id);
  const summary = cloud.summary || item.summary || "";
  const preview =
    showSummary && summary && !compact
      ? escapeHtml(summary.slice(0, 140)) + (summary.length > 140 ? "…" : "")
      : "";
  const linkCount = (mergeCloudWithManifest(item).links || []).length;
  const draftBadge = isDraftItem(item)
    ? `<span class="badge badge-draft" title="Saved on this device — push to git from laptop">Draft</span>`
    : "";
  const starred = getItemMeta(item.id).starred;
  return `
    <article class="ca-card ${statusClass(item.status)}" data-open-item="${escapeHtml(item.id)}">
      <div class="ca-card-meta">
        <time datetime="${escapeHtml(item.date || "")}">${escapeHtml(item.date ? formatDisplayDate(item.date) : "")}</time>
        ${gsBadges(item.gsPapers)}
        ${draftBadge}
        ${starred ? '<span class="star-badge" title="Starred">★</span>' : ""}
        <span class="status-pill ${statusClass(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
        <span class="link-count" title="Links">${linkCount} link${linkCount === 1 ? "" : "s"}</span>
      </div>
      <h3 class="ca-card-title">${escapeHtml(item.title || item.id)}</h3>
      ${preview ? `<p class="ca-card-preview">${preview}</p>` : ""}
      <div class="ca-card-tags">${tagBadges(item.tags)}</div>
    </article>`;
}

async function fetchNotesMd(itemId) {
  if (isDraftItem(itemById(itemId) || {})) {
    return defaultNotesTemplate();
  }
  if (isGitHubConnected()) {
    try {
      const fromApi = await fetchNotesMdFromGitHub(itemId);
      if (fromApi) return fromApi;
    } catch {
      /* fall through to Pages CDN */
    }
  }
  const path = assetUrl(`study/items/${itemId}/notes.md`);
  try {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    return await res.text();
  } catch {
    return null;
  }
}

function parsedNotesToHtmlSections(parsed) {
  const out = {};
  for (const sec of GIT_SECTIONS) {
    const raw = parsed[sec] || "";
    out[sec] = raw ? plainTextToNoteHtml(raw) : "";
  }
  return out;
}

/** Keep local section text when git pull returned empty (e.g. stale Pages CDN). */
function mergePulledGitWithLocal(parsed, local) {
  const htmlSections = parsedNotesToHtmlSections(parsed);
  if (!local || typeof local !== "object") return htmlSections;
  for (const sec of GIT_SECTIONS) {
    const gitPlain = noteHtmlToPlainText(htmlSections[sec] || "");
    const fid = fieldIdForSection(sec);
    const localVal = local[sec] ?? local[fid] ?? "";
    const localPlain = noteHtmlToPlainText(localVal);
    if (!gitPlain.trim() && localPlain.trim()) htmlSections[sec] = localVal;
  }
  return htmlSections;
}

function getGitSections(itemId, mdText) {
  const fromGit = mdText ? parseNotesMd(mdText) : emptyGitSections();
  const local = getGitNotesFromLocal(itemId);
  return mergeGitSectionsWithLocal(fromGit, local);
}

function renderNoteLabelRow(label, itemId, fieldId, userId) {
  const locked = isFieldLocked(itemId, fieldId);
  const lockBtn = `<span class="note-lock-wrap" title="Lock freezes this field — your text stays local until you unlock">
        <button
          type="button"
          class="note-lock-btn${locked ? " note-lock-btn--locked" : ""}"
          data-lock-field="${fieldId}"
          data-item-id="${escapeHtml(itemId)}"
          aria-pressed="${locked ? "true" : "false"}"
          aria-label="${locked ? "Unlock field" : "Lock field — stop cloud sync on this text"}"
        >${locked ? LOCK_ICON_CLOSED : LOCK_ICON_OPEN}</button>
      </span>`;
  return `<div class="note-label-row"><span class="note-label">${escapeHtml(label)}</span>${lockBtn}</div>`;
}

function syncNoteLockUi(btn, itemId, fieldId) {
  const field = btn.closest(".note-field");
  const locked = isFieldLocked(itemId, fieldId);
  const editor = field?.querySelector(".rich-note-editor");
  setRichNoteLocked(editor, locked);
  btn.innerHTML = locked ? LOCK_ICON_CLOSED : LOCK_ICON_OPEN;
  btn.classList.toggle("note-lock-btn--locked", locked);
  btn.setAttribute("aria-pressed", locked ? "true" : "false");
  btn.setAttribute(
    "aria-label",
    locked ? "Unlock field" : "Lock field — stop cloud sync on this text"
  );
}

function bindNoteLocks(root, itemId, userId) {
  root.querySelectorAll(".note-lock-btn").forEach((btn) => {
    syncNoteLockUi(btn, itemId, btn.dataset.lockField);
    btn.addEventListener("click", async () => {
      const fieldId = btn.dataset.lockField;
      const field = btn.closest(".note-field");
      const locked = isFieldLocked(itemId, fieldId);
      btn.disabled = true;
      try {
        if (locked) {
          await unlockNoteField(itemId, fieldId, userId);
        } else {
          const val = readNoteFieldValue(field);
          await lockNoteField(itemId, fieldId, val, userId);
        }
        syncNoteLockUi(btn, itemId, fieldId);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function renderDesk() {
  const q = state.searchQuery.trim();
  let items = mergedItems().filter((i) => matchesSearch(i, q));
  const stats = deskStats(items);
  const todo = items.filter((i) => i.status === "to-study");
  const studied = items.filter((i) => i.status === "studied");
  const revise = items.filter((i) => i.status === "revise");

  el.main.innerHTML = `
    <section class="desk-hero">
      <div class="hero-row">
        <div>
          <h2>Your CA desk</h2>
          <p class="muted">Workflow by status — not “today only”. Use <strong>All items</strong> for the full dated list.</p>
        </div>
      </div>
      <div class="stats-row">
        <div class="stat-chip"><strong>${stats.total}</strong> total</div>
        <div class="stat-chip"><strong>${stats.thisWeek}</strong> this week</div>
        <div class="stat-chip stat-todo"><strong>${stats.todo}</strong> to study</div>
        <div class="stat-chip stat-revise"><strong>${stats.revise}</strong> to revise</div>
      </div>
    </section>
    <div class="desk-columns">
      <div class="desk-stack">
        <h3 class="stack-head stack-todo">To study <span>${todo.length}</span></h3>
        ${todo.slice(0, 12).map((i) => renderItemCard(i)).join("") || '<p class="empty-hint">Nothing queued — <button type="button" class="link-btn" data-open-add>add today\'s CA</button></p>'}
      </div>
      <div class="desk-stack">
        <h3 class="stack-head stack-studied">Studied <span>${studied.length}</span></h3>
        ${studied.slice(0, 8).map((i) => renderItemCard(i)).join("") || '<p class="muted">Empty</p>'}
      </div>
      <div class="desk-stack">
        <h3 class="stack-head stack-revise">Revise <span>${revise.length}</span></h3>
        ${revise.slice(0, 8).map((i) => renderItemCard(i)).join("") || '<p class="empty-hint">Mark items as Revise from item page</p>'}
        ${revise.length ? `<button type="button" class="btn-ghost btn-sm stack-action" id="goReviseBtn">Open date-range revision →</button>` : ""}
      </div>
    </div>`;

  document.querySelector("[data-open-add]")?.addEventListener("click", openAddDialog);
  document.getElementById("goReviseBtn")?.addEventListener("click", () => navigate("revise"));
}

function groupByMonth(items) {
  const groups = new Map();
  for (const item of items) {
    const d = item.date || "Unknown";
    const key = d.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function renderTimeline() {
  const q = state.searchQuery.trim();
  const items = mergedItems()
    .filter((i) => matchesSearch(i, q))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const tagSet = new Set();
  items.forEach((i) => (i.tags || []).forEach((t) => tagSet.add(t)));
  const topTags = [...tagSet].slice(0, 12);

  el.main.innerHTML = `
    <section class="view-head">
      <h2>All items</h2>
      <p class="muted">${items.length} items · newest first</p>
      ${
        topTags.length
          ? `<div class="tag-filter-row">${topTags
              .map(
                (t) =>
                  `<button type="button" class="tag-filter-btn ${state.searchQuery === t ? "active" : ""}" data-tag-filter="${escapeHtml(t)}">${escapeHtml(t)}</button>`
              )
              .join("")}</div>`
          : ""
      }
    </section>
    <div class="timeline-grouped">
      ${
        groupByMonth(items)
          .map(
            ([month, monthItems]) => `
          <section class="month-group">
            <h3 class="month-head">${escapeHtml(formatMonth(month))}</h3>
            <div class="timeline">${monthItems.map((i) => renderItemCard(i)).join("")}</div>
          </section>`
          )
          .join("") || '<p class="empty-hint">No items yet — <button type="button" class="link-btn" data-open-add>add your first CA</button></p>'
      }
    </div>`;

  document.querySelector("[data-open-add]")?.addEventListener("click", openAddDialog);
  document.querySelectorAll("[data-tag-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.tagFilter;
      state.searchQuery = state.searchQuery === tag ? "" : tag;
      if (el.globalSearch) el.globalSearch.value = state.searchQuery;
      renderTimeline();
    });
  });
}

function formatMonth(ym) {
  if (!ym || ym === "Unknown") return "Unknown date";
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function renderReviseNoteBlock(label, body) {
  const text = (body || "").trim();
  if (!text) return "";
  return `
    <div class="revise-section">
      <h4>${escapeHtml(label)}</h4>
      <div class="revise-body">${escapeHtml(text).replace(/\n/g, "<br>")}</div>
    </div>`;
}

async function renderRevise() {
  const q = state.searchQuery.trim();
  let items = mergedItems().filter((i) => matchesSearch(i, q));
  items = filterByDateRange(items, state.reviseFrom, state.reviseTo);
  if (state.reviseTag.trim()) {
    const tag = state.reviseTag.trim().toLowerCase();
    items = items.filter((i) => (i.tags || []).some((t) => t.toLowerCase() === tag));
  }
  items.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  el.main.innerHTML = `
    <section class="view-head revise-head">
      <h2>Revise by date range</h2>
      <p class="muted">All notes from a period — ideal for weekly / monthly revision before prelims.</p>
      <div class="revise-presets">
        <button type="button" class="preset-btn" data-preset="7">Last 7 days</button>
        <button type="button" class="preset-btn" data-preset="30">Last 30 days</button>
        <button type="button" class="preset-btn" data-preset="month">This month</button>
        <button type="button" class="preset-btn" data-preset="90">Last 90 days</button>
      </div>
      <div class="topic-filters revise-filters">
        <div class="revise-date-fields">
          <label class="filter-field filter-field--date"><span>From</span><div id="reviseFromField" class="date-field-slot"></div></label>
          <label class="filter-field filter-field--date"><span>To</span><div id="reviseToField" class="date-field-slot"></div></label>
        </div>
        <label>Tag <input type="text" id="reviseTag" placeholder="optional" value="${escapeHtml(state.reviseTag)}" /></label>
        <button type="button" class="btn-primary btn-sm" id="reviseApplyBtn">Apply</button>
        <button type="button" class="btn-ghost btn-sm" id="revisePrintBtn">Print / PDF</button>
      </div>
      <p class="revise-count"><strong>${items.length}</strong> items · ${escapeHtml(formatDisplayDate(state.reviseFrom))} → ${escapeHtml(formatDisplayDate(state.reviseTo))}</p>
    </section>
    <div class="revise-list" id="reviseList">
      ${items.length ? '<p class="muted">Loading notes…</p>' : '<p class="empty-hint">No items in this range — widen dates or add CA.</p>'}
    </div>`;

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.preset;
      if (p === "month") {
        state.reviseFrom = startOfMonthIso();
        state.reviseTo = todayIso();
      } else {
        state.reviseFrom = isoDaysAgo(Number(p));
        state.reviseTo = todayIso();
      }
      renderRevise();
    });
  });

  const reviseFromPicker = mountDateField(document.getElementById("reviseFromField"), {
    value: state.reviseFrom,
    popover: true,
    onChange(iso) {
      state.reviseFrom = iso;
    },
  });
  const reviseToPicker = mountDateField(document.getElementById("reviseToField"), {
    value: state.reviseTo,
    popover: true,
    maxDate: todayIso(),
    onChange(iso) {
      state.reviseTo = iso;
    },
  });

  document.getElementById("reviseApplyBtn")?.addEventListener("click", () => {
    state.reviseFrom = reviseFromPicker?.getValue() || state.reviseFrom;
    state.reviseTo = reviseToPicker?.getValue() || state.reviseTo;
    state.reviseTag = document.getElementById("reviseTag")?.value.trim() || "";
    renderRevise();
  });

  document.getElementById("revisePrintBtn")?.addEventListener("click", () => window.print());

  if (!items.length) return;

  const listEl = document.getElementById("reviseList");
  const blocks = [];
  for (const item of items) {
    const cloud = getCloudEntry(item.id);
    const mdText = await fetchNotesMd(item.id);
    const sections = getGitSections(item.id, mdText);
    const summary = cloud.summary || item.summary || "";
    blocks.push(`
      <article class="revise-card" id="revise-${escapeHtml(item.id)}">
        <header class="revise-card-head">
          <div>
            <time datetime="${escapeHtml(item.date)}">${escapeHtml(formatDisplayDate(item.date))}</time>
            <h3>${escapeHtml(item.title)}</h3>
            <div class="item-badges">${gsBadges(item.gsPapers)} ${tagBadges(item.tags)}</div>
          </div>
          <button type="button" class="btn-ghost btn-sm" data-open-item="${escapeHtml(item.id)}">Open full</button>
        </header>
        ${summary ? renderReviseNoteBlock("Summary", summary) : ""}
        ${renderReviseNoteBlock("Facts", sections.Facts)}
        ${renderReviseNoteBlock("Static connection", sections["Static connection"])}
        ${renderReviseNoteBlock("GS paper fit", sections["GS paper fit"])}
        ${renderReviseNoteBlock("Exam angle", sections["Exam angle"])}
        ${renderReviseNoteBlock("Miscellaneous", sections.Miscellaneous)}
        <div class="link-ribbon revise-links">${renderLinkRibbon(mergeCloudWithManifest(item).links)}</div>
      </article>`);
  }
  listEl.innerHTML = blocks.join("");
}

function renderTopicLens() {
  const q = state.searchQuery.trim();
  const allItems = mergedItems().filter((i) => matchesSearch(i, q));
  const tagOptions = collectAllTags(allItems);
  const threadOptions = collectAllThreads(allItems);
  const filtered = filterByTopic(allItems).sort((a, b) =>
    (a.date || "").localeCompare(b.date || "")
  );
  el.main.innerHTML = `
    <section class="view-head">
      <h2>Topic lens</h2>
      <p class="view-desc">Filter by year, tag, or thread — e.g. all RBI MPC items in 2025.</p>
      <div class="filter-bar">
        <label class="filter-field"><span>Year</span>
          <input type="number" id="topicYear" value="${state.topicYear}" min="2020" max="2035" />
        </label>
        <label class="filter-field"><span>Tag</span>
          <select id="topicTag" aria-label="Filter by tag">${renderTagSelectOptions(tagOptions, state.topicTag)}</select>
        </label>
        <label class="filter-field filter-field--wide"><span>Thread</span>
          <select id="topicThread" aria-label="Filter by thread">${renderThreadSelectOptions(threadOptions, state.topicThread, { emptyLabel: "All threads" })}</select>
        </label>
      </div>
      <p class="filter-result">${filtered.length} item${filtered.length === 1 ? "" : "s"}</p>
    </section>
    <div class="timeline">${filtered.map((i) => renderItemCard(i)).join("") || '<p class="empty-state">No matches — pick a tag or thread from the dropdowns.</p>'}</div>`;

  const applyTopicFilters = () => {
    state.topicYear = Number(document.getElementById("topicYear").value) || state.topicYear;
    state.topicTag = document.getElementById("topicTag").value.trim();
    state.topicThread = document.getElementById("topicThread").value.trim();
    renderTopicLens();
  };

  document.getElementById("topicTag")?.addEventListener("change", applyTopicFilters);
  document.getElementById("topicThread")?.addEventListener("change", applyTopicFilters);
  document.getElementById("topicYear")?.addEventListener("change", applyTopicFilters);
}

function manifestJsonForUpload(item) {
  const { _draft, _createdAt, _folder, ...rest } = item;
  return rest;
}

function gitPdfEntries(item) {
  const sources = mergeCloudWithManifest(item).sources || [];
  return sources.filter((s) => s?.file?.storage === "git" && s?.file?.path);
}

function persistItemLinks(itemId, userId, draft, links) {
  if (draft) {
    updateDraftItem(itemId, { links });
    return;
  }
  updateCloudField(itemId, userId, "links", links);
}

function persistItemSources(itemId, userId, draft, sources) {
  if (draft) {
    updateDraftItem(itemId, { sources });
    return;
  }
  updateCloudField(itemId, userId, "sources", sources);
}

function renderGalleryImages(itemId, images) {
  if (!images?.length) {
    return `<p class="muted small">No cuttings yet — upload below or connect GitHub.</p>`;
  }
  return images
    .map((img) => {
      const name = typeof img === "string" ? img : img?.file || "";
      const src = assetUrl(`study/items/${itemId}/${name}`);
      return `
        <figure class="gallery-item">
          <button type="button" class="github-delete-btn hidden" data-file="${escapeHtml(name)}" data-file-kind="image" title="Delete from git">×</button>
          <img src="${escapeHtml(src)}" alt="" loading="lazy" />
          <figcaption class="small muted">${escapeHtml(name)}</figcaption>
        </figure>`;
    })
    .join("");
}

function renderPdfList(itemId, pdfs) {
  if (!pdfs.length) {
    return `<p class="muted small">No PDFs in git — upload below or paste a Drive link in Sources.</p>`;
  }
  return pdfs
    .map((src) => {
      const path = src.file.path;
      const href = assetUrl(`study/items/${itemId}/${path}`);
      return `
        <div class="pdf-row">
          <a class="pdf-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">📄 ${escapeHtml(src.name || path)}</a>
          <button type="button" class="github-delete-btn btn-ghost btn-sm hidden" data-file="${escapeHtml(path)}" data-file-kind="pdf">Delete</button>
        </div>`;
    })
    .join("");
}

async function renderItemDetail(itemId) {
  recordCaViewActivity(itemId);
  const item = itemById(itemId);
  if (!item) {
    el.main.innerHTML = `<p class="muted">Item not found.</p>`;
    return;
  }

  const merged = mergeCloudWithManifest(item);
  const cloud = getCloudEntry(itemId);
  const mdText = await fetchNotesMd(itemId);
  const sections = getGitSections(itemId, mdText);
  const userId = state.session?.user?.id || null;
  const draft = isDraftItem(item);
  const canEditCloud = true;
  const manifestJson = JSON.stringify(manifestJsonForUpload(item)).replace(/"/g, "&quot;");
  const pdfs = gitPdfEntries(item);

  el.main.innerHTML = `
    <button type="button" class="btn-ghost back-btn" id="backBtn">← Back</button>
    ${
      draft
        ? `<div class="draft-banner">
            <span>Draft — saved on this device only until published to GitHub.</span>
            <button type="button" class="btn-primary btn-sm" id="publishDraftBtn">Publish to GitHub</button>
          </div>`
        : ""
    }
    <article class="item-spread">
      <section class="git-zone git-zone--manifest item-meta-zone">
        <div class="git-zone-head">
          <span class="git-zone-badge git-zone-badge--manifest">Save to GitHub</span>
          <span class="git-zone-hint muted small">Status, tags, links, sources, files → manifest.json</span>
        </div>
      <header class="item-header">
        <div class="item-header-row">
          <div>
            <time datetime="${escapeHtml(item.date)}">${escapeHtml(formatDisplayDate(item.date))}</time>
            <h2>${escapeHtml(item.title)}</h2>
          </div>
          <div class="item-actions-row">
            <button type="button" class="btn-ghost btn-sm star-btn ${getItemMeta(itemId).starred ? "star-on" : ""}" id="starBtn" title="Star for revision">${getItemMeta(itemId).starred ? "★" : "☆"}</button>
            <label class="status-select-wrap git-manifest-control">
              <span class="small">Status</span>
              <select id="statusSelect" class="status-select git-manifest-control">
                ${STATUS_OPTIONS.map(
                  (s) =>
                    `<option value="${s.value}" ${item.status === s.value ? "selected" : ""}>${s.label}</option>`
                ).join("")}
              </select>
            </label>
          </div>
        </div>
        <div class="item-badges git-manifest-badges">${gsBadges(item.gsPapers)} ${tagBadges(item.tags)}</div>
      </header>
      </section>

      <section class="materials-panel git-zone git-zone--manifest" id="materialsPanel">
        <h3 class="section-label git-zone-section-label">Materials — links, cuttings, PDFs</h3>
        ${renderGitHubConnectHint()}

        <div class="materials-block">
          <h4 class="materials-subhead">Quick links <span class="git-zone-badge git-zone-badge--manifest git-zone-badge--inline">Save to GitHub</span></h4>
          <div class="link-ribbon" id="linkRibbon">${renderLinkRibbon(merged.links)}</div>
          <div id="linksEditor" class="links-editor"></div>
          <button type="button" class="btn-ghost btn-sm" id="addLinkBtn">+ Add link</button>
        </div>

        <div class="materials-block">
          <h4 class="materials-subhead">Sources &amp; PDF links <span class="git-zone-badge git-zone-badge--manifest git-zone-badge--inline">Save to GitHub</span></h4>
          <p class="muted small">Newspaper, PIB, magazine. For large PDFs on Drive — paste URL here (type: magazine/report).</p>
          <div id="sourcesList" class="sources-list"></div>
          <button type="button" class="btn-ghost btn-sm" id="addSourceBtn">+ Add source</button>
          <button type="button" class="btn-ghost btn-sm" id="addPdfLinkBtn">+ Paste PDF / Drive link</button>
        </div>

        <div class="materials-block materials-uploads">
          <h4 class="materials-subhead">Cuttings &amp; photos <span class="git-zone-badge git-zone-badge--manifest git-zone-badge--inline">Git upload</span></h4>
          <div class="materials-gallery gallery">${renderGalleryImages(itemId, item.images)}</div>
          <div class="upload-row">
            ${renderGitHubUploadButton("ca-image", { "item-id": itemId, "item-manifest": manifestJson })}
          </div>
        </div>

        <div class="materials-block materials-uploads">
          <h4 class="materials-subhead">Small PDF in git <span class="git-zone-badge git-zone-badge--manifest git-zone-badge--inline">Git upload</span></h4>
          <p class="muted small">Short reports only. Full magazines → paste a Google Drive URL in Sources (keeps repo &amp; Pages fast).</p>
          <div class="materials-pdfs">${renderPdfList(itemId, pdfs)}</div>
          <div class="upload-row">
            ${renderGitHubUploadButton("ca-pdf", { "item-id": itemId, "item-manifest": manifestJson })}
          </div>
        </div>
        ${
          !draft
            ? `<div class="git-zone-actions git-zone-actions--manifest">
                <button type="button" class="btn-primary btn-sm" id="saveGitHubBtn" title="Status, tags, links, sources → manifest + index">Save to GitHub</button>
              </div>`
            : ""
        }
      </section>

      <section class="notes-panel item-notes-panel git-zone git-zone--notes">
        <div class="git-zone-head">
          <span class="git-zone-badge git-zone-badge--notes">Commit notes.md → GitHub</span>
          <span class="git-zone-hint muted small">Summary, Facts, Exam angle, etc. → notes.md</span>
        </div>
        <p class="note-locks-help muted small">Toolbar: <strong>bold</strong>, lists. Padlock = freeze field. Box height: <strong>S/M/L</strong> in header. ${userId ? "Supabase syncs as you type." : "Saved in browser until commit."}</p>
        <div class="note-field git-notes-field${isFieldLocked(itemId, "summary") ? " note-field--locked" : ""}" data-field="summary">
          ${renderNoteLabelRow("Summary", itemId, "summary", userId)}
          ${renderRichNoteEditorHtml({ "data-field-id": "summary" }, { placeholder: "What happened — story angle", rows: 4 })}
        </div>

        ${GIT_SECTIONS.map((sec) => {
          const fid = fieldIdForSection(sec);
          return `<div class="note-field git-notes-field${isFieldLocked(itemId, fid) ? " note-field--locked" : ""}" data-field="${fid}">
            ${renderNoteLabelRow(sec, itemId, fid, userId)}
            ${renderRichNoteEditorHtml({ "data-field-id": fid, "data-section": sec }, { placeholder: sec, rows: 5 })}
          </div>`;
        }).join("")}

        <div class="item-tool-row item-tool-row--neutral">
          <button type="button" class="btn-ghost btn-sm" id="genFlashBtn" title="From Facts &amp; Exam angle — one bullet per line">Generate flashcards</button>
          <button type="button" class="btn-ghost btn-sm" id="markRevisedBtn">Mark revised today</button>
        </div>
        ${
          !draft
            ? `<div class="git-zone-actions git-zone-actions--notes">
                <button type="button" class="btn-git-notes btn-sm" id="commitNotesBtn">Commit notes.md → GitHub</button>
                <button type="button" class="btn-git-notes btn-sm btn-git-notes--soft" id="pullNotesBtn" title="Load notes.md from GitHub into this browser">Refresh notes from GitHub</button>
              </div>`
            : `<div class="git-zone-actions git-zone-actions--notes">
                <button type="button" class="btn-git-notes btn-sm" id="commitNotesBtn" disabled title="Publish first">Commit notes.md → GitHub</button>
              </div>`
        }
      </section>
    </article>`;

  document.getElementById("backBtn")?.addEventListener("click", () => navigate(state.view === "item" ? "today" : state.view));

  document.getElementById("publishDraftBtn")?.addEventListener("click", () => handlePublishDraft(item));

  document.getElementById("saveGitHubBtn")?.addEventListener("click", () => handleSaveToGitHub(item));

  document.getElementById("starBtn")?.addEventListener("click", () => {
    toggleStar(itemId, userId);
    recordCaStarActivity(itemId);
    navigate("item", itemId);
  });

  document.getElementById("statusSelect")?.addEventListener("change", (e) => {
    setStatusOverride(itemId, e.target.value);
    recordCaStatusActivity(itemId);
    navigate("item", itemId);
  });

  const summaryVal = pickNoteValue(itemId, "summary", cloud.summary || item.summary || "");
  writeNoteFieldValue(document.querySelector('[data-field-id="summary"]')?.closest(".note-field"), summaryVal);
  bindRichNoteEditor(document.querySelector('[data-field-id="summary"]'), {
    onInput: (val) => {
      updateCloudField(itemId, userId, "summary", val);
      recordCaNoteActivity(itemId, "summary", noteHtmlToPlainText(val));
    },
  });
  if (isFieldLocked(itemId, "summary")) {
    setRichNoteLocked(document.querySelector('[data-field-id="summary"]'), true);
  }

  const gitSections = { ...sections };
  document.querySelectorAll(".note-field[data-field]").forEach((fieldEl) => {
    const editor = fieldEl.querySelector(".rich-note-editor");
    const fid = editor?.dataset.fieldId;
    const sec = editor?.dataset.section;
    if (!fid) return;
    if (fid === "summary") return;
    const raw = pickNoteValue(itemId, fid, gitSections[sec] || "");
    writeNoteFieldValue(fieldEl, raw);
    if (isFieldLocked(itemId, fid)) setRichNoteLocked(editor, true);
    bindRichNoteEditor(editor, {
      onInput: (val) => {
        gitSections[sec] = val;
        saveGitNotesToLocal(itemId, gitSections, userId);
        recordCaNoteActivity(itemId, fid, noteHtmlToPlainText(val));
      },
    });
  });

  bindNoteLocks(el.main, itemId, userId);

  function readGitSectionsFromEditors() {
    const live = { ...gitSections };
    document.querySelectorAll(".note-field[data-field]").forEach((fieldEl) => {
      const editor = fieldEl.querySelector(".rich-note-editor");
      const sec = editor?.dataset.section;
      if (!sec) return;
      live[sec] = readNoteFieldValue(fieldEl);
    });
    return live;
  }

  document.getElementById("genFlashBtn")?.addEventListener("click", async () => {
    const liveSections = readGitSectionsFromEditors();
    const n = await generateFlashcardsFromItem(userId, item, liveSections);
    if (!n.length) {
      alert(
        "No flashcards created.\n\nAdd notes in Facts or Exam angle — one point per line (or short paragraph). Each line needs a few words (not just \"-\").\n\nExample in Facts:\n• RBI kept repo rate unchanged at 6.5%\n• CPI target remains 4% with band"
      );
      return;
    }
    alert(`Created ${n.length} flashcard${n.length === 1 ? "" : "s"}. Open Drill tab to revise.`);
  });

  document.getElementById("markRevisedBtn")?.addEventListener("click", () => {
    markRevised(itemId, userId);
    alert("Marked revised today.");
  });

  document.getElementById("commitNotesBtn")?.addEventListener("click", async () => {
    try {
      const liveSections = readGitSectionsFromEditors();
      saveGitNotesToLocal(itemId, liveSections, userId);
      const { path, searchEntry } = await commitNotesMdToGitHub(itemId, merged, liveSections);
      if (searchEntry) setSearchIndexEntry(itemId, searchEntry);
      alert(
        `Committed ${path} to GitHub.\n\nThis device already has your latest notes. On another device: sign in (Supabase sync) or use “Refresh notes from GitHub”.`
      );
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById("pullNotesBtn")?.addEventListener("click", async () => {
    try {
      const mdText = await fetchNotesMd(itemId);
      if (!mdText) {
        throw new Error(
          isGitHubConnected()
            ? "Could not load notes.md from GitHub. Commit first, or wait ~2 min for Pages if you are not signed in."
            : "Connect GitHub to refresh notes, or wait ~2 min after commit for Pages to update."
        );
      }
      const fromGit = parseNotesMd(mdText);
      const localBefore = getGitNotesFromLocal(itemId);
      saveGitNotesToLocal(itemId, mergePulledGitWithLocal(fromGit, localBefore), userId);
      if (fromGit[SUMMARY_SECTION]?.trim()) {
        updateCloudField(itemId, userId, "summary", plainTextToNoteHtml(fromGit[SUMMARY_SECTION]));
      }
      alert("Loaded notes from GitHub into this browser.");
      navigate("item", itemId);
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  mountLinksEditor(itemId, userId, draft, [...(merged.links || [])]);
  mountSourcesEditor(itemId, userId, draft, [...(merged.sources || [])]);

  document.getElementById("addPdfLinkBtn")?.addEventListener("click", () => {
    const sources = [...(mergeCloudWithManifest(itemById(itemId)).sources || [])];
    sources.push({
      type: "magazine",
      name: "Magazine / PDF",
      date: item.date || todayIso(),
      url: "",
    });
    persistItemSources(itemId, userId, draft, sources);
    mountSourcesEditor(itemId, userId, draft, sources);
  });
  bindAllMaterialsUploads(materialsPanel, itemId, manifestJsonForUpload(item), () => {
    setTimeout(() => renderItemDetail(itemId), 1500);
  });
}

function mountLinksEditor(itemId, userId, draft, links) {
  const root = document.getElementById("linksEditor");
  if (!root) return;

  const render = () => {
    root.innerHTML = links
      .map(
        (link, idx) => `
      <div class="editor-row" data-idx="${idx}">
        <input type="text" class="link-label" placeholder="Label" value="${escapeHtml(link.label || "")}" />
        <input type="url" class="link-url" placeholder="https://..." value="${escapeHtml(link.url || "")}" />
        <select class="link-kind">${LINK_KINDS.map((k) => `<option value="${k}" ${link.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select>
        <button type="button" class="btn-ghost btn-sm link-remove" title="Remove">×</button>
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
        persistItemLinks(itemId, userId, draft, links);
        document.getElementById("linkRibbon").innerHTML = renderLinkRibbon(links);
      };
      row.querySelectorAll("input, select").forEach((inp) => inp.addEventListener("input", sync));
      row.querySelector(".link-remove")?.addEventListener("click", () => {
        links.splice(idx, 1);
        persistItemLinks(itemId, userId, draft, links);
        render();
        document.getElementById("linkRibbon").innerHTML = renderLinkRibbon(links);
      });
    });
  };

  render();
  const addBtn = document.getElementById("addLinkBtn");
  const newAddBtn = addBtn?.cloneNode(true);
  addBtn?.replaceWith(newAddBtn);
  newAddBtn?.addEventListener("click", () => {
    links.push({ label: "", url: "", kind: "news", addedAt: new Date().toISOString().slice(0, 10) });
    persistItemLinks(itemId, userId, draft, links);
    render();
  });
}

function mountSourcesEditor(itemId, userId, draft, sources) {
  const root = document.getElementById("sourcesList");
  if (!root) return;
  const defaultDate = itemById(itemId)?.date || todayIso();

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
        <input class="src-name" placeholder="Name (The Hindu, Yojana…)" value="${escapeHtml(src.name || "")}" />
        <div class="src-date-mount date-field-slot"></div>
        <input class="src-url" type="url" placeholder="URL or Drive link" value="${escapeHtml(src.url || "")}" />
        <button type="button" class="btn-ghost btn-sm src-remove" title="Remove">×</button>
      </div>`
      )
      .join("");

    const datePickers = [];

    root.querySelectorAll(".source-row").forEach((row) => {
      const idx = Number(row.dataset.idx);
      const src = sources[idx];
      const dateMount = row.querySelector(".src-date-mount");
      const initialDate =
        src.date && /^\d{4}-\d{2}-\d{2}$/.test(src.date) ? src.date : defaultDate;

      const sync = () => {
        sources[idx] = {
          type: row.querySelector(".src-type")?.value || "other",
          name: row.querySelector(".src-name")?.value || "",
          date: datePickers[idx]?.getValue() || initialDate,
          url: row.querySelector(".src-url")?.value || "",
          file: sources[idx]?.file,
        };
        persistItemSources(itemId, userId, draft, sources);
      };

      datePickers[idx] = mountDateField(dateMount, {
        value: initialDate,
        popover: true,
        maxDate: todayIso(),
        onChange: sync,
      });

      row.querySelectorAll("input, select").forEach((inp) => inp.addEventListener("input", sync));
      row.querySelector(".src-remove")?.addEventListener("click", () => {
        datePickers[idx]?.destroy?.();
        sources.splice(idx, 1);
        persistItemSources(itemId, userId, draft, sources);
        render();
      });
    });
  };

  render();
  const addBtn = document.getElementById("addSourceBtn");
  const newAddBtn = addBtn?.cloneNode(true);
  addBtn?.replaceWith(newAddBtn);
  newAddBtn?.addEventListener("click", () => {
    sources.push({ type: "newspaper", name: "", date: defaultDate, url: "" });
    persistItemSources(itemId, userId, draft, sources);
    render();
  });
}

let addDatePickerApi = null;

function ensureAddDatePicker() {
  const container = document.getElementById("addDatePicker");
  const hidden = document.getElementById("addDate");
  if (!container || !hidden) return null;
  if (!addDatePickerApi) {
    addDatePickerApi = mountDatePicker(container, {
      value: todayIso(),
      maxDate: todayIso(),
      onChange(iso) {
        hidden.value = iso;
      },
    });
  }
  return addDatePickerApi;
}

function openAddDialog(presetDate) {
  el.addItemError?.classList.add("hidden");
  const hidden = document.getElementById("addDate");
  const iso = presetDate || todayIso();
  if (hidden) hidden.value = iso;
  ensureAddDatePicker()?.setValue(iso);
  document.getElementById("addTitle")?.focus();
  el.addItemDialog?.showModal();
}

function renderTracker() {
  renderActivityDashboard(el.main);
}

async function handlePublishDraft(item) {
  const btn = document.getElementById("publishDraftBtn") || document.getElementById("publishGitHubBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Publishing…";
  }
  try {
    if (!isGitHubConnected()) {
      throw new Error("Connect GitHub in the header first.");
    }
    const result = await publishDraftToGitHub(item);
    const published = { ...item, _folder: item.id };
    delete published._draft;
    removeDraft(item.id);
    await loadIndex();
    if (!state.items.some((row) => row.id === item.id)) {
      state.items.push(published);
    }
    if (result.searchEntry) setSearchIndexEntry(item.id, result.searchEntry);
    el.draftExportDialog?.close();
    alert(`Published ${item.title} to git. Live on site in ~1–2 min after GitHub Pages deploys.`);
    navigate("item", item.id);
  } catch (err) {
    alert(err.message || String(err));
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Publish to GitHub";
    }
  }
}

async function handleSaveToGitHub(item) {
  const btn = document.getElementById("saveGitHubBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }
  try {
    if (!isGitHubConnected()) {
      throw new Error("Connect GitHub in the header first.");
    }
    const merged = mergeCloudWithManifest(item);
    const { manifest, searchEntry } = await savePublishedItemToGitHub(merged);
    clearStatusOverride(item.id);
    const idx = state.items.findIndex((row) => row.id === item.id);
    if (idx >= 0) {
      state.items[idx] = { ...state.items[idx], ...manifest, _folder: item.id };
    }
    if (searchEntry) setSearchIndexEntry(item.id, searchEntry);
    alert(
      `Saved ${item.title} to GitHub (manifest + index).\n\nStatus, tags, links, and sources are synced — live in ~1–2 min.`
    );
    navigate("item", item.id);
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save to GitHub";
    }
  }
}

function showDraftExport(item) {
  state.pendingDraftId = item.id;
  const cli = draftCliCommand(item);
  const cliBlock = document.getElementById("draftCliBlock");
  const hint = document.getElementById("draftExportHint");
  if (hint) {
    hint.textContent = isGitHubConnected()
      ? "Publish to GitHub — no terminal needed. Or open the item and publish later."
      : "Connect GitHub in the header to publish from the app. Terminal commands below are optional.";
  }
  if (cliBlock) {
    cliBlock.textContent = `${cli}\npython3 scripts/build-index.py\ngit add study/ data/index.json && git commit -m "Add CA: ${item.title}" && git push`;
  }

  document.getElementById("publishGitHubBtn")?.replaceWith(document.getElementById("publishGitHubBtn").cloneNode(true));
  const pubBtn = document.getElementById("publishGitHubBtn");
  pubBtn?.addEventListener("click", () => handlePublishDraft(item));
  if (pubBtn) pubBtn.classList.toggle("hidden", !isGitHubConnected());

  document.getElementById("copyCliBtn")?.replaceWith(document.getElementById("copyCliBtn").cloneNode(true));
  const fullCli = cliBlock?.textContent || cli;
  document.getElementById("copyCliBtn")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(fullCli);
  });

  document.getElementById("dlManifestBtn")?.replaceWith(document.getElementById("dlManifestBtn").cloneNode(true));
  document.getElementById("dlManifestBtn")?.addEventListener("click", () => {
    const manifest = {
      id: item.id,
      date: item.date,
      title: item.title,
      status: item.status,
      gsPapers: item.gsPapers,
      tags: item.tags,
      threads: item.threads,
      images: [],
      sources: item.sources,
      links: item.links,
    };
    downloadTextFile("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  });

  document.getElementById("dlNotesBtn")?.replaceWith(document.getElementById("dlNotesBtn").cloneNode(true));
  document.getElementById("dlNotesBtn")?.addEventListener("click", () => {
    downloadTextFile("notes.md", defaultNotesTemplate());
  });

  document.getElementById("draftExportClose")?.replaceWith(document.getElementById("draftExportClose").cloneNode(true));
  document.getElementById("draftExportClose")?.addEventListener("click", () => {
    el.draftExportDialog?.close();
    navigate("item", item.id);
  });

  el.draftExportDialog?.showModal();
}

function bindAddItem() {
  el.addItemBtn?.addEventListener("click", openAddDialog);
  el.addItemCancel?.addEventListener("click", () => el.addItemDialog?.close());

  el.addItemForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    el.addItemError?.classList.add("hidden");
    try {
      const title = document.getElementById("addTitle")?.value || "";
      const date = document.getElementById("addDate")?.value || "";
      const tags = splitCsv(document.getElementById("addTags")?.value);
      const thread = document.getElementById("addThread")?.value.trim();
      const threads = thread ? [thread] : [];
      const gsPapers = [...document.querySelectorAll(".gs-fieldset input:checked")].map((cb) =>
        Number(cb.value)
      );
      const linkUrl = document.getElementById("addLinkUrl")?.value.trim();
      const links = linkUrl
        ? [{ label: "Source link", url: linkUrl, kind: "news", addedAt: date }]
        : [];

      const item = addDraftItem({ title, date, tags, threads, gsPapers, links });
      recordCaAddActivity(item.id);
      el.addItemDialog?.close();
      el.addItemForm?.reset();
      ensureAddDatePicker()?.setValue(todayIso());
      if (document.getElementById("addDate")) document.getElementById("addDate").value = todayIso();
      showDraftExport(item);
      navigate("today");
    } catch (err) {
      el.addItemError.textContent = err.message || "Could not add item";
      el.addItemError.classList.remove("hidden");
    }
  });
}

function bindSearch() {
  bindSearchAutocomplete({
    inputEl: el.globalSearch,
    suggestionsEl: el.searchSuggestions,
    getItems: mergedItems,
    deps: searchDeps,
    onQueryChange: (query) => {
      state.searchQuery = query;
      el.globalSearch?.setAttribute("aria-expanded", query.trim() ? "true" : "false");
      if (state.view === "item") return;
      navigate(state.view);
    },
    onSelectItem: (itemId) => {
      el.globalSearch?.setAttribute("aria-expanded", "false");
      navigate("item", itemId);
    },
  });
}

function navigate(view, itemId = null) {
  state.view = view;
  state.itemId = itemId;
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  if (view === "today") renderToday(viewCtx());
  else if (view === "desk") renderDesk();
  else if (view === "timeline") renderTimeline();
  else if (view === "revise") renderRevise();
  else if (view === "topic") renderTopicLens();
  else if (view === "calendar") renderCalendar(viewCtx());
  else if (view === "thread") renderThreadDiff(viewCtx());
  else if (view === "drill") renderDrill(viewCtx());
  else if (view === "monthly") renderMonthly(viewCtx());
  else if (view === "tracker") renderTracker();
  else if (view === "item" && itemId) renderItemDetail(itemId);
}

function userDisplayName(user) {
  if (!user) return "Signed in";
  const meta = user.user_metadata || {};
  return meta.full_name || meta.name || user.email?.split("@")[0] || "Signed in";
}

function renderAuthArea() {
  if (!el.authArea) return;
  const user = state.session?.user;
  if (user) {
    const name = userDisplayName(user);
    const email = user.email || "";
    el.authArea.innerHTML = `
      <span class="auth-user" title="${escapeHtml(email)}">${escapeHtml(name)}</span>
      <button type="button" class="btn-ghost btn-sm" id="signOutBtn">Sign out</button>`;
    document.getElementById("signOutBtn")?.addEventListener("click", () => signOut());
  } else {
    el.authArea.innerHTML =
      '<button type="button" class="btn-ghost btn-sm" id="signInBtn">Sign in</button>';
    document.getElementById("signInBtn")?.addEventListener("click", () => el.authDialog?.showModal());
  }
}

function updateAuthUi() {
  const configured = isSupabaseConfigured();
  const signedIn = Boolean(state.session);
  el.syncBadge.textContent = signedIn ? "Cloud sync on" : configured ? "Sign in to sync" : "Local only";
  el.syncBadge.classList.toggle("sync-on", signedIn);
  el.authConfigNote?.classList.toggle("hidden", configured);
  renderAuthArea();
}

async function loadIndex() {
  const url = assetUrl("data/index.json");
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("Failed to load index");
  const data = await res.json();
  state.items = data.items || [];
}

function bindGlobalClicks() {
  document.body.addEventListener("click", (e) => {
    const card = e.target.closest("[data-open-item]");
    if (card) {
      navigate("item", card.dataset.openItem);
    }
  });

  el.nav?.addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-btn");
    if (btn?.dataset.view) navigate(btn.dataset.view);
  });
}

function bindAuth() {
  el.authArea?.addEventListener("click", (e) => {
    if (e.target.closest("#signInBtn")) el.authDialog?.showModal();
  });

  document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const mode = tab.dataset.authTab;
      el.authSubmitBtn.textContent = mode === "signup" ? "Sign up" : "Sign in";
    });
  });

  el.authGoogleBtn?.addEventListener("click", async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      el.authError.textContent = err.message || "Google sign-in failed";
      el.authError.classList.remove("hidden");
    }
  });

  el.authForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    el.authError.classList.add("hidden");
    const mode = document.querySelector(".auth-tab.active")?.dataset.authTab || "signin";
    try {
      if (mode === "signup") {
        await signUpWithEmail(el.authEmail.value, el.authPassword.value);
      } else {
        await signInWithEmail(el.authEmail.value, el.authPassword.value);
      }
      el.authDialog.close();
    } catch (err) {
      el.authError.textContent = err.message || "Auth failed";
      el.authError.classList.remove("hidden");
    }
  });
}

async function withTimeout(promise, ms, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function initAuthBackground() {
  try {
    await withTimeout(initSupabase(), 12000, null);
    await initGitHubUploadConfig();
    bindGitHubHeaderButton(el.githubConnectBtn);
    state.session = await withTimeout(getSession(), 8000, null);
    if (state.session?.user?.id) {
      await withTimeout(loadAllCloudNotes(state.session.user.id), 12000, undefined);
      await withTimeout(loadFlashcards(state.session.user.id), 8000, undefined);
    }
    onAuthStateChange(async (session) => {
      state.session = session;
      updateAuthUi();
      if (session?.user?.id) {
        await loadAllCloudNotes(session.user.id);
        await loadFlashcards(session.user.id);
      }
      if (state.view === "item" && state.itemId) renderItemDetail(state.itemId);
      else navigate(state.view);
    });
    updateAuthUi();
  } catch (err) {
    console.warn("Auth / sync init", err);
    updateAuthUi();
  }
}

async function init() {
  try {
    initTheme();
    bindThemeToggle(el.themeToggle);
    bindNoteSizeControl(el.noteSizeControl);
    bindExportButtons(el.exportJsonBtn, el.exportMdBtn, () => mergedItems());
    loadLocalMeta();
    hydrateCloudFromLocal();
    loadFlashcardsLocal();

    bindAuth();
    bindAddItem();
    bindSearch();
    bindGlobalClicks();
    updateAuthUi();

    await loadIndex();
    await loadSearchIndex(assetUrl("data/search-index.json"));
    navigate("today");

    void initAuthBackground();
  } catch (err) {
    console.error("CA desk init failed", err);
    if (el.main) {
      el.main.innerHTML = `<p class="error">Could not start the app — ${escapeHtml(err.message || String(err))}</p>`;
    }
  }
}

init();
