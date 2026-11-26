import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  copyFile, mkdtemp, rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Same Node version as the managed workflows (`node-version: 24`): npm on macOS can write a
// package-lock.json that `npm ci` on the Linux runner rejects as out of sync (e.g. a nested
// ajv@6 hoisted differently), so the lock is checked and written inside this Linux image.
export const CI_IMAGE = 'node:24';
const LOCK_FILES = ['package.json', 'package-lock.json', '.npmrc'];

/**
 * @param {string[]} args docker arguments
 * @returns {{ code: number, output: string }}
 */
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error) return { code: 127, output: result.error.message };
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * @returns {boolean} the Docker daemon is reachable
 */
export function dockerAvailable() {
  return docker(['info', '--format', '{{.ServerVersion}}']).code === 0;
}

/**
 * Copies package.json, package-lock.json and .npmrc (allow-git) into a temporary directory:
 * the container never touches the project (nor its macOS node_modules).
 * @param {string} root
 * @returns {Promise<string>} temporary directory
 */
async function stage(root) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aem-kit-lock-'));
  await Promise.all(LOCK_FILES
    .filter((file) => existsSync(path.join(root, file)))
    .map((file) => copyFile(path.join(root, file), path.join(dir, file))));
  return dir;
}

/**
 * @param {string} dir
 * @param {string} script shell script run in /app
 * @returns {{ code: number, output: string }}
 */
function inLinux(dir, script) {
  return docker(['run', '--rm', '-v', `${dir}:/app`, '-w', '/app', CI_IMAGE, 'bash', '-c', script]);
}

/** `npm ci --dry-run` checks that the lock matches package.json, without installing. */
const VERIFY = 'npm ci --dry-run --ignore-scripts --no-audit --no-fund';

/**
 * @param {string} output npm output
 * @returns {string} the npm error lines that explain the failure
 */
function npmErrors(output) {
  return output.split('\n')
    .filter((line) => /^npm error (Invalid|Missing|`npm ci`)/.test(line))
    .slice(0, 6)
    .join('\n');
}

/**
 * Checks package-lock.json the way the CI does (`npm ci` on Linux).
 * @param {string} root
 * @returns {Promise<{ docker: boolean, ok: boolean, details: string }>}
 */
export async function verifyLock(root) {
  if (!existsSync(path.join(root, 'package-lock.json'))) return { docker: true, ok: true, details: '' };
  if (!dockerAvailable()) return { docker: false, ok: true, details: '' };
  const dir = await stage(root);
  try {
    const { code, output } = inLinux(dir, VERIFY);
    return { docker: true, ok: code === 0, details: npmErrors(output) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Rewrites package-lock.json on Linux (`npm install --package-lock-only`) and checks it with
 * `npm ci --dry-run`. Only the lock file is copied back into the project.
 * @param {string} root
 * @returns {Promise<void>}
 */
export async function regenerateLock(root) {
  if (!dockerAvailable()) {
    throw new Error(`Docker não está rodando: o lock precisa ser gerado no Linux (${CI_IMAGE}). Abra o Docker e rode de novo.`);
  }
  const dir = await stage(root);
  try {
    const { code, output } = inLinux(dir, `npm install --package-lock-only --ignore-scripts --no-audit --no-fund && ${VERIFY}`);
    if (code !== 0) throw new Error(`Não foi possível gerar o package-lock.json no Linux:\n${npmErrors(output) || output.slice(-2000)}`);
    await copyFile(path.join(dir, 'package-lock.json'), path.join(root, 'package-lock.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Message shown when the lock is out of sync for the CI. */
export const LOCK_HINT = 'O package-lock.json não passa no `npm ci` do CI (Linux). Rode `npm run aem:lock` e commite o lock.';
