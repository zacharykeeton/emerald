// The root postinstall (M9 fix 1156): lays emerald's two conout files from
// scripts/node-pty/lib over node-pty 1.1.0's, so every pty of a process
// drains its output through one shared worker thread where node-pty starts
// one per pty (about 11 MB each, and never freed for a pty that exits on its
// own). Copied on every platform, though only Windows loads the files, so
// the stage's check is one rule everywhere.
//
// It never fails an install: a missing node-pty, another version or a
// throw prints one line and exits 0, and packages/app/scripts/stage.mjs is
// what refuses to stage without the files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const NODE_PTY_VERSION = '1.1.0';
export const CONOUT_MARK = 'emerald fix 1156';
// Paths under node-pty's lib/.
export const CONOUT_FILES = ['windowsConoutConnection.js', 'worker/conoutSocketWorker.js'];

// version: the installed package.json's, or null when node-pty is not there.
// installed, ours: the two texts in CONOUT_FILES order, installed entries
// null when missing.
export function planCopy({ version, installed, ours }) {
  if (version === null) return 'missing';
  if (version !== NODE_PTY_VERSION) return 'version';
  if (installed.every((text, i) => text !== null && text === ours[i])) return 'already';
  return 'copy';
}

function main() {
  // The root from this file, never the cwd: npm runs a postinstall at the
  // root, but a person may run it from anywhere.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const nodePty = path.join(root, 'node_modules', 'node-pty');
  const pkg = path.join(nodePty, 'package.json');
  const version = fs.existsSync(pkg) ? JSON.parse(fs.readFileSync(pkg, 'utf8')).version : null;
  const readOr = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  const oursPaths = CONOUT_FILES.map((rel) => path.join(root, 'scripts', 'node-pty', 'lib', rel));
  const installedPaths = CONOUT_FILES.map((rel) => path.join(nodePty, 'lib', rel));
  const ours = oursPaths.map((f) => fs.readFileSync(f, 'utf8'));
  const installed = version === null ? CONOUT_FILES.map(() => null) : installedPaths.map(readOr);
  const plan = planCopy({ version, installed, ours });
  if (plan === 'missing') {
    console.log('patch-node-pty: node_modules/node-pty is not installed; nothing to patch');
  } else if (plan === 'version') {
    console.log(`patch-node-pty: node-pty is ${version}, not ${NODE_PTY_VERSION}; left as it is (fix 1156)`);
  } else if (plan === 'copy') {
    for (let i = 0; i < CONOUT_FILES.length; i++) {
      fs.mkdirSync(path.dirname(installedPaths[i]), { recursive: true });
      fs.copyFileSync(oursPaths[i], installedPaths[i]);
    }
    console.log('patch-node-pty: one conout worker for every pty (fix 1156)');
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (err) {
    console.log(`patch-node-pty: could not patch (${err?.message ?? err}); left as it is (fix 1156)`);
  }
  process.exit(0);
}
