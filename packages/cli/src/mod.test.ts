import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOD_HOOK_NAME } from '@emerald/shared';
import { HOOK_EVENTS } from './hooks-install.ts';

// The emerald mod (M9 fix 725) is three files with no build step; these
// hold its shape and its header to the daemon's constant, then let
// Claude Code's own validate and test commands read it.
const modDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'mod');

function readJson(rel: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(modDir, rel), 'utf8'));
}

test('the mod names one module, carries an author, and posts with the daemon\'s three headers (M9 fix 725)', () => {
  const hooks = readJson('hooks/hooks.json') as { modules?: unknown };
  assert.deepEqual(hooks.modules, ['./register.js']);
  const plugin = readJson('.claude-plugin/plugin.json') as { name?: unknown; author?: unknown };
  assert.equal(plugin.name, 'emerald');
  assert.ok(plugin.author, 'plugin.json has an author (validate --strict needs one)');
  const register = fs.readFileSync(path.join(modDir, 'hooks', 'register.js'), 'utf8');
  assert.ok(register.includes(`'X-Emerald-Hook': '${MOD_HOOK_NAME}'`), 'register.js sends MOD_HOOK_NAME');
  assert.ok(register.includes("'X-Emerald-Token'"));
  assert.ok(register.includes("'X-Emerald-Session'"));
  // The mod posts what the hook file posts, less PreToolUse.
  const listed = /const POSTED = new Set\(\[([^\]]*)\]\)/.exec(register)?.[1] ?? '';
  const posted = [...listed.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(posted.sort(), HOOK_EVENTS.filter((e) => e !== 'PreToolUse').sort());
});

function claudeRuns(): boolean {
  const r = spawnSync('claude --version', { shell: true, windowsHide: true, timeout: 60_000, encoding: 'utf8' });
  return r.status === 0;
}

test('claude plugin validate --strict and claude plugin test pass on the mod (M9 fix 725)', (t) => {
  if (!claudeRuns()) {
    t.skip('claude is not on PATH');
    return;
  }
  // Neither command starts a session or reaches the API.
  for (const cmd of [`claude plugin validate --strict "${modDir}"`, `claude plugin test "${modDir}"`]) {
    const r = spawnSync(cmd, { shell: true, windowsHide: true, timeout: 60_000, encoding: 'utf8' });
    assert.equal(r.status, 0, `${cmd} exited ${r.status}: ${r.stdout}${r.stderr}`);
  }
});
