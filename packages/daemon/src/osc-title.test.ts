import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TitleScanner } from './osc-title.ts';

const b = (s: string) => Buffer.from(s, 'utf8');

test('finds OSC 0 and OSC 2 titles with either terminator, in order, and leaves other sequences alone', () => {
  const s = new TitleScanner();
  const out = s.push(b('\x1b]0;◐ Git log hash\x07 text \x1b]2;hello\x1b\\ \x1b]9;9;C:\\Temp\x07 \x1b[32mgreen\x1b[0m'));
  assert.deepEqual(out, ['◐ Git log hash', 'hello']);
  assert.deepEqual(s.push(b('nothing here')), []);
});

test('a title cut between chunks is completed by the next push, wherever the cut falls', () => {
  // The glyph is three UTF-8 bytes, so some cuts fall inside a character.
  const whole = Buffer.from('before \x1b]0;◑ Claude Code\x07 after', 'utf8');
  for (let cut = 1; cut < whole.length; cut++) {
    const s = new TitleScanner();
    const first = s.push(whole.subarray(0, cut));
    const second = s.push(whole.subarray(cut));
    assert.deepEqual([...first, ...second], ['◑ Claude Code'], `cut at ${cut}`);
  }
});

test('an empty title comes through, and an endless one is dropped without swallowing the next', () => {
  const s = new TitleScanner();
  assert.deepEqual(s.push(b('\x1b]0;\x07')), ['']);
  assert.deepEqual(s.push(b('\x1b]2;' + 'x'.repeat(5000))), []);
  assert.deepEqual(s.push(b('\x07\x1b]0;ok\x07')), ['ok']);
});
