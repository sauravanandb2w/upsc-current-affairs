import { assetUrl, repoBase } from "./paths.js";
import {
  parseNotesMd,
  GIT_SECTIONS,
  emptyGitSections,
  defaultNotesTemplate,
} from "./notes-md.js";
import {
  hydrateCloudFromLocal,
  loadAllCloudNotes,
  mergeCloudWithManifest,
  getCloudEntry,
  updateCloudField,
  getGitNotesFromLocal,
  saveGitNotesToLocal,
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
  draftCliCommand,
  downloadTextFile,
} from "./local-meta.js";

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
  view: "desk",
  itemId: null,
  topicYear: new Date().getFullYear(),
  topicTag: "",
  topicThread: "",
  searchQuery: "",
  reviseFrom: isoDaysAgo(7),
  reviseTo: todayIso(),
  reviseTag: "",
  reviseExpandAll: false,
  pendingDraftId: null,
};

const el = {
  syncBadge: document.getElementById("syncBadge"),
  main: document.getElementById("main"),
  nav: document.getElementById("mainNav"),
  globalSearch: document.getElementById("globalSearch"),
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
  signInBtn: document.getElementById("signInBtn"),
  signOutBtn: document.getElementById("signOutBtn"),
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function startOfMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
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

function matchesSearch(item, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const cloud = getCloudEntry(item.id);
  const localNotes = getGitNotesFromLocal(item.id);
  const hay = [
    item.title,
    item.date,
    item.id,
    ...(item.tags || []),
    ...(item.threads || []),
    cloud.summary,
    localNotes ? Object.values(localNotes).join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
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
  return `
    <article class="ca-card ${statusClass(item.status)}" data-open-item="${escapeHtml(item.id)}">
      <div class="ca-card-meta">
        <time>${escapeHtml(item.date || "")}</time>
        ${gsBadges(item.gsPapers)}
        ${draftBadge}
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
  const path = assetUrl(`study/items/${itemId}/notes.md`);
  try {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    return await res.text();
  } catch {
    return null;
  }
}

function getGitSections(itemId, mdText) {
  const local = getGitNotesFromLocal(itemId);
  if (local) return { ...emptyGitSections(), ...local };
  if (mdText) return parseNotesMd(mdText);
  return emptyGitSections();
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
          <p class="muted">Add what you read · revise by date range · deep notes in git.</p>
        </div>
        <button type="button" class="btn-accent" id="deskAddBtn">+ Add CA</button>
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

  document.getElementById("deskAddBtn")?.addEventListener("click", openAddDialog);
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
        <label>From <input type="date" id="reviseFrom" value="${state.reviseFrom}" /></label>
        <label>To <input type="date" id="reviseTo" value="${state.reviseTo}" /></label>
        <label>Tag <input type="text" id="reviseTag" placeholder="optional" value="${escapeHtml(state.reviseTag)}" /></label>
        <button type="button" class="btn-primary btn-sm" id="reviseApplyBtn">Apply</button>
        <button type="button" class="btn-ghost btn-sm" id="revisePrintBtn">Print / PDF</button>
      </div>
      <p class="revise-count"><strong>${items.length}</strong> items · ${escapeHtml(state.reviseFrom)} → ${escapeHtml(state.reviseTo)}</p>
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

  document.getElementById("reviseApplyBtn")?.addEventListener("click", () => {
    state.reviseFrom = document.getElementById("reviseFrom")?.value || state.reviseFrom;
    state.reviseTo = document.getElementById("reviseTo")?.value || state.reviseTo;
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
            <time>${escapeHtml(item.date)}</time>
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
  const filtered = filterByTopic(mergedItems()).sort((a, b) =>
    (a.date || "").localeCompare(b.date || "")
  );
  el.main.innerHTML = `
    <section class="view-head topic-lens">
      <h2>Topic lens</h2>
      <p class="muted">Year-end view — e.g. all RBI monetary policy items in 2025</p>
      <div class="topic-filters">
        <label>Year <input type="number" id="topicYear" value="${state.topicYear}" min="2020" max="2035" /></label>
        <label>Tag <input type="text" id="topicTag" placeholder="monetary-policy" value="${escapeHtml(state.topicTag)}" /></label>
        <label>Thread <input type="text" id="topicThread" placeholder="2025-rbi-monetary-policy" value="${escapeHtml(state.topicThread)}" /></label>
        <button type="button" class="btn-primary btn-sm" id="topicApplyBtn">Apply</button>
      </div>
    </section>
    <div class="topic-results">
      <p><strong>${filtered.length}</strong> matching items</p>
      <div class="timeline">${filtered.map((i) => renderItemCard(i)).join("") || '<p class="muted">No matches — adjust filters or add tags</p>'}</div>
    </div>`;

  document.getElementById("topicApplyBtn")?.addEventListener("click", () => {
    state.topicYear = Number(document.getElementById("topicYear").value) || state.topicYear;
    state.topicTag = document.getElementById("topicTag").value.trim();
    state.topicThread = document.getElementById("topicThread").value.trim();
    renderTopicLens();
  });
}

async function renderItemDetail(itemId) {
  const item = itemById(itemId);
  if (!item) {
    el.main.innerHTML = `<p class="muted">Item not found.</p>`;
    return;
  }

  const cloud = getCloudEntry(itemId);
  const mdText = await fetchNotesMd(itemId);
  const sections = getGitSections(itemId, mdText);
  const images = (item.images || []).map((img) => {
    const src = assetUrl(`study/items/${itemId}/${img}`);
    return `<figure class="gallery-item"><img src="${escapeHtml(src)}" alt="" loading="lazy" /></figure>`;
  });

  const userId = state.session?.user?.id;
  const canEditCloud = Boolean(userId);
  const draft = isDraftItem(item);

  el.main.innerHTML = `
    <button type="button" class="btn-ghost back-btn" id="backBtn">← Back</button>
    ${
      draft
        ? `<div class="draft-banner">Draft on this device — run <code>${escapeHtml(draftCliCommand(item))}</code> on laptop, then <code>build-index.py</code> + git push.</div>`
        : ""
    }
    <article class="item-spread">
      <header class="item-header">
        <div class="item-header-row">
          <div>
            <time>${escapeHtml(item.date)}</time>
            <h2>${escapeHtml(item.title)}</h2>
          </div>
          <label class="status-select-wrap">
            <span class="small muted">Status</span>
            <select id="statusSelect" class="status-select">
              ${STATUS_OPTIONS.map(
                (s) =>
                  `<option value="${s.value}" ${item.status === s.value ? "selected" : ""}>${s.label}</option>`
              ).join("")}
            </select>
          </label>
        </div>
        <div class="item-badges">${gsBadges(item.gsPapers)} ${tagBadges(item.tags)}</div>
      </header>

      <section class="link-ribbon-wrap">
        <h3 class="section-label">Links</h3>
        <div class="link-ribbon" id="linkRibbon">${renderLinkRibbon(mergeCloudWithManifest(item).links)}</div>
        ${
          canEditCloud
            ? `<details class="edit-links"><summary>Add / edit links (syncs)</summary>
               <div id="linksEditor"></div>
               <button type="button" class="btn-ghost btn-sm" id="addLinkBtn">+ Link</button></details>`
            : `<p class="muted small">Sign in to edit links (Supabase sync).</p>`
        }
      </section>

      <div class="item-grid">
        <section class="gallery-panel">
          <h3 class="section-label">Cuttings / images</h3>
          <div class="gallery">${images.join("") || '<p class="muted small">Add images to git folder on laptop.</p>'}</div>
        </section>
        <section class="notes-panel">
          <h3 class="section-label">Summary <span class="sync-tag">Supabase</span></h3>
          <textarea class="note-box" id="summaryField" rows="4" ${canEditCloud ? "" : "readonly"} placeholder="What happened — story angle">${escapeHtml(cloud.summary || item.summary || "")}</textarea>

          <h3 class="section-label">Sources <span class="sync-tag">Supabase</span></h3>
          <div id="sourcesList" class="sources-list"></div>
          ${canEditCloud ? `<button type="button" class="btn-ghost btn-sm" id="addSourceBtn">+ Source row</button>` : ""}

          <h3 class="section-label">Deep notes <span class="sync-tag git-tag">Browser · git later</span></h3>
          <p class="muted small">Saved in this browser. Commit <code>notes.md</code> from laptop for backup.</p>
          ${GIT_SECTIONS.map(
            (sec) => `
            <label class="note-label">${escapeHtml(sec)}</label>
            <textarea class="note-box git-note" data-section="${escapeHtml(sec)}" rows="4">${escapeHtml(sections[sec] || "")}</textarea>`
          ).join("")}
        </section>
      </div>
    </article>`;

  document.getElementById("backBtn")?.addEventListener("click", () => navigate(state.view === "item" ? "desk" : state.view));

  document.getElementById("statusSelect")?.addEventListener("change", (e) => {
    setStatusOverride(itemId, e.target.value);
    navigate("item", itemId);
  });

  if (canEditCloud) {
    const summaryEl = document.getElementById("summaryField");
    summaryEl?.addEventListener("input", () => {
      updateCloudField(itemId, userId, "summary", summaryEl.value);
    });
    mountLinksEditor(itemId, userId, mergeCloudWithManifest(item).links || []);
    mountSourcesEditor(itemId, userId, mergeCloudWithManifest(item).sources || []);
  }

  document.querySelectorAll(".git-note").forEach((ta) => {
    ta.addEventListener("input", () => {
      const next = { ...sections };
      document.querySelectorAll(".git-note").forEach((elTa) => {
        next[elTa.dataset.section] = elTa.value;
      });
      saveGitNotesToLocal(itemId, next);
    });
  });
}

function mountLinksEditor(itemId, userId, links) {
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
        updateCloudField(itemId, userId, "links", links);
        document.getElementById("linkRibbon").innerHTML = renderLinkRibbon(links);
      };
      row.querySelectorAll("input, select").forEach((inp) => inp.addEventListener("input", sync));
      row.querySelector(".link-remove")?.addEventListener("click", () => {
        links.splice(idx, 1);
        updateCloudField(itemId, userId, "links", links);
        render();
        document.getElementById("linkRibbon").innerHTML = renderLinkRibbon(links);
      });
    });
  };

  render();
  document.getElementById("addLinkBtn")?.addEventListener("click", () => {
    links.push({ label: "", url: "", kind: "news", addedAt: new Date().toISOString().slice(0, 10) });
    updateCloudField(itemId, userId, "links", links);
    render();
  });
}

function mountSourcesEditor(itemId, userId, sources) {
  const root = document.getElementById("sourcesList");
  if (!root) return;

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
        <input class="src-name" placeholder="Name" value="${escapeHtml(src.name || "")}" />
        <input class="src-date" placeholder="Date" value="${escapeHtml(src.date || "")}" />
        <input class="src-url" type="url" placeholder="URL" value="${escapeHtml(src.url || "")}" />
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
          date: row.querySelector(".src-date")?.value || "",
          url: row.querySelector(".src-url")?.value || "",
        };
        updateCloudField(itemId, userId, "sources", sources);
      };
      row.querySelectorAll("input, select").forEach((inp) => inp.addEventListener("input", sync));
      row.querySelector(".src-remove")?.addEventListener("click", () => {
        sources.splice(idx, 1);
        updateCloudField(itemId, userId, "sources", sources);
        render();
      });
    });
  };

  render();
  document.getElementById("addSourceBtn")?.addEventListener("click", () => {
    sources.push({ type: "newspaper", name: "", date: "", url: "" });
    updateCloudField(itemId, userId, "sources", sources);
    render();
  });
}

function openAddDialog() {
  el.addItemError?.classList.add("hidden");
  const dateInput = document.getElementById("addDate");
  if (dateInput) dateInput.value = todayIso();
  document.getElementById("addTitle")?.focus();
  el.addItemDialog?.showModal();
}

function showDraftExport(item) {
  state.pendingDraftId = item.id;
  const cli = draftCliCommand(item);
  document.getElementById("draftCliBlock").textContent = `${cli}\npython3 scripts/build-index.py\ngit add study/ data/index.json && git commit -m "Add CA: ${item.title}" && git push`;

  document.getElementById("copyCliBtn")?.replaceWith(document.getElementById("copyCliBtn").cloneNode(true));
  document.getElementById("copyCliBtn")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(cli);
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
      el.addItemDialog?.close();
      el.addItemForm?.reset();
      showDraftExport(item);
      navigate("desk");
    } catch (err) {
      el.addItemError.textContent = err.message || "Could not add item";
      el.addItemError.classList.remove("hidden");
    }
  });
}

function bindSearch() {
  el.globalSearch?.addEventListener("input", () => {
    state.searchQuery = el.globalSearch.value;
    if (state.view === "item") return;
    navigate(state.view);
  });
}

function navigate(view, itemId = null) {
  state.view = view;
  state.itemId = itemId;
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  if (view === "desk") renderDesk();
  else if (view === "timeline") renderTimeline();
  else if (view === "revise") renderRevise();
  else if (view === "topic") renderTopicLens();
  else if (view === "item" && itemId) renderItemDetail(itemId);
}

function updateAuthUi() {
  const configured = isSupabaseConfigured();
  const signedIn = Boolean(state.session);
  el.syncBadge.textContent = signedIn ? "Cloud sync on" : configured ? "Sign in to sync" : "Local only";
  el.syncBadge.classList.toggle("sync-on", signedIn);
  el.signInBtn?.classList.toggle("hidden", signedIn);
  el.signOutBtn?.classList.toggle("hidden", !signedIn);
  el.authConfigNote?.classList.toggle("hidden", configured);
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
  el.signInBtn?.addEventListener("click", () => el.authDialog?.showModal());
  el.signOutBtn?.addEventListener("click", async () => {
    await signOut();
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

async function init() {
  loadLocalMeta();
  hydrateCloudFromLocal();
  await initSupabase();
  state.session = await getSession();
  if (state.session?.user?.id) {
    await loadAllCloudNotes(state.session.user.id);
  }
  onAuthStateChange(async (session) => {
    state.session = session;
    updateAuthUi();
    if (session?.user?.id) {
      await loadAllCloudNotes(session.user.id);
    }
    if (state.view === "item" && state.itemId) renderItemDetail(state.itemId);
    else navigate(state.view);
  });

  bindAuth();
  bindAddItem();
  bindSearch();
  bindGlobalClicks();
  updateAuthUi();

  try {
    await loadIndex();
    navigate("desk");
  } catch (err) {
    el.main.innerHTML = `<p class="error">Could not load data/index.json — run <code>python3 scripts/build-index.py</code> and use a local server.<br>${escapeHtml(err.message)}</p>`;
  }
}

init();
