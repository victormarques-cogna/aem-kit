import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const BLOCKING = new Set(['serious', 'critical']);
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Minimal static server: the project files + extensionless /drafts/{name} pages.
 * @param {string} root
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
function serve(root) {
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    let file = path.join(root, decodeURIComponent(pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (!path.extname(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => { server.close(() => done()); }),
      });
    });
  });
}

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
 * @param {import('playwright').Browser} browser
 * @param {string} baseUrl
 * @param {Function} AxeBuilder
 * @param {string} blockId
 * @returns {Promise<boolean>}
 */
async function checkBlock(browser, baseUrl, AxeBuilder, blockId) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // Only the local server: keeps the check fast and independent of the network (fonts, martech).
    await page.route('**/*', (route) => (route.request().url().startsWith(baseUrl) ? route.continue() : route.abort()));
    await page.goto(`${baseUrl}/drafts/${blockId}`);
    try {
      const loaded = `main .${blockId}[data-block-status="loaded"]`;
      await page.waitForSelector(loaded, { state: 'attached', timeout: 15000 });
    } catch {
      console.error(`✖ a11y ${blockId}: o bloco não carregou em drafts/${blockId}.html (veja erros no console do navegador).`);
      return false;
    }
    const result = await new AxeBuilder({ page }).include(`main .${blockId}`).withTags(TAGS).analyze();
    const blocking = result.violations.filter((v) => BLOCKING.has(v.impact));
    const warnings = result.violations.filter((v) => !BLOCKING.has(v.impact));
    [...blocking, ...warnings].forEach((violation) => {
      const isBlocking = BLOCKING.has(violation.impact);
      const nodes = violation.nodes.slice(0, 3).map((node) => `    → ${node.target.join(' ')}`).join('\n');
      const title = `${isBlocking ? '✖' : '⚠'} a11y ${blockId} [${violation.impact}] ${violation.id}: ${violation.help}`;
      console[isBlocking ? 'error' : 'warn'](`${title}\n    ${violation.helpUrl}\n${nodes}`);
    });
    if (!blocking.length) console.log(`✔ a11y ${blockId}${warnings.length ? ` (${warnings.length} aviso(s))` : ''}`);
    return !blocking.length;
  } finally {
    await context.close();
  }
}

/**
 * Renders drafts/{block}.html in headless Chromium and runs axe on the block element.
 * Fails on serious/critical violations; moderate/minor are warnings.
 * @param {string} root
 * @param {string[]} blocks
 * @returns {Promise<boolean>} true when no blocking violation was found
 */
export default async function checkA11y(root, blocks) {
  const targets = blocks.filter((blockId) => existsSync(path.join(root, 'drafts', `${blockId}.html`)));
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
      (queue, blockId) => queue.then(async (done) => [...done, await checkBlock(browser, server.url, AxeBuilder, blockId)]),
      Promise.resolve([]),
    );
    return results.every(Boolean);
  } finally {
    await browser.close();
    await server.close();
  }
}
