import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import serve from './serve.mjs';

const BLOCKING = new Set(['serious', 'critical']);
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * @param {string} root
 * @returns {Promise<{ chromium: object, AxeBuilder: Function }>}
 */
async function loadTools(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const playwright = await import(require.resolve('playwright'));
  const axe = await import(require.resolve('@axe-core/playwright'));
  const AxeBuilder = axe.default?.default ?? axe.default ?? axe.AxeBuilder;
  return { chromium: playwright.chromium ?? playwright.default.chromium, AxeBuilder };
}

/**
 * @typedef {{ label: string, page: string, ready: string, include: string }} Target
 *   page: path of the Draft (without .html); ready: selector that means "rendered"; include: axe scope
 */

/**
 * @param {import('playwright').Browser} browser
 * @param {string} baseUrl
 * @param {Function} AxeBuilder
 * @param {Target} target
 * @returns {Promise<boolean>}
 */
async function checkPage(browser, baseUrl, AxeBuilder, target) {
  const { label } = target;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // Only the local server: keeps the check fast and independent of the network (fonts, martech).
    await page.route('**/*', (route) => (route.request().url().startsWith(baseUrl) ? route.continue() : route.abort()));
    await page.goto(`${baseUrl}/${target.page}`);
    try {
      await page.waitForSelector(target.ready, { state: 'attached', timeout: 15000 });
    } catch {
      console.error(`✖ a11y ${label}: a página ${target.page}.html não carregou (veja erros no console do navegador).`);
      return false;
    }
    const result = await new AxeBuilder({ page }).include(target.include).withTags(TAGS).analyze();
    const blocking = result.violations.filter((v) => BLOCKING.has(v.impact));
    const warnings = result.violations.filter((v) => !BLOCKING.has(v.impact));
    [...blocking, ...warnings].forEach((violation) => {
      const isBlocking = BLOCKING.has(violation.impact);
      const nodes = violation.nodes.slice(0, 3).map((node) => `    → ${node.target.join(' ')}`).join('\n');
      const title = `${isBlocking ? '✖' : '⚠'} a11y ${label} [${violation.impact}] ${violation.id}: ${violation.help}`;
      console[isBlocking ? 'error' : 'warn'](`${title}\n    ${violation.helpUrl}\n${nodes}`);
    });
    if (!blocking.length) console.log(`✔ a11y ${label}${warnings.length ? ` (${warnings.length} aviso(s))` : ''}`);
    return !blocking.length;
  } finally {
    await context.close();
  }
}

/**
 * Renders drafts/{block}.html (and drafts/components/{id}.html) in headless Chromium and runs
 * axe on the block element (or the showcase's main). Fails on serious/critical violations;
 * moderate/minor are warnings.
 * @param {string} root
 * @param {string[]} blocks
 * @param {string[]} [components]
 * @returns {Promise<boolean>} true when no blocking violation was found
 */
export default async function checkA11y(root, blocks, components = []) {
  /** @type {Target[]} */
  const targets = [
    ...blocks.map((blockId) => ({
      label: blockId,
      page: `drafts/${blockId}`,
      ready: `main .${blockId}[data-block-status="loaded"]`,
      include: `main .${blockId}`,
    })),
    ...components.map((id) => ({
      label: `components/${id}`, page: `drafts/components/${id}`, ready: 'main', include: 'main',
    })),
  ].filter((target) => existsSync(path.join(root, `${target.page}.html`)));
  if (!targets.length) return true;

  const { chromium, AxeBuilder } = await loadTools(root);
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(`Não foi possível abrir o Chromium do Playwright. Rode "npx playwright install chromium".\n${error.message}`);
  }

  const server = await serve(root);
  try {
    // Sequential on purpose: one page at a time keeps the output readable and memory low.
    const results = await targets.reduce(
      (queue, target) => queue.then(async (done) => [...done, await checkPage(browser, server.url, AxeBuilder, target)]),
      Promise.resolve([]),
    );
    return results.every(Boolean);
  } finally {
    await browser.close();
    await server.close();
  }
}
