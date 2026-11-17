/** Field kinds a Block Source may declare in data-component. */
export const FIELD_COMPONENTS = new Set(['text', 'richtext', 'reference', 'select', 'link']);

/**
 * Parses data-options="value:Label, other:Other label" (the label is optional).
 * @param {string | undefined} source
 * @returns {{ name: string, value: string }[]}
 */
export function parseOptions(source) {
  return (source || '').split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [value, ...label] = entry.split(':');
    return { name: (label.join(':') || value).trim(), value: value.trim() };
  });
}

/**
 * Escapes text for an HTML attribute value.
 * @param {string} value
 * @returns {string}
 */
export function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
