import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo } from '@emerald/shared';
import { CliError } from './cli-error.ts';
import { resolveSession, shortId } from './resolve.ts';

function session(id: string, name: string, state: SessionInfo['state'] = 'idle'): SessionInfo {
  return {
    id,
    kind: 'shell',
    name,
    spawnCwd: 'C:\\work',
    cwd: 'C:\\work',
    groupCwd: 'C:\\work',
    state,
    args: [],
    autoName: true,
    branch: null,
    lastPrompt: null,
    lastReply: null,
    stateSince: 0,
    lastEventAt: null,
    stale: false,
    needsInputReason: null,
    errorType: null,
    waitingOn: [],
    team: [],
    conversation: null,
    shellCwd: null,
    commits: [],
    model: null,
    contextPercent: null,
    contextWindow: null,
    tokens: null,
    comment: null,
    phase: null,
    color: '#61afef',
    title: null,
    claudeSessionId: null,
    pid: 1,
    exitCode: null,
    createdAt: 0,
  };
}

const A = session('a1b2c3d4-0000-4000-8000-000000000001', 'emerald');
const B = session('a1b2ffff-0000-4000-8000-000000000002', 'api', 'working');
const C = session('c0ffee00-0000-4000-8000-000000000003', 'emerald', 'exited');
const all = [A, B, C];

function failure(fn: () => unknown, pattern: RegExp): void {
  assert.throws(fn, (err: unknown) => err instanceof CliError && err.exitCode === 1 && pattern.test(err.message));
}

test('an exact id wins over everything', () => {
  assert.equal(resolveSession(all, A.id), A);
});

test('a unique name resolves, a shared name is ambiguous', () => {
  assert.equal(resolveSession(all, 'api'), B);
  failure(() => resolveSession(all, 'emerald'), /"emerald" matches 2 sessions: a1b2c3d4 emerald \(idle\), c0ffee00 emerald \(exited\)/);
});

test('a unique id prefix resolves case-insensitively', () => {
  assert.equal(resolveSession(all, 'c0ff'), C);
  assert.equal(resolveSession(all, 'C0FFEE'), C);
  assert.equal(resolveSession(all, 'a1b2c'), A);
});

test('a shared id prefix is ambiguous and lists the candidates', () => {
  failure(() => resolveSession(all, 'a1b2'), /"a1b2" matches 2 sessions/);
});

test('nothing matching, or an empty reference, is an error', () => {
  failure(() => resolveSession(all, 'nope'), /no session matches "nope"/);
  failure(() => resolveSession(all, '   '), /empty session reference/);
  failure(() => resolveSession([], 'a'), /no session matches "a"/);
});

test('shortId is the first UUID block', () => {
  assert.equal(shortId(A.id), 'a1b2c3d4');
});
