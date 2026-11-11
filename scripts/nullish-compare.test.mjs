// No nullish default compared without brackets (the retro of the run of
// fixes 1091 to 1114). `a ?? <literal>` followed by `===` parses as
// `a ?? (<literal> === ...)`, which is true whenever `a` is not null, so a
// verify script's waitFor built that way passed on the wrong text for four
// harness runs of fix 1094's steps. Bracket the default:
// `(a ?? null) === 'x'`. A comment that spells the trap out is skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptFolders = ['scripts', 'packages/app/scripts', 'packages/cli/scripts', 'packages/daemon/scripts', '.claude/skills/batch', '.claude/hooks'];
const sourceFolders = ['packages/app/src', 'packages/cli/src', 'packages/daemon/src', 'packages/shared/src', 'packages/cli/hooks', 'packages/cli/mod'];

function walk(dir, exts, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'out') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.test(e.name)) out.push(p);
  }
  return out;
}

const files = [
  ...scriptFolders.flatMap((f) => fs.existsSync(path.join(root, f)) ? fs.readdirSync(path.join(root, f)).filter((n) => /\.(mjs|cjs)$/.test(n)).map((n) => path.join(root, f, n)) : []),
  ...sourceFolders.flatMap((f) => walk(path.join(root, f), /\.(ts|tsx|js|mjs|cjs)$/, [])),
];

// Two question marks, a literal default, then a comparison with no bracket
// closing the default first.
const unbracketed = new RegExp('[?][?]\\s*(null|undefined|\'\'|""|0|false|true)\\s*(===|!==|==|!=)');

test('the scan has files to read', () => {
  assert.ok(files.length > 200, `found ${files.length} files`);
});

test('no nullish default is compared without brackets (M9 fixes 1091 to 1114)', () => {
  const hits = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (unbracketed.test(line)) hits.push(`${path.relative(root, file).replaceAll('\\', '/')}:${i + 1}: ${t.slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, [], `bracket the default, (a ?? null) === 'x':\n${hits.join('\n')}`);
});
