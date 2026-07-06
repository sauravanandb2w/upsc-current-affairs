/**
 * Supabase + localStorage sync for Mains theme notes (per theme_id).
 */

import { getSupabase, isSupabaseConfigured } from "./supabase-client.js";
import { THEME_SECTIONS, sectionPlainLength, emptyThemeSections } from "./theme-notes-md.js";

const LS_PREFIX = "ca-theme:";
const LS_CATALOG_THEMES = "ca-custom-themes-v2";
const LS_CATALOG_CATEGORIES = "ca-custom-categories-v1";
const LS_CATALOG_SUBCATEGORIES = "ca-custom-subcategories-v1";
const DEBOUNCE_MS = 700;
const CATALOG_DEBOUNCE_MS = 700;

const saveTimers = new Map();
let syncUserId = null;
let themeCache = {};
let catalogSyncUserId = null;
let catalogSaveTimer = null;

export function setThemeSyncUserId(userId) {
  syncUserId = userId || null;
}

function resolveUserId(userId) {
  return userId || syncUserId || null;
}

function emptyEntry() {
  return { notes: emptyThemeSections(), links: [], sources: [], locks: {} };
}

function entryHasContent(entry) {
  if (!entry) return false;
  if (entry.links?.length) return true;
  if (entry.sources?.length) return true;
  return THEME_SECTIONS.some((sec) => sectionPlainLength(entry.notes?.[sec]) > 0);
}

function readLocal(themeId) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + themeId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    parsed.notes = { ...emptyThemeSections(), ...(parsed.notes || {}) };
    parsed.links = parsed.links || [];
    parsed.sources = parsed.sources || [];
    parsed.locks = parsed.locks || {};
    return parsed;
  } catch {
    return null;
  }
}

function writeLocal(themeId, entry) {
  localStorage.setItem(LS_PREFIX + themeId, JSON.stringify(entry));
}

export function getThemeEntry(themeId) {
  if (themeCache[themeId]) return themeCache[themeId];
  const local = readLocal(themeId);
  if (local) {
    themeCache[themeId] = local;
    return local;
  }
  const empty = emptyEntry();
  themeCache[themeId] = empty;
  return empty;
}

function persistThemeEntry(themeId, entry) {
  themeCache[themeId] = entry;
  writeLocal(themeId, entry);
}

export function updateThemeNotes(themeId, sections, userId = null) {
  const entry = getThemeEntry(themeId);
  entry.notes = { ...emptyThemeSections(), ...sections };
  persistThemeEntry(themeId, entry);
  scheduleThemeSave(themeId, userId, entry);
}

export function updateThemeLinks(themeId, links, userId = null) {
  const entry = getThemeEntry(themeId);
  entry.links = [...links];
  persistThemeEntry(themeId, entry);
  scheduleThemeSave(themeId, userId, entry);
}

export function updateThemeSources(themeId, sources, userId = null) {
  const entry = getThemeEntry(themeId);
  entry.sources = [...sources];
  persistThemeEntry(themeId, entry);
  scheduleThemeSave(themeId, userId, entry);
}

function scheduleThemeSave(themeId, userId, entry) {
  const uid = resolveUserId(userId);
  if (!uid || !isSupabaseConfigured()) return;
  const pending = saveTimers.get(themeId);
  if (pending) clearTimeout(pending);
  saveTimers.set(
    themeId,
    setTimeout(() => {
      saveTimers.delete(themeId);
      pushThemeEntry(themeId, uid, entry).catch((err) => console.warn("theme save", err));
    }, DEBOUNCE_MS)
  );
}

export async function flushThemeSavesNow() {
  const ids = [...saveTimers.keys()];
  await Promise.all(
    ids.map(async (themeId) => {
      clearTimeout(saveTimers.get(themeId));
      saveTimers.delete(themeId);
      const entry = getThemeEntry(themeId);
      const uid = resolveUserId(null);
      if (uid) await pushThemeEntry(themeId, uid, entry);
    })
  );
}

async function pushThemeEntry(themeId, userId, entry) {
  if (!isSupabaseConfigured()) return { ok: false };
  const sb = getSupabase();
  const { data: sessionWrap } = await sb.auth.getSession();
  if (!sessionWrap.session?.access_token) return { ok: false };

  const notes = {};
  for (const sec of THEME_SECTIONS) {
    if (entry.notes?.[sec]) notes[sec] = entry.notes[sec];
  }

  const { error } = await sb.from("ca_theme_notes").upsert(
    {
      user_id: userId,
      theme_id: themeId,
      notes_json: notes,
      links_json: entry.links || [],
      sources_json: entry.sources || [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,theme_id" }
  );

  if (error) {
    console.warn("ca_theme_notes upsert", error);
    const msg = error.message || "";
    if (/ca_theme_notes|schema cache|could not find/i.test(msg)) {
      return {
        ok: false,
        error:
          "Run supabase/schema-migrate.sql in Supabase SQL Editor (adds ca_theme_notes), then sign in again.",
      };
    }
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export async function loadAllThemeNotes(userId) {
  if (!isSupabaseConfigured() || !userId) return;
  const sb = getSupabase();
  const { data, error } = await sb.from("ca_theme_notes").select("*").eq("user_id", userId);
  if (error) {
    console.warn("ca_theme_notes load", error);
    return;
  }

  const localSnapshot = { ...themeCache };
  themeCache = {};

  for (const row of data || []) {
    const themeId = row.theme_id;
    const remote = {
      notes: { ...emptyThemeSections(), ...(row.notes_json || {}) },
      links: row.links_json || [],
      sources: row.sources_json || [],
    };
    const local = readLocal(themeId);
    if (local && entryHasContent(local)) {
      const merged = {
        notes: { ...emptyThemeSections() },
        links: local.links?.length ? local.links : remote.links,
        sources: local.sources?.length ? local.sources : remote.sources,
      };
      for (const sec of THEME_SECTIONS) {
        merged.notes[sec] =
          sectionPlainLength(local.notes?.[sec]) > 0 ? local.notes[sec] : remote.notes[sec] || "";
      }
      themeCache[themeId] = merged;
      writeLocal(themeId, merged);
    } else {
      themeCache[themeId] = remote;
      writeLocal(themeId, remote);
    }
  }

  for (const [themeId, entry] of Object.entries(localSnapshot)) {
    if (!themeCache[themeId] && entryHasContent(entry)) {
      themeCache[themeId] = entry;
    }
  }
}

export function hydrateThemesFromLocal() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(LS_PREFIX)) continue;
    const themeId = key.slice(LS_PREFIX.length);
    if (!themeCache[themeId]) getThemeEntry(themeId);
  }
}

export function isThemeFieldLocked(themeId, fieldId) {
  return Boolean(getThemeEntry(themeId).locks?.[fieldId]);
}

export function getThemeLockedSnapshot(themeId, fieldId) {
  return getThemeEntry(themeId).locks?.[fieldId]?.snapshot ?? "";
}

export function lockThemeField(themeId, fieldId, snapshot) {
  const entry = getThemeEntry(themeId);
  entry.locks = {
    ...(entry.locks || {}),
    [fieldId]: { snapshot: snapshot ?? "", lockedAt: new Date().toISOString() },
  };
  persistThemeEntry(themeId, entry);
}

export function unlockThemeField(themeId, fieldId) {
  const entry = getThemeEntry(themeId);
  const next = { ...(entry.locks || {}) };
  delete next[fieldId];
  entry.locks = next;
  persistThemeEntry(themeId, entry);
}

export function pickThemeNoteValue(themeId, fieldId, liveValue, gitValue = "") {
  if (isThemeFieldLocked(themeId, fieldId)) {
    return getThemeLockedSnapshot(themeId, fieldId);
  }
  const local = String(liveValue ?? "").trim();
  if (local) return liveValue;
  return gitValue || "";
}

// ——— Custom theme catalog (categories / subcategories / user themes) ———

function readCatalogFromLocal() {
  const read = (key) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const themes = read(LS_CATALOG_THEMES);
  return {
    themes: Object.keys(themes).length ? themes : read("ca-custom-themes-v1"),
    categories: read(LS_CATALOG_CATEGORIES),
    subcategories: read(LS_CATALOG_SUBCATEGORIES),
  };
}

function writeCatalogToLocal(catalog) {
  if (catalog.themes) localStorage.setItem(LS_CATALOG_THEMES, JSON.stringify(catalog.themes));
  if (catalog.categories) localStorage.setItem(LS_CATALOG_CATEGORIES, JSON.stringify(catalog.categories));
  if (catalog.subcategories) localStorage.setItem(LS_CATALOG_SUBCATEGORIES, JSON.stringify(catalog.subcategories));
}

function catalogHasContent(catalog) {
  if (!catalog) return false;
  if (Object.values(catalog.themes || {}).some((arr) => arr?.length)) return true;
  if (Object.values(catalog.categories || {}).some((arr) => arr?.length)) return true;
  return Object.values(catalog.subcategories || {}).some((byCat) =>
    Object.values(byCat || {}).some((arr) => arr?.length)
  );
}

function mergeCatalog(local, remote) {
  const merged = {
    themes: { ...(remote.themes || {}) },
    categories: { ...(remote.categories || {}) },
    subcategories: { ...(remote.subcategories || {}) },
  };
  for (const [paper, list] of Object.entries(local.themes || {})) {
    const byId = new Map((merged.themes[paper] || []).map((t) => [t.id, t]));
    for (const t of list || []) byId.set(t.id, t);
    merged.themes[paper] = [...byId.values()];
  }
  for (const [paper, list] of Object.entries(local.categories || {})) {
    const set = new Set([...(merged.categories[paper] || []), ...list]);
    merged.categories[paper] = [...set];
  }
  for (const [paper, byCat] of Object.entries(local.subcategories || {})) {
    merged.subcategories[paper] = { ...(merged.subcategories[paper] || {}) };
    for (const [cat, list] of Object.entries(byCat || {})) {
      const byId = new Map((merged.subcategories[paper][cat] || []).map((s) => [s.id, s]));
      for (const s of list || []) byId.set(s.id, s);
      merged.subcategories[paper][cat] = [...byId.values()];
    }
  }
  return merged;
}

export function setThemeCatalogUserId(userId) {
  catalogSyncUserId = userId || null;
}

export function scheduleThemeCatalogCloudSave() {
  const uid = catalogSyncUserId;
  if (!uid || !isSupabaseConfigured()) return;
  if (catalogSaveTimer) clearTimeout(catalogSaveTimer);
  catalogSaveTimer = setTimeout(() => {
    catalogSaveTimer = null;
    pushThemeCatalog(uid).catch((err) => console.warn("theme catalog save", err));
  }, CATALOG_DEBOUNCE_MS);
}

export async function flushThemeCatalogSavesNow() {
  if (catalogSaveTimer) {
    clearTimeout(catalogSaveTimer);
    catalogSaveTimer = null;
  }
  const uid = catalogSyncUserId;
  if (uid) await pushThemeCatalog(uid);
}

async function pushThemeCatalog(userId) {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase();
  const { data: sessionWrap } = await sb.auth.getSession();
  if (!sessionWrap.session?.access_token) return;

  const local = readCatalogFromLocal();
  const { error } = await sb.from("ca_theme_catalog").upsert(
    {
      user_id: userId,
      themes_json: local.themes,
      categories_json: local.categories,
      subcategories_json: local.subcategories,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) console.warn("ca_theme_catalog upsert", error);
}

export async function loadThemeCatalogFromCloud(userId) {
  if (!isSupabaseConfigured() || !userId) return;
  const sb = getSupabase();
  const { data, error } = await sb.from("ca_theme_catalog").select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    console.warn("ca_theme_catalog load", error);
    return;
  }
  if (!data) return;

  const remote = {
    themes: data.themes_json || {},
    categories: data.categories_json || {},
    subcategories: data.subcategories_json || {},
  };
  const local = readCatalogFromLocal();
  if (catalogHasContent(local) && catalogHasContent(remote)) {
    writeCatalogToLocal(mergeCatalog(local, remote));
  } else if (catalogHasContent(remote) && !catalogHasContent(local)) {
    writeCatalogToLocal(remote);
  }
}
