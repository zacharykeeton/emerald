import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateBadge } from './update-model.ts';

test('no badge while off, idle or checking, or when the feed is not ahead', () => {
  assert.equal(updateBadge('0.1.228', null, 'off'), null);
  assert.equal(updateBadge('0.1.228', null, 'idle'), null);
  assert.equal(updateBadge('0.1.228', '0.1.228', 'idle'), null);
  assert.equal(updateBadge('0.1.228', '0.1.240', 'checking'), null);
  assert.equal(updateBadge('0.1.228', '0.1.228', 'available'), null);
  assert.equal(updateBadge('0.1.240', '0.1.228', 'available'), null);
  assert.equal(updateBadge('0.1.228', null, 'available'), null);
});

test('a failed download reads as Retry <v>, with what a click does (M9 fix 656)', () => {
  const b = updateBadge('0.1.228', '0.1.240', 'available');
  assert.equal(b?.text, 'Retry 0.1.240');
  assert.match(b?.title ?? '', /0\.1\.240 is in the feed \(this is 0\.1\.228\)/);
  assert.match(b?.title ?? '', /Nothing changes until you restart/);
  // Available only after a download that failed (M9 fix 625).
  assert.match(b?.title ?? '', /click to try again/);
});

test('no badge while the download runs, and the ready state says what a restart does to the panes (M9 fix 625)', () => {
  assert.equal(updateBadge('0.1.228', '0.1.240', 'downloading', 42), null);
  assert.equal(updateBadge('0.1.228', '0.1.240', 'downloading', null), null);
  const ready = updateBadge('0.1.228', '0.1.240', 'ready', 100);
  assert.equal(ready?.text, 'Restart to update');
  assert.match(ready?.title ?? '', /0\.1\.240 is downloaded and checked \(this is 0\.1\.228\)/);
  assert.match(ready?.title ?? '', /daemon stops and every pane comes back through Resume/);
  assert.equal(updateBadge('0.1.228', '0.1.240', 'installing')?.text, 'Restarting…');
});

test('a failure after a click is shown with its words and a retry', () => {
  const e = updateBadge('0.1.228', '0.1.240', 'error', null, 'net::ERR_CONNECTION_REFUSED');
  assert.equal(e?.text, 'update failed');
  assert.equal(e?.title, 'net::ERR_CONNECTION_REFUSED Click to check again.');
});
