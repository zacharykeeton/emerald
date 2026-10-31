import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// M9 fix 1022: the sh shim resources/bin/emmer on a Mac. In the bundle it
// sits at Emerald.app/Contents/Resources/bin/emmer and runs the CLI under
// Contents/MacOS/Emerald as node; through the PATH link
// (/usr/local/bin/emmer) it first follows the link to itself. A fake bundle
// stands in: its Emerald is a sh script that runs node with a mark, and its
// main.js prints what it was run with. Off Windows only (the WSL run is the
// venue); it imports nothing but node's own modules.

const shim = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources', 'bin', 'emmer');
const offWindows = { skip: process.platform === 'win32' };
const temps: string[] = [];
test.after(() => {
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
});

function bundle(): { root: string; bin: string; exe: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-shim-'));
  temps.push(root);
  const contents = path.join(root, 'Emerald.app', 'Contents');
  const bin = path.join(contents, 'Resources', 'bin', 'emmer');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.copyFileSync(shim, bin);
  fs.chmodSync(bin, 0o755);
  const main = path.join(contents, 'Resources', 'cli', 'dist', 'main.js');
  fs.mkdirSync(path.dirname(main), { recursive: true });
  fs.writeFileSync(main, "console.log(JSON.stringify({ asNode: process.env.ELECTRON_RUN_AS_NODE ?? null, via: process.env.FAKE_EXE ?? 'node', args: process.argv.slice(2) }));\n");
  const exe = path.join(contents, 'MacOS', 'Emerald');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '#!/bin/sh\nFAKE_EXE=mac exec node "$@"\n');
  fs.chmodSync(exe, 0o755);
  return { root, bin, exe };
}

const ARGS = ['a', 'b c', '"q"'];

function run(file: string): { asNode: string | null; via: string; args: string[] } {
  const env = { ...process.env };
  delete env['ELECTRON_RUN_AS_NODE'];
  delete env['FAKE_EXE'];
  const r = spawnSync(file, ARGS, { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, `${file} exits 0 (stderr: ${r.stderr})`);
  return JSON.parse(r.stdout) as { asNode: string | null; via: string; args: string[] };
}

test('the shim in a Mac bundle runs the CLI under the bundle executable as node, arguments as given', offWindows, () => {
  const { bin } = bundle();
  assert.deepEqual(run(bin), { asNode: '1', via: 'mac', args: ARGS });
});

test('an absolute and a relative link to the shim, from another folder, run the same', offWindows, () => {
  const { bin } = bundle();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-shim-link-'));
  temps.push(elsewhere);
  const abs = path.join(elsewhere, 'abs', 'emmer');
  fs.mkdirSync(path.dirname(abs));
  fs.symlinkSync(bin, abs);
  assert.deepEqual(run(abs), { asNode: '1', via: 'mac', args: ARGS });
  const rel = path.join(elsewhere, 'rel', 'emmer');
  fs.mkdirSync(path.dirname(rel));
  fs.symlinkSync(path.relative(path.dirname(rel), bin), rel);
  assert.ok(!path.isAbsolute(fs.readlinkSync(rel)), 'the second link is relative');
  assert.deepEqual(run(rel), { asNode: '1', via: 'mac', args: ARGS });
  // A link to a link is followed to the end.
  const chain = path.join(elsewhere, 'chain');
  fs.symlinkSync(abs, chain);
  assert.deepEqual(run(chain), { asNode: '1', via: 'mac', args: ARGS });
});

test('with no bundle executable the shim runs the CLI under node', offWindows, () => {
  const { bin, exe } = bundle();
  fs.rmSync(exe);
  assert.deepEqual(run(bin), { asNode: null, via: 'node', args: ARGS });
});
