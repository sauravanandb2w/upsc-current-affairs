import { getSupabase, isSupabaseConfigured } from "./supabase-client.js";
import { noteHtmlToPlainText } from "./rich-notes.js";

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
  return flashCache.filter((c) => {
    if (!c.nextReviewAt) return true;
    return new Date(c.nextReviewAt).getTime() <= t;
  });
}

export function splitFactsToCards(text) {
  const plain = noteHtmlToPlainText(text);
  return plain
    .split(/\n/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter((l) => l.length > 10);
}

export async function generateFlashcardsFromItem(userId, item, sections) {
  const facts = splitFactsToCards(sections.Facts || sections.facts || "");
  const exam = splitFactsToCards(sections["Exam angle"] || sections.exam_angle || "");
  const lines = [...facts, ...exam].slice(0, 12);
  const month = (item.date || "").slice(0, 7);
  const created = [];
  for (const line of lines) {
    const q = line.includes("?") ? line : `What do you know: ${line.slice(0, 80)}?`;
    const card = {
      id: `local-${crypto.randomUUID()}`,
      itemId: item.id,
      question: q,
      answer: line,
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
