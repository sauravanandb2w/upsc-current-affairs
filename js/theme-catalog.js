/**
 * Built-in themes (data/themes-index.json) + custom themes (localStorage).
 */

const LS_CUSTOM = "ca-custom-themes-v1";

function slugifyId(name) {
  const base = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "theme";
}

export function getCustomThemesByPaper() {
  try {
    const raw = localStorage.getItem(LS_CUSTOM);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCustomThemesByPaper(byPaper) {
  localStorage.setItem(LS_CUSTOM, JSON.stringify(byPaper));
}

/** @returns {{ id: string, name: string, parent: string, keywords?: string, custom?: boolean }[]} */
export function getMergedThemesForPaper(paperKey, catalogIndex) {
  const builtIn = catalogIndex?.[paperKey]?.themes || [];
  const custom = getCustomThemesByPaper()[paperKey] || [];
  return [...builtIn, ...custom.map((t) => ({ ...t, custom: true }))];
}

export function findThemeById(themeId, catalogIndex, paperTabs) {
  if (!themeId) return null;
  for (const paper of paperTabs) {
    const themes = getMergedThemesForPaper(paper.key, catalogIndex);
    const t = themes.find((x) => x.id === themeId);
    if (t) {
      return {
        ...t,
        paperKey: paper.key,
        paperLabel: catalogIndex?.[paper.key]?.label || paper.label,
      };
    }
  }
  return null;
}

export function addCustomTheme(paperKey, { name, parent, keywords = "" }, catalogIndex = null) {
  const title = String(name || "").trim();
  const group = String(parent || "").trim();
  if (!title || !group) {
    throw new Error("Theme name and subject group are both required.");
  }

  const byPaper = getCustomThemesByPaper();
  const list = byPaper[paperKey] || [];
  let id = slugifyId(title);
  const taken = new Set(list.map((t) => t.id));
  for (const paper of Object.keys(byPaper)) {
    for (const t of byPaper[paper] || []) taken.add(t.id);
  }
  if (catalogIndex) {
    for (const key of Object.keys(catalogIndex)) {
      for (const t of catalogIndex[key]?.themes || []) taken.add(t.id);
    }
  }
  let n = 2;
  while (taken.has(id)) {
    id = `${slugifyId(title)}-${n}`;
    n += 1;
  }

  const theme = {
    id,
    name: title,
    parent: group,
    keywords: String(keywords || "").trim(),
    custom: true,
  };
  byPaper[paperKey] = [...list, theme];
  saveCustomThemesByPaper(byPaper);
  return theme;
}
