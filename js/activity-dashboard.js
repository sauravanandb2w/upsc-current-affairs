import {
  getActivitySummary,
  getHeatmapGrid,
  seedActivityFromExistingNotes,
} from "./activity-tracker.js";

const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatTooltip(cell) {
  if (!cell || cell.isFuture) return "";
  const { counts, date, total } = cell;
  if (total === 0) return `${date}: no activity`;
  const parts = [];
  if (counts.n) parts.push(`${counts.n} note save${counts.n === 1 ? "" : "s"}`);
  if (counts.a) parts.push(`${counts.a} CA added`);
  if (counts.s) parts.push(`${counts.s} status update${counts.s === 1 ? "" : "s"}`);
  if (counts.v) parts.push(`${counts.v} item opened`);
  if (counts.b) parts.push(`${counts.b} star toggle${counts.b === 1 ? "" : "s"}`);
  return `${date}: ${parts.join(" · ")}`;
}

function monthLabelsForWeeks(weeks) {
  const labels = [];
  let lastMonth = -1;
  for (const week of weeks) {
    const monday = week[0];
    if (!monday || monday.isFuture) {
      labels.push("");
      continue;
    }
    const d = new Date(monday.date + "T12:00:00");
    const m = d.getMonth();
    if (m !== lastMonth) {
      labels.push(MONTHS[m]);
      lastMonth = m;
    } else {
      labels.push("");
    }
  }
  return labels;
}

function renderHeatmap(weeks) {
  const monthLabels = monthLabelsForWeeks(weeks);
  const monthRow = monthLabels
    .map((label) => `<span class="activity-month">${escapeHtml(label)}</span>`)
    .join("");

  const gridRows = WEEKDAY_LABELS.map((label, rowIdx) => {
    const cells = weeks
      .map((week) => {
        const cell = week[rowIdx];
        const tip = formatTooltip(cell);
        const cls = [
          "activity-cell",
          `activity-level-${cell.level}`,
          cell.isFuture ? "activity-cell--future" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<span class="${cls}" role="img" aria-label="${escapeHtml(tip)}" title="${escapeHtml(tip)}"></span>`;
      })
      .join("");
    return `<div class="activity-row"><span class="activity-wday">${escapeHtml(label)}</span><div class="activity-week">${cells}</div></div>`;
  }).join("");

  return `
    <div class="activity-heatmap-wrap">
      <div class="activity-months" aria-hidden="true"><span class="activity-wday activity-wday--spacer"></span><div class="activity-months-track">${monthRow}</div></div>
      ${gridRows}
    </div>
  `;
}

function statCard(label, value, hint) {
  return `
    <article class="activity-stat">
      <p class="activity-stat-value">${escapeHtml(String(value))}</p>
      <p class="activity-stat-label">${escapeHtml(label)}</p>
      ${hint ? `<p class="activity-stat-hint">${escapeHtml(hint)}</p>` : ""}
    </article>
  `;
}

export function renderActivityDashboard(container) {
  if (!container) return;

  const seeded = seedActivityFromExistingNotes();
  const summary = getActivitySummary();
  const weeks = getHeatmapGrid(26);

  const streakLabel =
    summary.currentStreak === 0
      ? "Start today — add a CA or save a note"
      : summary.currentStreak === 1
        ? "1 day in a row"
        : `${summary.currentStreak} days in a row`;

  container.innerHTML = `
    <section class="activity-dashboard" aria-label="Study progress">
      <div class="paper-meta">
        <h2>Daily tracker</h2>
        <p>Notes, new items, and opens — a contribution graph for your current affairs prep.</p>
      </div>
      ${
        seeded
          ? `<p class="activity-seed-note">Imported your existing local notes into today’s activity.</p>`
          : ""
      }
      <div class="activity-streak-banner">
        <span class="activity-streak-flame" aria-hidden="true">🔥</span>
        <div>
          <p class="activity-streak-main">${escapeHtml(streakLabel)}</p>
          <p class="activity-streak-sub">Longest streak: ${summary.longestStreak} day${summary.longestStreak === 1 ? "" : "s"} · ${summary.activeDays} active day${summary.activeDays === 1 ? "" : "s"} total</p>
        </div>
      </div>
      <div class="activity-stats-grid">
        ${statCard("This week", summary.weekTotal, "All tracked events")}
        ${statCard("Note saves", summary.totalNotes, "Summary + git sections")}
        ${statCard("CA added", summary.totalAdds, "New items captured")}
        ${statCard("Items opened", summary.totalViews, "Unique per day")}
      </div>
      <div class="activity-heatmap-section">
        <h3 class="activity-section-title">Last 26 weeks</h3>
        <p class="activity-legend">
          <span>Less</span>
          <span class="activity-cell activity-level-0" aria-hidden="true"></span>
          <span class="activity-cell activity-level-1" aria-hidden="true"></span>
          <span class="activity-cell activity-level-2" aria-hidden="true"></span>
          <span class="activity-cell activity-level-3" aria-hidden="true"></span>
          <span class="activity-cell activity-level-4" aria-hidden="true"></span>
          <span>More</span>
        </p>
        ${renderHeatmap(weeks)}
      </div>
      <details class="activity-how">
        <summary>What counts as activity?</summary>
        <ul>
          <li><strong>Notes</strong> — once per field per day when you save meaningful text (8+ characters).</li>
          <li><strong>CA added</strong> — capturing a new current affairs item.</li>
          <li><strong>Opens</strong> — opening an item page (once per item per day).</li>
          <li><strong>Status / stars</strong> — changing workflow status or starring an item.</li>
        </ul>
        <p class="activity-how-foot">Stored on this device only.</p>
      </details>
    </section>
  `;
}
