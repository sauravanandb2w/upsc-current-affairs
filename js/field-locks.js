/** CA field lock keys — stored in ca_item_notes.locked_fields */

export function caFieldLockKey(itemId, fieldId) {
  return `ca:${itemId}:${fieldId}`;
}

export function parseCaLockKey(lockKey) {
  if (!lockKey?.startsWith("ca:")) return null;
  const parts = lockKey.split(":");
  if (parts.length < 3) return null;
  const fieldId = parts[parts.length - 1];
  const itemId = parts.slice(1, -1).join(":");
  return { itemId, fieldId, storageKey: fieldId };
}

/** Map display section → storage field id */
export const SECTION_FIELD_IDS = {
  Summary: "summary",
  Facts: "facts",
  "Static connection": "static",
  "GS paper fit": "gs_fit",
  "Exam angle": "exam_angle",
  Miscellaneous: "misc",
};

export function fieldIdForSection(sectionName) {
  return SECTION_FIELD_IDS[sectionName] || sectionName.toLowerCase().replace(/\s+/g, "_");
}
