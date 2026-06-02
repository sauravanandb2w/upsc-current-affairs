/** View renderers for CA Desk */

import { getCloudEntry, getItemMeta, markRevised, toggleStar } from "./ca-store.js";
import { getDueFlashcards, getFlashcards, rateFlashcard, generateFlashcardsFromItem } from "./flashcards.js";
import { noteHtmlToPlainText } from "./rich-notes.js";
import { GIT_SECTIONS } from "./notes-md.js";
import { exportCaAsMarkdown } from "./export-ca.js";

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function startOfMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function renderReviseTodayPanel(ctx, items) {
  const dueCards = getDueFlashcards().slice(0, 5);
  const starred = items.filter((i) => getItemMeta(i.id).starred).slice(0, 5);
  const reviseStatus = items.filter((i) => i.status === "revise").slice(0, 5);
  const weekAgo = isoDaysAgo(7);
  const stale = items
    .filter((i) => {
      const m = getItemMeta(i.id);
      const lr = m.lastRevisedAt ? new Date(m.lastRevisedAt).getTime() : 0;
      return (i.date || "") >= weekAgo && lr < Date.now() - 7 * 86400000;
    })
    .slice(0, 5);

  const rows = [
    ...dueCards.map((c) => ({ type: "card", id: c.id, label: `🃏 ${c.question.slice(0, 60)}…`, itemId: c.itemId })),
    ...starred.map((i) => ({ type: "item", id: i.id, label: `★ ${i.title}` })),
    ...reviseStatus.map((i) => ({ type: "item", id: i.id, label: `↻ ${i.title}` })),
    ...stale.map((i) => ({ type: "item", id: i.id, label: `📅 ${i.title}` })),
  ].slice(0, 8);

  if (!rows.length) return "";
  return `
    <section class="revise-today-panel">
      <h3>Revise today</h3>
      <ul class="revise-today-list">
        ${rows
          .map(
            (r) =>
              `<li><button type="button" class="revise-today-link" data-revise-type="${r.type}" data-id="${ctx.escapeHtml(r.id)}" ${r.itemId ? `data-item-id="${ctx.escapeHtml(r.itemId)}"` : ""}>${ctx.escapeHtml(r.label)}</button></li>`
          )
          .join("")}
      </ul>
    </section>`;
}

export function renderToday(ctx) {
  const today = todayIso();
  const q = ctx.state.searchQuery.trim();
  let items = ctx.mergedItems().filter((i) => ctx.matchesSearch(i, q));
  const todayItems = items.filter((i) => i.date === today);
  const weekItems = items.filter((i) => (i.date || "") >= isoDaysAgo(7));
  const stats = ctx.deskStats(items);

  ctx.el.main.innerHTML = `
    ${renderReviseTodayPanel(ctx, items)}
    <section class="desk-hero">
      <h2>Today · ${today}</h2>
      <p class="muted">${todayItems.length} item(s) dated today · ${weekItems.length} this week</p>
      <div class="stats-row">
        <div class="stat-chip"><strong>${stats.total}</strong> total</div>
        <div class="stat-chip"><strong>${getDueFlashcards().length}</strong> cards due</div>
        <div class="stat-chip stat-todo"><strong>${stats.todo}</strong> to study</div>
      </div>
    </section>
    <section class="today-section">
      <h3 class="stack-head stack-todo">Today's CA <span>${todayItems.length}</span></h3>
      <div class="timeline">${todayItems.map((i) => ctx.renderItemCard(i)).join("") || '<p class="empty-hint">Nothing dated today — use <strong>+ Add CA</strong> in the header.</p>'}</div>
    </section>
    <section class="today-section">
      <h3 class="stack-head">This week</h3>
      <div class="timeline">${weekItems.slice(0, 10).map((i) => ctx.renderItemCard(i, { compact: true })).join("") || '<p class="muted">Empty</p>'}</div>
    </section>`;

  ctx.bindReviseTodayClicks();
}

export function renderCalendar(ctx) {
  const month = ctx.state.calendarMonth || todayIso().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const startPad = first.getDay();
  const daysInMonth = last.getDate();

  const items = ctx.mergedItems();
  const byDate = new Map();
  for (const item of items) {
    const d = item.date;
    if (!d?.startsWith(month)) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(item);
  }

  let cells = "";
  for (let i = 0; i < startPad; i++) cells += `<div class="cal-cell cal-empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${month}-${String(d).padStart(2, "0")}`;
    const count = byDate.get(iso)?.length || 0;
    cells += `<button type="button" class="cal-cell ${count ? "cal-has-items" : ""}" data-cal-date="${iso}">
      <span class="cal-day">${d}</span>${count ? `<span class="cal-count">${count}</span>` : ""}
    </button>`;
  }

  ctx.el.main.innerHTML = `
    <section class="view-head">
      <h2>Calendar</h2>
      <p class="muted">Days you captured CA — click a day</p>
      <div class="cal-nav">
        <button type="button" class="btn-ghost btn-sm" id="calPrev">←</button>
        <strong>${first.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</strong>
        <button type="button" class="btn-ghost btn-sm" id="calNext">→</button>
      </div>
    </section>
    <div class="cal-grid cal-weekdays">
      <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
    </div>
    <div class="cal-grid">${cells}</div>
    <div id="calDayDetail" class="cal-day-detail"></div>`;

  document.getElementById("calPrev")?.addEventListener("click", () => {
    const d = new Date(y, m - 2, 1);
    ctx.state.calendarMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    renderCalendar(ctx);
  });
  document.getElementById("calNext")?.addEventListener("click", () => {
    const d = new Date(y, m, 1);
    ctx.state.calendarMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    renderCalendar(ctx);
  });

  ctx.el.main.querySelectorAll("[data-cal-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const date = btn.dataset.calDate;
      const dayItems = byDate.get(date) || [];
      const detail = document.getElementById("calDayDetail");
      detail.innerHTML = `<h4>${date}</h4><div class="timeline">${dayItems.map((i) => ctx.renderItemCard(i)).join("") || "<p class='muted'>No items</p>"}</div>`;
    });
  });
}

export function renderThreadDiff(ctx) {
  const thread = (ctx.state.threadDiff || "").trim();
  const items = ctx
    .mergedItems()
    .filter((i) => (i.threads || []).includes(thread))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  ctx.el.main.innerHTML = `
    <section class="view-head">
      <h2>Topic thread timeline</h2>
      <p class="muted">Compare recurring topics across the year (e.g. RBI MPC)</p>
      <div class="topic-filters">
        <label>Thread id <input type="text" id="threadDiffInput" value="${ctx.escapeHtml(thread)}" placeholder="2025-rbi-monetary-policy" /></label>
        <button type="button" class="btn-primary btn-sm" id="threadDiffApply">Apply</button>
      </div>
    </section>
    ${
      thread
        ? `<table class="thread-table">
        <thead><tr><th>Date</th><th>Title</th><th>Summary snippet</th><th>Tags</th></tr></thead>
        <tbody>
          ${items
            .map((i) => {
              const sum = noteHtmlToPlainText(getCloudEntry(i.id).summary || i.summary || "").slice(0, 120);
              return `<tr data-open-item="${ctx.escapeHtml(i.id)}" class="thread-row">
                <td>${ctx.escapeHtml(i.date)}</td>
                <td>${ctx.escapeHtml(i.title)}</td>
                <td>${ctx.escapeHtml(sum)}${sum.length >= 120 ? "…" : ""}</td>
                <td>${(i.tags || []).map((t) => ctx.escapeHtml(t)).join(", ")}</td>
              </tr>`;
            })
            .join("") || "<tr><td colspan='4'>No items — set thread in manifest when adding CA</td></tr>"}
        </tbody>
      </table>`
        : "<p class='muted'>Enter a thread id from your items (manifest threads[]).</p>"
    }`;

  document.getElementById("threadDiffApply")?.addEventListener("click", () => {
    ctx.state.threadDiff = document.getElementById("threadDiffInput")?.value.trim() || "";
    renderThreadDiff(ctx);
  });
}

export function renderDrill(ctx) {
  const due = getDueFlashcards();
  const card = due[0];
  if (!card) {
    ctx.el.main.innerHTML = `
      <section class="view-head"><h2>Flashcard drill</h2>
      <p class="muted">No cards due. Open an item → Generate flashcards from Facts.</p>
      <p class="muted">${getFlashcards().length} total cards in bank.</p></section>`;
    return;
  }

  ctx.state.drillCardId = card.id;
  ctx.el.main.innerHTML = `
    <section class="view-head"><h2>Flashcard drill</h2>
    <p class="muted">${due.length} due · buckets 7 → 365 days</p></section>
    <div class="drill-card">
      <p class="drill-q">${ctx.escapeHtml(card.question)}</p>
      <details class="drill-answer"><summary>Show answer</summary>
        <p>${ctx.escapeHtml(card.answer)}</p>
      </details>
      <div class="drill-actions">
        <button type="button" class="btn-ghost" data-rate="1">Hard</button>
        <button type="button" class="btn-ghost" data-rate="3">OK</button>
        <button type="button" class="btn-primary" data-rate="5">Easy</button>
      </div>
    </div>`;

  ctx.el.main.querySelectorAll("[data-rate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await rateFlashcard(ctx.state.session?.user?.id, card.id, Number(btn.dataset.rate));
      renderDrill(ctx);
    });
  });
}

export function renderMonthly(ctx) {
  const month = ctx.state.monthlyMonth || todayIso().slice(0, 7);
  const items = ctx
    .mergedItems()
    .filter((i) => (i.date || "").startsWith(month))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  ctx.el.main.innerHTML = `
    <section class="view-head">
      <h2>Monthly digest</h2>
      <p class="muted">${items.length} items in ${month}</p>
      <div class="topic-filters">
        <label>Month <input type="month" id="monthlyPicker" value="${month}" /></label>
        <button type="button" class="btn-primary btn-sm" id="monthlyApply">Show</button>
        <button type="button" class="btn-ghost btn-sm" id="monthlyExport">Export MD</button>
        <button type="button" class="btn-ghost btn-sm" id="monthlyPrint">Print</button>
      </div>
    </section>
    <div class="revise-list">
      ${items
        .map((item) => {
          const cloud = getCloudEntry(item.id);
          const git = ctx.getGitSections(item.id, null);
          return `<article class="revise-card">
            <h3>${ctx.escapeHtml(item.date)} — ${ctx.escapeHtml(item.title)}</h3>
            ${cloud.summary ? `<p>${ctx.escapeHtml(noteHtmlToPlainText(cloud.summary).slice(0, 300))}</p>` : ""}
            ${GIT_SECTIONS.map((s) => {
              const t = noteHtmlToPlainText(git[s] || "");
              return t.trim() ? `<p><strong>${s}:</strong> ${ctx.escapeHtml(t.slice(0, 200))}</p>` : "";
            }).join("")}
          </article>`;
        })
        .join("") || "<p class='muted'>No items this month</p>"}
    </div>`;

  document.getElementById("monthlyApply")?.addEventListener("click", () => {
    ctx.state.monthlyMonth = document.getElementById("monthlyPicker")?.value || month;
    renderMonthly(ctx);
  });
  document.getElementById("monthlyExport")?.addEventListener("click", () => {
    exportCaAsMarkdown(ctx.mergedItems(), { month: ctx.state.monthlyMonth || month });
  });
  document.getElementById("monthlyPrint")?.addEventListener("click", () => window.print());
}
