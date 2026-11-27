import {
  access, readdir, readFile, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { assertDataUi, componentGeneratedPaths, listComponents } from './components.mjs';
import { toClassName } from './names.mjs';
import { run } from './project.mjs';
import { buildComponents, GENERATED_HEADER } from './showcase.mjs';
import assertSourceGate from './source-gate.mjs';
import syncDraft, { extractDataFieldInners } from './sync-draft.mjs';
import strings from './i18n.mjs';
import { compileTailwind, syncIntellisense } from './tailwind.mjs';
import { FIELD_COMPONENTS, parseCondition, parseOptions } from './fields.mjs';

export { GENERATED_HEADER };

const BLOCK_RESOURCE = 'core/franklin/components/block/v1/block';
const ITEM_RESOURCE = 'core/franklin/components/block/v1/block/item';

/**
 * @param {string} source Attribute string inside a start tag
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
 * Kinds of data-item:
 * - child item: data-item without data-multi (children of the block in the content tree);
 * - block list: data-item + data-multi outside a child item (composite multi-field in the block's
 *   properties panel). Without child items it is the block's only list (`multi`);
 * - nested list: data-item + data-multi inside the child item (composite in the item's panel).
 * Extra data-item siblings of the same kind are Draft samples; only the first defines the model.
 * @param {string} html
 * @returns {object} Block marker, optional item marker and fields
 */
function readTemplate(html) {
  const stack = [];
  let block = null;
  /** @type {Record<string, string> | null} */
  let child = null;
  let childAt = 0;
  /** @type {{ attrs: Record<string, string>, fields: Record<string, string>[], at: number } | null} */
  let list = null;
  /** @type {{ attrs: Record<string, string>, fields: Record<string, string>[], at: number } | null} */
  let nested = null;
  /** @type {Record<string, string>[]} */
  const blockFields = [];
  /** @type {Record<string, string>[]} */
  const itemFields = [];
  /** @type {{ depth: number, kind: 'child' | 'list' | 'nested', collect: boolean }[]} */
  const scopes = [];
  const unwind = () => {
    while (scopes.length && stack.length < scopes.at(-1).depth) scopes.pop();
  };
  const tagRe = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)([^>]*?)(\/?)>/g;

  [...html.matchAll(tagRe)].forEach((match) => {
    if (match[0].startsWith('<!--')) return;
    if (match[1]) {
      const index = stack.lastIndexOf(match[1]);
      if (index >= 0) stack.splice(index);
      unwind();
      return;
    }

    const attrs = parseAttrs(match[3] || '');
    stack.push(match[2]);
    if (attrs['data-block']) block = attrs;
    if (attrs['data-item']) {
      const parent = scopes.at(-1);
      const multi = 'data-multi' in attrs;
      const depth = stack.length;
      if (!parent && multi) {
        const first = !list;
        if (first) list = { attrs, fields: [], at: blockFields.length };
        scopes.push({ depth, kind: 'list', collect: first });
      } else if (!parent) {
        const first = !child;
        if (first) {
          child = attrs;
          childAt = blockFields.length;
        }
        scopes.push({ depth, kind: 'child', collect: first });
      } else if (parent.kind === 'child') {
        if (!multi) {
          throw new Error('Um data-item dentro de outro precisa de data-multi (lista editável no painel do item).');
        }
        const first = parent.collect && !nested;
        if (first) nested = { attrs, fields: [], at: itemFields.length };
        scopes.push({ depth, kind: 'nested', collect: first });
      } else {
        throw new Error('Um data-item dentro de uma lista (data-item + data-multi) não é suportado.');
      }
    }
    if (attrs['data-field']) {
      const scope = scopes.at(-1);
      // data-multi on the item element marks the list, not a multi-value sub-field.
      const { 'data-multi': ignored, ...own } = attrs;
      const field = attrs['data-item'] ? own : attrs;
      if (!scope) blockFields.push(field);
      else if (scope.collect && scope.kind === 'child') itemFields.push(field);
      else if (scope.collect && scope.kind === 'list') list.fields.push(field);
      else if (scope.collect) nested.fields.push(field);
    }
    if (match[4] === '/') {
      stack.pop();
      unwind();
    }
  });

  if (!block?.['data-block']) throw new Error('O HTML precisa de um elemento com data-block.');
  if (child) {
    return {
      block,
      item: child,
      itemAt: childAt,
      multi: false,
      list,
      blockFields,
      itemFields,
      nested,
      fields: [...blockFields, ...(list?.fields ?? []), ...itemFields, ...(nested?.fields ?? [])],
    };
  }
  return {
    block,
    item: list?.attrs ?? null,
    itemAt: list?.at ?? 0,
    multi: Boolean(list),
    list: null,
    blockFields,
    itemFields: list?.fields ?? [],
    nested: null,
    fields: [...blockFields, ...(list?.fields ?? [])],
  };
}

/**
 * @param {Record<string, string>} field
 * @param {string} file
 * @returns {object[]}
 */
function baseFieldModel(field, file) {
  const name = field['data-field'];
  const component = field['data-component'] || 'text';
  const label = field['data-label'] || name;
  if (!name) throw new Error(`${file}: data-field sem nome.`);
  if (!FIELD_COMPONENTS.has(component)) {
    throw new Error(`${file}: data-component="${component}" não é suportado. Use text, richtext, reference, select, link ou url.`);
  }
  if ('data-multi' in field) {
    if (component !== 'text') {
      throw new Error(`${file}: data-multi em "${name}" só é suportado com data-component="text".`);
    }
    // Multi-value text field: one input per value in the properties panel, delivered as <ul><li>.
    return [{
      component: 'text',
      name,
      label,
      valueType: 'string',
      multi: true,
    }];
  }
  if (component === 'select') {
    const options = parseOptions(field['data-options']);
    if (!options.length) throw new Error(`${file}: select "${name}" precisa de data-options.`);
    // AEM collapses a property ending in Type/Title/Text/Alt/MimeType into its sibling.
    if (/(Type|Title|Text|Alt|MimeType)$/.test(name)) {
      throw new Error(`${file}: o nome "${name}" termina com um sufixo reservado do AEM (Type, Title, Text, Alt, MimeType).`);
    }
    return [{
      component: 'select',
      name,
      label,
      valueType: 'string',
      value: options[0].value,
      options,
    }];
  }
  if (component === 'link') {
    // Field collapse: AEM delivers `{name}` + `{name}Text` as one <a href>text</a>.
    return [
      {
        component: 'aem-content',
        name,
        label: `${label} (link)`,
      },
      {
        component: 'text',
        name: `${name}Text`,
        value: '',
        label: `${label} (texto)`,
        valueType: 'string',
      },
    ];
  }
  if (component === 'url') {
    // Only the address (no label field): the <a> keeps its own content.
    return [{ component: 'aem-content', name, label }];
  }
  if (component === 'reference') {
    return [{
      component: 'reference',
      valueType: 'string',
      name,
      label,
      multi: false,
    }];
  }
  return [{
    component,
    name,
    value: '',
    label,
    valueType: 'string',
  }];
}

/**
 * @param {Record<string, string>} field
 * @param {string} file
 * @returns {object[]} One model field, or two for a link (URL + `{name}Text`)
 */
function fieldModel(field, file) {
  const condition = parseCondition(field['data-condition'], file);
  return baseFieldModel(field, file).map((spec) => (condition ? { ...spec, condition } : spec));
}

/**
 * @param {Record<string, string>[]} fields
 * @param {string} file
 * @returns {object[]}
 */
function uniqueFieldModels(fields, file) {
  const names = new Set();
  return fields.flatMap((field) => fieldModel(field, file)).map((spec) => {
    if (names.has(spec.name)) throw new Error(`${file}: campo "${spec.name}" repetido.`);
    names.add(spec.name);
    return spec;
  });
}

/**
 * @param {Record<string, string>[]} fields
 * @param {string[]} inners
 * @returns {Record<string, string | string[]>}
 */
function fieldDefaults(fields, inners) {
  /** @type {Record<string, string | string[]>} */
  const values = {};
  fields.forEach((field, index) => {
    const name = field['data-field'];
    const raw = inners[index] ?? '';
    const kind = field['data-component'] || 'text';
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if ('data-multi' in field) values[name] = text ? [text] : [];
    else if (kind === 'select') values[name] = text;
    else if (kind === 'url') values[name] = field.href && field.href !== '#' ? field.href : '';
    else if (kind === 'link') {
      values[name] = field.href && field.href !== '#' ? field.href : '';
      values[`${name}Text`] = text;
    } else values[name] = kind === 'text' ? text : raw;
  });
  return values;
}

/**
 * @param {string} blockId
 * @param {object} model Parsed template markers
 * @param {string} file
 * @param {string} html Block Source HTML
 * @returns {object}
 */
function componentPartial(blockId, model, file, html) {
  const title = model.block['data-title'] || blockId;
  if (toClassName(title) !== blockId) {
    throw new Error(`${file}: data-title "${title}" gera a classe "${toClassName(title)}", diferente da pasta "${blockId}".`);
  }
  if (model.itemFields.some((field) => 'data-multi' in field)) {
    throw new Error(`${file}: data-multi só vale num campo do bloco ou no próprio elemento data-item.`);
  }
  const blockFields = uniqueFieldModels(model.blockFields, file);
  const itemFields = uniqueFieldModels(model.itemFields, file);
  if (![...blockFields, ...itemFields].length) {
    throw new Error(`${file}: nenhum data-field encontrado.`);
  }

  if (model.nested) {
    // Composite multi-field inside the child item: a repeatable group of fields in the item's
    // properties panel (e.g. the categories of a menu item), placed where it sits in the item.
    if (model.multi || !model.item) {
      throw new Error(`${file}: a lista dentro de um item (data-item + data-multi) só vale em itens filhos (data-item sem data-multi).`);
    }
    const nestedId = model.nested.attrs['data-item'];
    const subFields = uniqueFieldModels(model.nested.fields, file);
    if (!subFields.length) throw new Error(`${file}: data-item="${nestedId}" precisa de ao menos um data-field.`);
    const taken = new Set([...blockFields, ...itemFields].map((field) => field.name));
    [nestedId, ...subFields.map((field) => field.name)].forEach((name) => {
      if (taken.has(name)) throw new Error(`${file}: campo "${name}" repetido.`);
    });
    const condition = parseCondition(model.nested.attrs['data-condition'], file);
    const before = model.itemFields.slice(0, model.nested.at).flatMap((field) => fieldModel(field, file)).length;
    itemFields.splice(before, 0, {
      component: 'container',
      name: nestedId,
      label: model.nested.attrs['data-item-title'] || nestedId,
      multi: true,
      fields: subFields,
      ...(condition ? { condition } : {}),
    });
  }

  if (model.list) {
    // Composite multi-field in the block's own properties panel, next to the child items
    // (e.g. the menu items of a header whose children are the submenu categories).
    const listId = model.list.attrs['data-item'];
    const subFields = uniqueFieldModels(model.list.fields, file);
    if (!subFields.length) throw new Error(`${file}: data-item="${listId}" precisa de ao menos um data-field.`);
    const taken = new Set([...blockFields, ...itemFields].map((field) => field.name));
    [listId, ...subFields.map((field) => field.name)].forEach((name) => {
      if (taken.has(name)) throw new Error(`${file}: campo "${name}" repetido.`);
      taken.add(name);
    });
    const before = model.blockFields.slice(0, model.list.at).flatMap((field) => fieldModel(field, file)).length;
    blockFields.splice(before, 0, {
      component: 'container',
      name: listId,
      label: model.list.attrs['data-item-title'] || listId,
      multi: true,
      fields: subFields,
    });
  }

  const { blockInners, itemInners } = extractDataFieldInners(html);
  const blockValues = fieldDefaults(model.blockFields, blockInners);
  // The nested list's cell has no default value in the UE template (authors add entries).
  const ownItemInners = model.nested ? itemInners.filter((_, index) => index !== model.nested.at) : itemInners;
  const itemValues = fieldDefaults(model.itemFields, ownItemInners);

  if (model.multi) {
    // Composite multi-field: the item becomes a repeatable group of fields in the block's
    // own properties panel (no child items, no filter), placed where the item sits.
    const itemId = model.item['data-item'];
    if (!itemId) throw new Error(`${file}: data-item sem id.`);
    if (!itemFields.length) throw new Error(`${file}: data-item precisa de ao menos um data-field.`);
    const before = model.blockFields.slice(0, model.itemAt).flatMap((field) => fieldModel(field, file)).length;
    const container = {
      component: 'container',
      name: itemId,
      label: model.item['data-item-title'] || itemId,
      multi: true,
      fields: itemFields,
    };
    const fields = [...blockFields.slice(0, before), container, ...blockFields.slice(before)];
    const names = new Set(blockFields.map((field) => field.name));
    itemFields.forEach((field) => {
      if (names.has(field.name) || field.name === itemId) throw new Error(`${file}: campo "${field.name}" repetido.`);
    });
    if (names.has(itemId)) throw new Error(`${file}: campo "${itemId}" repetido.`);
    return {
      definitions: [
        {
          title,
          id: blockId,
          plugins: {
            xwalk: {
              page: {
                resourceType: BLOCK_RESOURCE,
                template: { name: title, model: blockId, ...blockValues },
              },
            },
          },
        },
      ],
      models: [{ id: blockId, fields }],
      filters: [],
    };
  }

  if (!model.item) {
    return {
      definitions: [
        {
          title,
          id: blockId,
          plugins: {
            xwalk: {
              page: {
                resourceType: BLOCK_RESOURCE,
                template: { name: title, model: blockId, ...blockValues },
              },
            },
          },
        },
      ],
      models: [{ id: blockId, fields: blockFields }],
      filters: [],
    };
  }

  const itemId = model.item['data-item'];
  const itemTitle = model.item['data-item-title'] || itemId;
  if (!itemId) throw new Error(`${file}: data-item sem id.`);
  if (!itemFields.length) throw new Error(`${file}: data-item precisa de ao menos um data-field.`);

  /** @type {Record<string, unknown>} */
  const blockTemplate = {
    name: title,
    filter: blockId,
    ...blockValues,
    // Seed one child so authors see an item immediately; more are added via +.
    item_0: {
      name: itemTitle,
      model: itemId,
      ...itemValues,
    },
  };
  if (blockFields.length) blockTemplate.model = blockId;

  return {
    definitions: [
      {
        title,
        id: blockId,
        plugins: {
          xwalk: {
            page: {
              resourceType: BLOCK_RESOURCE,
              template: blockTemplate,
            },
          },
        },
      },
      {
        title: itemTitle,
        id: itemId,
        plugins: {
          xwalk: {
            page: {
              resourceType: ITEM_RESOURCE,
              template: { name: itemTitle, model: itemId, ...itemValues },
            },
          },
        },
      },
    ],
    models: [
      ...(blockFields.length ? [{ id: blockId, fields: blockFields }] : []),
      { id: itemId, fields: itemFields },
    ],
    filters: [{ id: blockId, components: [itemId] }],
  };
}

/**
 * @param {string} blockId
 * @param {string} html
 * @param {boolean} hasEnhance
 * @param {boolean} usesComponents the Block Source has data-ui="{component}" elements
 * @returns {string}
 */
function blockScript(blockId, html, hasEnhance, usesComponents) {
  const imports = [
    "import renderTemplate from '../../scripts/render-template.js';",
    usesComponents ? "import initComponents from '../../scripts/ui.js';" : '',
    hasEnhance ? `import enhance from './${blockId}.enhance.js';` : '',
  ].filter(Boolean).join('\n');
  // Components first: enhance.js finds them ready (and can listen to their ui:* events).
  const calls = [
    usesComponents ? '  await initComponents(block);\n' : '',
    hasEnhance ? '  await enhance(block);\n' : '',
  ].join('');
  const signature = calls ? 'export default async function decorate(block) {' : 'export default function decorate(block) {';
  return `/* eslint-disable max-len, quotes */
// ${GENERATED_HEADER} blocks/${blockId}/${blockId}.html. Do not edit.
${imports}

const template = ${JSON.stringify(html.trim())};

${signature}
  renderTemplate(block, template);
${calls}}
`;
}

/**
 * Scopes the compiled utilities to the block: every block ships its own copy of shared
 * utilities (e.g. `.flex-col`), so without a scope a later block stylesheet would beat a
 * responsive variant of an earlier one on the same page (same layer and specificity,
 * later source order wins). `@scope` keeps each block's rules inside it (scope root: the
 * block's parent, so the block element itself matches), adds no
 * specificity and lets the nearest block win for nested blocks.
 * @param {string} css Minified Tailwind output
 * @param {string} blockId
 * @returns {string}
 */
export function scopeUtilities(css, blockId) {
  const marker = '@layer utilities{';
  const start = css.indexOf(marker);
  if (start < 0) return css;
  let depth = 0;
  for (let i = start + marker.length - 1; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const inner = css.slice(start + marker.length, i);
        // The scope root is the block's parent so the block element itself (which gets the
        // Block Source root classes) is in scope; it also holds when enhance.js moves a block.
        return `${css.slice(0, start)}${marker}@scope (:has(> .${blockId})){${inner}}}${css.slice(i + 1)}`;
      }
    }
  }
  return css;
}

/**
 * Compiles the block's utilities (theme + component classes) scoped to the block.
 * @param {string} root
 * @param {object} config
 * @param {string} blockId
 * @returns {Promise<void>}
 */
async function compileCss(root, config, blockId) {
  const dir = path.join(root, 'blocks', blockId);
  const output = path.join(dir, `${blockId}.css`);
  const compiled = await compileTailwind({
    root, config, dir, sources: [path.join(dir, `${blockId}.html`)], output,
  });
  const css = scopeUtilities(compiled, blockId);
  await writeFile(output, `/* ${GENERATED_HEADER} blocks/${blockId}/${blockId}.html. Do not edit. */\n/* stylelint-disable */\n${css}`);
}

/**
 * @param {string} root
 * @param {string} blockId
 * @returns {Promise<void>}
 */
async function allowInSection(root, blockId) {
  const sectionPath = path.join(root, 'models', '_section.json');
  const section = JSON.parse(await readFile(sectionPath, 'utf8'));
  const filter = section.filters.find((entry) => entry.id === 'section');
  if (!filter) throw new Error('models/_section.json não tem o filtro "section".');
  if (!filter.components.includes(blockId)) {
    filter.components.push(blockId);
    await writeFile(sectionPath, `${JSON.stringify(section, null, 2)}\n`);
    console.log(`section filter: + ${blockId}`);
  }
}

/**
 * @param {string} root
 * @param {string} blockId
 * @returns {Promise<boolean>}
 */
export async function hasHtmlSource(root, blockId) {
  try {
    await access(path.join(root, 'blocks', blockId, `${blockId}.html`));
    return true;
  } catch {
    return false;
  }
}

/**
 * Block Build for one HTML-first block.
 * @param {{ root: string, config: object }} ctx
 * @param {string} blockId
 * @returns {Promise<void>}
 */
export async function buildBlock({ root, config }, blockId) {
  const dir = path.join(root, 'blocks', blockId);
  const htmlPath = path.join(dir, `${blockId}.html`);
  const html = await readFile(htmlPath, 'utf8');
  assertSourceGate(html, htmlPath);
  const model = readTemplate(html);
  if (model.block['data-block'] !== blockId) {
    throw new Error(`${htmlPath}: data-block "${model.block['data-block']}" precisa ser "${blockId}".`);
  }
  const usesComponents = assertDataUi(root, html, `blocks/${blockId}/${blockId}.html`).length > 0;
  const partial = componentPartial(blockId, model, htmlPath, html);
  await writeFile(path.join(dir, `_${blockId}.json`), `${JSON.stringify(partial, null, 2)}\n`);
  let hasEnhance = false;
  try {
    await readFile(path.join(dir, `${blockId}.enhance.js`));
    hasEnhance = true;
  } catch {
    hasEnhance = false;
  }
  await writeFile(path.join(dir, `${blockId}.js`), blockScript(blockId, html, hasEnhance, usesComponents));
  await compileCss(root, config, blockId);
  await allowInSection(root, blockId);
  const title = model.block['data-title'] || blockId;
  await syncDraft({
    root, blockId, title, html, strings: strings(config.language),
  });
  console.log(`${blockId}: _${blockId}.json, ${blockId}.js, ${blockId}.css`);
}

/**
 * Lists the HTML-first blocks of the project (blocks/{name}/{name}.html).
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function listHtmlFirstBlocks(root) {
  const entries = await readdir(path.join(root, 'blocks'), { withFileTypes: true });
  const found = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => ((await hasHtmlSource(root, entry.name)) ? entry.name : null)));
  return found.filter(Boolean).sort();
}

/**
 * Regenerates component-*.json aggregates (boilerplate `build:json` script).
 * @param {string} root
 * @returns {Promise<void>}
 */
export async function buildJson(root) {
  await run('npm', ['run', 'build:json', '--silent'], { cwd: root, capture: true });
}

/**
 * Block Build for the given blocks (or all HTML-first blocks) + aggregates. A full build
 * (no `only`) also builds every component showcase and styles/tailwind.css (IntelliSense).
 * @param {{ root: string, config: object }} ctx
 * @param {string[]} [only]
 * @returns {Promise<string[]>} built block ids
 */
export async function buildBlocks(ctx, only) {
  if (!only?.length) {
    await buildComponents(ctx);
    await syncIntellisense(ctx.root, ctx.config);
  }
  const requested = only?.map((name) => toClassName(name)).filter(Boolean) ?? [];
  let blocks = requested;
  if (requested.length) {
    await Promise.all(requested.map(async (blockId) => {
      if (!(await hasHtmlSource(ctx.root, blockId))) {
        throw new Error(`blocks/${blockId}/${blockId}.html não encontrado.`);
      }
    }));
  } else {
    blocks = await listHtmlFirstBlocks(ctx.root);
  }

  if (!blocks.length) {
    console.log('Nenhum blocks/{nome}/{nome}.html encontrado.');
    return [];
  }

  await blocks.reduce((queue, blockId) => queue.then(() => buildBlock(ctx, blockId)), Promise.resolve());
  await buildJson(ctx.root);
  return blocks;
}

/**
 * Paths of the Generated Artifacts of a block, relative to the project root.
 * @param {string} blockId
 * @returns {string[]}
 */
export function generatedPaths(blockId) {
  return [
    `blocks/${blockId}/_${blockId}.json`,
    `blocks/${blockId}/${blockId}.js`,
    `blocks/${blockId}/${blockId}.css`,
    `drafts/${blockId}.html`,
  ];
}

/**
 * Generated Artifacts of every component (showcases) + the IntelliSense entry that imports them.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function componentArtifactPaths(root) {
  const ids = await listComponents(root);
  return [...ids.flatMap(componentGeneratedPaths), 'styles/tailwind.css'];
}

export const AGGREGATE_PATHS = [
  'models/_section.json',
  'component-models.json',
  'component-definition.json',
  'component-filters.json',
];
