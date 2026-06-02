/**
 * Local CA study activity log (streaks & heatmap).
 * Stored in localStorage; independent of Supabase sync.
 */

const STORAGE_KEY = "upsc-ca-activity-v1";
const DEDUPE_KEY = "upsc-ca-activity-dedupe-v1";
const MIN_NOTE_CHARS = 8;

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (raw && typeof raw === "object" && raw.days) return raw;
  } catch {
    /* ignore */
  }
  return { version: 1, days: {} };
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function loadDedupe() {
  try {
    return JSON.parse(localStorage.getItem(DEDUPE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveDedupe(map) {
  const keys = Object.keys(map);
  if (keys.length > 4000) {
    const sorted = keys.sort().slice(-2500);
    const trimmed = {};
    for (const k of sorted) trimmed[k] = map[k];
    map = trimmed;
  }
  localStorage.setItem(DEDUPE_KEY, JSON.stringify(map));
}

function ensureDay(store, day) {
  if (!store.days[day]) {
    store.days[day] = { n: 0, a: 0, v: 0, s: 0, b: 0 };
  }
  return store.days[day];
}

function dayTotal(counts) {
  return counts.n + counts.a + counts.v + counts.s + counts.b;
}

function notifyActivityUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("upsc-ca-activity-updated"));
  }
}

function bump(kind, amount = 1) {
  const store = loadStore();
  const day = todayKey();
  const counts = ensureDay(store, day);
  counts[kind] = (counts[kind] || 0) + amount;
  saveStore(store);
  notifyActivityUpdated();
  return store;
}

function oncePerDay(dedupeId) {
  const day = todayKey();
  const key = `${dedupeId}:${day}`;
  const map = loadDedupe();
  if (map[key]) return false;
  map[key] = 1;
  saveDedupe(map);
  return true;
}

/** Note field saved with meaningful text (summary or git section). */
export function recordCaNoteActivity(itemId, fieldId, text) {
  if (!String(text || "").trim() || String(text).trim().length < MIN_NOTE_CHARS) return;
  const dedupeId = `n:${itemId}:${fieldId}`;
  if (!oncePerDay(dedupeId)) return;
  bump("n");
}

export function recordCaAddActivity(itemId) {
  if (!oncePerDay(`a:${itemId}`)) return;
  bump("a");
}

export function recordCaViewActivity(itemId) {
  if (!oncePerDay(`v:${itemId}`)) return;
  bump("v");
}

export function recordCaStatusActivity(itemId) {
  if (!oncePerDay(`s:${itemId}`)) return;
  bump("s");
}

export function recordCaStarActivity(itemId) {
  if (!oncePerDay(`b:${itemId}`)) return;
  bump("b");
}

export function getActivitySummary() {
  const store = loadStore();
  const days = store.days || {};
  const dayKeys = Object.keys(days).sort();
  const today = todayKey();

  let currentStreak = 0;
  const cursor = new Date();
  for (;;) {
    const key = todayKey(cursor);
    const total = dayTotal(days[key] || {});
    if (total > 0) {
      currentStreak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (key === today) {
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
    if (currentStreak > 4000) break;
  }

  let longestStreak = 0;
  let run = 0;
  if (dayKeys.length) {
    const start = new Date(dayKeys[0] + "T12:00:00");
    const end = new Date(dayKeys[dayKeys.length - 1] + "T12:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = todayKey(d);
      if (dayTotal(days[key] || {}) > 0) {
        run += 1;
        longestStreak = Math.max(longestStreak, run);
      } else {
        run = 0;
      }
    }
  }
  longestStreak = Math.max(longestStreak, currentStreak);

  let totalNotes = 0;
  let totalAdds = 0;
  let totalViews = 0;
  let totalStatus = 0;
  let activeDays = 0;
  let weekTotal = 0;
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);

  for (const [key, counts] of Object.entries(days)) {
    const t = dayTotal(counts);
    if (t > 0) activeDays += 1;
    totalNotes += counts.n;
    totalAdds += counts.a;
    totalStatus += counts.s;
    totalViews += counts.v;
    const d = new Date(key + "T12:00:00");
    if (d >= weekAgo) weekTotal += t;
  }

  return {
    today,
    currentStreak,
    longestStreak,
    activeDays,
    totalNotes,
    totalAdds,
    totalStatus,
    totalViews,
    weekTotal,
    days,
  };
}

export function getHeatmapGrid(weekCount = 26) {
  const { days } = getActivitySummary();
  const today = new Date();
  const todayD = today.getDay();
  const mondayOffset = todayD === 0 ? -6 : 1 - todayD;
  const endMonday = new Date(today);
  endMonday.setDate(today.getDate() + mondayOffset);
  endMonday.setHours(12, 0, 0, 0);

  const startMonday = new Date(endMonday);
  startMonday.setDate(startMonday.getDate() - (weekCount - 1) * 7);

  const weeks = [];
  for (let w = 0; w < weekCount; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const cell = new Date(startMonday);
      cell.setDate(startMonday.getDate() + w * 7 + d);
      const key = todayKey(cell);
      const counts = days[key] || { n: 0, a: 0, v: 0, s: 0, b: 0 };
      const total = dayTotal(counts);
      week.push({
        date: key,
        total,
        level: levelForTotal(total),
        counts,
        isFuture: cell > today,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

function levelForTotal(total) {
  if (total <= 0) return 0;
  if (total <= 2) return 1;
  if (total <= 5) return 2;
  if (total <= 9) return 3;
  return 4;
}

/** Bootstrap from existing local cloud/git notes if activity log is empty. */
export function seedActivityFromExistingNotes() {
  const store = loadStore();
  if (Object.keys(store.days).length > 0) return false;

  let noteFields = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("upsc-ca-cloud-")) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "{}");
      if (String(parsed.summary || "").trim().length >= MIN_NOTE_CHARS) noteFields += 1;
      const git = parsed.gitNotes || {};
      for (const val of Object.values(git)) {
        if (String(val || "").trim().length >= MIN_NOTE_CHARS) noteFields += 1;
      }
    } catch {
      /* ignore */
    }
  }

  if (noteFields === 0) return false;

  const day = todayKey();
  const counts = ensureDay(store, day);
  counts.n = Math.min(noteFields, 40);
  saveStore(store);
  notifyActivityUpdated();
  return true;
}
