/** Tag / thread pickers for Topic lens & Thread views. */

function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

export function collectAllTags(items) {
  const counts = new Map();
  for (const item of items) {
    for (const raw of item.tags || []) {
      const tag = String(raw).trim();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

export function collectAllThreads(items) {
  const counts = new Map();
  for (const item of items) {
    for (const raw of item.threads || []) {
      const thread = String(raw).trim();
      if (!thread) continue;
      counts.set(thread, (counts.get(thread) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([thread]) => thread);
}

export function renderTagSelectOptions(tags, selected, { emptyLabel = "All tags" } = {}) {
  const parts = [`<option value="">${escapeAttr(emptyLabel)}</option>`];
  const known = new Set(tags);
  if (selected && !known.has(selected)) {
    parts.push(`<option value="${escapeAttr(selected)}" selected>${escapeAttr(selected)}</option>`);
  }
  for (const tag of tags) {
    parts.push(
      `<option value="${escapeAttr(tag)}"${tag === selected ? " selected" : ""}>${escapeAttr(tag)}</option>`
    );
  }
  return parts.join("");
}

export function renderThreadSelectOptions(threads, selected, { emptyLabel = "Choose a thread…" } = {}) {
  const parts = [`<option value="">${escapeAttr(emptyLabel)}</option>`];
  const known = new Set(threads);
  if (selected && !known.has(selected)) {
    parts.push(`<option value="${escapeAttr(selected)}" selected>${escapeAttr(selected)}</option>`);
  }
  for (const thread of threads) {
    parts.push(
      `<option value="${escapeAttr(thread)}"${thread === selected ? " selected" : ""}>${escapeAttr(thread)}</option>`
    );
  }
  return parts.join("");
}
