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

/** Normalize any stored note body to Markdown. */
export function noteValueToMarkdown(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (looksLikeNoteHtml(s)) return htmlToMarkdown(s);
  return s;
}

/** Markdown (or legacy HTML) → HTML for the rich editor (caller sanitizes). */
export function markdownToEditorHtml(value, sanitizeHtml) {
  const s = String(value ?? "").trim();
  if (!s) return "";
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
      return walkChildren(node).replace(/^\n+|\n+$/g, "").replace(/\n/g, " ").trim();
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

    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") {
      const level = Number(tag.slice(1));
      const inner = walkChildren(node).trim();
      return inner ? `${"#".repeat(level)} ${inner}\n\n` : "";
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

function tableToMarkdown(table) {
  const rows = [...table.querySelectorAll("tr")];
  if (!rows.length) return "";

  const lines = [];
  rows.forEach((tr, idx) => {
    const cells = [...tr.querySelectorAll("th,td")].map((cell) =>
      inlineMd(cell.textContent || "")
    );
    if (!cells.length) return;
    lines.push(`| ${cells.join(" | ")} |`);
    if (idx === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
  });

  return lines.length ? `${lines.join("\n")}\n\n` : "";
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

/** Markdown for notes.md / Supabase (never HTML). */
export function noteMarkdownForStorage(value) {
  return noteValueToMarkdown(value);
}
