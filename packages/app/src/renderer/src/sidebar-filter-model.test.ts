import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionGroup, SessionInfo, SessionState } from '@emerald/shared';
import { emptyFilterText, filterCounts, filterGroups, isSidebarFilter, matchesFilter } from './sidebar-filter-model.ts';
import { aSession } from './test-support.ts';

// Only the state matters to the filter; the rest is a plausible session.
const session = (id: string, state: SessionState): SessionInfo =>
  aSession({ id, kind: 'claude', name: id, autoName: true, spawnCwd: 'C:\\work\\a', cwd: 'C:\\work\\a', groupCwd: 'C:\\work\\a', state, stateSince: 1000, color: '#61afef', createdAt: 1000 });

const group = (key: string, ...sessions: SessionInfo[]): SessionGroup => ({ key, title: key, sessions });

const none: ReadonlySet<string> = new Set();

test('matchesFilter: needs is needs-input or errored, done is done, all is everything', () => {
  const states: SessionState[] = ['starting', 'idle', 'working', 'needs-input', 'done', 'waiting', 'errored', 'exited'];
  assert.deepEqual(
    states.filter((s) => matchesFilter('needs', session('x', s), none)),
    ['needs-input', 'errored'],
  );
  assert.deepEqual(
    states.filter((s) => matchesFilter('done', session('x', s), none)),
    ['done'],
  );
  assert.equal(states.filter((s) => matchesFilter('all', session('x', s), none)).length, states.length);
});

test('matchesFilter: unshown is a live session on no pane of any tab (M9 fix 249)', () => {
  const onPanes = new Set(['a']);
  assert.equal(matchesFilter('unshown', session('a', 'idle'), onPanes), false, 'on a pane');
  assert.equal(matchesFilter('unshown', session('b', 'idle'), onPanes), true, 'on none');
  assert.equal(matchesFilter('unshown', session('b', 'done'), onPanes), true, 'any live state counts');
  assert.equal(matchesFilter('unshown', session('b', 'exited'), onPanes), false, 'an exited session is not an orphan');
});

test('filterCounts counts every session once per chip', () => {
  const counts = filterCounts([session('a', 'idle'), session('b', 'needs-input'), session('c', 'errored'), session('d', 'done'), session('e', 'exited')], new Set(['a', 'b']));
  assert.deepEqual(counts, { all: 5, needs: 2, done: 1, unshown: 2 });
});

test('filterGroups drops rows that do not match, groups left empty, and the exited group', () => {
  const groups = [
    group('C:\\work\\a', session('a1', 'idle'), session('a2', 'needs-input')),
    group('C:\\work\\b', session('b1', 'working')),
    group('exited', session('x1', 'exited')),
  ];
  assert.equal(filterGroups(groups, 'all', none), groups, 'all hands the same array back');
  const needs = filterGroups(groups, 'needs', none);
  assert.deepEqual(
    needs.map((g) => [g.key, g.sessions.map((s) => s.id)]),
    [['C:\\work\\a', ['a2']]],
  );
  assert.deepEqual(filterGroups(groups, 'done', none), []);
  assert.deepEqual(
    filterGroups(groups, 'unshown', new Set(['a1'])).map((g) => [g.key, g.sessions.map((s) => s.id)]),
    [
      ['C:\\work\\a', ['a2']],
      ['C:\\work\\b', ['b1']],
    ],
    'unshown keeps the live rows on no pane and drops the exited group',
  );
});

test('isSidebarFilter and the empty text', () => {
  assert.equal(isSidebarFilter('needs'), true);
  assert.equal(isSidebarFilter('unshown'), true);
  assert.equal(isSidebarFilter('state'), false);
  assert.equal(isSidebarFilter(null), false);
  assert.equal(emptyFilterText('needs'), 'Nothing needs you');
  assert.equal(emptyFilterText('done'), 'Nothing done');
  assert.equal(emptyFilterText('unshown'), 'Every session is on a pane');
  assert.equal(emptyFilterText('all'), 'No sessions yet');
});
