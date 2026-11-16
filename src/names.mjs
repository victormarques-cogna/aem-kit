/**
 * Same algorithm as toClassName in scripts/aem.js (block class names at runtime). Keep in sync.
 * @param {string} name
 * @returns {string}
 */
export function toClassName(name) {
  return name
    .toLowerCase()
    .replace(/[^0-9a-z]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Removes diacritics ("Seção" → "Secao") so names survive toClassName.
 * @param {string} name
 * @returns {string}
 */
export function stripAccents(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Human title from a raw CLI name (keeps words; trims).
 * @param {string} name
 * @returns {string}
 */
export function toTitle(name) {
  return name
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
