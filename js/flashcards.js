import { getSupabase, isSupabaseConfigured } from "./supabase-client.js";
import { noteHtmlToPlainText, looksLikeNoteHtml } from "./rich-notes.js?v=29";
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

/** Line-preserving plain text for Q/A parsing (noteHtmlToPlainText may collapse lines without marked). */
function examAngleToParseablePlain(text) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  if (looksLikeNoteHtml(s)) return noteHtmlToPlainText(s).trim();
  return normalizeExamAngleMarkdown(s);
}

/** Markdown from notes.md / editor: ### Q1. … and **Answer:** on its own line. */
function normalizeExamAngleMarkdown(md) {
  return String(md ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+(?=Q\s*\d+\s*[.:)]?)/gim, "")
    .replace(/^\s*\*\*Answer\s*:\*\*\s*$/gim, "Answer:")
    .replace(/^\s*\*\*Answer\s*:\*\*\s+(.*)$/gim, "Answer: $1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .trim();
}

/** Parse Exam angle: Q1 / Q2 … then Answer: … (standard pattern). */
export function splitExamAngleToFlashcards(text) {
  const plain = examAngleToParseablePlain(text);
  if (!plain) return [];
  return dedupeFlashcardPairs(parseExamAngleStructured(plain));
}

function normalizeExamQuestion(question) {
  const q = String(question || "")
    .trim()
    .replace(/^Q\s*\d+\s*[.:)]?\s*/i, "")
    .replace(/\?+\s*$/, "")
    .trim();
  if (!q) return "";
  return `${q}?`;
}

const EXAM_Q_LINE =
  /^\s*(?:#{1,6}\s*)?Q\s*(\d+)\s*[.:)]?\s*(.*)$/i;
const EXAM_Q_SPLIT = /(?=^\s*(?:#{1,6}\s*)?Q\s*\d+\s*[.:)]?\s*)/im;

/** Q1. Question text / Q1 + question on next line(s), then Answer: … */
function parseExamAngleStructured(plain) {
  const segments = plain.replace(/\r\n/g, "\n").split(EXAM_Q_SPLIT);
  const pairs = [];

  for (const segment of segments) {
    if (!segment.trim()) continue;

    const rawLines = segment.replace(/\r\n/g, "\n").split("\n");
    let startIdx = 0;
    while (startIdx < rawLines.length && !rawLines[startIdx].trim()) startIdx += 1;
    if (startIdx >= rawLines.length) continue;

    const headerMatch = rawLines[startIdx].trim().match(EXAM_Q_LINE);
    if (!headerMatch) continue;

    const questionParts = [];
    if (headerMatch[2].trim()) questionParts.push(headerMatch[2].trim());

    const answerParts = [];
    let inAnswer = false;

    for (let i = startIdx + 1; i < rawLines.length; i += 1) {
      const trimmed = rawLines[i].trim();
      if (EXAM_Q_LINE.test(trimmed)) break;

      const answerMatch = trimmed.match(/^Answer\s*:\s*(.*)$/i);
      if (answerMatch) {
        inAnswer = true;
        if (answerMatch[1].trim()) answerParts.push(answerMatch[1].trim());
        continue;
      }

      if (!inAnswer) {
        if (trimmed) questionParts.push(trimmed);
      } else {
        answerParts.push(trimmed);
      }
    }

    const question = normalizeExamQuestion(questionParts.join(" ").replace(/\s+/g, " ").trim());
    const answer = answerParts
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (question.length >= 4 && answer.length >= 2) {
      pairs.push({ question, answer });
    }
  }

  return pairs;
}

function dedupeFlashcardPairs(pairs) {
  const seen = new Set();
  const out = [];
  for (const pair of pairs) {
    const key = pair.question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out.slice(0, 24);
}

/** @deprecated Legacy auto-prompt generator — Exam angle cards use explicit Q/A pairs now. */
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

export async function generateFlashcardsFromItem(userId, item, sections) {
  const examText = sections["Exam angle"] || sections.exam_angle || "";
  const pairs = splitExamAngleToFlashcards(examText);

  const month = (effectiveItemDate(item) || "").slice(0, 7);
  const created = [];
  for (const { question, answer } of pairs) {
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

export async function removeFlashcard(cardId, userId) {
  return removeFlashcards([cardId], userId);
}

export async function removeFlashcards(cardIds, userId) {
  const ids = [...new Set((cardIds || []).filter(Boolean))];
  if (!ids.length) return;
  const idSet = new Set(ids);
  flashCache = flashCache.filter((c) => !idSet.has(c.id));
  persistFlashLocal();
  if (!userId || !isSupabaseConfigured()) return;
  const remoteIds = ids.filter((id) => !String(id).startsWith("local-"));
  if (!remoteIds.length) return;
  const sb = getSupabase();
  const { error } = await sb.from("ca_flashcards").delete().eq("user_id", userId).in("id", remoteIds);
  if (error) console.warn("ca_flashcards batch delete", error);
}

export async function removeFlashcardsForItem(itemId, userId) {
  flashCache = flashCache.filter((c) => c.itemId !== itemId);
  persistFlashLocal();
  if (!userId || !isSupabaseConfigured()) return;
  const sb = getSupabase();
  const { error } = await sb.from("ca_flashcards").delete().eq("user_id", userId).eq("item_id", itemId);
  if (error) console.warn("ca_flashcards delete", error);
}
