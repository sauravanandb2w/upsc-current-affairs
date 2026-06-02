import { getSupabase, isSupabaseConfigured } from "./supabase-client.js";

const LS_CLOUD_PREFIX = "ca-cloud:";
const LS_GIT_PREFIX = "ca-git-notes:";
const DEBOUNCE_MS = 700;

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const saveTimers = new Map();

/** @type {Record<string, { summary: string, links: unknown[], sources: unknown[] }>} */
let cloudCache = {};

export function getCloudEntry(itemId) {
  return cloudCache[itemId] || { summary: "", links: [], sources: [] };
}

export function getGitNotesFromLocal(itemId) {
  try {
    const raw = localStorage.getItem(LS_GIT_PREFIX + itemId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGitNotesToLocal(itemId, sections) {
  localStorage.setItem(LS_GIT_PREFIX + itemId, JSON.stringify(sections));
}

export async function loadAllCloudNotes(userId) {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("ca_item_notes")
    .select("item_id, summary, links_json, sources_json")
    .eq("user_id", userId);
  if (error) {
    console.warn("ca_item_notes load", error);
    return;
  }
  cloudCache = {};
  for (const row of data || []) {
    cloudCache[row.item_id] = {
      summary: row.summary || "",
      links: Array.isArray(row.links_json) ? row.links_json : [],
      sources: Array.isArray(row.sources_json) ? row.sources_json : [],
    };
    localStorage.setItem(LS_CLOUD_PREFIX + row.item_id, JSON.stringify(cloudCache[row.item_id]));
  }
}

export function hydrateCloudFromLocal() {
  cloudCache = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(LS_CLOUD_PREFIX)) continue;
    try {
      const itemId = key.slice(LS_CLOUD_PREFIX.length);
      cloudCache[itemId] = JSON.parse(localStorage.getItem(key) || "{}");
    } catch {
      /* skip */
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
      const { error } = await sb.from("ca_item_notes").upsert(
        {
          user_id: userId,
          item_id: itemId,
          summary: payload.summary || "",
          links_json: payload.links || [],
          sources_json: payload.sources || [],
        },
        { onConflict: "user_id,item_id" }
      );
      if (error) console.warn("ca_item_notes save", error);
    }, DEBOUNCE_MS)
  );
}

export function updateCloudField(itemId, userId, field, value) {
  const cur = getCloudEntry(itemId);
  if (field === "summary") cur.summary = value;
  else if (field === "links") cur.links = value;
  else if (field === "sources") cur.sources = value;
  scheduleCloudSave(itemId, userId, cur);
}

export function mergeCloudWithManifest(item) {
  const id = item.id;
  const cloud = getCloudEntry(id);
  const hasCloud =
    cloud.summary ||
    (cloud.links && cloud.links.length) ||
    (cloud.sources && cloud.sources.length);
  if (!hasCloud) return item;
  return {
    ...item,
    summary: cloud.summary || item.summary || "",
    links: cloud.links?.length ? cloud.links : item.links || [],
    sources: cloud.sources?.length ? cloud.sources : item.sources || [],
  };
}
