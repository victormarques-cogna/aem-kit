import { existsSync, watch as fsWatch } from 'node:fs';
import path from 'node:path';
import { buildBlocks } from './build.mjs';

// Block Source (`{name}.html`) or behaviour (`{name}.enhance.js`, created/removed/changed)
// both change the generated `{name}.js`, so either triggers a Block Build.
const SOURCE_RE = /^([^/\\]+)[/\\]\1\.(html|enhance\.js)$/;
// A component change can affect every block (shared classes): rebuild everything.
const COMPONENT_RE = /^([^/\\]+)[/\\]\1\.(css|html|js)$/;

/**
 * Watches Block Sources and rebuilds the affected blocks.
 * @param {{ root: string, config: object }} ctx
 */
export default function watch(ctx) {
  const blocksDir = path.join(ctx.root, 'blocks');
  let timer = null;
  let running = false;
  /** @type {Set<string>} */
  const queue = new Set();

  async function flush() {
    if (running) return;
    running = true;
    try {
      const names = [...queue];
      queue.clear();
      if (names.length) {
        const only = names.includes('*') ? undefined : names;
        console.log(`[aem:watch] building ${only ? only.join(', ') : 'all'}…`);
        await buildBlocks(ctx, only);
        console.log('[aem:watch] done');
      }
    } catch (error) {
      console.error('[aem:watch]', error.message || error);
    } finally {
      running = false;
      if (queue.size) flush();
    }
  }

  function schedule(blockId) {
    queue.add(blockId ?? '*');
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }

  console.log('[aem:watch] watching blocks/{name}/{name}.{html,enhance.js}');
  schedule();

  fsWatch(blocksDir, { recursive: true }, (_event, filename) => {
    const match = filename && SOURCE_RE.exec(filename);
    if (match) schedule(match[1]);
  });

  const componentsDir = path.join(ctx.root, 'components');
  if (existsSync(componentsDir)) {
    console.log('[aem:watch] watching components/{name}/{name}.{css,html,js}');
    fsWatch(componentsDir, { recursive: true }, (_event, filename) => {
      if (filename && COMPONENT_RE.test(filename)) schedule();
    });
  }
}
