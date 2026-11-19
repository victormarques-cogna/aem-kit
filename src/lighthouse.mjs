import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { run } from './project.mjs';
import serve from './serve.mjs';

export const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
// Pre-commit: deterministic categories only. Performance varies too much on a dev machine
// to block a commit; CI (`aem-kit check`) and the post-deploy run cover it.
export const STAGED_CATEGORIES = ['accessibility', 'best-practices', 'seo'];

const LABELS = {
  performance: 'Performance',
  accessibility: 'Acessibilidade',
  'best-practices': 'Boas práticas',
  seo: 'SEO',
};
// AEM always serves *.aem.page / *.aem.live with `x-robots-tag: noindex`: only the
// production domain is crawlable, so that audit is meaningless there.
const AEM_HOST = /\.aem\.(page|live)$/;
// Drafts are local test pages: their canonical (https://localhost/...) is never the real one.
const DRAFT_SKIPPED = ['canonical'];
// Served code that Code Sync publishes (Block Sources are excluded by .hlxignore).
const SERVED_CODE = /^(blocks|scripts|styles)\/.+\.(js|css)$/;

/**
 * Lighthouse settings from aem-kit.config.json (`lighthouse`), with defaults.
 * @param {object} config
 * @returns {{ minScore: number, formFactor: string, runs: number, urls: string[], skipAudits: string[] }}
 */
export function lighthouseSettings(config) {
  const lh = config?.lighthouse ?? {};
  return {
    minScore: lh.minScore ?? 90,
    formFactor: lh.formFactor ?? 'mobile',
    runs: lh.runs ?? 3,
    urls: lh.urls ?? ['/'],
    skipAudits: lh.skipAudits ?? [],
  };
}

/**
 * @param {string} root
 */
async function loadTools(root) {
  const require = createRequire(path.join(root, 'package.json'));
  let lighthouse;
  try {
    lighthouse = await import(require.resolve('lighthouse'));
  } catch {
    throw new Error('Lighthouse não está instalado no projeto. Rode "npm run aem:init" (ou "npm i -D lighthouse").');
  }
  const launcher = await import(require.resolve('chrome-launcher'));
  const desktop = await import(require.resolve('lighthouse/core/config/desktop-config.js'));
  const playwright = await import(require.resolve('playwright'));
  const chromium = playwright.chromium ?? playwright.default.chromium;
  return {
    lighthouse: lighthouse.default,
    launch: launcher.launch ?? launcher.default.launch,
    desktopConfig: desktop.default,
    chromePath: chromium.executablePath(),
  };
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * @param {object} lhr Lighthouse result
 * @param {string} category
 * @returns {number} 0–100
 */
function score(lhr, category) {
  return Math.round((lhr.categories[category]?.score ?? 0) * 100);
}

/**
 * Prints the audits that cost the most points in a category.
 * @param {object} lhr
 * @param {string} category
 */
function printCulprits(lhr, category) {
  const refs = lhr.categories[category]?.auditRefs ?? [];
  refs
    .filter((ref) => ref.weight > 0)
    .map((ref) => ({ ref, audit: lhr.audits[ref.id] }))
    .filter(({ audit }) => audit && audit.score !== null && audit.score < 1)
    .sort((a, b) => (b.ref.weight * (1 - b.audit.score)) - (a.ref.weight * (1 - a.audit.score)))
    .slice(0, 5)
    .forEach(({ audit }) => {
      const value = audit.displayValue ? ` (${audit.displayValue})` : '';
      console.error(`    → ${audit.id}: ${audit.title}${value}`);
      (audit.details?.items ?? []).slice(0, 2).forEach((item) => {
        const where = item.node?.selector ?? item.node?.snippet ?? item.url ?? item.source?.url;
        if (where) console.error(`        ${String(where).slice(0, 140)}`);
      });
    });
}

/**
 * @param {Function} lighthouse
 * @param {number} port Chrome debugging port
 * @param {string} url
 * @param {object} opts
 * @returns {Promise<object>} lhr
 */
async function runAudit(lighthouse, port, url, {
  categories, formFactor, skipAudits, desktopConfig,
}) {
  const flags = {
    port, output: 'json', logLevel: 'error', onlyCategories: categories, skipAudits,
  };
  const result = await lighthouse(url, flags, formFactor === 'desktop' ? desktopConfig : undefined);
  if (!result?.lhr) throw new Error(`Lighthouse não retornou resultado para ${url}.`);
  if (result.lhr.runtimeError) throw new Error(`${url}: ${result.lhr.runtimeError.message}`);
  return result.lhr;
}

/**
 * Waits until the code of the last commit is live on `base` (AEM Code Sync), comparing
 * each changed JS/CSS file with the copy served there. Gives up after `timeoutMs`.
 * @param {string} root
 * @param {string} base
 * @param {number} [timeoutMs]
 */
export async function waitForCodeSync(root, base, timeoutMs = 10 * 60 * 1000) {
  const { stdout } = await run('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd: root, capture: true, allowFail: true });
  const files = stdout.split('\n').filter((file) => SERVED_CODE.test(file) && existsSync(path.join(root, file)));
  if (!files.length) return;
  console.log(`▸ Aguardando o Code Sync publicar ${files.length} arquivo(s) em ${base}`);
  const deadline = Date.now() + timeoutMs;
  const expected = await Promise.all(files.map((file) => readFile(path.join(root, file), 'utf8')));
  /* eslint-disable no-await-in-loop -- polling */
  while (Date.now() < deadline) {
    const served = await Promise.all(files.map(async (file) => {
      const response = await fetch(`${base}/${file}?aem-kit=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
      return response?.ok ? response.text() : null;
    }));
    if (served.every((text, index) => text === expected[index])) {
      console.log('✔ Code Sync concluído');
      return;
    }
    await new Promise((resolve) => { setTimeout(resolve, 15000); });
  }
  /* eslint-enable no-await-in-loop */
  throw new Error(`O código do último commit não apareceu em ${base} em ${Math.round(timeoutMs / 60000)} min.`);
}

/**
 * Production URL of the current branch: `main` → {repo}--{owner}.aem.live, others → .aem.page.
 * Uses the GitHub Actions environment when present, else the git remote.
 * @param {string} root
 * @returns {Promise<string>}
 */
export async function deployedBase(root) {
  let repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    const { stdout } = await run('git', ['remote', 'get-url', 'origin'], { cwd: root, capture: true });
    repository = stdout.trim().replace(/\.git$/, '').split(/[:/]/).slice(-2)
      .join('/');
  }
  let branch = process.env.GITHUB_REF_NAME;
  if (!branch) {
    const { stdout } = await run('git', ['branch', '--show-current'], { cwd: root, capture: true });
    branch = stdout.trim();
  }
  const [owner, repo] = repository.toLowerCase().split('/');
  const ref = branch.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `https://${ref}--${repo}--${owner}.${ref === 'main' ? 'aem.live' : 'aem.page'}`;
}

/**
 * Runs Lighthouse on block Drafts and/or URLs and fails when any category scores below
 * `minScore`. When Performance fails the first run, it is the median of `runs` runs.
 * @param {string} root
 * @param {object} config aem-kit config
 * @param {{ blocks?: string[], urls?: string[], categories?: string[], runs?: number }} opts
 * @returns {Promise<boolean>}
 */
export default async function checkLighthouse(root, config, {
  blocks = [], urls = [], categories = CATEGORIES, runs,
} = {}) {
  const settings = lighthouseSettings(config);
  const maxRuns = runs ?? settings.runs;
  const drafts = blocks.filter((blockId) => existsSync(path.join(root, 'drafts', `${blockId}.html`)));
  if (!drafts.length && !urls.length) return true;

  const tools = await loadTools(root);
  let chrome;
  try {
    chrome = await tools.launch({ chromePath: tools.chromePath, chromeFlags: ['--headless=new', '--no-sandbox'] });
  } catch (error) {
    throw new Error(`Não foi possível abrir o Chromium do Playwright. Rode "npx playwright install chromium".\n${error.message}`);
  }
  const server = drafts.length ? await serve(root) : null;

  const targets = [
    ...drafts.map((blockId) => ({ label: `drafts/${blockId}`, url: `${server.url}/drafts/${blockId}`, skip: DRAFT_SKIPPED })),
    ...urls.map((url) => ({ label: url, url, skip: AEM_HOST.test(new URL(url).hostname) ? ['is-crawlable'] : [] })),
  ];

  /**
   * @param {{ label: string, url: string, skip: string[] }} target
   * @returns {Promise<boolean>}
   */
  const checkTarget = async (target) => {
    const opts = {
      categories,
      formFactor: settings.formFactor,
      skipAudits: [...settings.skipAudits, ...target.skip],
      desktopConfig: tools.desktopConfig,
    };
    const lhr = await runAudit(tools.lighthouse, chrome.port, target.url, opts);
    const perfRuns = [lhr];
    if (categories.includes('performance')) {
      /* eslint-disable no-await-in-loop -- re-runs are sequential by nature */
      // Below the minimum: measure `runs` times in total and keep the median (filters out noise).
      const rerun = score(lhr, 'performance') < settings.minScore;
      while (rerun && perfRuns.length < maxRuns) {
        perfRuns.push(await runAudit(tools.lighthouse, chrome.port, target.url, { ...opts, categories: ['performance'] }));
      }
      /* eslint-enable no-await-in-loop */
    }
    const perfScores = perfRuns.map((result) => score(result, 'performance'));
    const perf = median(perfScores);
    const perfLhr = perfRuns.find((result) => score(result, 'performance') === perf);

    const scores = categories.map((category) => ({
      category,
      value: category === 'performance' ? perf : score(lhr, category),
    }));
    const failing = scores.filter(({ value }) => value < settings.minScore);
    const summary = scores.map(({ category, value }) => `${LABELS[category]} ${value}`).join(' · ');
    const runsNote = perfRuns.length > 1 ? ` (Performance: mediana de ${perfScores.join(', ')})` : '';
    if (!failing.length) {
      console.log(`✔ lighthouse ${target.label}: ${summary}${runsNote}`);
      return true;
    }
    console.error(`✖ lighthouse ${target.label}: ${summary}${runsNote} — mínimo ${settings.minScore}`);
    failing.forEach(({ category }) => {
      console.error(`  ${LABELS[category]}:`);
      printCulprits(category === 'performance' ? perfLhr : lhr, category);
    });
    return false;
  };

  try {
    // Sequential on purpose: Lighthouse needs the whole machine for stable timings.
    const results = await targets.reduce(
      (queue, target) => queue.then(async (done) => [...done, await checkTarget(target)]),
      Promise.resolve([]),
    );
    return results.every(Boolean);
  } finally {
    await chrome.kill();
    await server?.close();
  }
}
