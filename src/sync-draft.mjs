import {
  access, mkdir, readFile, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { escapeAttr, parseOptions } from './fields.mjs';

/**
 * @param {string} source
 * @returns {Record<string, string>}
 */
function parseAttrs(source) {
  const attrs = {};
  const re = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  [...source.matchAll(re)].forEach((match) => {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  });
  return attrs;
}

/**
 * @param {string} html
 * Draft cell content of every data-field, in document order, as AEM delivers it.
 * @param {string} html
 * @returns {{ blockInners: string[], itemInners: string[], itemVariants: string[][] }}
 *   itemVariants: one list of item inners per option of the item's first select (Drafts show each)
 */
export function extractDataFieldInners(html) {
  const blockInners = [];
  const itemInners = [];
  let itemSelect = null;
  const stack = [];
  let itemDepth = 0;
  const openRe = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)([^>]*?)(\/?)>/gi;
  let match = openRe.exec(html);

  while (match) {
    if (match[0].startsWith('<!--')) {
      match = openRe.exec(html);
      // continue
    } else if (match[1]) {
      const index = stack.lastIndexOf(match[1].toLowerCase());
      if (index >= 0) stack.splice(index);
      if (itemDepth && stack.length < itemDepth) itemDepth = 0;
      match = openRe.exec(html);
    } else {
      const tag = match[2];
      const attrs = parseAttrs(match[3] || '');
      stack.push(tag.toLowerCase());
      if (match[4] === '/') stack.pop();
      if (attrs['data-item'] && !itemDepth) itemDepth = stack.length;

      const component = attrs['data-component'] || 'text';
      if (attrs['data-field'] && component === 'select') {
        // A select only sets an attribute: its content holds other fields, so keep parsing inside it.
        const insideItem = itemDepth && stack.length >= itemDepth;
        const options = parseOptions(attrs['data-options']);
        const value = options[0]?.value ?? '';
        if (insideItem) {
          if (!itemSelect) itemSelect = { index: itemInners.length, options };
          itemInners.push(value);
        } else blockInners.push(value);
      } else if (attrs['data-field']) {
        const insideItem = itemDepth && stack.length >= itemDepth;
        let inner = '';
        if (match[4] !== '/') {
          const start = match.index + match[0].length;
          let depth = 1;
          const tagRe = new RegExp(`</?${tag}\\b[^>]*>`, 'gi');
          tagRe.lastIndex = start;
          let tagMatch = tagRe.exec(html);
          while (tagMatch) {
            if (tagMatch[0].startsWith('</')) depth -= 1;
            else if (!/\/\s*>$/.test(tagMatch[0])) depth += 1;
            if (depth === 0) {
              inner = html.slice(start, tagMatch.index).trim();
              openRe.lastIndex = tagMatch.index + tagMatch[0].length;
              stack.pop();
              break;
            }
            tagMatch = tagRe.exec(html);
          }
        }
        // Multi-value fields are delivered by AEM as a list, one <li> per value; links as one <a>.
        let value = inner;
        if ('data-multi' in attrs) value = `<ul><li>${inner}</li></ul>`;
        if (component === 'link') value = `<p><a href="${escapeAttr(attrs.href || '#')}">${inner}</a></p>`;
        if (insideItem) itemInners.push(value);
        else blockInners.push(value);
      }
      match = openRe.exec(html);
    }
  }

  const itemVariants = itemSelect && itemSelect.options.length > 1
    ? itemSelect.options.map(({ value }) => itemInners.map((inner, i) => (i === itemSelect.index ? value : inner)))
    : [itemInners];
  return { blockInners, itemInners, itemVariants };
}

/**
 * @param {string} blockId
 * @param {string[]} blockInners
 * @param {string[]} itemInners
 * @param {string[][]} [itemVariants] Item rows to render (one per select option)
 * @returns {string}
 */
function authoredBlock(blockId, blockInners, itemInners, itemVariants = [itemInners]) {
  const rows = [];

  if (itemInners.length) {
    blockInners.forEach((inner) => {
      rows.push(`          <div>
            <div>${inner}</div>
          </div>`);
    });
    itemVariants.forEach((variant) => {
      const itemCells = variant.map((inner) => `            <div>${inner}</div>`).join('\n');
      rows.push(`          <div>
${itemCells}
          </div>`);
    });
  } else {
    const cells = blockInners.map((inner) => `            <div>${inner}</div>`).join('\n');
    rows.push(`          <div>
${cells}
          </div>`);
  }

  return `        <div class="${blockId}">
${rows.join('\n')}
        </div>`;
}

/**
 * @param {string} html
 * @param {string} blockId
 * @param {string} replacement
 * @returns {string | null}
 */
function replaceAuthoredBlock(html, blockId, replacement) {
  const startRe = new RegExp(`([ \\t]*)<div class="${blockId}">`);
  const startMatch = startRe.exec(html);
  if (!startMatch) return null;
  const start = startMatch.index;
  let depth = 1;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = start + startMatch[0].length;
  let tagMatch = tagRe.exec(html);
  while (tagMatch) {
    if (tagMatch[0].startsWith('</')) depth -= 1;
    else if (!/\/\s*>$/.test(tagMatch[0])) depth += 1;
    if (depth === 0) {
      const end = tagMatch.index + tagMatch[0].length;
      return `${html.slice(0, start)}${replacement}${html.slice(end)}`;
    }
    tagMatch = tagRe.exec(html);
  }
  return null;
}

/**
 * @param {string} blockId
 * @param {string} title
 * @param {string[]} blockInners
 * @param {string[]} itemInners
 * @param {object} strings i18n strings (lang, draftDescription)
 * @param {string[][]} [itemVariants]
 * @returns {string}
 */
function fullDraftPage(blockId, title, blockInners, itemInners, strings, itemVariants) {
  return `<!DOCTYPE html>
<html lang="${strings.lang}">
  <head>
    <title>${title}</title>
    <meta name="description" content="${strings.draftDescription(title)}" />
    <link rel="canonical" href="https://localhost/drafts/${blockId}" />
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <script src="/scripts/aem.js" type="module"></script>
    <script src="/scripts/scripts.js" type="module"></script>
    <link rel="stylesheet" href="/styles/styles.css"/>
  </head>
  <body>
    <header></header>
    <main>
      <div>
        <h1>${title}</h1>
${authoredBlock(blockId, blockInners, itemInners, itemVariants)}
      </div>
    </main>
    <footer></footer>
  </body>
</html>
`;
}

/**
 * Keeps Draft markup in sync with Block Source field defaults.
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} opts.blockId
 * @param {string} opts.title
 * @param {string} opts.html Block Source HTML
 * @param {object} opts.strings i18n strings
 */
export default async function syncDraft({
  root, blockId, title, html, strings,
}) {
  const draftsDir = path.join(root, 'drafts');
  const draftPath = path.join(draftsDir, `${blockId}.html`);
  const { blockInners, itemInners, itemVariants } = extractDataFieldInners(html);
  if (!blockInners.length && !itemInners.length) return;

  await mkdir(draftsDir, { recursive: true });

  let exists = true;
  try {
    await access(draftPath);
  } catch {
    exists = false;
  }

  const blockMarkup = authoredBlock(blockId, blockInners, itemInners, itemVariants);

  if (!exists) {
    await writeFile(draftPath, fullDraftPage(blockId, title, blockInners, itemInners, strings, itemVariants));
    console.log(`draft: created drafts/${blockId}.html`);
    return;
  }

  const current = await readFile(draftPath, 'utf8');
  const replaced = replaceAuthoredBlock(current, blockId, blockMarkup);
  const next = replaced ?? fullDraftPage(blockId, title, blockInners, itemInners, strings, itemVariants);
  if (next !== current) {
    await writeFile(draftPath, next);
    console.log(`draft: synced drafts/${blockId}.html`);
  }
}
