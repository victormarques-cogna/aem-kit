import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildBlock, buildBlocks, buildJson } from './build.mjs';
import { COMPONENTS_DIR } from './components.mjs';
import strings from './i18n.mjs';
import { stripAccents, toClassName, toTitle } from './names.mjs';

/**
 * @param {string} blockId
 * @param {string} title
 * @param {object} text i18n strings
 * @returns {string}
 */
function blockSource(blockId, title, text) {
  return `<div data-block="${blockId}" data-title="${title}" class="flex flex-col gap-4">
  <h2
    data-field="heading"
    data-component="text"
    data-label="${text.headingLabel}"
    class="text-2xl font-semibold"
  >${text.headingDefault}</h2>
  <div
    data-field="text"
    data-component="richtext"
    data-label="${text.textLabel}"
    class="text-base"
  ><p>${text.textDefault}</p></div>
</div>
`;
}

/**
 * Formats with the project's Prettier config so the scaffold passes `format:check`.
 * @param {string} root
 * @param {string} file
 * @param {string} source
 * @returns {Promise<string>}
 */
async function formatWithPrettier(root, file, source) {
  const require = createRequire(path.join(root, 'package.json'));
  const mod = await import(require.resolve('prettier'));
  const prettier = mod.format ? mod : mod.default;
  const options = await prettier.resolveConfig(file);
  return prettier.format(source, { ...options, filepath: file });
}

/**
 * Block Scaffold: Block Source (+ Draft via Block Build).
 * @param {{ root: string, config: object }} ctx
 * @param {string} rawName
 * @returns {Promise<string>} block id
 */
export default async function generateBlock(ctx, rawName) {
  // Strip diacritics: block class names follow toClassName from scripts/aem.js, which only keeps
  // [0-9a-z], so "Seção" would otherwise become "se-o". data-title must stay consistent with it.
  const name = stripAccents(rawName).trim();
  if (!name) throw new Error('Uso: npm run aem:generate-block -- <nome>');

  const blockId = toClassName(name);
  const title = toTitle(name);
  if (!blockId) throw new Error('Nome de bloco inválido.');

  const blockDir = path.join(ctx.root, 'blocks', blockId);
  const htmlPath = path.join(blockDir, `${blockId}.html`);
  const draftPath = path.join(ctx.root, 'drafts', `${blockId}.html`);
  if (existsSync(blockDir) || existsSync(draftPath)) {
    throw new Error(`Bloco "${blockId}" já existe (blocks/${blockId} ou drafts/${blockId}.html). Abortando.`);
  }

  const source = blockSource(blockId, title, strings(ctx.config.language));
  const formatted = await formatWithPrettier(ctx.root, htmlPath, source);
  await mkdir(blockDir, { recursive: true });
  await writeFile(htmlPath, formatted);
  await buildBlock(ctx, blockId);
  await buildJson(ctx.root);

  console.log(`Criado blocks/${blockId}/${blockId}.html`);
  console.log(`Criado drafts/${blockId}.html (preview em /drafts/${blockId})`);
  return blockId;
}

/**
 * @param {string} id
 * @returns {string} components/{id}/{id}.css starter
 */
function componentCss(id) {
  return `/* Classes do componente: só @utility com nomes que começam por "${id}" (ex.: ${id}, ${id}-primary). */
@utility ${id} {
  @apply inline-flex items-center gap-2;
}
`;
}

/**
 * @param {string} id
 * @param {boolean} withJs
 * @param {object} text i18n strings
 * @returns {string} components/{id}/{id}.html starter (showcase)
 */
function componentShowcase(id, withJs, text) {
  const ui = withJs ? ` data-ui="${id}"` : '';
  return `<!-- Vitrine: mostre aqui todas as variantes e estados do componente. -->
<div${ui} class="${id}">${text.componentSample}</div>
`;
}

/**
 * @param {string} id
 * @returns {string} components/{id}/{id}.js starter
 */
function componentScript(id) {
  return `/**
 * Comportamento do componente: chamado uma vez para cada elemento com data-ui="${id}".
 * Use o HTML nativo primeiro e deixe aqui só o que falta. Ache as partes por data-ui-part,
 * nunca por classe, e avise o block com eventos ui:${id}:{ação}.
 * @param {HTMLElement} root
 */
export default function init(root) {
  root.dispatchEvent(new CustomEvent('ui:${id}:ready', { bubbles: true }));
}
`;
}

/**
 * Component Scaffold: components/{id}/{id}.css + .html (+ .js), then the showcase build.
 * @param {{ root: string, config: object }} ctx
 * @param {string} rawName
 * @param {{ js?: boolean }} [opts]
 * @returns {Promise<string>} component id
 */
export async function generateComponent(ctx, rawName, { js = false } = {}) {
  const id = toClassName(stripAccents(rawName).trim());
  if (!id) throw new Error('Uso: npm run aem:generate-component -- <nome> [--js]');
  const dir = path.join(ctx.root, COMPONENTS_DIR, id);
  if (existsSync(dir)) throw new Error(`Componente "${id}" já existe (components/${id}). Abortando.`);

  await mkdir(dir, { recursive: true });
  const files = [
    [`${id}.css`, componentCss(id)],
    [`${id}.html`, componentShowcase(id, js, strings(ctx.config.language))],
  ];
  await Promise.all(files.map(async ([name, source]) => {
    const file = path.join(dir, name);
    await writeFile(file, await formatWithPrettier(ctx.root, file, source));
  }));
  if (js) await writeFile(path.join(dir, `${id}.js`), componentScript(id));
  // Every block is compiled with every component's classes: rebuild all (+ showcases, IntelliSense).
  await buildBlocks(ctx);

  console.log(`Criado components/${id}/ (${id}.css, ${id}.html${js ? `, ${id}.js` : ''})`);
  console.log(`Vitrine em /drafts/components/${id}`);
  return id;
}
