import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitOwners } from './commit-lanes-model.ts';
import type { LaneSession } from './commit-lanes-model.ts';

const h = (n: number) => n.toString(16).padStart(40, '0');
// Newest first, as git log lists them: c5 at the top, c1 at the bottom.
const commits = [5, 4, 3, 2, 1].map((n) => ({ hash: h(n), subject: `c${n}`, author: 'x', at: n * 1000 }));
// Each claim is timed by its position in the list, so a session listed
// with [3, 2] claimed c3 before c2; the time is the position plus the
// session's own offset, given as a third argument.
const session = (id: string, commitNumbers: number[], color: string | null = '#ff0000', offset = 0): LaneSession => ({ id, name: `session ${id}`, color, commits: commitNumbers.map((n, i) => ({ hash: h(n), at: offset + i })), remoteSessionId: null });

test('commitOwners: the trailer names the owner before any claim, and a trailer nobody matches leaves the claim (M58)', () => {
  const a = { ...session('a', [3, 2]), remoteSessionId: 'session_aaa' };
  const b = { ...session('b', [], '#00ff00'), remoteSessionId: 'session_bbb' };
  const withTrailers = commits.map((c) => (c.hash === h(3) ? { ...c, claudeSession: 'session_bbb' } : c.hash === h(2) ? { ...c, claudeSession: 'session_zzz' } : c));
  const owners = commitOwners(withTrailers, [a, b]);
  assert.equal(owners.get(h(3)), 'b', "b's trailer beats a's claim");
  assert.equal(owners.get(h(2)), 'a', 'an unmatched trailer falls back to the claim');
  assert.equal(owners.has(h(5)), false, 'no trailer, no claim, no owner');
  // Two sessions claiming one commit: the earlier claim wins, the first
  // in the list on a tie.
  const early = session('a', [3], '#ff0000', 100);
  const late = session('b', [3, 2]);
  assert.equal(commitOwners(commits, [early, late]).get(h(3)), 'b', 'b claimed c3 first');
  assert.equal(commitOwners(commits, [session('a', [3]), session('b', [3])]).get(h(3)), 'a', 'the first in the list on a tie');
});
