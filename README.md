# aem-kit

Configura um repositório AEM Edge Delivery (xwalk), recém-criado pelo Cloud Manager a partir do boilerplate, com a toolchain de blocos **HTML-first + Tailwind**, validações de pre-commit e instruções para agents de IA.

## Começar um projeto novo

1. Clone o repositório criado pelo Cloud Manager.
2. Rode o init uma vez sem config, para criar o `aem-kit.config.json` de exemplo:

   ```sh
   npx github:victormarques-cogna/aem-kit#v0.5.1 init
   ```

3. Preencha `aem-kit.config.json` (nome, descrição, idioma, fonte, cores, breakpoints opcionais). O editor valida pelo schema.
4. Rode o init de novo. Ele instala as dependências, o Chromium do Playwright, os hooks e gera tudo:

   ```sh
   npx github:victormarques-cogna/aem-kit#v0.5.1 init
   ```

5. Revise com `git diff` e commite.

O init exige working tree limpo (só o `aem-kit.config.json` pode estar pendente). Use `--force` para ignorar essa checagem.

## Comandos (no projeto)

| Script | O que faz |
| --- | --- |
| `npm run aem:init` | Reaplica o kit (após mudar a config ou atualizar a versão). Idempotente |
| `npm run aem:generate-block -- <nome>` | Cria Block Source + Draft e roda o Block Build |
| `npm run aem:build [-- <nome>]` | Block Build (todos ou um bloco) + `build:json` |
| `npm run aem:up` | Servidor AEM com `drafts/` + rebuild ao salvar |
| `npm run check` | Build + ESLint + Stylelint + Prettier + html-validate + axe (o que o CI roda) |

O pre-commit roda `aem-kit check --staged`: Block Build só dos blocos alterados (e stage só dos artefatos gerados), lint e Prettier dos arquivos staged, semântica dos Block Sources e axe nos Drafts. Violações `serious`/`critical` bloqueiam o commit.

## O que o init gerencia

- **Managed Files** (sobrescritos a cada init): `.prettierrc.json`, `.prettierignore`, `.stylelintrc.json`, `.htmlvalidate.json`, `.editorconfig`, `.npmrc`, `.vscode/`, `.husky/pre-commit*`, `.github/workflows/aem-kit-check.yaml`, `scripts/render-template.js`, `styles/fonts.css`, `styles/tailwind.css`, `AGENTS.md`, `CONTEXT.md`, `CLAUDE.md`, `docs/adr/0001-*`, `.cursor/rules/aem-kit.mdc`, comando `criar-bloco` em `.claude/commands/` e `.cursor/commands/`.
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
