import { spawn } from 'node:child_process';
import watch from './watch.mjs';

/**
 * AEM CLI dev server (serving drafts/) + Block Source watcher.
 * @param {{ root: string, config: object }} ctx
 * @param {string[]} extraArgs forwarded to `aem up`
 */
export default function up(ctx, extraArgs = []) {
  const server = spawn('npx', [
    '-y', '@adobe/aem-cli', 'up', '--no-open', '--forward-browser-logs', '--html-folder', 'drafts', ...extraArgs,
  ], { cwd: ctx.root, stdio: 'inherit', shell: process.platform === 'win32' });

  const stop = () => {
    server.kill('SIGINT');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  server.on('exit', (code) => process.exit(code ?? 0));

  watch(ctx);
}
