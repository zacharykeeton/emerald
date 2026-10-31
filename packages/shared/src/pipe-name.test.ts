import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { isNoDaemon, pipePathOf, pipeUser, readPipeToken, sameHome, emeraldHomeOf } from './pipe-name.ts';
import { mkTemp, removeTemps } from './test-temp.ts';

after(async () => {
  await removeTemps();
});

// M9 fix 495: the pipe is named per user, and per home when a home is set.
test('the pipe name follows the user, the home and EMERALD_PIPE', () => {
  // The named pipe is Windows' (M9 fix 1015), so these ask for win32.
  assert.equal(pipePathOf({}, 'Zachary.Keeton', 'win32'), '\\\\.\\pipe\\emmerd-zacharykeeton');
  const home = 'C:\\Users\\x\\AppData\\Local\\Temp\\emerald-verify-a';
  const named = pipePathOf({ EMERALD_HOME: home }, 'Zachary.Keeton', 'win32');
  assert.match(named, /^\\\\\.\\pipe\\emmerd-zacharykeeton-[0-9a-f]{8}$/);
  // A Windows path compares case-blind and with its separator only on
  // Windows; off it the two strings are other relative names.
  if (process.platform === 'win32') {
    assert.equal(pipePathOf({ EMERALD_HOME: home.toUpperCase() }, 'Zachary.Keeton', 'win32'), named, 'the same home upper-cased');
    assert.equal(pipePathOf({ EMERALD_HOME: `${home}\\` }, 'Zachary.Keeton', 'win32'), named, 'the same home with a trailing separator');
  }
  assert.notEqual(pipePathOf({ EMERALD_HOME: `${home}b` }, 'Zachary.Keeton', 'win32'), named, 'another home');
  assert.equal(pipePathOf({ EMERALD_HOME: home, EMERALD_PIPE: '\\\\.\\pipe\\mine' }, 'Zachary.Keeton', 'win32'), '\\\\.\\pipe\\mine', 'EMERALD_PIPE wins');
  assert.equal(pipePathOf({ EMERALD_PIPE: '\\\\.\\pipe\\mine' }, 'Zachary.Keeton', 'win32'), '\\\\.\\pipe\\mine');
});

test('a user name keeps its letters and digits, or is hashed when none are left', () => {
  assert.equal(pipeUser('Zachary.Keeton'), 'zacharykeeton');
  assert.match(pipeUser('ユーザー'), /^[0-9a-f]{8}$/);
  assert.notEqual(pipeUser('ユーザー'), pipeUser('用户'));
  if (process.platform === 'win32') assert.equal(sameHome('C:\\a\\b', 'c:\\A\\B\\'), true);
});

// M9 fix 544: an empty or blank EMERALD_HOME counts as unset on every side.
test('an empty EMERALD_HOME gives the default home and the default pipe', () => {
  const home = path.join(os.homedir(), '.emerald');
  assert.equal(emeraldHomeOf({ EMERALD_HOME: '' }), home);
  assert.equal(emeraldHomeOf({ EMERALD_HOME: '  ' }), home);
  assert.equal(pipePathOf({ EMERALD_HOME: '' }, 'Zed', 'win32'), pipePathOf({}, 'Zed', 'win32'));
  assert.equal(pipePathOf({ EMERALD_HOME: '  ' }, 'Zed', 'win32'), pipePathOf({}, 'Zed', 'win32'));
});

// M9 fix 1015: off Windows the pipe is a Unix socket in the home.
test('off Windows the pipe is emmerd.sock in the home, and a path past 100 bytes throws', () => {
  for (const platform of ['linux', 'darwin'] as const) {
    assert.equal(pipePathOf({}, 'Zed', platform), path.join(os.homedir(), '.emerald', 'emmerd.sock'), `${platform}: the default home`);
    const home = path.join(os.tmpdir(), 'emerald-sock-home');
    assert.equal(pipePathOf({ EMERALD_HOME: home }, 'Zed', platform), path.join(path.resolve(home), 'emmerd.sock'), `${platform}: a named home`);
    assert.equal(pipePathOf({ EMERALD_HOME: '' }, 'Zed', platform), pipePathOf({}, 'Zed', platform), `${platform}: an empty home`);
    assert.equal(pipePathOf({ EMERALD_HOME: '   ' }, 'Zed', platform), pipePathOf({}, 'Zed', platform), `${platform}: a blank home`);
    assert.equal(pipePathOf({ EMERALD_HOME: home, EMERALD_PIPE: '/tmp/mine.sock' }, 'Zed', platform), '/tmp/mine.sock', `${platform}: EMERALD_PIPE wins`);
    assert.throws(() => pipePathOf({ EMERALD_HOME: 'a'.repeat(100) }, 'Zed', platform), /EMERALD_PIPE/, `${platform}: a long home throws`);
  }
});

test('isNoDaemon is ENOENT everywhere and ECONNREFUSED off Windows', () => {
  for (const p of ['win32', 'linux', 'darwin'] as const) assert.equal(isNoDaemon('ENOENT', p), true, p);
  assert.equal(isNoDaemon('ECONNREFUSED', 'linux'), true);
  assert.equal(isNoDaemon('ECONNREFUSED', 'darwin'), true);
  assert.equal(isNoDaemon('ECONNREFUSED', 'win32'), false);
  assert.equal(isNoDaemon('EPERM', 'linux'), false);
  assert.equal(isNoDaemon(undefined, 'linux'), false);
});

// M9 fix 612: the pipe token off daemon.json, or undefined.
test("readPipeToken answers daemon.json's pipeToken and nothing else", () => {
  const none = mkTemp('emerald-token-');
  assert.equal(readPipeToken(none), undefined, 'no file');
  const garbled = mkTemp('emerald-token-');
  fs.writeFileSync(path.join(garbled, 'daemon.json'), 'not json');
  assert.equal(readPipeToken(garbled), undefined, 'not JSON');
  const old = mkTemp('emerald-token-');
  fs.writeFileSync(path.join(old, 'daemon.json'), JSON.stringify({ pid: 1, hookToken: 'x' }));
  assert.equal(readPipeToken(old), undefined, 'no pipeToken');
  const empty = mkTemp('emerald-token-');
  fs.writeFileSync(path.join(empty, 'daemon.json'), JSON.stringify({ pid: 1, pipeToken: '' }));
  assert.equal(readPipeToken(empty), undefined, 'an empty pipeToken');
  const good = mkTemp('emerald-token-');
  fs.writeFileSync(path.join(good, 'daemon.json'), JSON.stringify({ pid: 1, pipeToken: 'c'.repeat(64), hookToken: 'x' }));
  assert.equal(readPipeToken(good), 'c'.repeat(64));
});
