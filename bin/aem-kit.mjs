#!/usr/bin/env node
import { buildBlocks, listHtmlFirstBlocks } from '../src/build.mjs';
import check from '../src/check.mjs';
import { requireConfig } from '../src/config.mjs';
import generateBlock from '../src/generate.mjs';
import init from '../src/init.mjs';
import checkLighthouse, { deployedBase, lighthouseSettings, waitForCodeSync } from '../src/lighthouse.mjs';
import { findProjectRoot, kitPackage } from '../src/project.mjs';
import up from '../src/up.mjs';
import watch from '../src/watch.mjs';

const HELP = `aem-kit v${kitPackage().version}

Uso: aem-kit <comando> [opções]

  init [--force] [--skip-install] [--diff] [--kit-spec <spec>]
                              aplica/atualiza o kit no projeto a partir de aem-kit.config.json
  generate-block <nome>       cria um bloco HTML-first + Draft e roda o Block Build
  build [nome...]             Block Build (todos os blocos ou só os informados) + build:json
  watch                       rebuild ao salvar blocks/{nome}/{nome}.{html,enhance.js}
  up [args do aem up]         servidor AEM (drafts/) + watch
  check [--staged]            build + ESLint + Stylelint + Prettier + html-validate + axe + Lighthouse
                              (--staged: só o que está no commit, usado no pre-commit)
  lighthouse [nome...] [--url <url>] [--deployed [--wait-sync]] [--categories a,b] [--runs n]
             [--block <padrão de URL>...] [--report] [--title <texto>]
                              --block '*googletagmanager.com*' mede sem o GTM; --report só mede
                              e mostra (nunca reprova); --title nomeia o resumo do GitHub Actions
                              Lighthouse (mínimo em aem-kit.config.json, padrão 90) nos Drafts
                              ou em URLs; --deployed usa {branch}--{repo}--{owner}.aem.live/page
`;

const [command, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

try {
  const root = findProjectRoot();
  const ctx = () => ({ root, config: requireConfig(root) });

  switch (command) {
    case 'init':
      await init(root, {
        force: flag('--force'),
        skipInstall: flag('--skip-install'),
        diff: flag('--diff'),
        kitSpec: option('--kit-spec'),
      });
      break;
    case 'generate-block':
      await generateBlock(ctx(), args.join(' '));
      break;
    case 'build':
      await buildBlocks(ctx(), args.length ? args : undefined);
      break;
    case 'watch':
      watch(ctx());
      break;
    case 'up':
      up(ctx(), args);
      break;
    case 'check':
      if (!(await check(ctx(), { staged: flag('--staged') }))) process.exitCode = 1;
      break;
    case 'lighthouse': {
      const { root: dir, config } = ctx();
      const values = (name) => args.flatMap((arg, i) => (args[i - 1] === name ? [arg] : []));
      const optionNames = ['--url', '--categories', '--runs', '--block', '--title'];
      const blocks = args.filter((arg, i) => !arg.startsWith('--') && !optionNames.includes(args[i - 1]));
      const urls = values('--url');
      if (flag('--deployed')) {
        const base = await deployedBase(dir);
        if (flag('--wait-sync')) await waitForCodeSync(dir, base);
        urls.push(...lighthouseSettings(config).urls.map((page) => new URL(page, base).href));
      }
      const categories = option('--categories')?.split(',');
      const runs = option('--runs') ? Number(option('--runs')) : undefined;
      const all = !blocks.length && !urls.length;
      const targets = all ? await listHtmlFirstBlocks(dir) : blocks;
      const blocked = values('--block');
      if (blocked.length) console.log(`▸ Sem carregar: ${blocked.join(', ')}`);
      if (!(await checkLighthouse(dir, config, {
        blocks: targets, urls, categories, runs, blocked, report: flag('--report'), title: option('--title'),
      }))) process.exitCode = 1;
      break;
    }
    case undefined:
    case '-h':
    case '--help':
      console.log(HELP);
      break;
    case '-v':
    case '--version':
      console.log(kitPackage().version);
      break;
    default:
      console.error(`Comando desconhecido: ${command}\n\n${HELP}`);
      process.exitCode = 1;
  }
} catch (error) {
  console.error(`✖ ${error.message || error}`);
  process.exitCode = 1;
}
