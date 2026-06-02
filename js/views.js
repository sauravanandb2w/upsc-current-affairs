/** View renderers for CA Desk */

import { getCloudEntry, getItemMeta, markRevised, toggleStar } from "./ca-store.js";
import {
  getDueFlashcards,
  getDrillDeck,
  getFlashcards,
  isCardDue,
  formatNextReview,
  cardThemeIndex,
  getFlashcards,
  rateFlashcard,
  removeFlashcard,
} from "./flashcards.js";
import { noteHtmlToPlainText } from "./rich-notes.js?v=27";
import { GIT_SECTIONS } from "./notes-md.js";
import { mountMonthPicker, formatDisplayDate, formatDisplayMonth, effectiveItemDate, isValidIsoDate } from "./date-picker.js";
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
  const todayItems = items.filter((i) => effectiveItemDate(i) === today);
  const weekItems = items
    .filter((i) => {
      const d = effectiveItemDate(i);
      return d >= isoDaysAgo(7) && d !== today;
    })
    .sort((a, b) => effectiveItemDate(b).localeCompare(effectiveItemDate(a)));
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
    const d = effectiveItemDate(item);
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
      detail.innerHTML = `<h4>${ctx.escapeHtml(formatDisplayDate(date))}</h4><div class="timeline">${dayItems.map((i) => ctx.renderItemCard(i)).join("") || "<p class='muted'>No items</p>"}</div>`;
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
                    <time datetime="${ctx.escapeHtml(i.date)}">${ctx.escapeHtml(formatDisplayDate(i.date))}</time>
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
        <button type="button" class="flash-card-delete" id="flashCardDelete" title="Remove this card" aria-label="Remove this flashcard">×</button>
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
            return `<div class="drill-deck-chip-wrap" role="listitem">
              <button
              type="button"
              class="drill-deck-chip drill-deck-chip--theme-${ti}${active ? " active" : ""}${chipDue ? " due" : ""}"
              data-drill-pick="${i}"
              title="${ctx.escapeHtml(c.question)}"
            >
              <span class="drill-deck-chip-num">${i + 1}</span>
              <span class="drill-deck-chip-text">${ctx.escapeHtml(short)}</span>
            </button>
            <button type="button" class="drill-deck-chip-delete" data-drill-delete="${ctx.escapeHtml(c.id)}" title="Remove card" aria-label="Remove flashcard">×</button>
            </div>`;
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

  async function deleteFlashcardById(cardId) {
    if (!confirm("Remove this flashcard from your deck?")) return;
    await removeFlashcard(cardId, ctx.state.session?.user?.id);
    const remaining = getDrillDeck();
    if (!remaining.length) {
      renderDrill(ctx);
      return;
    }
    if (ctx.state.drillIndex >= remaining.length) ctx.state.drillIndex = 0;
    renderDrill(ctx);
  }

  flashEl?.addEventListener("click", (e) => {
    if (e.target.closest(".flash-card-source, .flash-card-delete")) return;
    toggleFlip();
  });
  flashEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleFlip();
    }
  });

  document.getElementById("flashCardDelete")?.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteFlashcardById(card.id);
  });

  ctx.el.main.querySelectorAll("[data-drill-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteFlashcardById(btn.dataset.drillDelete);
    });
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
  const allItems = ctx.mergedItems().filter((i) => isValidIsoDate(effectiveItemDate(i)));
  const mode = ctx.state.monthlyMode || "last30";
  let month = ctx.state.monthlyMonth || todayIso().slice(0, 7);

  if (mode === "month" && !allItems.some((i) => effectiveItemDate(i).startsWith(month))) {
    const latest = allItems
      .map((i) => effectiveItemDate(i))
      .sort((a, b) => b.localeCompare(a))[0];
    if (latest) month = latest.slice(0, 7);
    ctx.state.monthlyMonth = month;
  }

  const from30 = isoDaysAgo(30);
  const toToday = todayIso();
  let items;
  let periodLabel;

  if (mode === "last30") {
    items = allItems
      .filter((i) => {
        const d = effectiveItemDate(i);
        return d >= from30 && d <= toToday;
      })
      .sort((a, b) => effectiveItemDate(a).localeCompare(effectiveItemDate(b)));
    periodLabel = `Last 30 days (${formatDisplayDate(from30)} → ${formatDisplayDate(toToday)})`;
  } else {
    items = allItems
      .filter((i) => effectiveItemDate(i).startsWith(month))
      .sort((a, b) => effectiveItemDate(a).localeCompare(effectiveItemDate(b)));
    periodLabel = formatDisplayMonth(month);
  }

  const tagSet = new Set();
  items.forEach((i) => (i.tags || []).forEach((t) => tagSet.add(t)));
  const flashInPeriod = getFlashcards().filter((c) => {
    if (mode === "last30") return true;
    return (c.month || "") === month;
  }).length;

  const weekGroups = new Map();
  for (const item of items) {
    const d = effectiveItemDate(item);
    const dt = new Date(`${d}T12:00:00`);
    const weekStart = new Date(dt);
    weekStart.setDate(dt.getDate() - dt.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    if (!weekGroups.has(key)) weekGroups.set(key, []);
    weekGroups.get(key).push(item);
  }

  function renderMonthlyCard(item) {
    const cloud = getCloudEntry(item.id);
    const git = ctx.getGitSections(item.id, null);
    const d = effectiveItemDate(item);
    const summary = noteHtmlToPlainText(cloud.summary || "").trim();
    const facts = noteHtmlToPlainText(git.Facts || "").trim();
    const exam = noteHtmlToPlainText(git["Exam angle"] || "").trim();
    const bullets = [];
    for (const line of (facts || exam).split(/\n+/)) {
      const t = line.replace(/^[-*•]\s*/, "").trim();
      if (t.length > 8) bullets.push(t);
      if (bullets.length >= 3) break;
    }
    const meta = getItemMeta(item.id);
    return `<article class="monthly-card${meta.starred ? " monthly-card--starred" : ""}" data-open-item="${ctx.escapeHtml(item.id)}">
      <header class="monthly-card-head">
        <time datetime="${ctx.escapeHtml(d)}">${ctx.escapeHtml(formatDisplayDate(d))}</time>
        ${meta.starred ? '<span class="monthly-star" title="Starred">★</span>' : ""}
        <span class="status-pill ${ctx.escapeHtml(item.status || "to-study")}">${ctx.escapeHtml(item.status || "to-study")}</span>
      </header>
      <h3 class="monthly-card-title">${ctx.escapeHtml(item.title)}</h3>
      ${summary ? `<p class="monthly-card-summary">${ctx.escapeHtml(summary.slice(0, 220))}${summary.length > 220 ? "…" : ""}</p>` : ""}
      ${
        bullets.length
          ? `<ul class="monthly-card-bullets">${bullets.map((b) => `<li>${ctx.escapeHtml(b.slice(0, 120))}${b.length > 120 ? "…" : ""}</li>`).join("")}</ul>`
          : ""
      }
      ${item.tags?.length ? `<div class="monthly-card-tags">${item.tags.map((t) => `<span class="badge badge-tag">${ctx.escapeHtml(t)}</span>`).join("")}</div>` : ""}
      <button type="button" class="btn-ghost btn-sm monthly-open-btn" data-open-item="${ctx.escapeHtml(item.id)}">Open full notes →</button>
    </article>`;
  }

  const weekBlocks = [...weekGroups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, weekItems]) => {
      const end = new Date(`${weekStart}T12:00:00`);
      end.setDate(end.getDate() + 6);
      const label = `${formatDisplayDate(weekStart)} – ${formatDisplayDate(end.toISOString().slice(0, 10))}`;
      return `<section class="monthly-week">
        <h3 class="monthly-week-head">Week of ${ctx.escapeHtml(label)} <span class="count-pill">${weekItems.length}</span></h3>
        <div class="monthly-week-grid">${weekItems.map(renderMonthlyCard).join("")}</div>
      </section>`;
    })
    .join("");

  ctx.el.main.innerHTML = `
    <section class="monthly-hero">
      <h2>Monthly consolidation</h2>
      <p class="view-desc">One scrollable digest of recent CA — summaries and key facts for prelims-style revision.</p>
      <div class="monthly-presets" role="tablist">
        <button type="button" class="monthly-preset${mode === "last30" ? " active" : ""}" data-monthly-mode="last30">Last 30 days</button>
        <button type="button" class="monthly-preset${mode === "month" ? " active" : ""}" data-monthly-mode="month">By month</button>
      </div>
      ${
        mode === "month"
          ? `<div class="monthly-month-row">
              <label class="filter-field filter-field--month">Month <div id="monthlyPickerMount" class="month-picker-slot"></div></label>
            </div>`
          : ""
      }
      <div class="monthly-stats">
        <div class="monthly-stat"><strong>${items.length}</strong> items</div>
        <div class="monthly-stat"><strong>${tagSet.size}</strong> topics</div>
        <div class="monthly-stat"><strong>${flashInPeriod}</strong> flashcards</div>
      </div>
      <p class="muted monthly-period">${ctx.escapeHtml(periodLabel)}</p>
      <div class="monthly-actions">
        <button type="button" class="btn-ghost btn-sm" id="monthlyExport">Export MD</button>
        <button type="button" class="btn-ghost btn-sm" id="monthlyPrint">Print digest</button>
      </div>
    </section>
    ${
      items.length
        ? `<div class="monthly-tip">
            <strong>How to use:</strong> Skim each week top-to-bottom once. Star weak items on the item page, then run <em>Drill</em> for flashcards.
          </div>
          <div class="monthly-body">${weekBlocks}</div>`
        : `<div class="monthly-empty">
            <p class="empty-state-title">No CA in this period</p>
            <p class="muted">Try <strong>Last 30 days</strong> or pick an earlier month — sample items are dated 2025.</p>
            <button type="button" class="btn-primary btn-sm" data-monthly-mode="month" data-monthly-jump="2025-06">Jump to June 2025</button>
          </div>`
    }`;

  ctx.el.main.querySelectorAll("[data-monthly-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ctx.state.monthlyMode = btn.dataset.monthlyMode;
      renderMonthly(ctx);
    });
  });

  document.querySelector("[data-monthly-jump]")?.addEventListener("click", (e) => {
    ctx.state.monthlyMode = "month";
    ctx.state.monthlyMonth = e.target.dataset.monthlyJump;
    renderMonthly(ctx);
  });

  if (mode === "month") {
    mountMonthPicker(document.getElementById("monthlyPickerMount"), {
      value: month,
      onChange(ym) {
        ctx.state.monthlyMonth = ym;
        renderMonthly(ctx);
      },
    });
  }

  document.getElementById("monthlyExport")?.addEventListener("click", () => {
    if (mode === "last30") {
      exportCaAsMarkdown(allItems, { fromDate: from30, toDate: toToday });
    } else {
      exportCaAsMarkdown(allItems, { month });
    }
  });
  document.getElementById("monthlyPrint")?.addEventListener("click", () => window.print());
}
