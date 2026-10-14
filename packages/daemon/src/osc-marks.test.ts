import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkScanner } from './osc-marks.ts';

const seq = (payload: string, end = '\x07') => `\x1b]133;${payload}${end}`;
const b = (s: string) => Buffer.from(s, 'utf8');

test('finds the three marks with either terminator, in order, among other output, and reads the D code', () => {
  const s = new MarkScanner();
  const out = s.push(b(`${seq('D;3')}${seq('A', '\x1b\\')}PS C:\\a> ${seq('C')}\r\nsome output\r\n${seq('D;0')}${seq('A')}${seq('B')}`));
  assert.deepEqual(out, [
    { mark: 'D', code: 3 },
    { mark: 'A', code: null },
    { mark: 'C', code: null },
    { mark: 'D', code: 0 },
    { mark: 'A', code: null },
  ]);
  assert.deepEqual(s.push(b('no sequence here')), []);
});

test('a bare D carries no code, a D with rubbish reads as none, and a negative code is kept', () => {
  const s = new MarkScanner();
  assert.deepEqual(s.push(b(`${seq('D')}${seq('D;')}${seq('D;abc')}${seq('D;-1073741510')}`)), [
    { mark: 'D', code: null },
    { mark: 'D', code: null },
    { mark: 'D', code: null },
    { mark: 'D', code: -1073741510 },
  ]);
});

test('a mark cut between chunks is completed by the next push, wherever the cut falls', () => {
  const whole = `before ${seq('C')} out ${seq('D;12')} after`;
  for (let cut = 1; cut < whole.length; cut++) {
    const s = new MarkScanner();
    const first = s.push(b(whole.slice(0, cut)));
    const second = s.push(b(whole.slice(cut)));
    assert.deepEqual([...first, ...second], [{ mark: 'C', code: null }, { mark: 'D', code: 12 }], `cut at ${cut}`);
  }
});

// The bytes Git Bash 5.2 with the daemon's rc and cmd with its PROMPT
// write (M9 fix 624), recorded off a real ConPTY: the scanner needs no
// change for either, and these pin that it never does.
test('a Git Bash prompt and a cmd prompt write the marks the PowerShell wrapper does (fix 624)', () => {
  assert.deepEqual(new MarkScanner().push(b('\x1b]133;C\x07' + 'output\r\n' + '\x1b]133;D;1\x07\x1b]133;A\x07\x1b]9;9;"C:\\Users\\x"\x1b\\' + '\x1b]0;MINGW64:/c/Users/x\x07\r\n$ ')), [
    { mark: 'C', code: null },
    { mark: 'D', code: 1 },
    { mark: 'A', code: null },
  ]);
  assert.deepEqual(new MarkScanner().push(b('\x1b]133;D\x1b\\\x1b]133;A\x1b\\\x1b]9;9;C:\\Users\\x\x1b\\C:\\Users\\x>')), [
    { mark: 'D', code: null },
    { mark: 'A', code: null },
  ]);
});
