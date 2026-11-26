/** Field kinds a Block Source may declare in data-component. */
export const FIELD_COMPONENTS = new Set(['text', 'richtext', 'reference', 'select', 'link', 'url']);

/** Components that must sit on an <a> (the runtime sets its href). */
export const LINK_COMPONENTS = new Set(['link', 'url']);

const CONDITION_RE = /^([A-Za-z][\w-]*)\s*(!?=)\s*(.+)$/;

/**
 * data-condition="campo=valor" (or campo!=valor; several values with |, e.g. tipo=link|botao-link)
 * → Universal Editor field condition (JSON Logic): the field is only shown in the properties panel
 * when the select `campo` has (or not) one of those values.
 * @param {string | undefined} source
 * @param {string} file for messages
 * @returns {object | undefined}
 */
export function parseCondition(source, file) {
  if (source === undefined) return undefined;
  const match = CONDITION_RE.exec(source.trim());
  if (!match) throw new Error(`${file}: data-condition="${source}" inválido (use "campo=valor" ou "campo!=valor").`);
  const [, name, op, raw] = match;
  const values = raw.split('|').map((value) => value.trim()).filter(Boolean);
  const test = values.length > 1 ? { in: [{ var: name }, values] } : { '===': [{ var: name }, values[0]] };
  if (op === '=') return test;
  return values.length > 1 ? { '!': test } : { '!==': [{ var: name }, values[0]] };
}

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
