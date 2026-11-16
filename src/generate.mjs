import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildBlock, buildJson } from './build.mjs';
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
