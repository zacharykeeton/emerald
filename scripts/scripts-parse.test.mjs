// Every script the repo runs by node parses (the retro of the run of fixes
// 1048 to 1078). Two branches each added a numbered step to smoke-mac.mjs,
// git merged them with no conflict, and the merged script declared `s16`
// twice: a SyntaxError that no Windows run reaches, since the script runs on
// a Mac at release time. `node --check` on every script catches that class at
// the unit suites, on a seat's branch and on the merged tree alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folders = [
  'scripts',
  'packages/app/scripts',
  'packages/cli/scripts',
  'packages/daemon/scripts',
  '.claude/skills/batch',
  '.claude/hooks',
];

function scriptsIn(folder) {
  const dir = path.join(root, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /\.(mjs|cjs)$/.test(f))
    .map((f) => path.join(dir, f));
}

const files = folders.flatMap(scriptsIn);

test('the repo has scripts to check', () => {
  assert.ok(files.length > 20, `found ${files.length} scripts`);
});

for (const file of files) {
  test(`node --check ${path.relative(root, file).replaceAll('\\', '/')}`, () => {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr.split('\n').slice(0, 6).join('\n'));
  });
}
