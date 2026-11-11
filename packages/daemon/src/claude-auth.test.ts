// M9 fix 1094: whether a claude is signed in, off claude auth status --json.
// A stub script stands in for claude, so no test runs the box's own.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseClaudeAuth, readClaudeAuth } from './claude-auth.ts';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-1094-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));

// Writes its argv to argv.json beside itself, then answers by STUB_ANSWER:
// the text to print and the exit code, or a sleep.
const stub = path.join(root, 'stub-claude.mjs');
fs.writeFileSync(
  stub,
  [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "fs.writeFileSync(path.join(path.dirname(process.argv[1]), 'argv.json'), JSON.stringify(process.argv.slice(2)));",
    "const a = JSON.parse(process.env.STUB_ANSWER || '{}');",
    'if (a.sleep) setTimeout(() => {}, a.sleep);',
    "else { process.stdout.write(a.out ?? ''); process.exitCode = a.code ?? 0; }",
    '',
  ].join('\n'),
);
const run = { file: process.execPath, args: [stub] };
const answer = (out: string, code = 0) => ({ ...process.env, STUB_ANSWER: JSON.stringify({ out, code }) });

test('parseClaudeAuth and readClaudeAuth: signed in, signed out on exit 1, expired, not JSON, no claude and a hang (M9 fix 1094)', async () => {
  const at = '2026-12-01T00:00:00.000Z';
  assert.deepEqual(await readClaudeAuth(run, answer(JSON.stringify({ loggedIn: true, loginExpiresAt: at }))), { signedIn: true, expiresAt: Date.parse(at) });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'argv.json'), 'utf8')), ['auth', 'status', '--json']);
  assert.deepEqual(await readClaudeAuth(run, answer(JSON.stringify({ loggedIn: false, loginExpiresAt: null }), 1)), { signedIn: false, expiresAt: null }, 'stdout is read on exit 1');
  assert.deepEqual(await readClaudeAuth(run, answer(JSON.stringify({ loggedIn: true, loginExpiresAt: 'not a date' }))), { signedIn: true, expiresAt: null });
  assert.equal(await readClaudeAuth(run, answer('Not logged in.', 1)), null);
  assert.equal(await readClaudeAuth(run, answer(JSON.stringify({ authMethod: 'none' }))), null);
  assert.equal(await readClaudeAuth(null, process.env), null);
  const t0 = Date.now();
  assert.equal(await readClaudeAuth(run, { ...process.env, STUB_ANSWER: JSON.stringify({ sleep: 5000 }) }, 300), null);
  assert.ok(Date.now() - t0 < 2000, `the hang gave up at its timeout, ${Date.now() - t0} ms`);
  assert.equal(parseClaudeAuth('[1]'), null);
  assert.deepEqual(parseClaudeAuth(`\n${JSON.stringify({ loggedIn: true, loginExpiresAt: null })}\n`), { signedIn: true, expiresAt: null });
});
