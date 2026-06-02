import { getSupabase, isSupabaseConfigured } from "./supabase-client.js";
import { fieldIdForSection } from "./field-locks.js";
import { GIT_SECTIONS } from "./notes-md.js";

const LS_CLOUD_PREFIX = "ca-cloud:";
const LS_GIT_PREFIX = "ca-git-notes:";
const LS_META_PREFIX = "ca-meta:";
const DEBOUNCE_MS = 700;

const saveTimers = new Map();

/** @type {Record<string, object>} */
let cloudCache = {};

/** @type {Record<string, { starred: boolean, lastRevisedAt: string|null }>} */
let metaCache = {};

function emptyCloudEntry() {
  return { summary: "", links: [], sources: [], gitNotes: {}, __locks: {} };
}

function parseLocks(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === "object" && "snapshot" in v) {
      out[k] = { snapshot: v.snapshot ?? "", lockedAt: v.lockedAt || null };
    }
  }
  return out;
}

function serializeLocks(locks) {
  const out = {};
  for (const [k, v] of Object.entries(locks || {})) {
    if (v?.snapshot !== undefined) {
      out[k] = { snapshot: v.snapshot, lockedAt: v.lockedAt || new Date().toISOString() };
    }
  }
  return out;
}

export function getCloudEntry(itemId) {
  return cloudCache[itemId] || emptyCloudEntry();
}

export function getItemMeta(itemId) {
  return metaCache[itemId] || { starred: false, lastRevisedAt: null };
}

export function isFieldLocked(itemId, fieldId) {
  return Boolean(getCloudEntry(itemId).__locks?.[fieldId]);
}

export function getLockedSnapshot(itemId, fieldId) {
  return getCloudEntry(itemId).__locks?.[fieldId]?.snapshot ?? "";
}

/** Value that should appear on GitHub — frozen at lock time when field is locked. */
export function gitVisibleNoteValue(itemId, fieldId, liveValue) {
  if (isFieldLocked(itemId, fieldId)) return getLockedSnapshot(itemId, fieldId);
  return liveValue ?? "";
}

export function getGitNotesFromLocal(itemId) {
  const cloud = getCloudEntry(itemId);
  if (cloud.gitNotes && Object.keys(cloud.gitNotes).length) {
    return { ...cloud.gitNotes };
  }
  try {
    const raw = localStorage.getItem(LS_GIT_PREFIX + itemId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGitNotesToLocal(itemId, sections, userId = null) {
  const entry = getCloudEntry(itemId);
  entry.gitNotes = { ...sections };
  localStorage.setItem(LS_GIT_PREFIX + itemId, JSON.stringify(sections));
  scheduleCloudSave(itemId, userId, entry);
}

export function lockNoteField(itemId, fieldId, snapshot, userId) {
  const entry = getCloudEntry(itemId);
  entry.__locks = {
    ...(entry.__locks || {}),
    [fieldId]: { snapshot: snapshot ?? "", lockedAt: new Date().toISOString() },
  };
  scheduleCloudSave(itemId, userId, entry);
}

export function unlockNoteField(itemId, fieldId, userId) {
  const entry = getCloudEntry(itemId);
  const next = { ...(entry.__locks || {}) };
  delete next[fieldId];
  entry.__locks = next;
  scheduleCloudSave(itemId, userId, entry);
}

export async function loadAllCloudNotes(userId) {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase();
  const [notesRes, metaRes] = await Promise.all([
    sb.from("ca_item_notes").select("*").eq("user_id", userId),
    sb.from("ca_item_meta").select("item_id, starred, last_revised_at").eq("user_id", userId),
  ]);

  if (notesRes.error) console.warn("ca_item_notes load", notesRes.error);
  if (metaRes.error) console.warn("ca_item_meta load", metaRes.error);

  cloudCache = {};
  for (const row of notesRes.data || []) {
    const gitNotes = row.git_notes_json && typeof row.git_notes_json === "object" ? row.git_notes_json : {};
    cloudCache[row.item_id] = {
      summary: row.summary || "",
      links: Array.isArray(row.links_json) ? row.links_json : [],
      sources: Array.isArray(row.sources_json) ? row.sources_json : [],
      gitNotes,
      __locks: parseLocks(row.locked_fields),
    };
    localStorage.setItem(LS_CLOUD_PREFIX + row.item_id, JSON.stringify(cloudCache[row.item_id]));
    if (Object.keys(gitNotes).length) {
      localStorage.setItem(LS_GIT_PREFIX + row.item_id, JSON.stringify(gitNotes));
    }
  }

  metaCache = {};
  for (const row of metaRes.data || []) {
    metaCache[row.item_id] = {
      starred: Boolean(row.starred),
      lastRevisedAt: row.last_revised_at || null,
    };
    localStorage.setItem(LS_META_PREFIX + row.item_id, JSON.stringify(metaCache[row.item_id]));
  }
}

export function hydrateCloudFromLocal() {
  cloudCache = {};
  metaCache = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(LS_CLOUD_PREFIX)) {
      try {
        const itemId = key.slice(LS_CLOUD_PREFIX.length);
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        parsed.__locks = parsed.__locks || {};
        parsed.gitNotes = parsed.gitNotes || {};
        cloudCache[itemId] = parsed;
      } catch {
        /* skip */
      }
    }
    if (key?.startsWith(LS_META_PREFIX)) {
      try {
        metaCache[key.slice(LS_META_PREFIX.length)] = JSON.parse(localStorage.getItem(key) || "{}");
      } catch {
        /* skip */
      }
    }
  }
}

function scheduleCloudSave(itemId, userId, payload) {
  cloudCache[itemId] = payload;
  localStorage.setItem(LS_CLOUD_PREFIX + itemId, JSON.stringify(payload));

  const prev = saveTimers.get(itemId);
  if (prev) clearTimeout(prev);

  saveTimers.set(
    itemId,
    setTimeout(async () => {
      saveTimers.delete(itemId);
      if (!isSupabaseConfigured() || !userId) return;
      const sb = getSupabase();
      const gitNotes = {};
      for (const sec of GIT_SECTIONS) {
        const fid = fieldIdForSection(sec);
        if (payload.gitNotes?.[sec] !== undefined) gitNotes[sec] = payload.gitNotes[sec];
        else if (payload.gitNotes?.[fid] !== undefined) gitNotes[sec] = payload.gitNotes[fid];
      }
      const { error } = await sb.from("ca_item_notes").upsert(
        {
          user_id: userId,
          item_id: itemId,
          summary: payload.summary || "",
          links_json: payload.links || [],
          sources_json: payload.sources || [],
          locked_fields: serializeLocks(payload.__locks),
          git_notes_json: gitNotes,
        },
        { onConflict: "user_id,item_id" }
      );
      if (error) console.warn("ca_item_notes save", error);
    }, DEBOUNCE_MS)
  );
}

function scheduleMetaSave(itemId, userId, meta) {
  metaCache[itemId] = meta;
  localStorage.setItem(LS_META_PREFIX + itemId, JSON.stringify(meta));
  if (!isSupabaseConfigured() || !userId) return;
  const sb = getSupabase();
  sb.from("ca_item_meta")
    .upsert(
      {
        user_id: userId,
        item_id: itemId,
        starred: meta.starred,
        last_revised_at: meta.lastRevisedAt,
      },
      { onConflict: "user_id,item_id" }
    )
    .then(({ error }) => {
      if (error) console.warn("ca_item_meta save", error);
    });
}

export function updateCloudField(itemId, userId, field, value) {
  const cur = getCloudEntry(itemId);
  if (field === "summary") cur.summary = value;
  else if (field === "links") cur.links = value;
  else if (field === "sources") cur.sources = value;
  scheduleCloudSave(itemId, userId, cur);
}

export function toggleStar(itemId, userId) {
  const meta = getItemMeta(itemId);
  meta.starred = !meta.starred;
  scheduleMetaSave(itemId, userId, meta);
  return meta.starred;
}

export function markRevised(itemId, userId) {
  const meta = getItemMeta(itemId);
  meta.lastRevisedAt = new Date().toISOString();
  scheduleMetaSave(itemId, userId, meta);
}

export function mergeCloudWithManifest(item) {
  const id = item.id;
  const cloud = getCloudEntry(id);
  const hasCloud =
    cloud.summary ||
    (cloud.links && cloud.links.length) ||
    (cloud.sources && cloud.sources.length);
  const meta = getItemMeta(id);
  const merged = {
    ...item,
    starred: meta.starred,
    lastRevisedAt: meta.lastRevisedAt,
  };
  if (!hasCloud) return merged;
  return {
    ...merged,
    summary: cloud.summary || item.summary || "",
    links: cloud.links?.length ? cloud.links : item.links || [],
    sources: cloud.sources?.length ? cloud.sources : item.sources || [],
  };
}

export function pickNoteValue(_itemId, _fieldId, currentValue) {
  return currentValue;
}

export function getAllCloudDataForExport() {
  return { cloudCache: { ...cloudCache }, metaCache: { ...metaCache } };
}

/** Remove Supabase-backed notes, meta, and browser cache for one item. */
export async function removeItemFromCloud(itemId, userId) {
  delete cloudCache[itemId];
  delete metaCache[itemId];
  localStorage.removeItem(LS_CLOUD_PREFIX + itemId);
  localStorage.removeItem(LS_GIT_PREFIX + itemId);
  localStorage.removeItem(LS_META_PREFIX + itemId);
  const pending = saveTimers.get(itemId);
  if (pending) {
    clearTimeout(pending);
    saveTimers.delete(itemId);
  }
  if (!userId || !isSupabaseConfigured()) return;
  const sb = getSupabase();
  const [notesRes, metaRes, flashRes] = await Promise.all([
    sb.from("ca_item_notes").delete().eq("user_id", userId).eq("item_id", itemId),
    sb.from("ca_item_meta").delete().eq("user_id", userId).eq("item_id", itemId),
    sb.from("ca_flashcards").delete().eq("user_id", userId).eq("item_id", itemId),
  ]);
  if (notesRes.error) console.warn("ca_item_notes delete", notesRes.error);
  if (metaRes.error) console.warn("ca_item_meta delete", metaRes.error);
  if (flashRes.error) console.warn("ca_flashcards delete", flashRes.error);
}
