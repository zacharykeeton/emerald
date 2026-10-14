// Stages the daemon and CLI, then runs electron-builder for win32, arm64
// by default. `node scripts/pack.mjs --dir` builds the unpacked directory
// only; without the flag it builds the NSIS installer too. `--x64` builds
// for x64 instead (M9 fix 452), staging node-pty's win32-x64 prebuild, and
// writes to release-x64/ so release/latest.yml, which `emmer feed publish`
// reads to pick the installer to serve, is never rewritten to name an x64
// installer this box's arm64 app would then be offered.
//
// This wrapper exists for one environment variable. 7-Zip 24 applies its
// ARM64 branch filter to ARM64 executables on its own, and the NSIS 7z
// plugin that unpacks the installer predates that filter: it skipped every
// .exe and .dll silently, and the install had no Emerald.exe. The classic
// BCJ filter is decodable by the plugin, so the archive is built with it.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage } from './stage.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.resolve(appDir, '..', '..', 'node_modules', 'electron-builder', 'cli.js');
const dirOnly = process.argv.includes('--dir');
const arch = process.argv.includes('--x64') ? 'x64' : 'arm64';

stage({ arch });
// --publish never: the publish block in electron-builder.yml is there for
// the updater's app-update.yml and latest.yml (M9 fix 239), and the feed
// is a folder `emmer feed publish` copies into, never an upload from here,
// and names the public repository the updater reads (fix 608).
const r = spawnSync(process.execPath, [cli, '--win', `--${arch}`, '--publish', 'never', ...(arch === 'x64' ? ['-c.directories.output=release-x64'] : []), ...(dirOnly ? ['--dir'] : [])], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_BUILDER_7Z_FILTER: 'BCJ' },
});
process.exit(r.status ?? 1);
