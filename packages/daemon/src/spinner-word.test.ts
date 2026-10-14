import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpinnerScanner } from './spinner-word.ts';

const b = (s: string) => Buffer.from(s, 'utf8');

// A repaint as ConPTY hands it on, read off a real turn (M9 fix 158).
const repaint = (glyph: string, word: string) => `\x1b[?2026h\x1b[?2026l\x1b[?25l\x1b[38;2;215;119;87m\x1b[34;1H${glyph}\x1b[1C${word}\u2026\x1b[37;3H\x1b[?25h\x1b[m`;

test('finds the spinner word in a repaint, the last of a burst, and the space form on a scrolled line', () => {
  const s = new SpinnerScanner();
  assert.deepEqual(s.push(b(repaint('✶', 'Finagling'))), ['Finagling']);
  assert.deepEqual(s.push(b(repaint('✻', 'Finagling') + repaint('✽', 'Boogieing') + '\x1b[38;2;153;153;153m(running UserPromptSubmit hooks\u2026 0/2)')), ['Finagling', 'Boogieing']);
  assert.deepEqual(s.push(b('\x1b[38;2;215;119;87m\r\n✻ Thinking\u2026 \x1b[m\x1b[20C\x1b[K')), ['Thinking']);
});

test('a word cut between chunks is completed by the next push, wherever the cut falls', () => {
  const whole = b('text before' + repaint('✳', 'Whatchamacalliting') + ' after');
  for (let cut = 1; cut < whole.length; cut++) {
    const s = new SpinnerScanner();
    const first = s.push(whole.subarray(0, cut));
    const second = s.push(whole.subarray(cut));
    assert.deepEqual([...first, ...second], ['Whatchamacalliting'], `cut at ${cut}`);
  }
});

test('a line that is not a spinner is left alone', () => {
  const s = new SpinnerScanner();
  // A shell's prompt, a title, a tool result with an ellipsis, a
  // lower-case word, a word with no ellipsis.
  assert.deepEqual(s.push(b('PS C:\\Users\\me> \x1b]0;◐ Git log hash\x07\r\n  ⎿ Read 40 lines\u2026\r\n✻ grinding\u2026\r\n✻ Grinding\r\n')), []);
  // A carry that never completes is dropped rather than kept forever.
  assert.deepEqual(s.push(b('\x1b[34;1H✶\x1b[1C' + 'A'.repeat(1000))), []);
  assert.deepEqual(s.push(b(repaint('✢', 'Reticulating'))), ['Reticulating']);
});
