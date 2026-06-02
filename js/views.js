/** View renderers for CA Desk */

import { getCloudEntry, getItemMeta, markRevised, toggleStar } from "./ca-store.js";
import {
  getDueFlashcards,
  getDrillDeck,
  getFlashcards,
  isCardDue,
  formatNextReview,
  cardThemeIndex,
  rateFlashcard,
} from "./flashcards.js";
import { noteHtmlToPlainText } from "./rich-notes.js";
import { GIT_SECTIONS } from "./notes-md.js";
import { exportCaAsMarkdown } from "./export-ca.js";
import { collectAllThreads, renderThreadSelectOptions } from "./filter-options.js";

function formatTodayHeading(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

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
  const items = ctx.mergedItems().filter((i) => ctx.matchesSearch(i, q));
  const todayItems = items.filter((i) => i.date === today);
  const weekItems = items
    .filter((i) => (i.date || "") >= isoDaysAgo(7) && i.date !== today)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const stats = ctx.deskStats(items);
  const dueCards = getDueFlashcards().length;
  const heading = formatTodayHeading(today);

  const subline = [
    stats.total ? `${stats.total} in desk` : null,
    stats.todo ? `${stats.todo} to study` : null,
    stats.revise ? `${stats.revise} to revise` : null,
    dueCards ? `${dueCards} cards due` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  let body = "";

  if (!todayItems.length && !weekItems.length) {
    body = `
      <section class="empty-state empty-state--hero">
        <p class="empty-state-title">Nothing captured yet</p>
        <p class="empty-state-desc">Use <strong>+ Add CA</strong> in the header when you read something worth noting.</p>
      </section>`;
  } else {
    if (todayItems.length) {
      body += `
        <section class="content-block">
          <h3 class="content-block-title">Today <span class="count-pill">${todayItems.length}</span></h3>
          <div class="timeline">${todayItems.map((i) => ctx.renderItemCard(i)).join("")}</div>
        </section>`;
    } else {
      body += `
        <section class="content-block content-block--quiet">
          <p class="empty-inline">No CA dated today — add one with <strong>+ Add CA</strong>.</p>
        </section>`;
    }

    if (weekItems.length) {
      body += `
        <section class="content-block">
          <h3 class="content-block-title">Earlier this week <span class="count-pill">${weekItems.length}</span></h3>
          <div class="timeline timeline--compact">${weekItems.slice(0, 8).map((i) => ctx.renderItemCard(i, { compact: true })).join("")}</div>
        </section>`;
    }
  }

  ctx.el.main.innerHTML = `
    ${renderReviseTodayPanel(ctx, items)}
    <header class="today-hero">
      <h2>${ctx.escapeHtml(heading)}</h2>
      ${subline ? `<p class="today-subline">${ctx.escapeHtml(subline)}</p>` : ""}
    </header>
    ${body}`;

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
  const q = ctx.state.searchQuery.trim();
  const allItems = ctx.mergedItems().filter((i) => ctx.matchesSearch(i, q));
  const threadOptions = collectAllThreads(allItems);
  let thread = (ctx.state.threadDiff || "").trim();
  if (!thread && threadOptions.length === 1) {
    ctx.state.threadDiff = threadOptions[0];
    thread = threadOptions[0];
  }
  const items = allItems
    .filter((i) => thread && (i.threads || []).includes(thread))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  ctx.el.main.innerHTML = `
    <section class="view-head">
      <h2>Thread timeline</h2>
      <p class="view-desc">Follow a recurring story across the year — e.g. RBI MPC meetings.</p>
      <div class="filter-bar">
        <label class="filter-field filter-field--wide"><span>Thread</span>
          <select id="threadDiffSelect" aria-label="Choose thread">
            ${renderThreadSelectOptions(threadOptions, thread)}
          </select>
        </label>
      </div>
      ${thread ? `<p class="filter-result">${items.length} item${items.length === 1 ? "" : "s"} in <code>${ctx.escapeHtml(thread)}</code></p>` : ""}
    </section>
    ${
      !thread
        ? `<p class="empty-state">Pick a thread from the dropdown — set threads when adding CA.</p>`
        : items.length
          ? `<div class="thread-timeline">
              ${items
                .map((i) => {
                  const sum = noteHtmlToPlainText(getCloudEntry(i.id).summary || i.summary || "").slice(0, 160);
                  return `<article class="thread-card" data-open-item="${ctx.escapeHtml(i.id)}">
                    <time>${ctx.escapeHtml(i.date)}</time>
                    <h3>${ctx.escapeHtml(i.title)}</h3>
                    ${sum ? `<p class="thread-snippet">${ctx.escapeHtml(sum)}${sum.length >= 160 ? "…" : ""}</p>` : ""}
                    <div class="thread-card-tags">${(i.tags || []).map((t) => `<span class="badge badge-tag">${ctx.escapeHtml(t)}</span>`).join("")}</div>
                  </article>`;
                })
                .join("")}
            </div>`
          : `<p class="empty-state">No items with this thread — add <code>threads[]</code> in the item manifest.</p>`
    }`;

  document.getElementById("threadDiffSelect")?.addEventListener("change", (e) => {
    ctx.state.threadDiff = e.target.value.trim();
    renderThreadDiff(ctx);
  });
}

export function renderDrill(ctx) {
  const deck = getDrillDeck();
  const dueCount = getDueFlashcards().length;
  const total = getFlashcards().length;

  if (!total) {
    ctx.el.main.innerHTML = `
      <section class="view-head drill-head">
        <h2>Flashcard drill</h2>
        <p class="view-desc">Quick recall from your CA notes — one bullet becomes one card.</p>
      </section>
      <div class="drill-empty">
        <div class="drill-empty-icon" aria-hidden="true">🃏</div>
        <p class="drill-empty-title">No cards yet</p>
        <ol class="drill-empty-steps">
          <li>Open any CA item</li>
          <li>Add bullet points under <strong>Facts</strong> or <strong>Exam angle</strong></li>
          <li>Click <strong>Generate flashcards</strong></li>
        </ol>
      </div>`;
    return;
  }

  if (ctx.state.drillIndex >= deck.length) ctx.state.drillIndex = 0;
  if (ctx.state.drillIndex < 0) ctx.state.drillIndex = 0;
  const card = deck[ctx.state.drillIndex % deck.length];
  const themeIdx = cardThemeIndex(card);
  const due = isCardDue(card);
  const item = ctx.mergedItems().find((i) => i.id === card.itemId);
  const itemTitle = item?.title || card.itemId;
  const practiceNote =
    dueCount === 0
      ? `<p class="drill-practice-note">All caught up — still practicing the full deck (${total} cards).</p>`
      : "";

  ctx.state.drillCardId = card.id;
  ctx.el.main.innerHTML = `
    <section class="view-head drill-head">
      <h2>Flashcard drill</h2>
      <p class="muted drill-stats">
        <span class="drill-stat drill-stat--due"><strong>${dueCount}</strong> due</span>
        <span class="drill-stat"><strong>${total}</strong> in deck</span>
        <span class="drill-stat">Card ${(ctx.state.drillIndex % deck.length) + 1} of ${deck.length}</span>
      </p>
      ${practiceNote}
    </section>

    <div class="drill-stage">
      <article
        class="flash-card flash-card--theme-${themeIdx}${due ? " flash-card--due" : ""}"
        id="flashCard"
        data-flipped="false"
        tabindex="0"
        aria-label="Flashcard — tap to flip"
      >
        <div class="flash-card-inner">
          <div class="flash-card-face flash-card-front">
            <span class="flash-card-label">Question</span>
            <p class="flash-card-text">${ctx.escapeHtml(card.question)}</p>
            <span class="flash-card-hint">Tap to reveal answer</span>
          </div>
          <div class="flash-card-face flash-card-back">
            <span class="flash-card-label">Answer</span>
            <p class="flash-card-text">${ctx.escapeHtml(card.answer)}</p>
            <span class="flash-card-hint">Tap to hide</span>
          </div>
        </div>
        <div class="flash-card-meta">
          <span class="flash-card-badge ${due ? "flash-card-badge--due" : "flash-card-badge--later"}">${ctx.escapeHtml(formatNextReview(card))}</span>
          <button type="button" class="flash-card-source" data-open-item="${ctx.escapeHtml(card.itemId)}">${ctx.escapeHtml(itemTitle)}</button>
          ${card.month ? `<span class="flash-card-month">${ctx.escapeHtml(card.month)}</span>` : ""}
        </div>
      </article>

      <div class="drill-actions drill-actions--rated hidden" id="drillRateRow">
        <span class="drill-rate-label">How well did you recall it?</span>
        <button type="button" class="drill-rate-btn drill-rate-btn--hard" data-rate="1">Hard</button>
        <button type="button" class="drill-rate-btn drill-rate-btn--ok" data-rate="3">OK</button>
        <button type="button" class="drill-rate-btn drill-rate-btn--easy" data-rate="5">Easy</button>
      </div>
      <p class="drill-flip-prompt muted" id="drillFlipPrompt">Flip the card to see the answer, then rate yourself.</p>
    </div>

    <section class="drill-deck-section">
      <h3 class="drill-deck-title">Your deck</h3>
      <div class="drill-deck-strip" role="list">
        ${deck
          .map((c, i) => {
            const active = i === ctx.state.drillIndex % deck.length;
            const chipDue = isCardDue(c);
            const ti = cardThemeIndex(c);
            const short = c.answer.slice(0, 42) + (c.answer.length > 42 ? "…" : "");
            return `<button
              type="button"
              class="drill-deck-chip drill-deck-chip--theme-${ti}${active ? " active" : ""}${chipDue ? " due" : ""}"
              data-drill-pick="${i}"
              role="listitem"
              title="${ctx.escapeHtml(c.question)}"
            >
              <span class="drill-deck-chip-num">${i + 1}</span>
              <span class="drill-deck-chip-text">${ctx.escapeHtml(short)}</span>
            </button>`;
          })
          .join("")}
      </div>
    </section>`;

  const flashEl = document.getElementById("flashCard");
  const rateRow = document.getElementById("drillRateRow");
  const flipPrompt = document.getElementById("drillFlipPrompt");

  const setFlipped = (on) => {
    flashEl.dataset.flipped = on ? "true" : "false";
    rateRow.classList.toggle("hidden", !on);
    flipPrompt.classList.toggle("hidden", on);
  };

  const toggleFlip = () => setFlipped(flashEl.dataset.flipped !== "true");

  flashEl?.addEventListener("click", (e) => {
    if (e.target.closest(".flash-card-source")) return;
    toggleFlip();
  });
  flashEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleFlip();
    }
  });

  ctx.el.main.querySelectorAll("[data-rate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await rateFlashcard(ctx.state.session?.user?.id, card.id, Number(btn.dataset.rate));
      ctx.state.drillIndex = (ctx.state.drillIndex + 1) % deck.length;
      renderDrill(ctx);
    });
  });

  ctx.el.main.querySelectorAll("[data-drill-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ctx.state.drillIndex = Number(btn.dataset.drillPick);
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
