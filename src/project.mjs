import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root of the aem-kit package itself. */
export const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @returns {{ version: string, aemKit: object }} */
export function kitPackage() {
  return JSON.parse(readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf8'));
}

/**
 * Finds the AEM project root (folder with package.json + scripts/aem.js), walking up from cwd.
 * @param {string} [from]
 * @returns {string}
 */
export function findProjectRoot(from = process.cwd()) {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'scripts', 'aem.js'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Projeto AEM não encontrado (package.json + scripts/aem.js). Rode o comando na raiz do repositório.');
    }
    dir = parent;
  }
}

/**
 * Path to a binary installed in the project (node_modules/.bin).
 * @param {string} root
 * @param {string} name
 * @returns {string}
 */
export function projectBin(root, name) {
  return path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
}

/**
 * Runs a command, inheriting stdio unless `capture` is set.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd: string, capture?: boolean, allowFail?: boolean }} opts
 * @returns {Promise<{ code: number, stdout: string }>}
 */
export function run(cmd, args, { cwd, capture = false, allowFail = false }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      shell: process.platform === 'win32',
    });
    let stdout = '';
    if (capture) child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 || allowFail) resolve({ code, stdout });
      else reject(new Error(`${path.basename(cmd)} ${args.join(' ')} saiu com código ${code}`));
    });
  });
}
