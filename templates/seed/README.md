# {{PROJECT_NAME}}

{{PROJECT_DESCRIPTION}}

Site em AEM Edge Delivery Services, autorado no Universal Editor (xwalk). Criado a partir do [aem-boilerplate-xwalk](https://github.com/adobe-rnd/aem-boilerplate-xwalk) e configurado pelo **aem-kit** (blocos HTML-first com Tailwind).

## Ambientes

- Preview: https://main--{{REPO}}.aem.page/
- Live: https://main--{{REPO}}.aem.live/
- Branch: `https://{branch}--{{REPO}}.aem.page/`

## Pré-requisitos

- Node.js 20 ou mais recente (recomendado 22+; o CI usa 24) e npm
- Git com acesso a este repositório
- AEM Cloud Service release 2026.4 ou mais recente

## Passo a passo

### 1. Preparar a máquina (uma vez)

```sh
git clone <url-deste-repositório>
cd {{REPO_NAME}}
npm install                       # dependências + hook de pre-commit
npx playwright install chromium   # navegador usado na checagem de acessibilidade
```

### 2. Rodar localmente

```sh
git checkout -b minha-feature
npm run aem:up
```

Abre o servidor em http://localhost:3000 com o conteúdo publicado pelos autores e as páginas locais de `drafts/`. Cada bloco HTML-first tem uma página de rascunho em `http://localhost:3000/drafts/<nome>`. Ao salvar um bloco, ele é recompilado e a página recarrega.

### 3. Criar um bloco

Com um agente de IA (Claude Code, Cursor), use o comando **`/criar-bloco`** passando um print, link do Figma ou descrição. Ele segue as regras do `AGENTS.md`.

Manualmente:

```sh
npm run aem:generate-block -- "Nome do Bloco"   # cria blocks/nome-do-bloco/ e drafts/nome-do-bloco.html
```

1. Edite **só** `blocks/<nome>/<nome>.html`: HTML semântico, classes Tailwind com os tokens do projeto (`bg-primary`, `text-foreground`…) e os atributos `data-field` / `data-label` que viram campos no Universal Editor.
2. Comportamento (abrir/fechar, carrossel…) vai em `blocks/<nome>/<nome>.enhance.js`, opcional.
3. Não edite `_<nome>.json`, `<nome>.js` nem `<nome>.css`: eles são gerados pelo build.
4. Confira o resultado em `http://localhost:3000/drafts/<nome>`.

### 4. Validar e commitar

```sh
npm run check   # opcional: o mesmo que o pre-commit e o CI rodam, no projeto inteiro
git add .
git commit -m "feat: adiciona bloco nome-do-bloco"
```

O pre-commit roda sozinho nos arquivos do commit: gera os artefatos dos blocos alterados e os inclui no commit, depois valida ESLint, Stylelint, Prettier, semântica do HTML e acessibilidade (axe). Se algo falhar, a mensagem diz o arquivo e a regra. Corrija e commite de novo; nunca use `--no-verify`, o CI repete as mesmas checagens.

Correções automáticas: `npm run lint:fix` (JS e CSS) e `npm run format` (HTML dos blocos e CSS).

### 5. Publicar

1. `git push -u origin minha-feature` e abra um pull request para `main`.
2. Na descrição do PR, inclua o link de preview da branch: `https://minha-feature--{{REPO}}.aem.page/<caminho>`.
3. O CI roda `npm run check`; após o merge, o código vai para produção pelo AEM Code Sync.
4. No Universal Editor, os autores adicionam o bloco em uma seção e preenchem os campos.

### Mudar cores, fonte ou breakpoints

Edite `aem-kit.config.json` e rode:

```sh
npm run aem:init
```

Isso atualiza o tema do Tailwind, a fonte, o `AGENTS.md` e recompila os blocos. Revise com `git diff` e commite.

### Atualizar o aem-kit

Troque a versão de `aem-kit` em `package.json` (`…/aem-kit.git#vX.Y.Z`), depois:

```sh
npm install
npm run aem:init
```

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run aem:up` | Servidor local (http://localhost:3000) + rebuild dos blocos ao salvar |
| `npm run aem:generate-block -- <nome>` | Cria um bloco HTML-first + página em `drafts/` |
| `npm run aem:build [-- <nome>]` | Gera `_json`/`js`/`css` dos blocos HTML-first |
| `npm run check` | Tudo o que o pre-commit e o CI validam |
| `npm run lint` / `npm run lint:fix` | ESLint + Stylelint (e correção automática) |
| `npm run format` | Prettier no HTML dos blocos e no CSS |
| `npm run aem:init` | Reaplica o aem-kit (após mudar `aem-kit.config.json` ou atualizar o kit) |

## Documentação

- [`AGENTS.md`](AGENTS.md): convenções do projeto (vale para pessoas e agentes)
- [`CONTEXT.md`](CONTEXT.md): glossário
- [`aem-kit.config.json`](aem-kit.config.json): nome, idioma, fonte e tokens do projeto
- [AEM Authoring](https://www.aem.live/docs/aem-authoring), [Universal Editor Tutorial](https://www.aem.live/developer/ue-tutorial), [Component Model Definitions](https://www.aem.live/developer/component-model-definitions)
