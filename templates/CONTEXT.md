# {{PROJECT_NAME}} — AEM Edge Delivery

> Gerenciado pelo aem-kit {{KIT_VERSION}}. Só a seção **Contexto do projeto** no fim é do projeto; o resto é regerado por `npm run aem:init`.

{{PROJECT_DESCRIPTION}}

## Language

**Toolchain Bootstrap**:
O ato idempotente de aplicar o pacote **aem-kit** num repositório recém-criado pelo Cloud Manager a partir do boilerplate xwalk (`npx github:victormarques-cogna/aem-kit#vX init`, depois `npm run aem:init`): npm scripts (`aem:*`, `check`), Managed Files, Seed Files, hooks, adaptadores de agents e `AGENTS.md`, tudo derivado do Kit Config. Rodar de novo atualiza o projeto para a versão do kit.
_Avoid_: Scaffold de projeto, init de repositório git, migração automática de blocks manuais, doctor-only, reinstall forçado, cópia de `tools/` para o projeto, docs só no README

**Kit Config**:
O arquivo `aem-kit.config.json` do projeto (nome, descrição, idioma, fonte, tokens de cor, breakpoints), validado pelo schema do aem-kit. É a única entrada do Toolchain Bootstrap; os tokens viram tema do Tailwind.
_Avoid_: Config do Tailwind à mão, `.env`, frontmatter

**Managed File**:
Arquivo (ou região marcada) que o aem-kit sobrescreve a cada `aem:init`: configs (Prettier, Stylelint, html-validate, editorconfig, VS Code), hooks, workflow de CI, `scripts/render-template.js`, `AGENTS.md`, `CONTEXT.md`, ADR, adaptadores `.claude/`/`.cursor/`, `styles/fonts.css`, `styles/tailwind.css` e as regiões `aem-kit:*` de `styles/styles.css`.
_Avoid_: Editar à mão (a edição é perdida), fork local do kit

**Seed File**:
Arquivo criado pelo aem-kit uma única vez e depois do projeto: `styles/styles.css` (fora das regiões `aem-kit:*`) e `README.md`. Em conflito o init mostra o diff e não sobrescreve.
_Avoid_: Managed File

**Check**:
A validação `aem-kit check`: Block Build, ESLint, Stylelint, Prettier, semântica (Source Gate + html-validate), acessibilidade (axe nos Drafts) e Lighthouse nos Drafts (nota mínima por categoria; sem Performance no `--staged`). Com `--staged` roda no pre-commit só sobre o que está no commit; sem flag roda no CI sobre o projeto todo.
_Avoid_: Lint só no CI, `--no-verify`

**Block Source**:
O HTML do block (`blocks/{name}/{name}.html`) com markers `data-*` e classes Tailwind; é o artefato que o desenvolvedor edita e a partir do qual o modelo Universal Editor é derivado. Na v1, `data-component` aceita só `text`, `richtext` e `reference`.
_Avoid_: Template AEM, partial, source of truth do JSON

**Block Scaffold**:
O conjunto inicial criado por `aem:generate-block`: Block Source simples sem items, com fields `heading` (text no `<h2>`) e `text` (richtext), Draft de preview e disparo do Block Build. O argumento de nome é normalizado para kebab-case; `data-title` preserva a forma legível. Labels UE e copy do Draft em português (PT-BR). Aborta só se `blocks/[name]` (ou artefatos do nome) já existirem — sem lista de nomes reservados.
_Avoid_: Generate component, boilerplate do block, stub de `_json`, scaffold com data-item, overwrite / --force, heading estático fora do model, denylist de nomes, scaffold em inglês, exigir kebab na CLI

**Block Build**:
A conversão do Block Source em artefatos consumíveis pelo AEM (`_json` regenerado, `js`, `css`), o registro do block no filtro de section e a consolidação dos aggregates de models/definitions/filters. Disparado manualmente via scripts npm e automaticamente no pre-commit quando há Block Source staged (incluindo Source Gate).
_Avoid_: Compile, transpile, bundle

**Generated Artifacts**:
Os arquivos produzidos pelo Block Build (`_[name].json`, `[name].js`, `[name].css` e aggregates) que são commitados no git e tratados como somente leitura para humanos.
_Avoid_: Source, draft, enhance

**Draft**:
Uma página HTML estática completa em `drafts/` para preview local; o markup do block é sincronizado a partir dos defaults dos `data-field` do Block Source a cada Block Build (e em realtime via `aem:watch` / `aem:up`).
_Avoid_: Storybook story, fixture de teste, fragmento isolado, draft só na criação

**Source Gate**:
A barreira do Block Build (checks custom) que rejeita o Block Source na v1 se falhar: contrato `data-*`, presença de ao menos um heading, `alt` em toda `img`, e `data-label`/nome acessível em field interativo. Landmark e hierarquia estrita ficam fora da v1. O Draft não entra nessa barreira.
_Avoid_: Lint cosmético, warning-only, validação da página draft, axe headless, html-validate, plugin ESLint HTML, pacote estrito (landmark/`h1` ban)

**HTML-first Block**:
Block criado pela toolchain (tem Block Source `.html` + Tailwind); é o único formato permitido para blocks novos. Comportamento extra opcional via `{name}.enhance.js` adicionado pelo dev — fora do Block Scaffold.
_Avoid_: Block legado, block manual, enhance obrigatório no scaffold

**Legacy Block**:
Block mantido à mão (`.js` / `.css` / `_json` sem Block Source); continua válido, mas fora do fluxo `generate` / Tailwind obrigatório.
_Avoid_: Block depreciado, block antigo a migrar

## Contexto do projeto

<!-- project-notes:start -->
{{PROJECT_NOTES}}
<!-- project-notes:end -->
