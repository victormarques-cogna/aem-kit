import { existsSync, readFileSync } from 'node:fs';
import {
  mkdir, readFile, rm, rmdir, writeFile, readdir,
} from 'node:fs/promises';
import path from 'node:path';
import { buildBlocks } from './build.mjs';
import { CONFIG_FILE, STARTER_CONFIG, loadConfig } from './config.mjs';
import { KIT_ROOT, kitPackage, run } from './project.mjs';
import {
  fontFallbackFace, fontNames, fontVars, themeBlock, utilityOverrides,
} from './theme.mjs';

const T = (file) => path.join(KIT_ROOT, 'templates', file);
const LANGUAGE_NAMES = { 'pt-BR': 'Portuguese (PT-BR)', en: 'English' };
const NOTES_START = '<!-- project-notes:start -->';
const NOTES_END = '<!-- project-notes:end -->';

/** Files of the pre-package toolchain (copied into tools/) that the kit replaces. */
const LEGACY_FILES = [
  'tools/aem-init.mjs',
  'tools/build-blocks.mjs',
  'tools/generate-block.mjs',
  'tools/watch-blocks.mjs',
  'tools/lib/names.mjs',
  'tools/lib/source-gate.mjs',
  'tools/lib/sync-draft.mjs',
  // npm is the package manager; npm also reads a yarn.lock and fails `npm ci` when they disagree.
  'yarn.lock',
];
const LEGACY_SCRIPTS = ['build:blocks', 'aem:up:server'];
// ESLint override that the pre-package toolchain added for its tools/ scripts.
const LEGACY_ESLINT_OVERRIDE = `  overrides: [
    {
      files: ['tools/**/*.mjs'],
      env: { node: true },
      rules: {
        'import/extensions': 'off',
        'import/no-unresolved': 'off',
        'no-console': 'off',
        'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
      },
    },
  ],
`;
const BOILERPLATE_FONTS = ['roboto-bold.woff2', 'roboto-condensed-bold.woff2', 'roboto-medium.woff2', 'roboto-regular.woff2'];

/**
 * @param {string} template
 * @param {Record<string, string>} values
 * @returns {string}
 */
function fill(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => (key in values ? values[key] : match));
}

/**
 * Replaces the content of a marked region (`aem-kit:{name}:start` … `aem-kit:{name}:end`).
 * @param {string} source
 * @param {string} name
 * @param {string} content
 * @returns {string | null} null when the markers are missing
 */
function replaceRegion(source, name, content) {
  const start = source.indexOf(`aem-kit:${name}:start`);
  const end = source.indexOf(`aem-kit:${name}:end`);
  if (start < 0 || end < start) return null;
  // The region starts on the line after the start comment closes (it may span several lines)
  const close = source.indexOf('*/', start);
  const from = source.indexOf('\n', close) + 1;
  const to = source.lastIndexOf('\n', end) + 1;
  return `${source.slice(0, from)}${content}${source.slice(to)}`;
}

/**
 * @param {string} source
 * @returns {string | null} project notes between the markers
 */
function projectNotes(source) {
  const start = source.indexOf(NOTES_START);
  const end = source.indexOf(NOTES_END);
  if (start < 0 || end < start) return null;
  return source.slice(start + NOTES_START.length, end).replace(/^\n|\n$/g, '');
}

/**
 * @param {object} config
 * @returns {string} Markdown table of the design tokens
 */
function tokensMarkdown(config) {
  const { stack } = fontNames(config);
  const rows = [
    '| Token | Value | Tailwind |',
    '| --- | --- | --- |',
    `| font | \`${stack}\` | \`font-sans\` (also the page default) |`,
    ...Object.entries(config.colors ?? {}).map(([name, value]) => (
      `| color \`${name}\` | \`${value}\` | \`bg-${name}\`, \`text-${name}\`, \`border-${name}\`… |`
    )),
  ];
  const breakpoints = Object.entries(config.breakpoints ?? {});
  const bp = breakpoints.length
    ? `Breakpoints (project): ${breakpoints.map(([name, value]) => `\`${name}\` ${value}`).join(', ')}.`
    : 'Breakpoints: Tailwind defaults (`sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px).';
  return `${rows.join('\n')}\n\n${bp}`;
}

/**
 * @param {string} root
 * @returns {Promise<{ owner: string, repo: string } | null>}
 */
async function gitRemote(root) {
  try {
    const { stdout } = await run('git', ['remote', 'get-url', 'origin'], { cwd: root, capture: true });
    const match = /github\.com[:/]([^/]+)\/([^/.\s]+)(\.git)?\s*$/.exec(stdout.trim());
    return match ? { owner: match[1], repo: match[2] } : null;
  } catch {
    return null;
  }
}

/**
 * Applies aem-kit to the project. Idempotent.
 * @param {string} root
 * @param {{ force?: boolean, skipInstall?: boolean, kitSpec?: string, diff?: boolean }} opts
 * @returns {Promise<boolean>} false when the starter config was created and init stopped
 */
export default async function init(root, opts = {}) {
  const kit = kitPackage();
  const report = [];
  const note = (status, file) => report.push([status, file]);

  // 1. Kit Config
  const config = loadConfig(root);
  if (!config) {
    const remote = await gitRemote(root);
    const starter = structuredClone(STARTER_CONFIG);
    if (remote) starter.project.name = remote.repo;
    await writeFile(path.join(root, CONFIG_FILE), `${JSON.stringify(starter, null, 2)}\n`);
    console.log(`Criei ${CONFIG_FILE} com valores de exemplo. Preencha nome, descrição, idioma, fonte e cores e rode o init de novo.`);
    return false;
  }

  // 2. Safety: everything the init writes must be reviewable with git diff
  if (!opts.force) {
    const { stdout } = await run('git', ['status', '--porcelain'], { cwd: root, capture: true });
    const dirty = stdout.split('\n').filter(Boolean).filter((line) => !line.endsWith(CONFIG_FILE));
    if (dirty.length) {
      throw new Error(`Working tree com alterações. Commite ou descarte antes do init (ou use --force):\n${dirty.join('\n')}`);
    }
  }

  const write = async (rel, content) => {
    const file = path.join(root, rel);
    const current = existsSync(file) ? await readFile(file, 'utf8') : null;
    if (current === content) return;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    note(current === null ? 'criado' : 'atualizado', rel);
  };
  const template = (file) => readFileSync(T(file), 'utf8');
  const remote = await gitRemote(root);

  // 3. package.json: scripts, devDependencies, identity (only while it is still the boilerplate's)
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.scripts ??= {};
  LEGACY_SCRIPTS.forEach((name) => delete pkg.scripts[name]);
  Object.assign(pkg.scripts, {
    'aem:init': 'aem-kit init',
    'aem:generate-block': 'aem-kit generate-block',
    'aem:build': 'aem-kit build',
    'aem:watch': 'aem-kit watch',
    'aem:up': 'aem-kit up',
    check: 'aem-kit check',
    format: 'prettier --write .',
    'format:check': 'prettier --check .',
  });
  const officialSpec = kit.aemKit.packageSpec.replace('{version}', kit.version);
  const currentSpec = pkg.devDependencies?.['aem-kit'];
  // Also accepts the short `github:` form, so projects that used it are moved to the HTTPS spec.
  const isOfficial = [officialSpec.split('#')[0], 'github:victormarques-cogna/aem-kit']
    .some((prefix) => currentSpec?.startsWith(prefix));
  const kitSpec = opts.kitSpec ?? (!currentSpec || isOfficial ? officialSpec : currentSpec);
  pkg.devDependencies = Object.fromEntries(Object.entries({
    ...pkg.devDependencies,
    ...kit.aemKit.projectDevDependencies,
    'aem-kit': kitSpec,
  }).sort(([a], [b]) => a.localeCompare(b)));
  if (pkg.name === '@adobe/aem-boilerplate') {
    pkg.name = remote?.repo ?? path.basename(root);
    pkg.description = config.project.description ?? pkg.description;
    delete pkg.author;
    if (remote) {
      const base = `https://github.com/${remote.owner}/${remote.repo}`;
      pkg.repository = { type: 'git', url: `git+${base}.git` };
      pkg.bugs = { url: `${base}/issues` };
      pkg.homepage = `${base}#readme`;
    }
  }
  await write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

  // 4. Managed Files (always overwritten)
  const header = (text, style) => (style === 'js' ? `// ${text}\n` : `/* ${text} */\n`);
  const managedNote = 'Managed by aem-kit. Do not edit: regenerated by `npm run aem:init`.';
  await write('scripts/render-template.js', header(managedNote, 'js') + template('managed/render-template.js'));
  await write('.prettierrc.json', template('managed/prettierrc.json'));
  await write('.prettierignore', template('managed/prettierignore'));
  await write('.stylelintrc.json', template('managed/stylelintrc.json'));
  await write('.htmlvalidate.json', template('managed/htmlvalidate.json'));
  await write('.editorconfig', template('managed/editorconfig'));
  await write('.npmrc', template('managed/npmrc'));
  await write('.vscode/settings.json', template('managed/vscode-settings.json'));
  await write('.vscode/extensions.json', template('managed/vscode-extensions.json'));
  await write('.husky/pre-commit', template('managed/husky-pre-commit'));
  await write('.husky/pre-commit.mjs', template('managed/husky-pre-commit.mjs'));
  await write('.github/workflows/aem-kit-check.yaml', template('managed/workflow-check.yaml'));
  await write('docs/adr/0001-html-first-blocks-tailwind.md', template('adr-0001.md'));
  await write('CLAUDE.md', template('managed/claude.md'));
  await write('.cursor/rules/aem-kit.mdc', template('managed/cursor-rule.mdc'));
  await write('.claude/commands/criar-bloco.md', `---
description: Cria um bloco HTML-first a partir de print, Figma ou descrição
argument-hint: <print, link do Figma ou descrição>
---

${fill(template('managed/criar-bloco.md'), { ARGS: '$ARGUMENTS' })}`);
  await write('.cursor/commands/criar-bloco.md', fill(template('managed/criar-bloco.md'), {
    ARGS: 'o texto, imagem ou link informado junto com o comando',
  }));

  // 5. Files generated from the Kit Config (managed)
  await write('styles/fonts.css', config.font.url
    ? `${header(`${managedNote} Source: font.url in ${CONFIG_FILE}.`)}@import url('${config.font.url}');\n`
    : `${header(`${managedNote} No font.url in ${CONFIG_FILE}: the font must be installed locally or self-hosted.`)}`);
  const intellisenseNote = `${managedNote}\n * Tailwind IntelliSense entry only (theme from ${CONFIG_FILE}). Pages never load this file.`;
  await write('styles/tailwind.css', [
    header(intellisenseNote),
    "@import 'tailwindcss';\n\n",
    themeBlock(config),
    '\n',
    utilityOverrides(),
    "\n@source '../blocks/**/*.html';\n@source '../drafts/**/*.html';\n",
  ].join(''));

  const values = {
    KIT_VERSION: `v${kit.version}`,
    PROJECT_NAME: config.project.name,
    PROJECT_DESCRIPTION: config.project.description ?? '',
    LANGUAGE_NAME: LANGUAGE_NAMES[config.language],
    FONT_FAMILY: config.font.family,
    TOKENS: tokensMarkdown(config),
  };
  const withNotes = async (rel, file, fallback) => {
    const current = existsSync(path.join(root, rel)) ? await readFile(path.join(root, rel), 'utf8') : '';
    await write(rel, fill(template(file), { ...values, PROJECT_NOTES: projectNotes(current) ?? fallback }));
  };
  await withNotes('AGENTS.md', 'AGENTS.md', '_Regras específicas deste projeto. Este trecho é preservado pelo `npm run aem:init`._');
  await withNotes('CONTEXT.md', 'CONTEXT.md', '_Termos de negócio deste projeto. Este trecho é preservado pelo `npm run aem:init`._');

  // 6. Seed Files (created once, then owned by the project) + managed regions inside them
  const stylesPath = path.join(root, 'styles', 'styles.css');
  // Region contents end with a blank line: Stylelint wants an empty line before the end marker.
  const fontFace = `${fontFallbackFace(config)}\n`;
  const vars = `${fontVars(config)}\n`;
  const currentStyles = existsSync(stylesPath) ? await readFile(stylesPath, 'utf8') : null;
  const regions = (source) => {
    const withVars = replaceRegion(source, 'font-vars', vars);
    return withVars && replaceRegion(withVars, 'font-face', fontFace);
  };
  const seededStyles = regions(fill(template('seed/styles.css'), { FONT_VARS: vars, FONT_FACE: fontFace }));
  if (currentStyles === null || !currentStyles.includes('aem-kit:font-vars:start')) {
    await write('styles/styles.css', seededStyles);
    await Promise.all(BOILERPLATE_FONTS.map(async (font) => {
      const file = path.join(root, 'fonts', font);
      if (existsSync(file)) {
        await rm(file);
        note('removido', `fonts/${font}`);
      }
    }));
  } else {
    const updated = regions(currentStyles);
    if (!updated) throw new Error('styles/styles.css: marcadores aem-kit:font-vars/font-face incompletos.');
    await write('styles/styles.css', updated);
    if (updated !== seededStyles) note('seed difere (mantido)', 'styles/styles.css');
  }

  const readmePath = path.join(root, 'README.md');
  const readme = existsSync(readmePath) ? await readFile(readmePath, 'utf8') : null;
  if (readme === null || readme.includes("# Your Project's Title")) {
    const repo = remote ? `${remote.repo}--${remote.owner}` : '{repo}--{owner}';
    await write('README.md', fill(template('seed/README.md'), { ...values, REPO: repo, REPO_NAME: remote?.repo ?? path.basename(root) }));
  }

  // 7. Small config files that only need a line
  const hlxPath = path.join(root, '.hlxignore');
  const hlx = existsSync(hlxPath) ? await readFile(hlxPath, 'utf8') : '';
  if (!hlx.split('\n').includes('blocks/**/*.html')) {
    await write('.hlxignore', `${hlx.replace(/\n?$/, '\n')}blocks/**/*.html\n`);
  }
  await mkdir(path.join(root, 'drafts'), { recursive: true });

  // 8. Remove the pre-package toolchain copied into tools/
  await Promise.all(LEGACY_FILES.map(async (rel) => {
    if (existsSync(path.join(root, rel))) {
      await rm(path.join(root, rel));
      note('removido', rel);
    }
  }));
  const eslintrcPath = path.join(root, '.eslintrc.js');
  if (existsSync(eslintrcPath)) {
    const eslintrc = await readFile(eslintrcPath, 'utf8');
    const cleaned = eslintrc.replace(LEGACY_ESLINT_OVERRIDE, '');
    if (cleaned !== eslintrc) await write('.eslintrc.js', cleaned);
  }
  await Promise.all(['tools/lib', 'tools'].map(async (dir) => {
    const full = path.join(root, dir);
    if (existsSync(full) && !(await readdir(full)).length) await rmdir(full);
  }));

  // 9. Install, browsers for the a11y check, Block Build
  if (!opts.skipInstall) {
    console.log('\n▸ npm install');
    await run('npm', ['install'], { cwd: root });
    console.log('\n▸ npx playwright install chromium');
    await run('npx', ['--no-install', 'playwright', 'install', 'chromium'], { cwd: root });
    console.log('\n▸ Block Build');
    await buildBlocks({ root, config });
  }

  console.log(`\naem-kit v${kit.version} aplicado (${kitSpec}).`);
  report.forEach(([status, file]) => console.log(`  ${status.padEnd(22)} ${file}`));
  if (!report.length) console.log('  nada mudou');
  if (opts.diff && report.some(([status]) => status === 'seed difere (mantido)')) {
    await run('git', ['diff', '--no-index', '--', T('seed/styles.css'), stylesPath], { cwd: root, allowFail: true });
  }
  return true;
}
