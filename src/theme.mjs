import { toClassName } from './names.mjs';

/**
 * CSS font-family names are case-insensitive; lowercase keeps Stylelint (value-keyword-case) happy.
 * @param {object} config
 * @returns {{ family: string, fallback: string, stack: string }}
 */
export function fontNames(config) {
  const family = config.font.family.trim().toLowerCase();
  const fallback = `${toClassName(family)}-fallback`;
  const name = /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/.test(family) ? family : `'${family}'`;
  return { family: name, fallback, stack: `${name}, ${fallback}, sans-serif` };
}

/**
 * Tailwind v4 `@theme` block built from the project tokens.
 * Used when compiling each block and in styles/tailwind.css (IntelliSense).
 * @param {object} config
 * @returns {string}
 */
export function themeBlock(config) {
  const lines = [`  --font-sans: ${fontNames(config).stack};`];
  Object.entries(config.colors ?? {}).forEach(([name, value]) => {
    // Lowercase hex: matches Prettier's CSS output
    lines.push(`  --color-${name}: ${/^#[0-9a-f]+$/i.test(value) ? value.toLowerCase() : value};`);
  });
  const breakpoints = Object.entries(config.breakpoints ?? {});
  if (breakpoints.length) {
    lines.push('  --breakpoint-*: initial;');
    breakpoints.forEach(([name, value]) => lines.push(`  --breakpoint-${name}: ${value};`));
  }
  return `@theme {\n${lines.join('\n')}\n}\n`;
}

/**
 * Declarations for the managed region inside :root in styles/styles.css.
 * @param {object} config
 * @returns {string}
 */
export function fontVars(config) {
  return `  --font-family: ${fontNames(config).stack};\n`;
}

/**
 * Metric-matched local fallback so the web font swap does not shift layout (CLS).
 * @param {object} config
 * @returns {string}
 */
export function fontFallbackFace(config) {
  const { fallback } = fontNames(config);
  const metrics = config.font.fallback ?? {};
  const props = [
    ['size-adjust', metrics.sizeAdjust],
    ['ascent-override', metrics.ascentOverride],
    ['descent-override', metrics.descentOverride],
    ['line-gap-override', metrics.lineGapOverride],
  ].filter(([, value]) => value);
  return `@font-face {
  font-family: ${fallback};
${props.map(([prop, value]) => `  ${prop}: ${value};\n`).join('')}  src: local('Arial');
}
`;
}
