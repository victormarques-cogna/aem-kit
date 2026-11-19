// Fields sent with every event (`tracking.defaults` in aem-kit.config.json). The page metadata
// `page-name` overrides `pageName`.
const DEFAULTS = {{DEFAULTS}};

/**
 * Normalizes a text the way the analytics team expects it:
 * "Entre R$500 mil e R$1 milhão" → "entre_r$500_mil_e_r$1_milhao".
 * @param {string} text
 * @returns {string}
 */
export function slug(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * @returns {Record<string, string>} DEFAULTS with the page overrides applied
 */
export function pageDefaults() {
  const pageName = document.querySelector('meta[name="page-name"]')?.content.trim();
  return pageName ? { ...DEFAULTS, pageName } : { ...DEFAULTS };
}

/**
 * Pushes an event to the dataLayer (GTM picks it up when loaded; earlier events queue).
 * The default fields (`marca`, `pageName`…) fill in whatever the event leaves out.
 * @param {Record<string, unknown>} event
 * @returns {Record<string, unknown>} the pushed payload
 */
export function track(event) {
  const payload = { ...event, ...pageDefaults(), ...event };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);
  return payload;
}

/**
 * Click on an element with `data-track` (kept by the runtime, so it can sit in a Block Source).
 * Optional overrides: data-track-label, -action, -category, -location, -type, -text and
 * data-track-when="expanded" (only when the click leaves aria-expanded="true", e.g. accordions).
 * textElement defaults to the slug of the element text (or its aria-label).
 * @param {Element} el
 * @returns {Record<string, unknown> | null}
 */
export function trackClick(el) {
  const data = el.dataset;
  if (data.trackWhen === 'expanded' && el.getAttribute('aria-expanded') !== 'true') return null;
  const { pageName } = pageDefaults();
  return track({
    event: data.track || 'clique',
    eventLabel: data.trackLabel || pageName,
    eventAction: data.trackAction || 'clique',
    eventCategory: data.trackCategory || 'interacao',
    pageName,
    locationElement: data.trackLocation || 'body',
    typeElement: data.trackType || 'button',
    textElement: data.trackText || slug(el.textContent.trim() || el.getAttribute('aria-label')),
  });
}

if (!window.aemKitTracking) {
  window.aemKitTracking = true;
  // Bubbling listener: block handlers (e.g. an accordion toggling aria-expanded) run first.
  document.addEventListener('click', (event) => {
    const el = event.target instanceof Element ? event.target.closest('[data-track]') : null;
    if (el) trackClick(el);
  });
}
