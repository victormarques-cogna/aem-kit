import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import checkA11y from './a11y.mjs';
import {
  AGGREGATE_PATHS, buildBlocks, buildJson, generatedPaths, hasHtmlSource, listHtmlFirstBlocks,
} from './build.mjs';
import { projectBin, run } from './project.mjs';

const BLOCK_SOURCE_RE = /^blocks\/([^/]+)\/\1\.(html|enhance\.js)$/;
const PARTIAL_RE = /(^|\/)_[^/]*\.json$/;

/**
 * @param {string} root
 * @param {string} filter git --diff-filter
 * @returns {Promise<string[]>}
 */
async function stagedFiles(root, filter) {
  const { stdout } = await run('git', ['diff', '--cached', '--name-only', `--diff-filter=${filter}`], { cwd: root, capture: true });
  return stdout.split('\n').filter(Boolean);
}

/**
 * @param {string} root
 * @param {string[]} files
 */
async function stage(root, files) {
  const existing = files.filter((file) => existsSync(path.join(root, file)));
  if (existing.length) await run('git', ['add', '--', ...existing], { cwd: root });
}

/**
 * Runs a validation step and records failures instead of stopping at the first one.
 * @param {string} label
 * @param {() => Promise<boolean>} step
 * @param {string[]} failures
 */
async function step(label, fn, failures) {
  console.log(`\n▸ ${label}`);
  try {
    const ok = await fn();
    if (!ok) failures.push(label);
  } catch (error) {
    console.error(error.message || error);
    failures.push(label);
  }
}

/**
 * @param {string} root
 * @param {string} bin
 * @param {string[]} args
 * @returns {Promise<boolean>}
 */
async function tool(root, bin, args) {
  const { code } = await run(projectBin(root, bin), args, { cwd: root, allowFail: true });
  return code === 0;
}

/**
 * Pre-commit (`--staged`) or full-project (CI) validation:
 * Block Build → ESLint → Stylelint → Prettier → semântica (html-validate) → acessibilidade (axe).
 * @param {{ root: string, config: object }} ctx
 * @param {{ staged?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export default async function check(ctx, { staged = false } = {}) {
  const { root } = ctx;
  const failures = [];
  let blocks;
  let files;

  if (staged) {
    const changed = await stagedFiles(root, 'ACMRD');
    const candidates = [...new Set(changed.map((file) => BLOCK_SOURCE_RE.exec(file)?.[1]).filter(Boolean))];
    const flags = await Promise.all(candidates.map((blockId) => hasHtmlSource(root, blockId)));
    blocks = candidates.filter((_, index) => flags[index]);

    if (blocks.length) {
      console.log(`▸ Block Build: ${blocks.join(', ')}`);
      await buildBlocks(ctx, blocks);
      // Stage only Generated Artifacts, never unrelated work in blocks/ or models/
      await stage(root, [...blocks.flatMap(generatedPaths), ...AGGREGATE_PATHS]);
    } else if (changed.some((file) => PARTIAL_RE.test(file))) {
      console.log('▸ build:json (model partials staged)');
      await buildJson(root);
      await stage(root, AGGREGATE_PATHS.filter((file) => file.startsWith('component-')));
    }

    files = (await stagedFiles(root, 'ACMR')).filter((file) => existsSync(path.join(root, file)));
    if (!files.length) return true;
  } else {
    console.log('▸ Block Build (todos os blocos HTML-first)');
    // Generated Artifacts must already match their Block Sources (CI catches a forgotten build)
    const tracked = [...(await listHtmlFirstBlocks(root)).flatMap(generatedPaths), ...AGGREGATE_PATHS];
    const snapshot = (list) => Promise.all(list.map((file) => readFile(path.join(root, file), 'utf8').catch(() => null)));
    const before = await snapshot(tracked);
    blocks = await buildBlocks(ctx);
    const after = await snapshot(tracked);
    const stale = tracked.filter((_, index) => before[index] !== after[index]);
    if (stale.length) {
      console.error(`Generated Artifacts desatualizados (o build acabou de regerá-los; revise e commite):\n  ${stale.join('\n  ')}`);
      failures.push('Generated Artifacts');
    }
  }

  const pick = (re) => (files ? files.filter((file) => re.test(file)) : null);
  const jsFiles = pick(/\.(js|mjs|cjs|json)$/);
  const cssFiles = pick(/\.css$/);
  const sources = blocks.map((blockId) => `blocks/${blockId}/${blockId}.html`)
    .filter((file) => existsSync(path.join(root, file)));

  if (!jsFiles || jsFiles.length) {
    await step('ESLint', () => tool(root, 'eslint', jsFiles ?? ['.', '--ext', '.json,.js,.mjs']), failures);
  }
  if (!cssFiles || cssFiles.length) {
    const targets = cssFiles ?? ['blocks/**/*.css', 'styles/*.css'];
    await step('Stylelint', () => tool(root, 'stylelint', ['--allow-empty-input', ...targets]), failures);
  }
  await step('Prettier', () => tool(root, 'prettier', ['--check', '--ignore-unknown', ...(files ?? ['.'])]), failures);
  if (sources.length) {
    await step('Semântica (html-validate)', () => tool(root, 'html-validate', sources), failures);
    await step('Acessibilidade (axe)', () => checkA11y(root, blocks), failures);
  }

  if (failures.length) {
    console.error(`\n✖ aem-kit check falhou: ${failures.join(', ')}`);
    return false;
  }
  console.log('\n✔ aem-kit check ok');
  return true;
}
