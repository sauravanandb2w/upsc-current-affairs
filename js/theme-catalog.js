/**
 * Built-in category/subcategory tree (data/themes-index.json) + user themes (localStorage).
 */

const LS_CUSTOM = "ca-custom-themes-v2";
const LS_CUSTOM_CATEGORIES = "ca-custom-categories-v1";
const LS_CUSTOM_SUBCATEGORIES = "ca-custom-subcategories-v1";

function slugifyId(name) {
  const base = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "item";
}

function normalizeCatalogCategories(paperKey, catalogIndex) {
  const paper = catalogIndex?.[paperKey];
  if (!paper) return [];

  if (Array.isArray(paper.categories) && paper.categories[0]?.subcategories) {
    return paper.categories.map((c) => ({
      name: c.name,
      subcategories: [...(c.subcategories || [])],
      custom: false,
    }));
  }

  // Legacy flat categories + themes as subcategories
  if (Array.isArray(paper.themes)) {
    const byParent = new Map();
    for (const t of paper.themes) {
      const parent = t.parent || "Other";
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push({ id: t.id, name: t.name });
    }
    return [...byParent.entries()].map(([name, subcategories]) => ({ name, subcategories, custom: false }));
  }

  const names = paper.categories || [];
  return names.map((name) => ({ name, subcategories: [], custom: false }));
}

export function getCustomThemesByPaper() {
  try {
    const raw = localStorage.getItem(LS_CUSTOM) || localStorage.getItem("ca-custom-themes-v1");
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

export function getCustomCategoriesByPaper() {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_CATEGORIES);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCustomCategoriesByPaper(byPaper) {
  localStorage.setItem(LS_CUSTOM_CATEGORIES, JSON.stringify(byPaper));
}

export function getCustomSubcategoriesByPaper() {
  try {
    const raw = localStorage.getItem(LS_CUSTOM_SUBCATEGORIES);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCustomSubcategoriesByPaper(byPaper) {
  localStorage.setItem(LS_CUSTOM_SUBCATEGORIES, JSON.stringify(byPaper));
}

export function isCustomCategory(paperKey, category) {
  return (getCustomCategoriesByPaper()[paperKey] || []).includes(category);
}

export function isCustomSubcategory(paperKey, category, subcategoryId) {
  return (getCustomSubcategoriesByPaper()[paperKey]?.[category] || []).some((s) => s.id === subcategoryId);
}

function normalizeCustomTheme(t) {
  if (t.category && t.subcategory) return { ...t, custom: true };
  const category = t.category || t.parent || "";
  const subcategory = t.subcategory || t.subcategoryId || "__general__";
  const subcategoryName = t.subcategoryName || (subcategory === "__general__" ? "General" : subcategory);
  return { ...t, category, subcategory, subcategoryName, custom: true };
}

/** User-created themes only. */
export function getThemesForSubcategory(paperKey, category, subcategoryId, catalogIndex) {
  return sortUserThemes(
    getCustomThemesByPaper()[paperKey] || [],
    paperKey,
    category,
    subcategoryId,
    catalogIndex
  );
}

export function getThemesForCategory(paperKey, categoryName, catalogIndex) {
  return sortUserThemes(getCustomThemesByPaper()[paperKey] || [], paperKey, categoryName, null, catalogIndex);
}

function sortUserThemes(rawList, paperKey, categoryFilter, subcategoryFilter, catalogIndex) {
  const themes = rawList
    .map(normalizeCustomTheme)
    .filter((t) => {
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (subcategoryFilter && t.subcategory !== subcategoryFilter) return false;
      return true;
    })
    .map((t) => {
      const sub = findSubcategoryById(paperKey, t.category, t.subcategory, catalogIndex);
      return {
        ...t,
        subcategoryName: sub?.name || t.subcategoryName || t.subcategory,
      };
    });
  themes.sort((a, b) => {
    const pathA = `${a.category}\0${a.subcategoryName}\0${a.name}`;
    const pathB = `${b.category}\0${b.subcategoryName}\0${b.name}`;
    return pathA.localeCompare(pathB);
  });
  return themes;
}

export function getMergedThemesForPaper(paperKey, catalogIndex) {
  return sortUserThemes(getCustomThemesByPaper()[paperKey] || [], paperKey, null, null, catalogIndex);
}

export function findThemeById(themeId, catalogIndex, paperTabs) {
  if (!themeId) return null;
  for (const paper of paperTabs) {
    const themes = getMergedThemesForPaper(paper.key, catalogIndex);
    const t = themes.find((x) => x.id === themeId);
    if (t) {
      const sub = findSubcategoryById(paper.key, t.category, t.subcategory, catalogIndex);
      return {
        ...t,
        paperKey: paper.key,
        paperLabel: catalogIndex?.[paper.key]?.label || paper.label,
        subcategoryName: sub?.name || t.subcategoryName || t.subcategory,
      };
    }
  }
  return null;
}

export function getCategoriesForPaper(paperKey, catalogIndex) {
  const builtIn = normalizeCatalogCategories(paperKey, catalogIndex).map((c) => c.name);
  const custom = getCustomCategoriesByPaper()[paperKey] || [];
  const order = [...builtIn];
  const seen = new Set(order);
  for (const c of custom) {
    if (!seen.has(c)) {
      order.push(c);
      seen.add(c);
    }
  }
  return order;
}

export function getCategoryMeta(paperKey, categoryName, catalogIndex) {
  const builtIn = normalizeCatalogCategories(paperKey, catalogIndex).find((c) => c.name === categoryName);
  if (builtIn) return builtIn;
  if (isCustomCategory(paperKey, categoryName)) {
    return { name: categoryName, subcategories: [], custom: true };
  }
  return null;
}

export function getSubcategoriesForCategory(paperKey, categoryName, catalogIndex) {
  const meta = getCategoryMeta(paperKey, categoryName, catalogIndex);
  const builtIn = meta?.subcategories || [];
  const custom = getCustomSubcategoriesByPaper()[paperKey]?.[categoryName] || [];
  const byId = new Map();
  for (const s of builtIn) byId.set(s.id, { ...s, custom: false });
  for (const s of custom) byId.set(s.id, { ...s, custom: true });

  const legacyGeneral = (getCustomThemesByPaper()[paperKey] || [])
    .map(normalizeCustomTheme)
    .some((t) => t.category === categoryName && t.subcategory === "__general__");
  if (legacyGeneral && !byId.has("__general__")) {
    byId.set("__general__", { id: "__general__", name: "General", custom: true });
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findSubcategoryById(paperKey, categoryName, subcategoryId, catalogIndex) {
  return getSubcategoriesForCategory(paperKey, categoryName, catalogIndex).find((s) => s.id === subcategoryId) || null;
}

export function countThemesInSubcategory(paperKey, category, subcategoryId, catalogIndex) {
  return getThemesForSubcategory(paperKey, category, subcategoryId, catalogIndex).length;
}

export function countThemesInCategory(paperKey, category, catalogIndex) {
  const subs = getSubcategoriesForCategory(paperKey, category, catalogIndex);
  return subs.reduce((n, s) => n + countThemesInSubcategory(paperKey, category, s.id, catalogIndex), 0);
}

export function addCustomCategory(paperKey, name, catalogIndex = null) {
  const title = String(name || "").trim();
  if (!title) throw new Error("Category name is required.");

  const lower = title.toLowerCase();
  const taken = getCategoriesForPaper(paperKey, catalogIndex).map((c) => c.toLowerCase());
  if (taken.includes(lower)) throw new Error(`"${title}" already exists as a category.`);

  const byPaper = getCustomCategoriesByPaper();
  byPaper[paperKey] = [...(byPaper[paperKey] || []), title];
  saveCustomCategoriesByPaper(byPaper);
  return title;
}

export function addCustomSubcategory(paperKey, categoryName, name, catalogIndex = null) {
  const category = String(categoryName || "").trim();
  const title = String(name || "").trim();
  if (!category || !title) throw new Error("Subcategory name is required.");

  const subs = getSubcategoriesForCategory(paperKey, category, catalogIndex);
  if (subs.some((s) => s.name.toLowerCase() === title.toLowerCase())) {
    throw new Error(`"${title}" already exists in this category.`);
  }

  let id = slugifyId(title);
  const taken = new Set(subs.map((s) => s.id));
  let n = 2;
  while (taken.has(id)) {
    id = `${slugifyId(title)}-${n}`;
    n += 1;
  }

  const sub = { id, name: title, custom: true };
  const byPaper = getCustomSubcategoriesByPaper();
  const list = byPaper[paperKey]?.[category] || [];
  byPaper[paperKey] = { ...(byPaper[paperKey] || {}), [category]: [...list, sub] };
  saveCustomSubcategoriesByPaper(byPaper);

  if (!getCategoriesForPaper(paperKey, catalogIndex).includes(category)) {
    addCustomCategory(paperKey, category, catalogIndex);
  }

  return sub;
}

export function addCustomTheme(paperKey, { name, category, subcategory, keywords = "" }, catalogIndex = null) {
  const title = String(name || "").trim();
  const cat = String(category || "").trim();
  const sub = String(subcategory || "").trim();
  if (!title || !cat || !sub) {
    throw new Error("Theme name, category, and subcategory are all required.");
  }

  const byPaper = getCustomThemesByPaper();
  const list = byPaper[paperKey] || [];
  let id = slugifyId(title);
  const taken = new Set(list.map((t) => t.id));
  for (const paper of Object.keys(byPaper)) {
    for (const t of byPaper[paper] || []) taken.add(t.id);
  }
  let n = 2;
  while (taken.has(id)) {
    id = `${slugifyId(title)}-${n}`;
    n += 1;
  }

  const subMeta = findSubcategoryById(paperKey, cat, sub, catalogIndex);
  const theme = {
    id,
    name: title,
    category: cat,
    subcategory: sub,
    subcategoryName: subMeta?.name || sub,
    keywords: String(keywords || "").trim(),
    custom: true,
  };
  byPaper[paperKey] = [...list, theme];
  saveCustomThemesByPaper(byPaper);
  return theme;
}

export function themeFieldIdForSection(sectionName) {
  return `theme_${String(sectionName).toLowerCase().replace(/\s+/g, "_")}`;
}
