// Assembles packages/app/stage/, the self-contained daemon and CLI that
// electron-builder ships as extraResources next to the app. The layout
// mirrors the repo (daemon/ and cli/ side by side, one node_modules above
// them), so the CLI's "../../daemon/dist/main.js" resolution and Node's
// upward node_modules walk both work unchanged in the installed tree:
//
//   stage/
//     daemon/package.json, dist/*.js
//     cli/package.json, dist/**/*.js, hooks/claude-hook.cmd and the status line files, skills/emmer-cli/SKILL.md
//     node_modules/@emerald/shared/package.json, dist/*.js
//     node_modules/node-pty/package.json, lib/*.js, prebuilds/win32-<arch>/
//     node_modules/@xterm/headless/package.json, lib-headless/xterm-headless.js
//     bin/emmer.cmd, emmer-path.ps1
//     schemes/*.json, the terminal's shipped colour schemes (M9 fix 225)
//     WHATS-NEW.md, the notes the What's New tab shows (M9 fix 227)
//
// Build first (npm run build at the root). Run: node scripts/stage.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..', '..');
export const stageDir = path.join(appDir, 'stage');

// Runtime JavaScript only: no declarations, source maps or tests.
function isRuntimeJs(file) {
  return file.endsWith('.js') && !file.endsWith('.test.js');
}

// M9 fix 602: built files that no runtime path loads; the unit suites' temp
// folder helper, shared's and the daemon's orphan from before fix 585, and
// the daemon's pipe client, which only its tests and scripts/smoke.ts import.
const TEST_ONLY_JS = new Set(['test-temp.js', 'client.js']);

// The daemon's and shared's keep rule (M9 fix 602): runtime JavaScript, not
// on the test-only list, and built from a source that still exists, so a dist
// file whose .ts was moved or deleted, which tsc -b never removes, stays out
// of the stage.
function keepBuilt(srcDir) {
  return (name, rel) => isRuntimeJs(name) && !TEST_ONLY_JS.has(rel) && fs.existsSync(path.join(srcDir, rel.slice(0, -'.js'.length) + '.ts'));
}

function copyTree(from, to, keep, rel = '') {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dst, keep, path.join(rel, entry.name));
    } else if (keep(entry.name, path.join(rel, entry.name))) {
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function require(file, hint) {
  if (!fs.existsSync(file)) throw new Error(`${file} is missing (${hint})`);
}

export function stage({ arch = 'arm64' } = {}) {
  const daemon = path.join(repoRoot, 'packages', 'daemon');
  const cli = path.join(repoRoot, 'packages', 'cli');
  const shared = path.join(repoRoot, 'packages', 'shared');
  const nodePty = path.join(repoRoot, 'node_modules', 'node-pty');
  require(path.join(daemon, 'dist', 'main.js'), 'run npm run build at the repo root');
  require(path.join(cli, 'dist', 'main.js'), 'run npm run build at the repo root');
  require(path.join(shared, 'dist', 'index.js'), 'run npm run build at the repo root');
  require(path.join(nodePty, 'prebuilds', `win32-${arch}`, 'pty.node'), 'npm install did not fetch node-pty 1.1.0');

  fs.rmSync(stageDir, { recursive: true, force: true });

  copyFile(path.join(daemon, 'package.json'), path.join(stageDir, 'daemon', 'package.json'));
  copyTree(path.join(daemon, 'dist'), path.join(stageDir, 'daemon', 'dist'), keepBuilt(path.join(daemon, 'src')));

  copyFile(path.join(cli, 'package.json'), path.join(stageDir, 'cli', 'package.json'));
  copyTree(path.join(cli, 'dist'), path.join(stageDir, 'cli', 'dist'), isRuntimeJs);
  for (const f of ['claude-hook.cmd', 'claude-statusline.cmd', 'claude-statusline.js']) {
    copyFile(path.join(cli, 'hooks', f), path.join(stageDir, 'cli', 'hooks', f));
  }
  copyFile(path.join(cli, 'skills', 'emmer-cli', 'SKILL.md'), path.join(stageDir, 'cli', 'skills', 'emmer-cli', 'SKILL.md'));

  const sharedOut = path.join(stageDir, 'node_modules', '@emerald', 'shared');
  copyFile(path.join(shared, 'package.json'), path.join(sharedOut, 'package.json'));
  copyTree(path.join(shared, 'dist'), path.join(sharedOut, 'dist'), keepBuilt(path.join(shared, 'src')));

  // node-pty needs no build step and requires nothing else at runtime
  // (node-addon-api is compile-time only). Only the built arch's prebuild
  // ships; the .pdb symbol files are ten times the size of the binaries.
  const ptyOut = path.join(stageDir, 'node_modules', 'node-pty');
  copyFile(path.join(nodePty, 'package.json'), path.join(ptyOut, 'package.json'));
  copyTree(path.join(nodePty, 'lib'), path.join(ptyOut, 'lib'), isRuntimeJs);
  copyTree(
    path.join(nodePty, 'prebuilds', `win32-${arch}`),
    path.join(ptyOut, 'prebuilds', `win32-${arch}`),
    (name) => !name.endsWith('.pdb'),
  );

  // The headless xterm behind read --screen (M17): one JS bundle, no
  // dependencies of its own. Left out of the stage until the M29 install
  // found the shipped daemon could not start.
  const headless = path.join(repoRoot, 'node_modules', '@xterm', 'headless');
  require(path.join(headless, 'lib-headless', 'xterm-headless.js'), 'npm install did not fetch @xterm/headless');
  const headlessOut = path.join(stageDir, 'node_modules', '@xterm', 'headless');
  copyFile(path.join(headless, 'package.json'), path.join(headlessOut, 'package.json'));
  copyTree(path.join(headless, 'lib-headless'), path.join(headlessOut, 'lib-headless'), isRuntimeJs);

  copyFile(path.join(appDir, 'resources', 'bin', 'emmer.cmd'), path.join(stageDir, 'bin', 'emmer.cmd'));
  copyFile(path.join(appDir, 'resources', 'bin', 'emmer-path.ps1'), path.join(stageDir, 'bin', 'emmer-path.ps1'));
  // The colour schemes land under resources/schemes next to app.asar,
  // where main/index.ts's resolveSchemesDir reads them in a packaged app.
  copyTree(path.join(appDir, 'resources', 'schemes'), path.join(stageDir, 'schemes'), (name) => name.endsWith('.json'));

  // The release notes (M9 fix 227) ride beside the daemon under resources/,
  // where the main process reads them for the What's New tab; a dev build
  // reads the checkout's docs/WHATS-NEW.md.
  require(path.join(repoRoot, 'docs', 'WHATS-NEW.md'), 'the release notes are missing from docs/');
  copyFile(path.join(repoRoot, 'docs', 'WHATS-NEW.md'), path.join(stageDir, 'WHATS-NEW.md'));
  return stageDir;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = stage();
  let bytes = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else bytes += fs.statSync(path.join(d, e.name)).size;
    }
  };
  walk(dir);
  console.log(`staged ${dir} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
}
