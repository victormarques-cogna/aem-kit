// Tracking (Google Tag Manager + dataLayer) generated from `tracking` in aem-kit.config.json.
//
// - head.html gets a managed region (an inline, nonce'd script, as high as possible in <head>):
//   creates `dataLayer`, pushes the pageview and loads GTM. The container comes from the page
//   metadata `gtm-id` (authored in AEM) or `tracking.gtmId`; `page-name` overrides `pageName`.
// - scripts/datalayer.js (Managed File): `track()`, `slug()` and the declarative click tracking
//   (`data-track` attributes, see templates/AGENTS.md). Imported by render-template.js, so it is
//   active on every page with an HTML-first block (Drafts included).

export const GTM_ID = /^GTM-[A-Z0-9]+$/;

/**
 * @param {object} config
 * @returns {{ gtmId: string, defaults: Record<string, string>, pageview: boolean } | null}
 */
export function trackingSettings(config) {
  const tracking = config?.tracking;
  if (!tracking) return null;
  return {
    gtmId: tracking.gtmId ?? '',
    defaults: tracking.defaults ?? {},
    pageview: tracking.pageview !== false,
  };
}

/**
 * Inline script for the managed head.html region ('' when tracking is not configured).
 * ES5 on purpose: it runs before any module and must not fail on old browsers.
 * @param {object} config
 * @returns {string}
 */
export function headSnippet(config) {
  const settings = trackingSettings(config);
  if (!settings) return '';
  const defaults = JSON.stringify(settings.defaults);
  return `<script nonce="aem">
  (function (w, d) {
    function meta(name) {
      var el = d.querySelector('meta[name="' + name + '"]');
      return el ? el.content.trim() : '';
    }
    var base = ${defaults};
    if (meta('page-name')) base.pageName = meta('page-name');
    w.dataLayer = w.dataLayer || [];
${settings.pageview ? `    w.dataLayer.push(Object.assign({
      event: 'pageview', eventLabel: base.pageName, eventAction: 'view', eventCategory: 'navegacao',
    }, base));
` : ''}    // GTM is not loaded inside the Universal Editor nor on localhost (add ?gtm=on to test it there).
    var host = w.location.hostname;
    var local = host === 'localhost' || host === '127.0.0.1';
    if (/\\.adobeaemcloud\\.(com|net)$/.test(host) || (local && !/[?&]gtm=on\\b/.test(w.location.search))) return;
    var id = meta('gtm-id') || ${JSON.stringify(settings.gtmId)};
    if (!/^GTM-[A-Z0-9]+$/.test(id)) return;
    w.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var script = d.createElement('script');
    script.async = true;
    script.nonce = 'aem';
    script.src = 'https://www.googletagmanager.com/gtm.js?id=' + id;
    d.head.appendChild(script);
  }(window, document));
</script>
`;
}

/**
 * Puts (or refreshes) the managed tracking region in head.html, right after the CSP meta.
 * @param {string} source current head.html
 * @param {object} config
 * @returns {string}
 */
export function headWithTracking(source, config) {
  const START = '<!-- aem-kit:tracking:start — Managed by aem-kit (aem-kit.config.json "tracking"). Do not edit. -->';
  const END = '<!-- aem-kit:tracking:end -->';
  const content = headSnippet(config);
  const region = `${START}\n${content}${END}\n`;
  const start = source.indexOf('<!-- aem-kit:tracking:start');
  const end = source.indexOf(END);
  if (start >= 0 && end > start) return `${source.slice(0, start)}${region}${source.slice(end + END.length + 1)}`;
  if (!content) return source;
  // As high as possible: after the CSP meta (it must stay first to cover the inline script).
  const csp = source.match(/<meta[^>]*Content-Security-Policy[\s\S]*?>\n?/i);
  if (!csp) return `${region}${source}`;
  const at = csp.index + csp[0].length;
  return `${source.slice(0, at)}${region}${source.slice(at)}`;
}

/**
 * `tracking.defaults` as an Airbnb-style object literal for scripts/datalayer.js.
 * @param {object} config
 * @returns {string}
 */
export function dataLayerDefaultsSource(config) {
  const entries = Object.entries(trackingSettings(config)?.defaults ?? {});
  if (!entries.length) return '{}';
  const quote = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const key = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name));
  return `{\n${entries.map(([name, value]) => `  ${key(name)}: ${quote(value)},`).join('\n')}\n}`;
}
