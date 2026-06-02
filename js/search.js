/**
 * Global search: index-backed matching + header autocomplete.
 */

import { formatDisplayDate } from "./date-picker.js";

/** @type {Record<string, { title: string, date: string, tags: string[], threads: string[], text: string }>} */
let searchIndexEntries = {};

export async function loadSearchIndex(fetchUrl) {
  try {
    const res = await fetch(fetchUrl, { cache: "no-cache" });
    if (!res.ok) return;
    const data = await res.json();
    searchIndexEntries = data.entries && typeof data.entries === "object" ? data.entries : {};
  } catch {
    searchIndexEntries = {};
  }
}

export function setSearchIndexEntry(itemId, entry) {
  if (!itemId || !entry) return;
  searchIndexEntries[itemId] = entry;
}

function fallbackHaystack(item, deps) {
  const cloud = deps.getCloudEntry(item.id);
  const localNotes = deps.getGitNotesFromLocal(item.id);
  return [
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
}

function haystackForItem(item, deps) {
  const idx = searchIndexEntries[item.id];
  if (idx?.text) {
    return [
      idx.title,
      idx.date,
      item.id,
      ...(idx.tags || []),
      ...(idx.threads || []),
      idx.text,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }
  return fallbackHaystack(item, deps);
}

export function matchesSearch(item, query, deps) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;
  return haystackForItem(item, deps).includes(q);
}

function scoreItem(item, q, deps) {
  let score = 0;
  const title = (item.title || "").toLowerCase();
  const id = (item.id || "").toLowerCase();
  if (title.startsWith(q)) score += 120;
  else if (title.includes(q)) score += 70;
  if (id.includes(q)) score += 30;
  if ((item.tags || []).some((t) => t.toLowerCase().includes(q))) score += 45;
  if ((item.threads || []).some((t) => t.toLowerCase().includes(q))) score += 35;
  const idx = searchIndexEntries[item.id];
  if (idx?.text?.toLowerCase().includes(q)) score += 25;
  else if (haystackForItem(item, deps).includes(q)) score += 10;
  return score;
}

export function rankSearchResults(items, query, deps, limit = 8) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return items
    .filter((item) => matchesSearch(item, q, deps))
    .map((item) => ({ item, score: scoreItem(item, q, deps) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.item.date || "").localeCompare(a.item.date || "") ||
        (a.item.title || "").localeCompare(b.item.title || "")
    )
    .slice(0, limit)
    .map((row) => row.item);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightMatch(text, query) {
  const raw = escapeHtml(text || "");
  const q = query.trim();
  if (!q) return raw;
  const lower = raw.toLowerCase();
  const qi = lower.indexOf(q.toLowerCase());
  if (qi < 0) return raw;
  return (
    raw.slice(0, qi) +
    "<mark>" +
    raw.slice(qi, qi + q.length) +
    "</mark>" +
    raw.slice(qi + q.length)
  );
}

/**
 * @param {object} opts
 * @param {HTMLInputElement} opts.inputEl
 * @param {HTMLElement} opts.suggestionsEl
 * @param {() => object[]} opts.getItems
 * @param {(query: string) => void} opts.onQueryChange
 * @param {(itemId: string) => void} opts.onSelectItem
 * @param {{ getCloudEntry: Function, getGitNotesFromLocal: Function }} opts.deps
 */
export function bindSearchAutocomplete(opts) {
  const { inputEl, suggestionsEl, getItems, onQueryChange, onSelectItem, deps } = opts;
  if (!inputEl || !suggestionsEl) return;

  let activeIndex = -1;

  const hideSuggestions = () => {
    suggestionsEl.classList.add("hidden");
    suggestionsEl.innerHTML = "";
    activeIndex = -1;
  };

  const renderSuggestions = () => {
    const q = inputEl.value.trim();
    if (!q) {
      hideSuggestions();
      return;
    }
    const matches = rankSearchResults(getItems(), q, deps, 8);
    if (!matches.length) {
      suggestionsEl.innerHTML = `<li class="search-suggestion search-suggestion--empty">No matches</li>`;
      suggestionsEl.classList.remove("hidden");
      activeIndex = -1;
      return;
    }
    suggestionsEl.innerHTML = matches
      .map((item, i) => {
        const tag = (item.tags || [])[0];
        return `<li class="search-suggestion" role="option" data-index="${i}" data-item-id="${item.id}" aria-selected="${i === activeIndex}">
          <span class="search-suggestion-title">${highlightMatch(item.title, q)}</span>
          <span class="search-suggestion-meta">${item.date ? formatDisplayDate(item.date) : ""}${tag ? ` · ${tag}` : ""}</span>
        </li>`;
      })
      .join("");
    suggestionsEl.classList.remove("hidden");
  };

  const selectSuggestion = (itemId) => {
    hideSuggestions();
    onSelectItem(itemId);
  };

  inputEl.addEventListener("input", () => {
    onQueryChange(inputEl.value);
    renderSuggestions();
  });

  inputEl.addEventListener("focus", () => {
    if (inputEl.value.trim()) renderSuggestions();
  });

  inputEl.addEventListener("keydown", (e) => {
    const rows = [...suggestionsEl.querySelectorAll(".search-suggestion[data-item-id]")];
    if (!rows.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, rows.length - 1);
      rows.forEach((row, i) => row.setAttribute("aria-selected", String(i === activeIndex)));
      rows[activeIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      rows.forEach((row, i) => row.setAttribute("aria-selected", String(i === activeIndex)));
      rows[activeIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectSuggestion(rows[activeIndex].dataset.itemId);
    } else if (e.key === "Escape") {
      hideSuggestions();
    }
  });

  suggestionsEl.addEventListener("mousedown", (e) => {
    const row = e.target.closest(".search-suggestion[data-item-id]");
    if (!row) return;
    e.preventDefault();
    selectSuggestion(row.dataset.itemId);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-combobox")) hideSuggestions();
  });
}
