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
 * Composite multi-field cell as AEM delivers it: one <li> per entry when an entry is a
 * single element, otherwise entries separated by <hr> with one paragraph per field.
 * @param {string[][]} entries
 * @returns {string}
 */
function compositeCell(entries) {
  const wrap = (inner) => (/^<(p|ul|ol|h[1-6]|pre)\b/i.test(inner) ? inner : `<p>${inner}</p>`);
  if (entries.every((entry) => entry.length === 1)) {
    return `<ul>${entries.map(([inner]) => `<li>${inner}</li>`).join('')}</ul>`;
  }
  return `<hr>${entries.map((entry) => `${entry.filter(Boolean).map(wrap).join('')}<hr>`).join('')}`;
}

/**
 * Draft cell content of every data-field, in document order, as AEM delivers it.
 * @param {string} html
 * @returns {{ blockInners: string[], itemInners: string[], itemVariants: string[][], multiAt: number,
 *   listEntries: string[][] | null }}
 *   itemVariants: one list of item inners per option of the item's first select (Drafts show each)
 *   multiAt: position of a composite multi-field (data-item + data-multi) among the block fields, or -1
 *   listEntries: entries of that block list when the block also has child items (else null: the
 *   list entries are the items)
 */
export function extractDataFieldInners(html) {
  const blockInners = [];
  /** @type {string[][]} */
  const itemEntries = [];
  /** @type {string[][]} */
  const listEntries = [];
  let itemSelect = null;
  let multiAt = -1;
  const stack = [];
  // A data-item without data-multi means child items: a top-level data-multi list is then a
  // block field of its own (one cell), not the items.
  const hasChildItems = [...html.matchAll(/<[a-zA-Z][^>]*\sdata-item\s*=[^>]*>/g)]
    .some(([tag]) => !/\sdata-multi\b/.test(tag));
  /** @type {{ depth: number, kind: 'item' | 'list' | 'nested', entry: string[], nested?: string[][] | null, nestedAt?: number }[]} */
  const scopes = [];
  /* eslint-disable no-param-reassign -- scopes are the parser's own records */
  const closeNested = (scope) => {
    if (scope.nested) scope.entry[scope.nestedAt] = compositeCell(scope.nested);
    scope.nested = null;
  };
  /* eslint-enable no-param-reassign */
  const unwind = () => {
    while (scopes.length && stack.length < scopes.at(-1).depth) {
      const scope = scopes.pop();
      if (scope.kind === 'item') closeNested(scope);
    }
  };
  const push = (value, isSelect, options) => {
    const scope = scopes.at(-1);
    if (!scope) blockInners.push(value);
    else if (scope.kind === 'nested' || scope.kind === 'list') scope.entry.push(value);
    else {
      if (isSelect && !itemSelect) itemSelect = { index: scope.entry.length, options };
      scope.entry.push(value);
    }
  };
  const openRe = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)([^>]*?)(\/?)>/gi;
  let match = openRe.exec(html);

  while (match) {
    if (match[0].startsWith('<!--')) {
      match = openRe.exec(html);
      // continue
    } else if (match[1]) {
      const index = stack.lastIndexOf(match[1].toLowerCase());
      if (index >= 0) stack.splice(index);
      unwind();
      match = openRe.exec(html);
    } else {
      const tag = match[2];
      const attrs = parseAttrs(match[3] || '');
      stack.push(tag.toLowerCase());
      if (match[4] === '/') stack.pop();
      if (attrs['data-item']) {
        const parent = scopes.at(-1);
        const depth = stack.length;
        if (parent?.kind === 'item') {
          // One more entry of the nested list (the first one starts the cell).
          if (!parent.nested) {
            parent.nested = [];
            parent.nestedAt = parent.entry.length;
            parent.entry.push('');
          }
          const entry = [];
          parent.nested.push(entry);
          scopes.push({ depth, kind: 'nested', entry });
        } else if (!parent && 'data-multi' in attrs && hasChildItems) {
          if (multiAt < 0) multiAt = blockInners.length;
          const entry = [];
          listEntries.push(entry);
          scopes.push({ depth, kind: 'list', entry });
        } else if (!parent) {
          const entry = [];
          itemEntries.push(entry);
          if ('data-multi' in attrs && multiAt < 0) multiAt = blockInners.length;
          scopes.push({
            depth, kind: 'item', entry, nested: null, nestedAt: -1,
          });
        }
      }

      const component = attrs['data-component'] || 'text';
      if (attrs['data-field'] && component === 'select') {
        // A select only sets an attribute: its content holds other fields, so keep parsing inside it.
        const options = parseOptions(attrs['data-options']);
        push(options[0]?.value ?? '', true, options);
      } else if (attrs['data-field']) {
        let inner = '';
        let consumed = false;
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
              // HTML comments (e.g. commented-out sample copy) are never default content.
              inner = html.slice(start, tagMatch.index).replace(/<!--[\s\S]*?-->/g, '').trim();
              openRe.lastIndex = tagMatch.index + tagMatch[0].length;
              consumed = true;
              break;
            }
            tagMatch = tagRe.exec(html);
          }
        }
        // Multi-value fields are delivered by AEM as a list, one <li> per value; links as one <a>.
        let value = inner;
        if ('data-multi' in attrs && !attrs['data-item']) value = `<ul><li>${inner}</li></ul>`;
        if (component === 'link') value = `<p><a href="${escapeAttr(attrs.href || '#')}">${inner}</a></p>`;
        if (component === 'url') {
          // Only the address is authored: AEM delivers it as a link to itself.
          const href = attrs.href && attrs.href !== '#' ? escapeAttr(attrs.href) : '';
          value = href ? `<p><a href="${href}">${href}</a></p>` : '';
        }
        push(value, false);
        // A field element may hold other fields (e.g. a url <a> with a text <span>): keep parsing inside.
        if (component === 'url' && match[4] !== '/') {
          openRe.lastIndex = match.index + match[0].length;
        } else if (consumed) {
          stack.pop();
          unwind();
        }
      }
      match = openRe.exec(html);
    }
  }
  while (scopes.length) {
    const scope = scopes.pop();
    if (scope.kind === 'item') closeNested(scope);
  }

  const itemInners = itemEntries[0] || [];
  const samples = itemEntries.length ? itemEntries : [itemInners];
  const itemVariants = itemSelect && itemSelect.options.length > 1
    ? itemSelect.options.map(({ value }) => itemInners.map((inner, i) => (i === itemSelect.index ? value : inner)))
    : samples;
  return {
    blockInners, itemInners, itemVariants, multiAt, listEntries: hasChildItems && multiAt >= 0 ? listEntries : null,
  };
}

/**
 * @param {string} blockId
 * @param {string[]} blockInners
 * @param {string[]} itemInners
 * @param {string[][]} [itemVariants] Item rows to render (one per select option)
 * @param {number} [multiAt] Position of a composite multi-field among the block fields
 * @param {string[][] | null} [listEntries] Entries of that list when the block also has child items
 * @returns {string}
 */
function authoredBlock(blockId, blockInners, itemInners, itemVariants = [itemInners], multiAt = -1, listEntries = null) {
  const rows = [];

  if (listEntries) {
    // Block list (one cell among the block fields) followed by the child items.
    const cells = [...blockInners];
    cells.splice(multiAt, 0, compositeCell(listEntries));
    cells.forEach((inner) => {
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
  } else if (multiAt >= 0) {
    const cells = [...blockInners];
    cells.splice(multiAt, 0, compositeCell(itemVariants));
    cells.forEach((inner) => {
      rows.push(`          <div>
            <div>${inner}</div>
          </div>`);
    });
  } else if (itemInners.length) {
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
 * @param {number} [multiAt]
 * @param {string[][] | null} [listEntries]
 * @returns {string}
 */
function fullDraftPage(blockId, title, blockInners, itemInners, strings, itemVariants, multiAt, listEntries) {
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
${authoredBlock(blockId, blockInners, itemInners, itemVariants, multiAt, listEntries)}
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
  const {
    blockInners, itemInners, itemVariants, multiAt, listEntries,
  } = extractDataFieldInners(html);
  if (!blockInners.length && !itemInners.length) return;

  await mkdir(draftsDir, { recursive: true });

  let exists = true;
  try {
    await access(draftPath);
  } catch {
    exists = false;
  }

  const blockMarkup = authoredBlock(blockId, blockInners, itemInners, itemVariants, multiAt, listEntries);

  if (!exists) {
    await writeFile(draftPath, fullDraftPage(blockId, title, blockInners, itemInners, strings, itemVariants, multiAt, listEntries));
    console.log(`draft: created drafts/${blockId}.html`);
    return;
  }

  const current = await readFile(draftPath, 'utf8');
  const replaced = replaceAuthoredBlock(current, blockId, blockMarkup);
  const next = replaced ?? fullDraftPage(blockId, title, blockInners, itemInners, strings, itemVariants, multiAt, listEntries);
  if (next !== current) {
    await writeFile(draftPath, next);
    console.log(`draft: synced drafts/${blockId}.html`);
  }
}
