import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CwdScanner } from './osc-cwd.ts';

const seq = (path: string, end = '\x1b\\') => `\x1b]9;9;${path}${end}`;
const b = (s: string) => Buffer.from(s, 'utf8');

test('finds quoted and bare paths with either terminator, in order, among other output', () => {
  const s = new CwdScanner();
  const out = s.push(b(`PS C:\\a> ${seq('"C:\\Users\\me\\code"')}\r\n${seq('C:\\Temp', '\x07')}\x1b[32mtext\x1b[0m`));
  assert.deepEqual(out, ['C:\\Users\\me\\code', 'C:\\Temp']);
  assert.deepEqual(s.push(b('no sequence here')), []);
});

test('a sequence cut between chunks is completed by the next push, wherever the cut falls', () => {
  const whole = `before ${seq('"C:\\code\\emerald"')} after`;
  for (let cut = 1; cut < whole.length; cut++) {
    const s = new CwdScanner();
    const first = s.push(b(whole.slice(0, cut)));
    const second = s.push(b(whole.slice(cut)));
    assert.deepEqual([...first, ...second], ['C:\\code\\emerald'], `cut at ${cut}`);
  }
});

test('non-ASCII paths survive, an empty path is skipped, and an endless sequence is dropped', () => {
  const s = new CwdScanner();
  assert.deepEqual(s.push(b(seq('"C:\\Users\\Zoë\\проект"'))), ['C:\\Users\\Zoë\\проект']);
  assert.deepEqual(s.push(b(seq('""'))), []);
  assert.deepEqual(s.push(b('\x1b]9;9;' + 'x'.repeat(5000))), []);
  assert.deepEqual(s.push(b('\x07' + seq('C:\\ok', '\x07'))), ['C:\\ok'], 'the dropped one does not swallow the next');
});

// The bytes Git Bash 5.2 with the daemon's rc and cmd with its PROMPT
// write (M9 fix 624): the folder quoted from bash, bare from cmd, and
// cmd at a drive root, whose path ends in the backslash right before the
// terminator's ESC.
test('a Git Bash prompt and a cmd prompt write the marks the PowerShell wrapper does (fix 624)', () => {
  assert.deepEqual(new CwdScanner().push(b('\x1b]133;C\x07' + 'output\r\n' + '\x1b]133;D;1\x07\x1b]133;A\x07\x1b]9;9;"C:\\Users\\x"\x1b\\' + '\x1b]0;MINGW64:/c/Users/x\x07\r\n$ ')), ['C:\\Users\\x']);
  assert.deepEqual(new CwdScanner().push(b('\x1b]133;D\x1b\\\x1b]133;A\x1b\\\x1b]9;9;C:\\Users\\x\x1b\\C:\\Users\\x>')), ['C:\\Users\\x']);
  assert.deepEqual(new CwdScanner().push(b('\x1b]9;9;C:\\\x1b\\C:\\>')), ['C:\\']);
});
