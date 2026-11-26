# aem-kit

Configura um repositório AEM Edge Delivery (xwalk), recém-criado pelo Cloud Manager a partir do boilerplate, com a toolchain de blocos **HTML-first + Tailwind**, validações de pre-commit e instruções para agents de IA.

## Começar um projeto novo

1. Clone o repositório criado pelo Cloud Manager.
2. Rode o init uma vez sem config, para criar o `aem-kit.config.json` de exemplo:

   ```sh
   npx github:victormarques-cogna/aem-kit#v0.5.4 init
   ```

3. Preencha `aem-kit.config.json` (nome, descrição, idioma, fonte, cores e, opcionais, fonte dos títulos, escala tipográfica e breakpoints). O editor valida pelo schema.
4. Rode o init de novo. Ele instala as dependências, o Chromium do Playwright, os hooks e gera tudo:

   ```sh
   npx github:victormarques-cogna/aem-kit#v0.5.4 init
   ```

5. Revise com `git diff` e commite.

O init exige working tree limpo (só o `aem-kit.config.json` pode estar pendente). Use `--force` para ignorar essa checagem.

## Comandos (no projeto)

| Script | O que faz |
| --- | --- |
| `npm run aem:init` | Reaplica o kit (após mudar a config ou atualizar a versão). Idempotente |
| `npm run aem:generate-block -- <nome>` | Cria Block Source + Draft e roda o Block Build |
| `npm run aem:generate-component -- <nome> [--js]` | Cria um componente reutilizável em `components/<nome>/` (classes `@utility` + vitrine; `--js` inclui o comportamento) e roda o build |
| `npm run aem:build [-- <nome>]` | Block Build (todos ou um bloco) + `build:json`; sem nome, também as vitrines dos componentes |
| `npm run aem:up` | Servidor AEM com `drafts/` + rebuild ao salvar |
| `npm run aem:lock` | Regera o `package-lock.json` no Linux (Docker, `node:24`, como o CI) e confere com `npm ci --dry-run`. Use depois de mudar dependências |
| `npm run check` | Build + ESLint + Stylelint + Prettier + html-validate + axe + Lighthouse (o que o CI roda) |
| Tracking | `tracking` no `aem-kit.config.json` (GTM + dataLayer): região gerenciada no `head.html`, `scripts/datalayer.js` e cliques via `data-track` nos Block Sources |
| `npm run aem:lighthouse` | Lighthouse nos Drafts (`-- <bloco>` ou `-- components/<nome>`), numa URL (`-- --url <url>`) ou no site publicado da branch (`-- --deployed`); nota mínima em `lighthouse.minScore` (padrão 90) |

O pre-commit roda `aem-kit check --staged`: Block Build só dos blocos alterados (todos os blocos e vitrines quando algo em `components/` muda) e stage só dos artefatos gerados, lint e Prettier dos arquivos staged, semântica dos Block Sources, axe e Lighthouse (Acessibilidade, Boas práticas e SEO) nos Drafts. Violações `serious`/`critical` e notas abaixo do mínimo bloqueiam o commit. Performance é cobrada no CI e, após cada push na `main`, pelo workflow `aem-kit lighthouse` na URL real (depois do Code Sync).

## Componentes reutilizáveis

Peças de interface usadas por vários blocos (Button, Accordion, Modal…) ficam em `components/<nome>/`:

- `<nome>.css`: só `@utility` com nomes que começam pelo nome do componente (`button`, `button-primary`). É compilado junto com cada bloco; só as classes usadas entram no CSS do bloco.
- `<nome>.html`: vitrine com variantes e estados, gerada em `drafts/components/<nome>.html` e validada por html-validate, axe e Lighthouse.
- `<nome>.js` (opcional): comportamento, carregado sob demanda por `data-ui="<nome>"` via `scripts/ui.js`, antes do `enhance.js` do bloco.

Detalhes e regras na seção "Reusable components" do `AGENTS.md` gerado.

## package-lock.json e o CI (Docker)

O npm no macOS pode gravar um `package-lock.json` que o `npm ci` do runner Linux recusa ("not in sync"), e aí todos os jobs falham antes de validar qualquer coisa. Por isso o lock é conferido e gerado num container `node:24`, igual ao CI:

- `npm run aem:lock` regera e confere o lock;
- o pre-commit confere o lock quando `package.json` ou `package-lock.json` estão no commit (bloqueia se estiver fora de sincronia);
- o init confere depois do `npm install` e regera se precisar.

Sem o Docker rodando, essas verificações só avisam.

## O que o init gerencia

- **Managed Files** (sobrescritos a cada init): `.prettierrc.json`, `.prettierignore`, `.stylelintrc.json`, `.htmlvalidate.json`, `.editorconfig`, `.npmrc`, `.vscode/`, `.husky/pre-commit*`, `.github/workflows/aem-kit-check.yaml`, `scripts/render-template.js`, `scripts/ui.js`, `styles/fonts.css`, `styles/tailwind.css`, `AGENTS.md`, `CONTEXT.md`, `CLAUDE.md`, `docs/adr/0001-*`, `.cursor/rules/aem-kit.mdc`, comando `criar-bloco` em `.claude/commands/` e `.cursor/commands/`.
- **Regiões gerenciadas**: `aem-kit:font-vars` e `aem-kit:font-face` em `styles/styles.css`; a seção "Project notes" do `AGENTS.md` (e "Contexto do projeto" do `CONTEXT.md`) é preservada.
- **Seed Files** (criados uma vez, depois do projeto): `styles/styles.css` e `README.md`. Se o seed do kit mudar, o init avisa; `--diff` mostra a diferença.
- **xwalk.json**: garante `public.xwalk.multi-field.enabled: true` (necessário para campos `data-multi`), mantendo as outras chaves.
- **package.json**: scripts `aem:*`, `check`, `format`; devDependencies da toolchain; nome/descrição enquanto ainda forem os do boilerplate.
- Limpeza da toolchain antiga copiada em `tools/`, das fontes Roboto do boilerplate e de qualquer `yarn.lock` (o npm lê o `yarn.lock` e o `npm ci` falha quando ele diverge do `package-lock.json`).

## CI

O workflow gerado (`.github/workflows/aem-kit-check.yaml`) roda `npm ci` + `npm run check` em todo push e pull request. Este repositório é público e o init grava a dependência como `git+https://…`, então nem o CI nem quem clona o projeto precisam de token ou chave SSH.

## Publicar uma versão

1. Atualize `version` no `package.json` (o init grava `git+https://github.com/victormarques-cogna/aem-kit.git#v<version>` nos projetos).
2. Commite, crie a tag `v<version>` e faça push da tag.
3. Nos projetos: `npx github:victormarques-cogna/aem-kit#v<version> init` (ou ajuste a versão no `package.json` e rode `npm install && npm run aem:init`).

## Desenvolvimento do kit

```sh
npm install
npm run lint
# testar num projeto sem publicar:
node ../aem-kit/bin/aem-kit.mjs init --kit-spec file:../aem-kit
```

Requer Node 20.19+ (Node 20 já está fora de suporte; prefira 22 ou 24).
