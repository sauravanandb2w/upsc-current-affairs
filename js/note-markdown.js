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

/** Normalize any stored note body to Markdown (never plain text). */
export function noteValueToMarkdown(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (looksLikeNoteHtml(s) && !hasMarkdownSyntax(s)) return htmlToMarkdown(s);
  return s;
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

    if (tag === "u") {
      const inner = walkChildren(node).trim();
      return inner ? `<u>${inner}</u>` : "";
    }

    if (tag === "span") {
      return spanToMarkdown(node);
    }

    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") {
      const level = Number(tag.slice(1));
      const inner = walkChildren(node).trim();
      // notes.md reserves ## for the six fixed section titles — use ###+ inside fields.
      const mdLevel = Math.min(6, level + 2);
      return inner ? `${"#".repeat(mdLevel)} ${inner}\n\n` : "";
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
  if (isUnderline) inner = `<u>${inner}</u>`;
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
    return inner ? `<u>${inner}</u>` : "";
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
  const hasStyle = Boolean(table.querySelector("[style]"));
  if (hasStyle) {
    return `\n\n${table.outerHTML}\n\n`;
  }

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

/** Markdown for notes.md / Supabase (never HTML). */
export function noteMarkdownForStorage(value) {
  return normalizeGitSectionMarkdown(noteValueToMarkdown(value));
}

/**
 * Clean in-section lines that wrongly use ## (reserved for notes.md section titles).
 * Legacy commits and rich-text headings produced ## bullets/subheads inside a section.
 */
export function normalizeGitSectionMarkdown(body) {
  const md = noteValueToMarkdown(body).trim();
  if (!md) return "";
  const lines = md.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (line.startsWith("## ") && !line.startsWith("###")) {
      const rest = line.slice(3).trim();
      if (rest.startsWith("- ")) {
        out.push(rest);
        continue;
      }
      if (rest.startsWith("<")) {
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
