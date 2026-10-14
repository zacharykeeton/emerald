import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConflictReport } from '@emerald/shared';
import { renderConflicts, scopeReport } from './conflicts.ts';
import type { ConflictSession } from './conflicts.ts';

const NOW = 1_700_000_000_000;
const H = 3_600_000;
const s = (id: string, branch: string, cwd = `C:\\wt\\${branch}`): ConflictSession => ({ id, name: branch, branch, cwd, groupCwd: 'C:\\repo', state: 'working' });
const base = (ahead: number, behind: number, ago: number) => ({ ahead, behind, forkedAt: NOW - ago, defaultBranch: 'main', repo: 'c:/repo/.git' });

const sessions = [s('p', 'fix-pocket'), s('l', 'fix-live-count'), s('s', 'fix-sweep'), s('w', 'fix-week'), s('d', 'fix-debt')];
const report: ConflictReport = {
  conflicts: [
    { a: 'l', b: 'p', files: ['style.css'] },
    { a: 'd', b: 'l', files: ['style.css', 'protocol.ts', 'session-manager.ts'] },
    { a: 'd', b: 'w', files: ['style.css', 'ActivityRidges.tsx'] },
  ],
  base: { p: base(4, 0, 3 * H), l: base(6, 0, 3 * H), s: base(7, 1, 3 * H), w: base(9, 2, 3 * H), d: base(12, 40, 48 * H) },
};

test('renderConflicts: the head line, the pairs with every file, then the bases padded to the widest name and figure', () => {
  const lines = renderConflicts(report, sessions, NOW);
  assert.deepEqual(lines, [
    'emerald · 5 sessions on 5 branches · 3 pairs will conflict',
    '',
    '  fix-live-count  fix-pocket      style.css',
    '  fix-debt        fix-live-count  style.css, protocol.ts, session-manager.ts',
    '  fix-debt        fix-week        style.css, ActivityRidges.tsx',
    '',
    '  fix-debt        12 ahead, 40 behind main, forked 2d ago',
    '  fix-live-count   6 ahead,  0 behind main, forked 3h ago',
    '  fix-pocket       4 ahead,  0 behind main, forked 3h ago',
    '  fix-sweep        7 ahead,  1 behind main, forked 3h ago',
    '  fix-week         9 ahead,  2 behind main, forked 3h ago',
  ]);
});

test('renderConflicts with no pair still prints the bases, and with nothing at all says so', () => {
  const lines = renderConflicts({ conflicts: [], base: { p: base(4, 0, 3 * H), s: base(7, 1, 3 * H) } }, sessions, NOW);
  assert.deepEqual(lines, ['emerald · 2 sessions on 2 branches · no pairs will conflict', '', '  fix-pocket  4 ahead, 0 behind main, forked 3h ago', '  fix-sweep   7 ahead, 1 behind main, forked 3h ago']);
  assert.deepEqual(renderConflicts({ conflicts: [], base: {} }, [], NOW), ['emerald · no sessions on a branch · no pairs will conflict']);
  assert.equal(renderConflicts({ conflicts: [{ a: 'l', b: 'p', files: ['x'] }], base: { p: base(1, 0, H), l: base(1, 0, H) } }, sessions, NOW)[0], 'emerald · 2 sessions on 2 branches · 1 pair will conflict');
});

test('two repositories are two blocks, and --folder keeps one', () => {
  const other = [s('o1', 'main', 'C:\\other'), s('o2', 'topic', 'C:\\other-wt')].map((x) => ({ ...x, groupCwd: 'C:\\other' }));
  const two: ConflictReport = { conflicts: [{ a: 'o1', b: 'o2', files: ['a.ts'] }], base: { p: base(4, 0, H), o1: { ...base(0, 0, H), repo: 'c:/other/.git' }, o2: { ...base(2, 0, H), repo: 'c:/other/.git' } } };
  const lines = renderConflicts(two, [...sessions, ...other], NOW);
  assert.equal(lines.filter((l) => l.startsWith('emerald ·')).length, 2);
  assert.ok(lines.includes(''), 'a blank line between the blocks');
  const scoped = scopeReport(two, [...sessions, ...other], 'C:/other');
  assert.deepEqual(Object.keys(scoped.base), ['o1', 'o2']);
  assert.equal(scoped.conflicts.length, 1);
  const none = scopeReport(two, [...sessions, ...other], 'C:\\repo');
  assert.deepEqual(Object.keys(none.base), ['p']);
  assert.equal(none.conflicts.length, 0);
});
