import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo } from '@emerald/shared';
import { EXIT_TO_SHELL_REASON, exitsToShell } from './exit-to-shell-model.ts';

type Seen = Pick<SessionInfo, 'id' | 'kind' | 'state' | 'endReason'>;
const claude = (id: string, state: SessionInfo['state'], endReason?: string | null): Seen => ({ id, kind: 'claude', state, ...(endReason === undefined ? {} : { endReason }) });

test('a Claude seen working then exited with /exit drops to a shell once (M9 fix 813)', () => {
  let { live, exited } = exitsToShell(new Set(), [claude('a', 'working')]);
  assert.deepEqual(exited, []);
  ({ live, exited } = exitsToShell(live, [claude('a', 'exited', EXIT_TO_SHELL_REASON)]));
  assert.deepEqual(exited, ['a']);
  ({ live, exited } = exitsToShell(live, [claude('a', 'exited', EXIT_TO_SHELL_REASON)]));
  assert.deepEqual(exited, [], 'not a second time');
});

test("an exit whose SessionEnd lands a call later drops on that call (M9 fix 813)", () => {
  let { live, exited } = exitsToShell(new Set(), [claude('a', 'idle')]);
  ({ live, exited } = exitsToShell(live, [claude('a', 'exited', null)]));
  assert.deepEqual(exited, [], 'no reason yet');
  ({ live, exited } = exitsToShell(live, [claude('a', 'exited', EXIT_TO_SHELL_REASON)]));
  assert.deepEqual(exited, ['a']);
});

test('a logout, a kill, a first sighting at exited and a shell never drop (M9 fix 813)', () => {
  for (const reason of ['other', 'logout']) {
    let { live, exited } = exitsToShell(new Set(), [claude('a', 'working')]);
    ({ live, exited } = exitsToShell(live, [claude('a', 'exited', reason)]));
    assert.deepEqual(exited, [], reason);
    assert.equal(live.has('a'), false, `${reason} drops out of live`);
  }
  assert.deepEqual(exitsToShell(new Set(), [claude('a', 'exited', EXIT_TO_SHELL_REASON)]).exited, [], 'first seen exited');
  let { live, exited } = exitsToShell(new Set(), [{ id: 's', kind: 'shell', state: 'idle' }]);
  ({ live, exited } = exitsToShell(live, [{ id: 's', kind: 'shell', state: 'exited', endReason: EXIT_TO_SHELL_REASON }]));
  assert.deepEqual(exited, [], 'a shell is a shell already');
});
