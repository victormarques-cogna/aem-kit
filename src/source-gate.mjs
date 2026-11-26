import { FIELD_COMPONENTS, LINK_COMPONENTS } from './fields.mjs';

const TAG_RE = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)([^>]*?)(\/?)>/g;
const ATTR_RE = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;

/**
 * @param {string} source
 * @returns {Record<string, string>}
 */
function parseAttrs(source) {
  const attrs = {};
  [...source.matchAll(ATTR_RE)].forEach((match) => {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  });
  return attrs;
}

/**
 * Source Gate v1: data-* contract extras + essential a11y/semantics.
 * Template markers (data-block / fields) are still validated by the build parser.
 * @param {string} html
 * @param {string} file
 */
export default function assertSourceGate(html, file) {
  const errors = [];
  let hasHeading = false;

  [...html.matchAll(TAG_RE)].forEach((match) => {
    if (match[0].startsWith('<!--') || match[1]) return;

    const tag = match[2].toLowerCase();
    const attrs = parseAttrs(match[3] || '');

    if (/^h[1-6]$/.test(tag)) hasHeading = true;

    if (tag === 'img') {
      if (attrs.alt === undefined) {
        errors.push(`${file}: <img> sem atributo alt.`);
      }
    }

    if (attrs['data-field']) {
      const component = attrs['data-component'] || 'text';
      if (!FIELD_COMPONENTS.has(component)) {
        errors.push(
          `${file}: data-component="${component}" não é suportado. Use text, richtext, reference, select, link ou url.`,
        );
      }
      if (LINK_COMPONENTS.has(component) && tag !== 'a') {
        errors.push(`${file}: data-field="${attrs['data-field']}" (${component}) precisa estar num <a>.`);
      }
      const label = (attrs['data-label'] || attrs['aria-label'] || '').trim();
      if (!label) {
        errors.push(
          `${file}: data-field="${attrs['data-field']}" precisa de data-label (ou aria-label).`,
        );
      }
    }
  });

  if (!hasHeading) {
    errors.push(`${file}: Block Source precisa de ao menos um heading (h1–h6).`);
  }

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
}
