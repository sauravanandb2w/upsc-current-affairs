import { getSupabase, isSupabaseConfigured } from "./supabase-client.js";
import { noteHtmlToPlainText } from "./rich-notes.js?v=27";
import { effectiveItemDate } from "./date-picker.js";

/** Spaced revision buckets (days) */
export const REVISION_BUCKETS = [7, 30, 90, 180, 365];

const LS_FLASH = "ca-flashcards:v1";
let flashCache = [];

export function loadFlashcardsLocal() {
  try {
    flashCache = JSON.parse(localStorage.getItem(LS_FLASH) || "[]");
    if (!Array.isArray(flashCache)) flashCache = [];
  } catch {
    flashCache = [];
  }
}

function persistFlashLocal() {
  localStorage.setItem(LS_FLASH, JSON.stringify(flashCache));
}

export async function loadFlashcards(userId) {
  loadFlashcardsLocal();
  if (!userId || !isSupabaseConfigured()) return flashCache;
  const sb = getSupabase();
  const { data, error } = await sb.from("ca_flashcards").select("*").eq("user_id", userId);
  if (error) {
    console.warn("ca_flashcards load", error);
    return flashCache;
  }
  flashCache = (data || []).map(rowToCard);
  persistFlashLocal();
  return flashCache;
}

function rowToCard(row) {
  return {
    id: row.id,
    itemId: row.item_id,
    question: row.question || "",
    answer: row.answer || "",
    month: row.month,
    tags: row.tags || [],
    nextReviewAt: row.next_review_at,
    ease: row.ease ?? 2.5,
    intervalDays: row.interval_days ?? 0,
  };
}

async function saveCard(userId, card) {
  if (!userId || !isSupabaseConfigured()) {
    persistFlashLocal();
    return card;
  }
  const sb = getSupabase();
  const payload = {
    user_id: userId,
    item_id: card.itemId,
    question: card.question,
    answer: card.answer,
    month: card.month,
    tags: card.tags,
    next_review_at: card.nextReviewAt,
    ease: card.ease,
    interval_days: card.intervalDays,
  };
  if (card.id && !String(card.id).startsWith("local-")) payload.id = card.id;
  const { data, error } = await sb.from("ca_flashcards").upsert(payload).select().single();
  if (error) {
    console.warn("ca_flashcards save", error);
    persistFlashLocal();
    return card;
  }
  return rowToCard(data);
}

export function getFlashcards() {
  return flashCache.slice();
}

export function getDueFlashcards(now = new Date()) {
  const t = now.getTime();
  return flashCache.filter((c) => isCardDue(c, now));
}

export function isCardDue(card, now = new Date()) {
  if (!card?.nextReviewAt) return true;
  return new Date(card.nextReviewAt).getTime() <= now.getTime();
}

/** Due cards first, then the rest (soonest review date next). */
export function getDrillDeck(now = new Date()) {
  const all = flashCache.slice();
  if (!all.length) return [];
  const due = all.filter((c) => isCardDue(c, now));
  const dueIds = new Set(due.map((c) => c.id));
  const later = all
    .filter((c) => !dueIds.has(c.id))
    .sort(
      (a, b) =>
        new Date(a.nextReviewAt || 0).getTime() - new Date(b.nextReviewAt || 0)
    );
  return [...due, ...later];
}

export function formatNextReview(card) {
  if (!card?.nextReviewAt) return "New";
  if (isCardDue(card)) return "Due now";
  const d = new Date(card.nextReviewAt);
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (days <= 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

/** Stable accent index from item id (0–5). */
export function cardThemeIndex(card) {
  const key = String(card?.itemId || card?.id || "");
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h + key.charCodeAt(i)) % 6;
  return h;
}

/** Front = prompt; back = full fact (never identical unless line is empty). */
export function makeFlashcardPair(factLine) {
  const answer = String(factLine || "").trim().replace(/\?+\s*$/, "").trim();
  if (!answer) return { question: "", answer: "" };

  const colonIdx = answer.indexOf(":");
  if (colonIdx > 6 && colonIdx < 72) {
    return {
      question: `${answer.slice(0, colonIdx + 1)} …?`,
      answer,
    };
  }

  const words = answer.split(/\s+/);
  if (words.length > 4) {
    const n = Math.max(2, Math.floor(words.length * 0.35));
    return {
      question: `${words.slice(0, n).join(" ")} … — complete this fact.`,
      answer,
    };
  }

  if (/^(who|what|when|where|why|how|which)\b/i.test(answer)) {
    return {
      question: answer.endsWith("?") ? answer : `${answer}?`,
      answer: `Answer:\n${answer.replace(/\?+\s*$/, "")}`,
    };
  }

  return {
    question: `What do you recall about “${words.slice(0, 3).join(" ")}…”?`,
    answer,
  };
}

export function splitFactsToCards(text) {
  const plain = noteHtmlToPlainText(text).trim();
  if (!plain) return [];

  const lines = [];
  for (const block of plain.split(/\n+/)) {
    let line = block.replace(/^[-*•]\d+[.)]\s*/, "").replace(/^[-*•]\s*/, "").trim();
    if (!line || line === "-") continue;

    if (line.length > 10) {
      lines.push(line);
      continue;
    }

    // Paragraph-style notes: split into sentences
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (s.length > 10) lines.push(s);
    }
  }

  return [...new Set(lines)];
}

export async function generateFlashcardsFromItem(userId, item, sections) {
  const sources = [
    ["Facts", sections.Facts || sections.facts || ""],
    ["Exam angle", sections["Exam angle"] || sections.exam_angle || ""],
    ["Static connection", sections["Static connection"] || ""],
    ["GS paper fit", sections["GS paper fit"] || ""],
  ];

  const lines = [];
  for (const [, text] of sources) {
    lines.push(...splitFactsToCards(text));
  }

  const unique = [...new Set(lines)].slice(0, 12);
  const month = (effectiveItemDate(item) || "").slice(0, 7);
  const created = [];
  for (const line of unique) {
    let { question, answer } = makeFlashcardPair(line);
    if (!question || !answer) continue;
    if (question === answer) {
      question = `${line.slice(0, Math.min(48, line.length))}… — recall the full fact.`;
    }
    const card = {
      id: `local-${crypto.randomUUID()}`,
      itemId: item.id,
      question,
      answer,
      month,
      tags: item.tags || [],
      nextReviewAt: new Date().toISOString(),
      ease: 2.5,
      intervalDays: 0,
    };
    const saved = await saveCard(userId, card);
    flashCache.push(saved);
    created.push(saved);
  }
  persistFlashLocal();
  return created;
}

export async function rateFlashcard(userId, cardId, quality) {
  const idx = flashCache.findIndex((c) => c.id === cardId);
  if (idx < 0) return null;
  const card = { ...flashCache[idx] };
  let interval = card.intervalDays || 0;
  if (quality >= 3) {
    if (interval === 0) interval = REVISION_BUCKETS[0];
    else {
      const next = REVISION_BUCKETS.find((b) => b > interval) || 365;
      interval = next;
    }
    card.ease = Math.min(3, (card.ease || 2.5) + 0.1);
  } else {
    interval = REVISION_BUCKETS[0];
    card.ease = Math.max(1.3, (card.ease || 2.5) - 0.2);
  }
  card.intervalDays = interval;
  const next = new Date();
  next.setDate(next.getDate() + interval);
  card.nextReviewAt = next.toISOString();
  const saved = await saveCard(userId, card);
  flashCache[idx] = saved;
  persistFlashLocal();
  return saved;
}

export function getFlashcardsForItem(itemId) {
  return flashCache.filter((c) => c.itemId === itemId);
}

export async function removeFlashcardsForItem(itemId, userId) {
  flashCache = flashCache.filter((c) => c.itemId !== itemId);
  persistFlashLocal();
  if (!userId || !isSupabaseConfigured()) return;
  const sb = getSupabase();
  const { error } = await sb.from("ca_flashcards").delete().eq("user_id", userId).eq("item_id", itemId);
  if (error) console.warn("ca_flashcards delete", error);
}
