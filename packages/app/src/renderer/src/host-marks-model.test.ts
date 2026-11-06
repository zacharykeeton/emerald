import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionGroup } from '@emerald/shared';
import { filesRemoteMuted, filesRemoteShellLabel, filesRemoteText, hostChipTitle, hostOrderOf, hostSections, lostBandText, lostClock, lostRowLine, retrySecondsLeft } from './host-marks-model.ts';

const g = (host: string, folder: string): SessionGroup => ({ key: host === '' ? folder : host + '\u0000' + folder, title: folder, sessions: [], host, folder });
const exitedGroup: SessionGroup = { key: 'exited', title: 'exited', sessions: [], host: '', folder: '' };

test('hostChipTitle and hostOrderOf', () => {
  assert.equal(hostChipTitle('wfs-db', 'zach@192.0.2.7'), 'Runs on wfs-db, reached by ssh as zach@192.0.2.7');
  assert.deepEqual(hostOrderOf([{ name: 'a' }, { name: 'b' }]), ['', 'a', 'b']);
  assert.deepEqual(hostOrderOf([]), ['']);
});

test('hostSections is null with no remote group', () => {
  assert.equal(hostSections([g('', 'C:\\a'), exitedGroup], false), null);
});

test('hostSections splits two hosts into runs in the order given', () => {
  const r = hostSections([g('', 'C:\\a'), g('', 'C:\\b'), g('x', '/srv'), g('y', '/srv')], true)!;
  assert.deepEqual(
    r.sections.map((s) => [s.host, s.groups.length]),
    [
      ['', 2],
      ['x', 1],
      ['y', 1],
    ],
  );
  assert.equal(r.exited, null);
});

test('hostSections keeps the Exited group apart', () => {
  const r = hostSections([g('', 'C:\\a'), g('x', '/srv'), exitedGroup], true)!;
  assert.equal(r.sections.length, 2);
  assert.equal(r.exited, exitedGroup);
  assert.ok(r.sections.every((s) => !s.groups.includes(exitedGroup)));
});

test('the Files tab texts', () => {
  assert.equal(filesRemoteText('x'), "This folder is on x. The files, the commit graph and the review tab read this PC's disk, so they are not drawn for it yet.");
  assert.equal(filesRemoteMuted('x'), 'The terminal, the chat view, the state on the row and the hooks all come from x as they do from here.');
  assert.equal(filesRemoteShellLabel('x', 'srv'), 'Shell on x in srv');
});

test('lostClock zero-pads local time', () => {
  assert.equal(lostClock(new Date(2026, 10, 5, 14, 2).getTime()), '14:02');
  assert.equal(lostClock(new Date(2026, 10, 5, 9, 5).getTime()), '09:05');
});

test('lostRowLine', () => {
  assert.equal(lostRowLine(new Date(2026, 10, 5, 14, 2).getTime()), 'Lost at 14:02, trying again');
});

test('lostBandText at 8, 0 and null', () => {
  const at = new Date(2026, 10, 5, 14, 2).getTime();
  assert.equal(lostBandText('x', at, 8), 'Lost the line to x at 14:02. The session runs on there; trying again in 8s.');
  assert.equal(lostBandText('x', at, 0), 'Lost the line to x at 14:02. The session runs on there; trying again now.');
  assert.equal(lostBandText('x', at, null), 'Lost the line to x at 14:02. The session runs on there; trying again.');
});

test('retrySecondsLeft counts down and never goes negative', () => {
  assert.equal(retrySecondsLeft(null, 0, 5000), null);
  assert.equal(retrySecondsLeft(10, 1000, 1000), 10);
  assert.equal(retrySecondsLeft(10, 1000, 4500), 7);
  assert.equal(retrySecondsLeft(10, 1000, 99000), 0);
});
