/**
 * Markdown storage for CA notes (Supabase + notes.md).
 * Editor stays contenteditable HTML; persist as GitHub-flavoured Markdown.
 */

let markedParse = null;

function looksLikeNoteHtml(value) {
  return /<[a-z][\s\S]*>/i.test(String(value ?? ""));
}

export async function initNoteMarkdown() {
  if (markedParse) return;
  try {
    const mod = await import("https://esm.sh/marked@15.0.6");
    mod.marked.setOptions({ gfm: true, breaks: true });
    markedParse = mod.marked.parse.bind(mod.marked);
  } catch (err) {
    console.warn("Markdown renderer unavailable", err);
  }
}

export function looksLikeMarkdown(value) {
  const s = String(value ?? "");
  if (!s.trim() || looksLikeNoteHtml(s)) return false;
  return /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|.+\|)/m.test(s);
}

function hasMarkdownSyntax(s) {
  return /(\*\*[^*]+\*\*|__[^_]+__|^#{1,6}\s|^[-*+]\s+\S|^\d+\.\s+\S|^>\s|```|^\|.+\|)/m.test(
    String(s ?? "")
  );
}

/** Normalize any stored note body to Markdown (never plain text or HTML). */
export function noteValueToMarkdown(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (looksLikeNoteHtml(s)) {
    if (hasMarkdownSyntax(s) && /<(table|ul|ol|p|div|h[1-6]|li|tr|td|th)\b/i.test(s)) {
      return convertEmbeddedHtmlToMarkdown(s);
    }
    if (!hasMarkdownSyntax(s)) return htmlToMarkdown(s);
  }
  return convertEmbeddedHtmlToMarkdown(s);
}

/** Markdown (or legacy HTML) → HTML for the rich editor (caller sanitizes). */
export function markdownToEditorHtml(value, sanitizeHtml) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const legacyHtmlOnly = looksLikeNoteHtml(s) && !hasMarkdownSyntax(s);
  if (!legacyHtmlOnly && markedParse) {
    try {
      return sanitizeHtml ? sanitizeHtml(markedParse(s)) : markedParse(s);
    } catch {
      /* fall through */
    }
  }
  if (looksLikeNoteHtml(s)) {
    return sanitizeHtml ? sanitizeHtml(s) : s;
  }
  if (markedParse) {
    try {
      return sanitizeHtml ? sanitizeHtml(markedParse(s)) : markedParse(s);
    } catch {
      /* fall through */
    }
  }
  return plainLinesToHtml(s);
}

function plainLinesToHtml(text) {
  return String(text ?? "")
    .split(/\n/)
    .map((line) => {
      const t = line.trim();
      return t ? `<p>${escapeHtml(t)}</p>` : "<p><br></p>";
    })
    .join("");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMd(text) {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .trim();
}

function htmlToMarkdown(html) {
  const root = document.createElement("div");
  root.innerHTML = html;

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || "").replace(/\u00a0/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";

    if (tag === "table") return tableToMarkdown(node);

    if (tag === "ul" || tag === "ol") {
      const ordered = tag === "ol";
      let n = 1;
      const items = [];
      for (const child of node.children) {
        if (child.tagName?.toLowerCase() !== "li") continue;
        const body = walkChildren(child).replace(/^\n+|\n+$/g, "").replace(/\n/g, " ").trim();
        items.push(ordered ? `${n}. ${body}` : `- ${body}`);
        n += 1;
      }
      return items.length ? `${items.join("\n")}\n\n` : "";
    }

    if (tag === "li") {
      const inner = walkChildren(node).replace(/^\n+|\n+$/g, "");
      if (/\n/.test(inner) || /\|/.test(inner)) return `${inner}\n`;
      return inner.replace(/\n/g, " ").trim();
    }

    if (tag === "p" || tag === "div") {
      const inner = walkChildren(node).replace(/\n+$/g, "");
      if (!inner.trim()) return "\n";
      return `${inner}\n\n`;
    }

    if (tag === "strong" || tag === "b") {
      const inner = walkChildren(node).trim();
      return inner ? `**${inner}**` : "";
    }

    if (tag === "em" || tag === "i") {
      const inner = walkChildren(node).trim();
      return inner ? `*${inner}*` : "";
    }

    if (tag === "u") {
      const inner = walkChildren(node).trim();
      return inner || "";
    }

    if (tag === "span") {
      return spanToMarkdown(node);
    }

    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") {
      const inner = walkChildren(node).trim();
      // notes.md reserves ## for the six fixed section titles — subheadings are always ###.
      return inner ? `### ${inner}\n\n` : "";
    }

    if (tag === "blockquote") {
      const inner = walkChildren(node).trim();
      return inner
        ? `${inner
            .split(/\n/)
            .map((l) => `> ${l}`)
            .join("\n")}\n\n`
        : "";
    }

    if (tag === "pre") {
      const code = node.textContent || "";
      return code ? `\`\`\`\n${code}\n\`\`\`\n\n` : "";
    }

    if (tag === "code") {
      const inner = node.textContent || "";
      return inner ? `\`${inner}\`` : "";
    }

    return walkChildren(node);
  }

  function walkChildren(node) {
    let out = "";
    for (const child of node.childNodes) out += walk(child);
    return out;
  }

  let md = walkChildren(root).replace(/\n{3,}/g, "\n\n").trim();
  return md;
}

function spanToMarkdown(node) {
  const style = String(node.getAttribute("style") || "");
  const weight = node.style?.fontWeight || "";
  const isBold =
    weight === "bold" ||
    Number(weight) >= 600 ||
    /font-weight:\s*(bold|[6-9]00)/i.test(style);
  const isItalic =
    node.style?.fontStyle === "italic" || /font-style:\s*italic/i.test(style);
  const isUnderline =
    String(node.style?.textDecoration || "").includes("underline") ||
    /text-decoration:[^;]*underline/i.test(style);
  if (!isBold && !isItalic && !isUnderline) {
    return walkInlineChildren(node);
  }
  let inner = walkInlineChildren(node).trim();
  if (!inner) return "";
  if (isBold) inner = `**${inner}**`;
  if (isItalic) inner = `*${inner}*`;
  return inner;
}

function walkInline(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || "").replace(/\u00a0/g, " ");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  if (tag === "strong" || tag === "b") {
    const inner = walkInlineChildren(node).trim();
    return inner ? `**${inner}**` : "";
  }
  if (tag === "em" || tag === "i") {
    const inner = walkInlineChildren(node).trim();
    return inner ? `*${inner}*` : "";
  }
  if (tag === "u") {
    const inner = walkInlineChildren(node).trim();
    return inner || "";
  }
  if (tag === "span") return spanToMarkdown(node);
  if (tag === "br") return "\n";
  return walkInlineChildren(node);
}

function walkInlineChildren(node) {
  let out = "";
  for (const child of node.childNodes) out += walkInline(child);
  return out;
}

function tableToMarkdown(table) {
  const rows = [...table.querySelectorAll("tr")];
  if (!rows.length) return "";

  const lines = [];
  rows.forEach((tr, idx) => {
    const cells = [...tr.querySelectorAll("th,td")].map((cell) =>
      cellMarkdownInline(cell)
    );
    if (!cells.length) return;
    lines.push(`| ${cells.join(" | ")} |`);
    if (idx === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
  });

  return lines.length ? `${lines.join("\n")}\n\n` : "";
}

/** Replace embedded HTML blocks inside a Markdown string with Markdown equivalents. */
function convertEmbeddedHtmlToMarkdown(md) {
  let out = String(md ?? "");
  out = out.replace(/<table[\s\S]*?<\/table>/gi, (html) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const table = wrap.querySelector("table");
    return table ? tableToMarkdown(table).trim() : "";
  });
  out = out.replace(/<ul[\s\S]*?<\/ul>/gi, (html) => htmlToMarkdown(html).trim());
  out = out.replace(/<ol[\s\S]*?<\/ol>/gi, (html) => htmlToMarkdown(html).trim());
  if (looksLikeNoteHtml(out)) {
    const wrapped = /^<[a-z]/i.test(out.trim()) ? out : `<div>${out}</div>`;
    out = htmlToMarkdown(wrapped);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function cellMarkdownInline(cell) {
  let out = "";
  for (const child of cell.childNodes) out += walkInline(child);
  return out.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

/** Plain text for search, flashcards, activity (strips Markdown/HTML). */
export function noteToPlainText(value, sanitizeHtml) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (looksLikeNoteHtml(s)) {
    const div = document.createElement("div");
    div.innerHTML = sanitizeHtml ? sanitizeHtml(s) : s;
    return blockPlainFromDiv(div);
  }
  if (markedParse) {
    try {
      const div = document.createElement("div");
      div.innerHTML = sanitizeHtml ? sanitizeHtml(markedParse(s)) : markedParse(s);
      return blockPlainFromDiv(div);
    } catch {
      /* fall through */
    }
  }
  return s
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function blockPlainFromDiv(div) {
  const BLOCK = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4"]);
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").replace(/\u00a0/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    let inner = "";
    for (const child of node.childNodes) inner += walk(child);
    return BLOCK.has(tag) ? `${inner}\n` : inner;
  }
  let out = "";
  for (const child of div.childNodes) out += walk(child);
  return out.replace(/\n{3,}/g, "\n\n").replace(/\n+$/g, "").trim();
}

/** Editor read path — convert HTML to Markdown without dedupe (runs once at git save). */
export function noteMarkdownFromEditorHtml(html) {
  const md = noteValueToMarkdown(String(html ?? "")).trim();
  if (!md) return "";
  return convertEmbeddedHtmlToMarkdown(md);
}

export function notePlainLen(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#*_`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/** Prepend plain lines visible in innerText but missing from converted markdown. */
export function prependMissingPlainLines(plain, md) {
  const plainLines = String(plain ?? "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!plainLines.length) return md;
  const mdNorm = String(md ?? "").replace(/\s+/g, " ");
  const prefix = [];
  for (const line of plainLines) {
    const norm = line.replace(/\s+/g, " ");
    if (mdNorm.includes(norm)) break;
    prefix.push(line);
  }
  if (!prefix.length) return md;
  return `${prefix.join("\n\n")}${md ? `\n\n${md}` : ""}`;
}

/** Markdown-only storage for notes.md and Supabase (no HTML). */
export function noteMarkdownForStorage(value) {
  let md = noteValueToMarkdown(value).trim();
  if (!md) return "";
  md = convertEmbeddedHtmlToMarkdown(md);
  return canonicalizeSectionMarkdown(md);
}

/** Final pass: one ### block per title, no plain-line duplicates of headings. */
export function canonicalizeSectionMarkdown(md) {
  if (!String(md || "").trim()) return "";
  let out = String(md).trim();
  out = expandCollapsedPipeTables(out);
  out = dedupeConsecutiveLines(out);
  out = promotePlainHeadings(out);
  out = promoteSubheadingLines(out);
  out = collapseInSectionHeadings(out);
  out = dedupeSectionMarkdown(out);
  out = stripPlainHeadingDuplicates(out);
  out = dedupeConsecutiveLines(out);
  out = dedupeSectionMarkdown(out);
  return out.trim();
}

/** Fix table rows collapsed onto one line: "| a | b | | --- |" → separate lines. */
function expandCollapsedPipeTables(md) {
  return md.replace(/(\|[^|\n]+(?:\|[^|\n]+)+\|)(?:\s*\|\s*\|)/g, "$1\n|");
}

function dedupeConsecutiveLines(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (t && out.length && out[out.length - 1].trim() === t) continue;
    out.push(line);
  }
  return out.join("\n");
}

function isSubheadingLine(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 72) return false;
  if (/^[#|*-]/.test(t)) return false;
  if (/^\*\*/.test(t)) return false;
  if (/^(Relevant|PPI is|This news is|Because PPI|Number of items|It is related|\*\*Answer)/i.test(t)) {
    return false;
  }
  if (t.endsWith(".") && t.length > 55) return false;
  if (/^GS-\d+$/i.test(t)) return true;
  if (/^Prelims$/i.test(t)) return true;
  if (/^Q\d+\./.test(t)) return true;
  // Real subheadings use title case — not casual notes like "test test test"
  if (/^[A-Z][a-zA-Z0-9'→–—&/-]*(\s+[A-Za-z0-9][a-zA-Z0-9'→–—&/-]*)+/.test(t) && /[A-Z]/.test(t)) return true;
  return false;
}

/** Plain title line before bullets/table → ### heading. */
function promoteSubheadingLines(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isSubheadingLine(t) && !/^#{1,6}\s/.test(t)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = lines[j]?.trim() || "";
      if (next.startsWith("-") || next.startsWith("|") || /^Q\d+\./.test(next)) {
        out.push(`### ${t}`);
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

function promotePlainHeadings(md) {
  return md
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      const q = t.match(/^Q(\d+)\.\s*(.+)$/);
      if (q) return `### Q${q[1]}. ${q[2].trim()}`;
      return line;
    })
    .join("\n");
}

function collapseInSectionHeadings(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const rest = heading[2].trim();
      if (rest.startsWith("- ")) {
        out.push(rest);
        continue;
      }
      if (!rest) continue;
      out.push(`### ${rest}`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Remove plain-text lines that repeat a ### heading title (editor round-trip artefact). */
function stripPlainHeadingDuplicates(md) {
  const titles = new Set([...md.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1].trim()));
  return md
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t || /^#/.test(t)) return true;
      return !titles.has(t);
    })
    .join("\n");
}

/**
 * Clean in-section markdown (legacy entry — prefer noteMarkdownForStorage).
 */
export function normalizeGitSectionMarkdown(body) {
  return canonicalizeSectionMarkdown(noteValueToMarkdown(body));
}

/** Split section body into ###-headed blocks; keep one block per title (longest body wins). */
function parseSubheadingBlocks(md) {
  const blocks = [];
  let current = { title: null, lines: [] };

  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^###\s+(.+)$/);
    if (m) {
      if (current.lines.length) blocks.push(current);
      current = { title: m[1].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length) blocks.push(current);
  return blocks;
}

function dedupeSectionMarkdown(md) {
  if (!md) return "";
  const blocks = parseSubheadingBlocks(md);
  const best = new Map();
  const order = [];
  const out = [];

  for (const block of blocks) {
    if (!block.title) {
      out.push(...block.lines);
      continue;
    }
    const body = block.lines.slice(1).join("\n").trim();
    if (!best.has(block.title)) {
      order.push(block.title);
      best.set(block.title, { body, lines: block.lines });
    } else {
      const prev = best.get(block.title);
      if (body.length > prev.body.length) best.set(block.title, { body, lines: block.lines });
    }
  }

  for (const title of order) {
    const entry = best.get(title);
    if (entry) out.push(...entry.lines);
  }
  return out.join("\n").trim().replace(/\n{3,}/g, "\n\n");
}
