// The parsers of scripts/install-check.mjs (M9 fix 383) over a fixture
// main.log shaped like the install of fixes 352 to 371, where the sweep
// met EPERM, the poster never wrote its log and the daemon took 5.2 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daemonProcessIs, daemonStartFindings, parseCache, parseMainLog, parseStamps, parseWindowProcesses, posterForm, posterLogFindings, whatsNewHeading } from '../../scripts/install-check.mjs';

const lines = (...ls: string[]): string => ls.join('\n') + '\n';

const install352 = lines(
  '2026-09-21T18:31:18.050Z usage read: 3 windows, asked on focus',
  '2026-09-21T18:31:20.906Z install poster spawned (pid 3764)',
  '2026-09-21T18:31:20.907Z updater: restart to install: stopping the daemon first',
  '2026-09-21T18:31:20.907Z stopping emmerd for the update: asking pid 20436 to stop',
  '2026-09-21T18:31:21.076Z disconnected from emmerd',
  '2026-09-21T18:31:21.094Z updater: Executing: C:\\x\\pending\\Emerald-setup-0.1.352-arm64.exe with args: --updated,/S,--force-run',
  '2026-09-21T18:32:03.092Z single-instance lock held',
  '2026-09-21T18:32:03.157Z installing.json (0.1.352 at 2026-09-21T18:31:20.892Z) is spent: removed',
  '2026-09-21T18:32:03.251Z updater cache: could not remove pending 0.1.352: Error: EPERM, Permission denied',
  '2026-09-21T18:32:03.251Z first launch of 0.1.352 after 0.1.329: running emmer hooks install',
  '2026-09-21T18:32:03.279Z starting emmerd: C:\\x\\Emerald.exe C:\\x\\daemon\\dist\\main.js',
  '2026-09-21T18:32:03.697Z emmer hooks install exited 0',
  '2026-09-21T18:32:08.497Z connected to emmerd 0.1.352 pid 17760 feature level 54',
);

const texts = (f: { level: string; text: string }[]) => f.map((x) => `${x.level}: ${x.text}`);

test('the install of fixes 352 to 371 reads as its three looks', () => {
  const out = texts(parseMainLog(install352));
  assert.ok(out.includes('ok: installer run at 2026-09-21T18:31:21.094Z: C:\\x\\pending\\Emerald-setup-0.1.352-arm64.exe with args: --updated,/S,--force-run'));
  assert.ok(out.includes("ok: no launch in the install's gap"));
  assert.ok(out.includes('ok: 2026-09-21T18:32:03.157Z installing.json (0.1.352 at 2026-09-21T18:31:20.892Z) is spent: removed'));
  assert.ok(out.includes('ok: 2026-09-21T18:32:03.251Z first launch of 0.1.352 after 0.1.329: running emmer hooks install'));
  assert.ok(out.includes('ok: 2026-09-21T18:32:03.697Z emmer hooks install exited 0'));
  assert.ok(out.includes('look: 2026-09-21T18:32:03.251Z updater cache: could not remove pending 0.1.352: Error: EPERM, Permission denied'));
  assert.ok(out.includes('ok: 2026-09-21T18:31:20.906Z install poster spawned (pid 3764)'));
  assert.ok(out.includes('look: connected to emmerd 0.1.352 pid 17760 feature level 54, 5.2 s after starting emmerd (2026-09-21T18:32:03.279Z)'));
  // M9 fix 413: the 0.1.352 build's plain spawn, its pid off the line.
  assert.deepEqual(posterForm(install352), { form: 'plain', pid: '3764' });
});

test('a quick start, a swept cache and a launch in the gap read the other way', () => {
  const text = lines(
    '2026-09-21T20:00:00.000Z install poster spawned (worker pid 10)',
    '2026-09-21T20:00:00.001Z updater: restart to install: stopping the daemon first',
    '2026-09-21T20:00:00.100Z updater: Executing: C:\\x\\pending\\Emerald-setup-0.1.372-arm64.exe with args: --updated,/S,--force-run',
    '2026-09-21T20:00:10.000Z launched while 0.1.372 is installing (since 2026-09-21T20:00:00.000Z): Still installing emerald 0.1.372: About 40 s to go; quitting with no window',
    '2026-09-21T20:00:40.000Z installing.json (0.1.372 at 2026-09-21T20:00:00.000Z) is spent: removed',
    '2026-09-21T20:00:40.010Z first launch of 0.1.372 after 0.1.352: running emmer hooks install',
    '2026-09-21T20:00:40.020Z starting emmerd: C:\\x\\Emerald.exe C:\\x\\daemon\\dist\\main.js',
    '2026-09-21T20:00:40.300Z connected to emmerd 0.1.372 pid 11 feature level 55',
    '2026-09-21T20:00:40.400Z emmer hooks install exited 0, settings changed',
    '2026-09-21T20:00:45.000Z updater cache: removed pending 0.1.372, 112.8 MB',
  );
  const out = texts(parseMainLog(text));
  assert.ok(out.some((l) => l.startsWith("look: 1 launch in the install's gap: 2026-09-21T20:00:10.000Z launched while 0.1.372")));
  assert.ok(out.includes('ok: 2026-09-21T20:00:45.000Z updater cache: removed pending 0.1.372, 112.8 MB'));
  assert.ok(out.includes('ok: 2026-09-21T20:00:40.400Z emmer hooks install exited 0, settings changed'));
  assert.ok(out.includes('ok: connected to emmerd 0.1.372 pid 11 feature level 55, 0.3 s after starting emmerd (2026-09-21T20:00:40.020Z)'));
  assert.ok(out.includes('ok: 2026-09-21T20:00:00.000Z install poster spawned (worker pid 10)'));
  // M9 fix 413: fix 385's worker form, its own pid off the line.
  assert.deepEqual(posterForm(text), { form: 'worker', pid: '10' });
});

test('a log with no install and one with a failed hooks install say so', () => {
  assert.deepEqual(texts(parseMainLog(lines('2026-09-21T20:00:00.000Z connected to emmerd 0.1.352 pid 1 feature level 54'))), [
    'look: main.log has no `updater: Executing:` line; no install through the updater is on record',
  ]);
  const out = texts(
    parseMainLog(
      lines(
        '2026-09-21T20:00:00.100Z updater: Executing: C:\\x\\setup.exe with args: /S',
        '2026-09-21T20:00:40.010Z first launch of 0.1.372 after 0.1.352: running emmer hooks install',
        '2026-09-21T20:00:40.400Z emmer hooks install exited 1',
      ),
    ),
  );
  assert.ok(out.includes('look: 2026-09-21T20:00:40.400Z emmer hooks install exited 1'));
  assert.ok(out.includes('look: no `installing.json ... is spent` line: the new build\'s first launch did not remove the marker, or is not on record'));
  assert.ok(out.includes('look: no `install poster spawned` line at the second click'));
  assert.ok(out.includes('look: no `starting emmerd` line after the first launch'));
  // M9 fix 413: no poster line on record at all, before the first click.
  assert.deepEqual(posterForm(lines('2026-09-21T20:00:00.000Z connected to emmerd 0.1.352 pid 1 feature level 54')), { form: 'none', pid: null });
  // Fix 408's gap poster (another branch) is never read as this one.
  assert.deepEqual(
    posterForm(
      lines(
        '2026-09-21T20:00:00.000Z install-gap poster spawned (worker pid 99)',
        '2026-09-21T20:00:00.100Z updater: Executing: C:\\x\\setup.exe with args: /S',
      ),
    ),
    { form: 'none', pid: null },
  );
});

test('the stamps, the cache and the heading', () => {
  const daemonProc = { commandLine: 'C:\\x\\Programs\\emerald\\Emerald.exe C:\\x\\resources\\daemon\\dist\\main.js', createdAt: 1000 };
  assert.deepEqual(texts(parseStamps('{"version":"0.1.352","at":"t"}', '{"version":"0.1.352","pid":7}', () => daemonProc)), ['ok: installed.json: 0.1.352 at t', 'ok: daemon.json: 0.1.352 pid 7']);
  assert.deepEqual(texts(parseStamps(null, '{"pid":7}', () => null)), ['look: no installed.json under the home', 'look: daemon.json: (no version) pid 7, not running']);
  // M9 fix 534: a live process that took the number is not the daemon.
  const other = { commandLine: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile', createdAt: 5000 };
  assert.deepEqual(texts(parseStamps(null, '{"version":"0.1.352","pid":7,"startedAt":1000}', () => other))[1], 'look: daemon.json: 0.1.352 pid 7, not running (pid 7 is another process now)');
  const root = [
    { name: 'current.blockmap', size: 10, mtime: 'm1', dir: '' as const, isDir: false },
    { name: 'installer.exe', size: 20, mtime: 'm2', dir: '' as const, isDir: false },
  ];
  assert.deepEqual(texts(parseCache(root)), ['ok: updater cache root: current.blockmap 10 m1, installer.exe 20 m2', 'ok: no pending folder under the updater cache']);
  const held = [...root, { name: 'pending', size: 0, mtime: 'm3', dir: '' as const, isDir: true }, { name: 'Emerald-setup-0.1.352-arm64.exe', size: 30, mtime: 'm4', dir: 'pending' as const, isDir: false }];
  assert.deepEqual(texts(parseCache(held))[1], 'look: pending holds Emerald-setup-0.1.352-arm64.exe 30 m4');
  assert.equal(texts(parseCache([]))[0], 'look: the updater cache root holds no files (the next differential download is built from installer.exe and current.blockmap)');
  assert.equal(whatsNewHeading('# What is new\n\n## Fixes 352 to 371, 2026-09-21\n\n## Fixes 329 to 351\n'), 'Fixes 352 to 371, 2026-09-21');
  assert.equal(whatsNewHeading('nothing'), null);
});

// M9 fix 411: the window process among the install's Emerald.exe, chosen
// by excluding --type= (a child process) and any .js (the CLI or a
// status line as node).
test('the window process is picked out, with the taskkill line to paste', () => {
  const one = [
    { pid: 111, commandLine: 'C:\\x\\Programs\\emerald\\Emerald.exe' },
    { pid: 222, commandLine: 'C:\\x\\Programs\\emerald\\Emerald.exe --type=renderer' },
    { pid: 333, commandLine: 'C:\\x\\Programs\\emerald\\Emerald.exe C:\\x\\resources\\cli\\dist\\main.js feed serve' },
  ];
  assert.deepEqual(texts(parseWindowProcesses(one)), ['ok: the window is pid 111: taskkill /pid 111']);

  const updated = [{ pid: 444, commandLine: 'C:\\x\\Programs\\emerald\\Emerald.exe --updated,/S,--force-run' }];
  assert.deepEqual(texts(parseWindowProcesses(updated)), ['ok: the window is pid 444, --updated: taskkill /pid 444']);

  assert.deepEqual(texts(parseWindowProcesses([])), ['look: no Emerald.exe window process found under the install']);

  const two = [
    { pid: 111, commandLine: 'C:\\x\\Programs\\emerald\\Emerald.exe' },
    { pid: 555, commandLine: 'C:\\x\\Programs\\emerald\\Emerald.exe --updated' },
  ];
  assert.deepEqual(texts(parseWindowProcesses(two)), ['look: 2 Emerald.exe window processes found: pid 111, pid 555 (--updated)']);

  // M9 fix 534: a window started on a .json or .jsonl file is the window;
  // the CLI beside it is still dropped.
  const cli = { pid: 333, commandLine: 'C:\\x\\Programs\\emerald\\Emerald.exe C:\\x\\resources\\cli\\dist\\main.js feed serve' };
  const onJson = [{ pid: 666, commandLine: '"C:\\x\\Programs\\emerald\\Emerald.exe" "C:\\x\\notes.json"' }, cli];
  assert.deepEqual(texts(parseWindowProcesses(onJson)), ['ok: the window is pid 666: taskkill /pid 666']);
  const onJsonl = [{ pid: 777, commandLine: '"C:\\x\\Programs\\emerald\\Emerald.exe" "C:\\x\\log.jsonl"' }, cli];
  assert.deepEqual(texts(parseWindowProcesses(onJsonl)), ['ok: the window is pid 777: taskkill /pid 777']);
});

test('no window says when it closed, when main.log has the window close after the lock (M9 fix 534)', () => {
  const closed = lines(
    '2026-09-28T20:00:00.000Z single-instance lock held',
    '2026-09-28T20:05:00.000Z window-all-closed; active resources: none',
  );
  assert.deepEqual(texts(parseWindowProcesses([], closed)), ['look: no Emerald.exe window process found under the install; the window closed at 2026-09-28T20:05:00.000Z']);
  const reopened = lines(
    '2026-09-28T20:05:00.000Z window-all-closed; active resources: none',
    '2026-09-28T20:06:00.000Z single-instance lock held on try 2',
  );
  assert.deepEqual(texts(parseWindowProcesses([], reopened)), ['look: no Emerald.exe window process found under the install']);
  assert.deepEqual(texts(parseWindowProcesses([], null)), ['look: no Emerald.exe window process found under the install']);
});

test('an update\'s window closed through app.quit() says when, from its will-quit line (M9 fix 657)', () => {
  const quit = lines(
    '2026-09-28T20:00:00.000Z single-instance lock held',
    '2026-09-28T20:05:00.000Z updater: running the installer silently and relaunching',
    '2026-09-28T20:05:01.000Z will-quit; active resources: none',
  );
  assert.deepEqual(texts(parseWindowProcesses([], quit)), ['look: no Emerald.exe window process found under the install; the window closed at 2026-09-28T20:05:01.000Z']);
});

test('the daemon is read by its command line and its start time (M9 fix 534)', () => {
  const installed = 'C:\\x\\Programs\\emerald\\Emerald.exe C:\\x\\Programs\\emerald\\resources\\daemon\\dist\\main.js';
  const checkout = 'node C:/code/emerald/packages/daemon/dist/main.js';
  assert.equal(daemonProcessIs({ commandLine: installed, createdAt: 9000 }, 10_000), true, 'created before startedAt');
  assert.equal(daemonProcessIs({ commandLine: checkout, createdAt: 11_500 }, 10_000), true, 'within the tolerance');
  assert.equal(daemonProcessIs({ commandLine: installed, createdAt: 20_000 }, 10_000), false, 'created 10 s after startedAt');
  assert.equal(daemonProcessIs({ commandLine: 'powershell.exe -NoProfile', createdAt: 9000 }, 10_000), false, 'not the daemon');
  assert.equal(daemonProcessIs({ commandLine: installed, createdAt: 99_999 }, undefined), true, 'no startedAt: the command line alone');
  assert.equal(daemonProcessIs(null, 10_000), false);
});

// M9 fix 447: the gap launch's own poster (fix 408) and its log, and
// both poster logs read against the install's time.
const gapInstall = (...gapLines: string[]): string =>
  lines(
    '2026-09-26T20:00:00.000Z install poster spawned (worker pid 10)',
    '2026-09-26T20:00:00.001Z updater: restart to install: stopping the daemon first',
    '2026-09-26T20:00:00.100Z updater: Executing: C:\\x\\pending\\Emerald-setup-0.1.426-arm64.exe with args: --updated,/S,--force-run',
    ...gapLines,
    '2026-09-26T20:00:40.000Z installing.json (0.1.426 at 2026-09-26T20:00:00.000Z) is spent: removed',
  );
const launched = (at: string): string => `${at} launched while 0.1.426 is installing (since 2026-09-26T20:00:00.000Z): Still installing emerald 0.1.426: About 40 s to go; quitting with no window`;

test("a gap launch's poster line is ok when spawned and a look when held, failed or missing", () => {
  const spawned = texts(parseMainLog(gapInstall(launched('2026-09-26T20:00:15.000Z'), '2026-09-26T20:00:15.010Z install-gap poster spawned (worker pid 42)')));
  assert.ok(spawned.includes('ok: 2026-09-26T20:00:15.010Z install-gap poster spawned (worker pid 42)'));
  // The gap line is still not the install poster's (fix 413's read).
  assert.ok(spawned.includes('ok: 2026-09-26T20:00:00.000Z install poster spawned (worker pid 10)'));

  const held = texts(parseMainLog(gapInstall(launched('2026-09-26T20:00:15.000Z'), '2026-09-26T20:00:15.010Z install-gap poster held (harness)')));
  assert.ok(held.includes('look: 2026-09-26T20:00:15.010Z install-gap poster held (harness)'));
  const failed = texts(parseMainLog(gapInstall(launched('2026-09-26T20:00:15.000Z'), '2026-09-26T20:00:15.010Z install-gap poster failed: spawn EPERM')));
  assert.ok(failed.includes('look: 2026-09-26T20:00:15.010Z install-gap poster failed: spawn EPERM'));

  // Two launches: the first has no poster line of its own, and the
  // second's is not borrowed for it.
  const two = texts(
    parseMainLog(gapInstall(launched('2026-09-26T20:00:10.000Z'), launched('2026-09-26T20:00:20.000Z'), '2026-09-26T20:00:20.010Z install-gap poster spawned (worker pid 43)')),
  );
  assert.ok(two.includes('look: no `install-gap poster` line after the gap launch at 2026-09-26T20:00:10.000Z'));
  assert.ok(two.includes('ok: 2026-09-26T20:00:20.010Z install-gap poster spawned (worker pid 43)'));
});

test('the poster logs: this install ok, an older install a look, gap-poster.log only after a gap launch', () => {
  const withGap = gapInstall(launched('2026-09-26T20:00:15.000Z'), '2026-09-26T20:00:15.010Z install-gap poster spawned (worker pid 42)');
  const noGap = gapInstall();
  const fresh = 'x\r\n2026-09-26T15:00:02.1234567-05:00 shown under electron.app.emerald\r\n';
  const old = '2026-09-22T15:00:02.1234567-05:00 shown under electron.app.emerald\r\n';
  const gapFresh = '2026-09-26T15:00:16.5000000-05:00 shown under electron.app.emerald\r\n';
  const ip = 'C:\\h\\install-poster.log';
  const gp = 'C:\\h\\gap-poster.log';

  assert.deepEqual(texts(posterLogFindings(withGap, fresh, gapFresh, ip, gp)), [
    "ok: install-poster.log's last line: 2026-09-26T15:00:02.1234567-05:00 shown under electron.app.emerald",
    "ok: gap-poster.log's last line: 2026-09-26T15:00:16.5000000-05:00 shown under electron.app.emerald",
  ]);
  // Both logs are appended across installs; a last line from before
  // this install's sequence is an older install's answer.
  assert.deepEqual(texts(posterLogFindings(withGap, old, old, ip, gp)), [
    "look: install-poster.log's last line is from before this install (2026-09-26T20:00:00.000Z): 2026-09-22T15:00:02.1234567-05:00 shown under electron.app.emerald",
    "look: gap-poster.log's last line is from before this install (2026-09-26T20:00:00.000Z): 2026-09-22T15:00:02.1234567-05:00 shown under electron.app.emerald",
  ]);
  // A gap launch whose worker never wrote the log names the worker.
  assert.deepEqual(texts(posterLogFindings(withGap, fresh, null, ip, gp))[1], "look: C:\\h\\gap-poster.log does not exist: the gap poster's worker (pid 42) did not reach its log");
  // No gap launch: gap-poster.log is not read at all, even an old one.
  assert.deepEqual(texts(posterLogFindings(noGap, fresh, old, ip, gp)), ["ok: install-poster.log's last line: 2026-09-26T15:00:02.1234567-05:00 shown under electron.app.emerald"]);
  // Fix 413's reads when install-poster.log is missing are unchanged.
  assert.deepEqual(texts(posterLogFindings(noGap, null, null, ip, gp)), ["look: fix 385's worker (pid 10) did not reach its log"]);
  assert.deepEqual(texts(posterLogFindings(null, null, null, ip, gp)), ['look: C:\\h\\install-poster.log does not exist: the poster never ran to its log']);
});

test("the daemon's start warnings: none is ok, a skipped sessions entry is named, an older start's are not read", () => {
  const startedAt = Date.parse('2026-10-17T14:35:46.789Z');
  const log = lines(
    '2026-10-16T13:39:56.797Z WARN skipping unusable sessions file entry {"id":"ac7901b7-0000","name":"an older start","removedAt":null}',
    '2026-10-17T14:35:46.900Z INFO emmerd starting',
    '2026-10-17T14:35:47.979Z WARN skipping unusable sessions file entry {"id":"44882470-6594","name":"Install 769","removedAt":1792171445752}',
    '2026-10-17T14:35:47.982Z WARN skipping unusable sessions file entry {"id":"9361ba41-0474","name":"Batch 797","removedAt":null}',
    '2026-10-17T14:36:01.000Z ERROR feed: could not serve',
  );
  assert.deepEqual(texts(daemonStartFindings(log, startedAt)), [
    'look: the daemon\'s start dropped 2 sessions file entries: 44882470 "Install 769" (removed); 9361ba41 "Batch 797" (on the sidebar)',
    'look: 2026-10-17T14:36:01.000Z ERROR feed: could not serve',
  ]);
  assert.deepEqual(texts(daemonStartFindings(lines('2026-10-17T14:35:46.900Z INFO emmerd starting'), startedAt)), ['ok: no WARN or ERROR line in emmerd.log since the daemon started (2026-10-17T14:35:46.789Z)']);
  assert.deepEqual(texts(daemonStartFindings(null, startedAt)), ['look: no emmerd.log under the home']);
  assert.deepEqual(texts(daemonStartFindings(log, undefined)), ['look: daemon.json has no startedAt, so the start warnings are not read']);
});
