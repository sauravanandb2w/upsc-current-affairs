import { assetUrl, repoBase } from "./paths.js";
import {
  parseNotesMd,
  serializeNotesMd,
  GIT_SECTIONS,
  emptyGitSections,
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

/** @type {{ items: object[], session: import('@supabase/supabase-js').Session | null }} */
const state = {
  items: [],
  session: null,
  view: "desk",
  itemId: null,
  topicYear: new Date().getFullYear(),
  topicTag: "",
  topicThread: "",
};

const el = {
  syncBadge: document.getElementById("syncBadge"),
  main: document.getElementById("main"),
  nav: document.getElementById("mainNav"),
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

function mergedItems() {
  return state.items.map((item) => mergeCloudWithManifest(item));
}

function itemById(id) {
  return mergedItems().find((i) => i.id === id);
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

function renderLinkRibbon(links) {
  if (!links?.length) {
    return `<p class="muted">No links yet — add below when signed in.</p>`;
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

function renderItemCard(item, { showSummary = true } = {}) {
  const cloud = getCloudEntry(item.id);
  const summary = cloud.summary || item.summary || "";
  const preview = showSummary && summary ? escapeHtml(summary.slice(0, 160)) + (summary.length > 160 ? "…" : "") : "";
  const linkCount = (mergeCloudWithManifest(item).links || []).length;
  return `
    <article class="ca-card ${statusClass(item.status)}" data-open-item="${escapeHtml(item.id)}">
      <div class="ca-card-meta">
        <time>${escapeHtml(item.date || "")}</time>
        ${gsBadges(item.gsPapers)}
        <span class="link-count" title="Links">${linkCount} link${linkCount === 1 ? "" : "s"}</span>
      </div>
      <h3 class="ca-card-title">${escapeHtml(item.title || item.id)}</h3>
      ${preview ? `<p class="ca-card-preview">${preview}</p>` : ""}
      <div class="ca-card-tags">${tagBadges(item.tags)}</div>
    </article>`;
}

async function fetchNotesMd(itemId) {
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
  const items = mergedItems();
  const todo = items.filter((i) => i.status === "to-study");
  const studied = items.filter((i) => i.status === "studied");
  const revise = items.filter((i) => i.status === "revise");

  el.main.innerHTML = `
    <section class="desk-hero">
      <h2>Your CA desk</h2>
      <p class="muted">Curated current affairs — summary & links sync via Supabase; deep notes live in git.</p>
    </section>
    <div class="desk-columns">
      <div class="desk-stack">
        <h3 class="stack-head stack-todo">To study <span>${todo.length}</span></h3>
        ${todo.map((i) => renderItemCard(i)).join("") || '<p class="muted">Empty</p>'}
      </div>
      <div class="desk-stack">
        <h3 class="stack-head stack-studied">Studied <span>${studied.length}</span></h3>
        ${studied.slice(0, 8).map((i) => renderItemCard(i)).join("") || '<p class="muted">Empty</p>'}
      </div>
      <div class="desk-stack">
        <h3 class="stack-head stack-revise">Revise <span>${revise.length}</span></h3>
        ${revise.map((i) => renderItemCard(i)).join("") || '<p class="muted">Empty</p>'}
      </div>
    </div>`;
}

function renderTimeline() {
  const items = mergedItems();
  el.main.innerHTML = `
    <section class="view-head">
      <h2>Timeline</h2>
      <p class="muted">${items.length} items in your bank</p>
    </section>
    <div class="timeline">${items.map((i) => renderItemCard(i)).join("")}</div>`;
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
      <p class="topic-cli muted">CLI: <code>python3 scripts/topic-report.py --year ${state.topicYear} --tag ${escapeHtml(state.topicTag || "TAG")}</code></p>
    </section>
    <div class="topic-results">
      <p><strong>${filtered.length}</strong> matching items</p>
      <div class="timeline">${filtered.map((i) => renderItemCard(i)).join("") || '<p class="muted">No matches — adjust filters or add tags in manifest.json</p>'}</div>
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

  el.main.innerHTML = `
    <button type="button" class="btn-ghost back-btn" id="backBtn">← Back</button>
    <article class="item-spread">
      <header class="item-header">
        <time>${escapeHtml(item.date)}</time>
        <h2>${escapeHtml(item.title)}</h2>
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
          <h3 class="section-label">Gallery</h3>
          <div class="gallery">${images.join("") || '<p class="muted">No images in git yet.</p>'}</div>
        </section>
        <section class="notes-panel">
          <h3 class="section-label">Summary <span class="sync-tag">Supabase</span></h3>
          <textarea class="note-box" id="summaryField" rows="4" ${canEditCloud ? "" : "readonly"} placeholder="What happened — story angle">${escapeHtml(cloud.summary || item.summary || "")}</textarea>

          <h3 class="section-label">Sources <span class="sync-tag">Supabase</span></h3>
          <div id="sourcesList" class="sources-list"></div>
          ${
            canEditCloud
              ? `<button type="button" class="btn-ghost btn-sm" id="addSourceBtn">+ Source row</button>`
              : ""
          }

          <h3 class="section-label">Deep notes <span class="sync-tag git-tag">Git · notes.md</span></h3>
          <p class="muted small">Edit here (saved in browser). Commit <code>notes.md</code> via git push from laptop.</p>
          ${GIT_SECTIONS.map(
            (sec) => `
            <label class="note-label">${escapeHtml(sec)}</label>
            <textarea class="note-box git-note" data-section="${escapeHtml(sec)}" rows="5">${escapeHtml(sections[sec] || "")}</textarea>`
          ).join("")}
        </section>
      </div>
    </article>`;

  document.getElementById("backBtn")?.addEventListener("click", () => navigate(state.view === "item" ? "timeline" : state.view));

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
      document.querySelectorAll(".git-note").forEach((el) => {
        next[el.dataset.section] = el.value;
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
      row.querySelectorAll("input, select").forEach((el) => el.addEventListener("input", sync));
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
      row.querySelectorAll("input, select").forEach((el) => el.addEventListener("input", sync));
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

function navigate(view, itemId = null) {
  state.view = view;
  state.itemId = itemId;
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  if (view === "desk") renderDesk();
  else if (view === "timeline") renderTimeline();
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
