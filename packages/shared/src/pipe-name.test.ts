import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { pipePathOf, pipeUser, readPipeToken, sameHome, emeraldHomeOf } from './pipe-name.ts';
import { mkTemp, removeTemps } from './test-temp.ts';

after(async () => {
  await removeTemps();
});

// M9 fix 495: the pipe is named per user, and per home when a home is set.
test('the pipe name follows the user, the home and EMERALD_PIPE', () => {
  assert.equal(pipePathOf({}, 'Zachary.Keeton'), '\\\\.\\pipe\\emmerd-zacharykeeton');
  const home = 'C:\\Users\\x\\AppData\\Local\\Temp\\emerald-verify-a';
  const named = pipePathOf({ EMERALD_HOME: home }, 'Zachary.Keeton');
  assert.match(named, /^\\\\\.\\pipe\\emmerd-zacharykeeton-[0-9a-f]{8}$/);
  assert.equal(pipePathOf({ EMERALD_HOME: home.toUpperCase() }, 'Zachary.Keeton'), named, 'the same home upper-cased');
  assert.equal(pipePathOf({ EMERALD_HOME: `${home}\\` }, 'Zachary.Keeton'), named, 'the same home with a trailing separator');
  assert.notEqual(pipePathOf({ EMERALD_HOME: `${home}b` }, 'Zachary.Keeton'), named, 'another home');
  assert.equal(pipePathOf({ EMERALD_HOME: home, EMERALD_PIPE: '\\\\.\\pipe\\mine' }, 'Zachary.Keeton'), '\\\\.\\pipe\\mine', 'EMERALD_PIPE wins');
  assert.equal(pipePathOf({ EMERALD_PIPE: '\\\\.\\pipe\\mine' }, 'Zachary.Keeton'), '\\\\.\\pipe\\mine');
});

test('a user name keeps its letters and digits, or is hashed when none are left', () => {
  assert.equal(pipeUser('Zachary.Keeton'), 'zacharykeeton');
  assert.match(pipeUser('ユーザー'), /^[0-9a-f]{8}$/);
  assert.notEqual(pipeUser('ユーザー'), pipeUser('用户'));
  assert.equal(sameHome('C:\\a\\b', 'c:\\A\\B\\'), true);
});

// M9 fix 544: an empty or blank EMERALD_HOME counts as unset on every side.
test('an empty EMERALD_HOME gives the default home and the default pipe', () => {
  const home = path.join(os.homedir(), '.emerald');
  assert.equal(emeraldHomeOf({ EMERALD_HOME: '' }), home);
  assert.equal(emeraldHomeOf({ EMERALD_HOME: '  ' }), home);
  assert.equal(pipePathOf({ EMERALD_HOME: '' }, 'Zed'), pipePathOf({}, 'Zed'));
  assert.equal(pipePathOf({ EMERALD_HOME: '  ' }, 'Zed'), pipePathOf({}, 'Zed'));
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
