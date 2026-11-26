import { toClassName } from './names.mjs';

/**
 * CSS font-family names are case-insensitive; lowercase keeps Stylelint (value-keyword-case) happy.
 * @param {object} config
 * @param {'font' | 'headingFont'} [key] which font of the config
 * @returns {{ family: string, fallback: string, stack: string }}
 */
export function fontNames(config, key = 'font') {
  const family = config[key].family.trim().toLowerCase();
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
  if (config.headingFont) lines.push(`  --font-heading: ${fontNames(config, 'headingFont').stack};`);
  Object.entries(config.colors ?? {}).forEach(([name, value]) => {
    // Lowercase hex: matches Prettier's CSS output
    lines.push(`  --color-${name}: ${/^#[0-9a-f]+$/i.test(value) ? value.toLowerCase() : value};`);
  });
  Object.entries(config.typography ?? {}).forEach(([name, style]) => {
    lines.push(`  --text-${name}: ${style.size};`);
    if (style.lineHeight) lines.push(`  --text-${name}--line-height: ${style.lineHeight};`);
    if (style.weight) lines.push(`  --text-${name}--font-weight: ${style.weight};`);
    if (style.letterSpacing) lines.push(`  --text-${name}--letter-spacing: ${style.letterSpacing};`);
  });
  const breakpoints = Object.entries(config.breakpoints ?? {});
  if (breakpoints.length) {
    lines.push('  --breakpoint-*: initial;');
    breakpoints.forEach(([name, value]) => lines.push(`  --breakpoint-${name}: ${value};`));
  }
  return `@theme {\n${lines.join('\n')}\n}\n`;
}

/**
 * Tailwind utility overrides compiled into every block and styles/tailwind.css.
 * `container` centers and adds horizontal padding by default.
 * @returns {string}
 */
export function utilityOverrides() {
  return `@utility container {
  margin-inline: auto;
  padding-inline: --spacing(6);
}
`;
}

/**
 * Declarations for the managed region inside :root in styles/styles.css.
 * @param {object} config
 * @returns {string}
 */
export function fontVars(config) {
  const heading = config.headingFont ? `  --heading-font: ${fontNames(config, 'headingFont').stack};\n` : '';
  return `  --font-family: ${fontNames(config).stack};\n${heading}`;
}

function fallbackFace(config, key) {
  const { fallback } = fontNames(config, key);
  const metrics = config[key].fallback ?? {};
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

/**
 * Metric-matched local fallbacks (main and heading font) so the web font swap does not shift layout (CLS).
 * @param {object} config
 * @returns {string}
 */
export function fontFallbackFace(config) {
  return ['font', 'headingFont'].filter((key) => config[key]).map((key) => fallbackFace(config, key)).join('\n');
}
