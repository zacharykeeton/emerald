import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dayKey } from '@emerald/shared';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { NOTHING_RECORDED, buildUsageReport, windowStart } from './usage-report.ts';

after(() => removeTemps());

// A fixed noon, so the window's days do not move under the test.
const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function jsonl(rows: object[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  // The report skips a generation last written before the window.
  fs.utimesSync(file, new Date(NOW), new Date(NOW));
}

function seededHome(): string {
  const home = mkTemp('emerald-usage-report-');
  const logs = path.join(home, 'logs');
  const t = NOW - 3 * 60 * 60 * 1000;
  write(
    path.join(logs, 'usage.1.jsonl'),
    jsonl([
      { at: windowStart(NOW, 30) - 1000, ev: 'action', name: 'review', from: 'key' },
      { at: t, ev: 'action', name: 'split-vertical', from: 'key', view: 'empty-pane' },
      { at: t + 1000, ev: 'action', name: 'close-pane', from: 'key' },
      { at: t + 2000, ev: 'view-open', view: 'file-tab' },
      { at: t + 3200, ev: 'view-close', view: 'file-tab', ms: 1200 },
    ]),
  );
  write(
    path.join(logs, 'usage.jsonl'),
    jsonl([
      { at: t + 10_000, ev: 'action', name: 'text-bigger', from: 'key' },
      { at: t + 10_100, ev: 'action', name: 'text-bigger', from: 'key' },
      { at: t + 10_200, ev: 'action', name: 'text-bigger', from: 'key' },
      { at: t + 10_300, ev: 'action', name: 'text-bigger', from: 'key' },
      { at: t + 20_000, ev: 'action', name: 'text-smaller', from: 'key' },
      { at: t + 20_100, ev: 'action', name: 'text-smaller', from: 'key' },
      { at: t + 30_000, ev: 'action', name: 'drop-session', from: 'click' },
      { at: t + 31_000, ev: 'action', name: 'close-pane', from: 'key' },
      { at: t + 40_000, ev: 'action', name: 'drop-view', from: 'click' },
      { at: t + 44_000, ev: 'action', name: 'close-pane', from: 'menu' },
      { at: t + 50_000, ev: 'action', name: 'cheat-sheet', from: 'menu' },
      { at: t + 50_000, ev: 'view-open', view: 'review-tab' },
      { at: t + 55_000, ev: 'view-close', view: 'review-tab', ms: 5000 },
      { at: t + 60_000, ev: 'view-open', view: 'file-tab' },
      { at: t + 60_000 + 2 * 60 * 60 * 1000, ev: 'view-close', view: 'file-tab', ms: 2 * 60 * 60 * 1000 },
      { at: t + 70_000, ev: 'action', name: 'not-a-feature', from: 'key' },
      'not json',
    ]),
  );
  write(
    path.join(logs, 'main.log'),
    [
      `${new Date(t).toISOString()} starting emmerd`,
      `${new Date(t).toISOString()} renderer: error [emerald] split failed Error: x (index-abc.js:12)`,
      `${new Date(t + 1).toISOString()} renderer: error [emerald] split failed Error: x (index-abc.js:12)`,
      `${new Date(t + 2).toISOString()} renderer: warning [lib] something odd (vendor.js:3)`,
      `${new Date(t + 3).toISOString()} renderer: 4 more lines dropped this second`,
      '',
    ].join('\n'),
  );
  write(
    path.join(logs, 'hooks.1.jsonl'),
    jsonl([{ at: NOW - DAY, sessionId: 'a', event: 'Stop', outcome: 'applied', payload: { cwd: 'C:\\code\\zorca' } }]),
  );
  write(
    path.join(logs, 'hooks.jsonl'),
    jsonl([
      { at: NOW - 60_000, sessionId: 'a', event: 'Stop', outcome: 'applied', payload: { cwd: 'C:\\Code\\Zorca\\' } },
      { at: NOW - 50_000, sessionId: 'a', event: 'Stop', outcome: 'applied', payload: { cwd: 'C:\\code\\zorca' } },
      { at: NOW - 40_000, sessionId: 'b', event: 'Stop', outcome: 'applied', payload: {} },
      { at: NOW - 30_000, sessionId: 'c', event: 'Stop', outcome: 'foreign', payload: { cwd: 'C:\\elsewhere' } },
    ]),
  );
  write(path.join(home, 'sessions.json'), JSON.stringify({ sessions: [{ id: 'b', name: 'b', kind: 'shell', groupCwd: 'C:/code/other', spawnCwd: 'C:/code/other/sub' }] }));
  return home;
}

test('the heading names the window (M9 fix 677)', async () => {
  const report = await buildUsageReport(seededHome(), NOW, 30);
  assert.equal(report.split('\n')[0], `# Emerald usage, the last 30 days (${dayKey(windowStart(NOW, 30))} to ${dayKey(NOW)})`);
  assert.equal(dayKey(windowStart(NOW, 30)), '2026-09-15');
});

test('the actions table counts by source and leaves out a line before the window', async () => {
  const report = await buildUsageReport(seededHome(), NOW, 30);
  assert.ok(report.includes('| Action | Count | Key | Click | Menu | CLI |'));
  assert.ok(report.includes('| text-bigger | 4 | 4 | 0 | 0 | 0 |'));
  assert.ok(report.includes('| close-pane | 3 | 2 | 0 | 1 | 0 |'));
  assert.ok(report.includes('| drop-session | 1 | 0 | 1 | 0 | 0 |'));
  assert.ok(report.includes('| cheat-sheet | 1 | 0 | 0 | 1 | 0 |'));
  assert.ok(!report.includes('| review |'), 'the line before the window is not counted');
  assert.ok(!report.includes('not-a-feature'));
  assert.ok(report.indexOf('| close-pane |') < report.indexOf('| cheat-sheet |'), 'by count');
});

test('a view has its time open and its longest', async () => {
  const report = await buildUsageReport(seededHome(), NOW, 30);
  assert.ok(report.includes('| file-tab | 2 | 2 | 2h | 2h |'), report);
  assert.ok(report.includes('| review-tab | 1 | 1 | 5s | 5s |'));
});

test('never used holds an unused feature and not a used one', async () => {
  const report = await buildUsageReport(seededHome(), NOW, 30);
  const never = report.slice(report.indexOf('## Never used'), report.indexOf('## Friction'));
  assert.ok(never.includes('**Keys**'));
  assert.ok(never.includes('- `jump`: Jump to a session'));
  assert.ok(!never.includes('`split-vertical`'));
  assert.ok(never.includes('**CLI**') && never.includes('- `cli-open`: emmer open'));
});

test('the friction bullets', async () => {
  const report = await buildUsageReport(seededHome(), NOW, 30);
  assert.ok(report.includes('- Views closed within 3 s: 1 (file-tab 1)'), report);
  assert.ok(report.includes('- The same action three or more times running: 1 (text-bigger 1, longest 4)'));
  assert.ok(report.includes('- A drop taken back within 3 s: 1 (drop-session 1)'));
  assert.ok(report.includes('- A split closed within 3 s: 1 (split-vertical 1)'));
});

test('the renderer counts, the source cut from the message', async () => {
  const report = await buildUsageReport(seededHome(), NOW, 30);
  assert.ok(report.includes('2 errors and 1 warnings, 4 lines dropped by the cap.'));
  assert.ok(report.includes('| error | 2 | [emerald] split failed Error: x |'));
  assert.ok(report.includes('| warning | 1 | [lib] something odd |'));
});

test("a day's sessions, projects and hook lines, one project found only through sessions.json", async () => {
  const report = await buildUsageReport(seededHome(), NOW, 30);
  assert.ok(report.includes(`| ${dayKey(NOW)} | 2 | 2 | 3 |`), report);
  assert.ok(report.includes(`| ${dayKey(NOW - DAY)} | 1 | 1 | 1 |`));
  assert.ok(report.includes('Projects by days active: zorca (2), other (1)'));
});

function homeWith(current: object[], older?: { rows: object[]; ageDays: number }): string {
  const home = mkTemp('emerald-usage-report-');
  const logs = path.join(home, 'logs');
  write(path.join(logs, 'usage.jsonl'), jsonl(current));
  if (older !== undefined) {
    const file = path.join(logs, 'usage.1.jsonl');
    write(file, jsonl(older.rows));
    const when = new Date(NOW - older.ageDays * DAY);
    fs.utimesSync(file, when, when);
  }
  return home;
}

test('M9 fix 699: a record switched on nine days ago says so and heads Never used with it', async () => {
  const home = homeWith([
    { at: NOW - 9 * DAY, ev: 'switch', on: true },
    { at: NOW - 9 * DAY + 1000, ev: 'action', name: 'split-vertical', from: 'key' },
  ]);
  const report = await buildUsageReport(home, NOW, 30);
  assert.ok(report.includes('The record was on from 2026-10-05 (10 of the 30 days).'), report);
  assert.ok(report.includes('## Never used while the record was on'));
  const never = report.slice(report.indexOf('## Never used'), report.indexOf('## Friction'));
  assert.ok(never.includes('`jump`') && !never.includes('`split-vertical`'));
});

test('M9 fix 699: a switch off and on again counts the days of both spans', async () => {
  const home = homeWith([
    { at: NOW - 20 * DAY, ev: 'switch', on: true },
    { at: NOW - 15 * DAY, ev: 'switch', on: false },
    { at: NOW - 5 * DAY, ev: 'switch', on: true },
  ]);
  const report = await buildUsageReport(home, NOW, 30);
  assert.ok(report.includes('The record was on from 2026-09-24 (12 of the 30 days).'), report);
});

test('M9 fix 699: an older generation is scanned for the switch that sets the state at the window start', async () => {
  const on = homeWith([{ at: NOW - 1000, ev: 'action', name: 'split-vertical', from: 'key' }], {
    rows: [{ at: NOW - 40 * DAY, ev: 'switch', on: true }],
    ageDays: 40,
  });
  const onReport = await buildUsageReport(on, NOW, 30);
  assert.ok(onReport.includes('The record was on from 2026-09-15 (30 of the 30 days).'), onReport);
  assert.ok(onReport.includes('## Never used\n'));
  const off = homeWith([], { rows: [{ at: NOW - 40 * DAY, ev: 'switch', on: false }], ageDays: 40 });
  const offReport = await buildUsageReport(off, NOW, 30);
  assert.ok(offReport.includes('The record was off for the whole window.'), offReport);
});

test('M9 fix 699: a record from before the switch line reads as on for the whole window', async () => {
  const report = await buildUsageReport(seededHome(), NOW, 30);
  assert.ok(report.includes('The record was on from 2026-09-15 (30 of the 30 days).'), report);
  assert.ok(report.includes('## Never used\n'));
});

test('with no usage file the single "Nothing recorded yet" line', async () => {
  const home = mkTemp('emerald-usage-report-');
  const report = await buildUsageReport(home, NOW, 7);
  assert.ok(!report.includes('The record was'));
  assert.ok(report.includes(`## Actions by count\n\n${NOTHING_RECORDED}\n`));
  assert.ok(report.includes('No main.log under this home.'));
  assert.ok(report.includes('No hook lines in the window.'));
});

// M9 fix 694: Electron's line at a browser pane's close is left out,
// whether written before the update as an error or after it as a note.
test("the renderer counts leave out Electron's Invalid guestInstanceId, old form and new", async () => {
  const home = mkTemp('emerald-usage-report-');
  const t = NOW - 60 * 60 * 1000;
  write(
    path.join(home, 'logs', 'main.log'),
    [
      `${new Date(t).toISOString()} renderer: error [lib] Uncaught Error: Invalid guestInstanceId: 2 (node:electron/js2c/isolated_bundle:2)`,
      `${new Date(t + 1).toISOString()} renderer: note [lib] Uncaught Error: Invalid guestInstanceId: 3 (node:electron/js2c/isolated_bundle:2)`,
      `${new Date(t + 2).toISOString()} renderer: error [emerald] split failed Error: x (index-abc.js:12)`,
      '',
    ].join('\n'),
  );
  const report = await buildUsageReport(home, NOW, 30);
  assert.ok(report.includes('1 errors and 0 warnings, 0 lines dropped by the cap.'), report);
  assert.ok(!report.includes('guestInstanceId'), report);
});
