import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { toClassName } from './names.mjs';

export const CONFIG_FILE = 'aem-kit.config.json';

const LANGUAGES = ['pt-BR', 'en'];
const COLOR_NAME = /^[a-z][a-z0-9-]*$/;
const BREAKPOINT_NAME = /^[a-z0-9][a-z0-9-]*$/;
const CSS_LENGTH = /^\d+(\.\d+)?(px|rem|em)$/;
const LETTER_SPACING = /^-?\d+(\.\d+)?(px|rem|em)$|^0$/;
const TYPOGRAPHY_KEYS = ['size', 'lineHeight', 'weight', 'letterSpacing'];
const PERCENT = /^-?\d+(\.\d+)?%$/;

/** Starter config written by `aem-kit init` when the project has none. */
export const STARTER_CONFIG = {
  $schema: './node_modules/aem-kit/schema/aem-kit.config.schema.json',
  project: {
    name: 'Nome do projeto',
    description: 'Descrição curta do site',
  },
  language: 'pt-BR',
  font: {
    family: 'Inter',
    url: 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap',
    fallback: {
      sizeAdjust: '107.06%',
      ascentOverride: '90.49%',
      descentOverride: '22.56%',
      lineGapOverride: '0%',
    },
  },
  colors: {
    primary: '#004664',
    secondary: '#00AA82',
  },
};

/**
 * Loads and validates aem-kit.config.json.
 * @param {string} root
 * @returns {object | null} null when the file does not exist
 */
export function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  if (!existsSync(file)) return null;
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${CONFIG_FILE}: JSON inválido (${error.message}).`);
  }

  const errors = [];
  const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

  if (!isObject(config.project) || !config.project.name?.trim()) {
    errors.push('project.name é obrigatório.');
  }
  if (!LANGUAGES.includes(config.language)) {
    errors.push(`language deve ser um de: ${LANGUAGES.join(', ')}.`);
  }
  const validateFont = (key) => {
    const font = config[key];
    if (!isObject(font) || !font.family?.trim()) {
      errors.push(`${key}.family é obrigatório.`);
      return;
    }
    if (!toClassName(font.family)) errors.push(`${key}.family inválido.`);
    if (font.url && !/^https:\/\//.test(font.url)) errors.push(`${key}.url deve ser https.`);
    Object.entries(font.fallback ?? {}).forEach(([name, value]) => {
      if (!['sizeAdjust', 'ascentOverride', 'descentOverride', 'lineGapOverride'].includes(name)) {
        errors.push(`${key}.fallback.${name} não é suportado.`);
      } else if (!PERCENT.test(value)) {
        errors.push(`${key}.fallback.${name} deve ser uma porcentagem (ex.: "107.06%").`);
      }
    });
  };
  validateFont('font');
  if (config.headingFont !== undefined) {
    validateFont('headingFont');
    if (isObject(config.font) && isObject(config.headingFont)
      && toClassName(config.font.family ?? '') === toClassName(config.headingFont.family ?? '')) {
      errors.push('headingFont.family é igual a font.family: remova headingFont.');
    }
  }
  if (config.colors !== undefined) {
    if (!isObject(config.colors)) errors.push('colors deve ser um objeto { nome: cor }.');
    else {
      Object.entries(config.colors).forEach(([name, value]) => {
        if (!COLOR_NAME.test(name)) errors.push(`colors.${name}: use kebab-case minúsculo (ex.: "primary", "gray-700").`);
        if (typeof value !== 'string' || !value.trim()) errors.push(`colors.${name}: valor inválido.`);
      });
    }
  }
  if (config.typography !== undefined) {
    if (!isObject(config.typography)) errors.push('typography deve ser um objeto { nome: { size, lineHeight, weight } }.');
    else {
      Object.entries(config.typography).forEach(([name, style]) => {
        const at = `typography.${name}`;
        if (!COLOR_NAME.test(name)) errors.push(`${at}: use kebab-case minúsculo (ex.: "desktop-h2").`);
        if (!isObject(style)) {
          errors.push(`${at} deve ser um objeto { size, lineHeight, weight }.`);
          return;
        }
        Object.keys(style).filter((key) => !TYPOGRAPHY_KEYS.includes(key))
          .forEach((key) => errors.push(`${at}.${key} não é suportado (use ${TYPOGRAPHY_KEYS.join(', ')}).`));
        if (!CSS_LENGTH.test(style.size ?? '')) errors.push(`${at}.size: use px, rem ou em (ex.: "28px").`);
        if (style.lineHeight !== undefined && !CSS_LENGTH.test(style.lineHeight)) {
          errors.push(`${at}.lineHeight: use px, rem ou em (ex.: "36px").`);
        }
        if (style.weight !== undefined && !/^[1-9]00$/.test(String(style.weight))) errors.push(`${at}.weight: use 100 a 900 (ex.: "700").`);
        if (style.letterSpacing !== undefined && !LETTER_SPACING.test(style.letterSpacing)) {
          errors.push(`${at}.letterSpacing: use px, rem ou em (ex.: "0.08em").`);
        }
      });
    }
  }
  if (config.breakpoints !== undefined) {
    if (!isObject(config.breakpoints)) errors.push('breakpoints deve ser um objeto { nome: largura }.');
    else {
      Object.entries(config.breakpoints).forEach(([name, value]) => {
        if (!BREAKPOINT_NAME.test(name)) errors.push(`breakpoints.${name}: use kebab-case minúsculo.`);
        if (!CSS_LENGTH.test(value)) errors.push(`breakpoints.${name}: use px, rem ou em (ex.: "48rem").`);
      });
    }
  }

  if (config.tracking !== undefined) {
    const tr = config.tracking;
    if (!isObject(tr)) errors.push('tracking deve ser um objeto.');
    else {
      if (tr.gtmId !== undefined && !/^GTM-[A-Z0-9]+$/.test(tr.gtmId)) {
        errors.push('tracking.gtmId deve ser um ID de container do GTM (ex.: "GTM-ABC1234").');
      }
      if (tr.defaults !== undefined && !(isObject(tr.defaults) && Object.values(tr.defaults).every((v) => typeof v === 'string'))) {
        errors.push('tracking.defaults deve ser um objeto { campo: "texto" }.');
      }
      if (tr.pageview !== undefined && typeof tr.pageview !== 'boolean') errors.push('tracking.pageview deve ser true ou false.');
    }
  }
  if (config.lighthouse !== undefined && config.lighthouse !== false) {
    const lh = config.lighthouse;
    if (!isObject(lh)) errors.push('lighthouse deve ser um objeto ou false.');
    else {
      if (lh.minScore !== undefined && !(Number.isInteger(lh.minScore) && lh.minScore >= 0 && lh.minScore <= 100)) {
        errors.push('lighthouse.minScore deve ser um inteiro de 0 a 100.');
      }
      if (lh.formFactor !== undefined && !['mobile', 'desktop'].includes(lh.formFactor)) {
        errors.push('lighthouse.formFactor deve ser "mobile" ou "desktop".');
      }
      if (lh.runs !== undefined && !(Number.isInteger(lh.runs) && lh.runs >= 1 && lh.runs <= 5)) {
        errors.push('lighthouse.runs deve ser um inteiro de 1 a 5.');
      }
      if (lh.urls !== undefined && !(Array.isArray(lh.urls) && lh.urls.every((u) => typeof u === 'string' && u.startsWith('/')))) {
        errors.push('lighthouse.urls deve ser uma lista de caminhos (ex.: ["/"]).');
      }
      if (lh.skipAudits !== undefined && !(Array.isArray(lh.skipAudits) && lh.skipAudits.every((a) => typeof a === 'string'))) {
        errors.push('lighthouse.skipAudits deve ser uma lista de ids de auditoria.');
      }
    }
  }

  if (errors.length) {
    throw new Error(`${CONFIG_FILE} inválido:\n- ${errors.join('\n- ')}`);
  }
  return config;
}

/**
 * Loads the config or fails with a helpful message (for commands other than init).
 * @param {string} root
 * @returns {object}
 */
export function requireConfig(root) {
  const config = loadConfig(root);
  if (!config) throw new Error(`${CONFIG_FILE} não encontrado. Rode "npx aem-kit init" primeiro.`);
  return config;
}
