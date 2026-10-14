// The OSC scanner's abort rule (M9 fix 500, the ledger's M10): an OSC ends
// at BEL or ESC \, and any other ESC, CAN or SUB aborts it, as xterm does,
// so an unterminated title or folder cannot swallow the next real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TitleScanner } from './osc-title.ts';
import { CwdScanner } from './osc-cwd.ts';

const push = (s: { push(b: Buffer): string[] }, text: string): string[] => s.push(Buffer.from(text, 'utf8'));

test('an unterminated title is aborted by the next ESC and the real title comes through', () => {
  const s = new TitleScanner();
  const first = push(s, '\x1b]0;half');
  const second = push(s, '\r\noutput output \x1b[2J\x1b]0;✳ Real title\x07');
  assert.deepEqual([...first, ...second], ['✳ Real title']);
});

test('a title aborted inside one chunk drops the screenful after it', () => {
  const s = new TitleScanner();
  assert.deepEqual(push(s, '\x1b]0;x\x1b[0m' + 'y'.repeat(30000) + '\x07'), []);
  assert.deepEqual(push(s, '\x1b]0;ok\x07'), ['ok']);
});

test('an unterminated folder does not become a garbage shellCwd', () => {
  const s = new CwdScanner();
  const first = push(s, '\x1b]9;9;"C:\\a');
  const second = push(s, '\r\nPS> dir\r\n\x1b]9;9;"C:\\real"\x1b\\');
  const all = [...first, ...second];
  assert.deepEqual(all, ['C:\\real']);
  assert.ok(all.every((p) => !p.includes('\r\n')));
});

test('a terminated payload past the carry bound inside one chunk is dropped', () => {
  const s = new TitleScanner();
  assert.deepEqual(push(s, '\x1b]0;' + 'p'.repeat(5000) + '\x07'), []);
  assert.deepEqual(push(s, '\x1b]0;after\x07'), ['after']);
});

test('CAN and SUB each abort a title', () => {
  const s = new TitleScanner();
  assert.deepEqual(push(s, '\x1b]0;one\x18\x1b]0;two\x07'), ['two']);
  assert.deepEqual(push(s, '\x1b]0;three\x1a\x1b]0;four\x07'), ['four']);
});
