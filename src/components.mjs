import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { toClassName } from './names.mjs';

export const COMPONENTS_DIR = 'components';
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * @param {string} root
 * @param {string} id
 * @param {'css' | 'js' | 'html'} ext
 * @returns {string} absolute path of components/{id}/{id}.{ext}
 */
export function componentFile(root, id, ext) {
  return path.join(root, COMPONENTS_DIR, id, `${id}.${ext}`);
}

/**
 * Reusable components of the project: components/{id}/ with {id}.css (classes) and {id}.html
 * (showcase), plus an optional {id}.js (behaviour, loaded by data-ui="{id}").
 * @param {string} root
 * @returns {Promise<string[]>} component ids, sorted
 */
export async function listComponents(root) {
  const dir = path.join(root, COMPONENTS_DIR);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  ids.forEach((id) => {
    if (id !== toClassName(id) || !NAME_RE.test(id)) {
      throw new Error(`components/${id}: use kebab-case minúsculo, sem acento (ex.: "button", "menu-dropdown").`);
    }
    ['css', 'html'].forEach((ext) => {
      if (!existsSync(componentFile(root, id, ext))) {
        throw new Error(`components/${id}: falta components/${id}/${id}.${ext}.`);
      }
    });
  });
  return ids;
}

/**
 * A component stylesheet may only declare Tailwind utilities named after the component
 * (`@utility {id}`, `@utility {id}-primary`, `@utility {id}-*`): anything else at the top
 * level would be copied, unscoped, into every block.
 * @param {string} id
 * @param {string} css
 * @returns {string[]} errors (PT-BR)
 */
export function componentCssErrors(id, css) {
  const errors = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const nameRe = new RegExp(`^${id}(-[a-z0-9-]*\\*?)?$`);
  const checkHead = (head) => {
    const match = /^@utility\s+([a-z0-9*-]+)$/.exec(head);
    if (!match) {
      errors.push(`no nível de cima só vale @utility (encontrado "${head.slice(0, 60)}").`);
    } else if (!nameRe.test(match[1])) {
      errors.push(`a classe "${match[1]}" precisa começar com "${id}" (ex.: "${id}", "${id}-primary").`);
    }
  };
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') {
      if (depth === 0) checkHead(text.slice(start, i).trim());
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) start = i + 1;
    } else if (char === ';' && depth === 0) {
      checkHead(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (text.slice(start).trim()) checkHead(text.slice(start).trim());
  return errors;
}

/**
 * Validated stylesheets of every component, to be imported by each Tailwind compile.
 * @param {string} root
 * @returns {Promise<string[]>} absolute paths of components/{id}/{id}.css
 */
export async function componentStylesheets(root) {
  const ids = await listComponents(root);
  return Promise.all(ids.map(async (id) => {
    const file = componentFile(root, id, 'css');
    const errors = componentCssErrors(id, await readFile(file, 'utf8'));
    if (errors.length) throw new Error(`components/${id}/${id}.css: ${errors.join(' ')}`);
    return file;
  }));
}

/**
 * @param {string} html
 * @returns {string[]} data-ui values used in the markup (HTML comments ignored)
 */
export function dataUiNames(html) {
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');
  return [...new Set([...markup.matchAll(/\sdata-ui\s*=\s*["']([^"']*)["']/g)].map((match) => match[1]))];
}

/**
 * Every data-ui="{id}" needs components/{id}/{id}.js: the runtime imports it.
 * @param {string} root
 * @param {string} html
 * @param {string} file for messages
 * @returns {string[]} data-ui names used
 */
export function assertDataUi(root, html, file) {
  const names = dataUiNames(html);
  names.forEach((name) => {
    if (!NAME_RE.test(name)) throw new Error(`${file}: data-ui="${name}" inválido (use o nome do componente, ex.: "accordion").`);
    if (!existsSync(componentFile(root, name, 'js'))) {
      throw new Error(`${file}: data-ui="${name}" precisa de components/${name}/${name}.js (componente com comportamento).`);
    }
  });
  return names;
}

/**
 * Generated Artifacts of a component (its showcase page and stylesheet).
 * @param {string} id
 * @returns {string[]}
 */
export function componentGeneratedPaths(id) {
  return [`drafts/components/${id}.html`, `drafts/components/${id}.css`];
}
