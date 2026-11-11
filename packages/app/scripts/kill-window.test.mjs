// M9 fix 1115: the pure half of killWindow, which reads the electron.exe
// list and keeps the rows on one profile started since the spawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowPidsOf } from './cdp.mjs';

test('windowPidsOf keeps the electron.exe rows on this profile started since the spawn, the window first (M9 fix 1115)', () => {
  const profile = 'C:\\T\\emerald-verify-a\\electron-profile';
  const spawnedAt = 1_700_000_000_000;
  const rows = [
    // A helper first in the output, to prove the window still leads.
    '102\t1700000006000\t"C:\\x\\electron.exe" --type=gpu-process --user-data-dir="C:\\T\\emerald-verify-a\\electron-profile" --gpu-preferences=x',
    '101\t1700000005000\tC:\\x\\electron.exe --remote-debugging-port=9 --user-data-dir=C:\\T\\emerald-verify-a\\electron-profile --force-device-scale-factor=1 C:\\wt\\out\\main\\index.js',
    '103\t1700000007000\tC:\\x\\electron.exe --type=renderer --user-data-dir=c:\\t\\EMERALD-VERIFY-A\\electron-profile',
    '104\t1700000007000\tC:\\x\\electron.exe --user-data-dir=C:\\T\\emerald-verify-ab\\electron-profile',
    '105\t1700000007000\tC:\\x\\electron.exe --user-data-dir=C:\\T\\emerald-verify-a\\electron-profile2',
    '106\t1699999990000\tC:\\x\\electron.exe --user-data-dir=C:\\T\\emerald-verify-a\\electron-profile',
    '107\t1699999999000\tC:\\x\\electron.exe --type=utility --user-data-dir=C:\\T\\emerald-verify-a\\electron-profile',
    'garbage',
    '',
  ];
  const pids = windowPidsOf(rows.join('\r\n'), profile, spawnedAt);
  assert.deepEqual(pids, [101, 102, 103, 107]);
});
