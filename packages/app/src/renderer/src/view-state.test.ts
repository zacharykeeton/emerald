import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityFromQuery, activityQuery, activityView, cleanGraph, commitsFromQuery, commitsQuery, commitsView } from './view-state.ts';

test('a commits state round-trips through its query, the defaults leaving the query empty (M9 fix 178)', () => {
  const full = { graph: { mode: 'list' as const, orientation: 'horizontal' as const, reverse: true, draw: 'active' as const, hidden: ['s1', 'outside'], solo: 's2', layout: { s1: 'line' as const, s3: 'graph' as const, 'person:Ada': 'line' as const }, scale: 1.25 as const, remotes: true }, rows: false };
  const q = commitsQuery(full);
  assert.equal(q, 'mode=list&orientation=horizontal&reverse=&draw=active&hidden=s1%2Coutside&solo=s2&layout=s1%3Aline%2Cs3%3Agraph%2Cperson%3AAda%3Aline&scale=1.25&remotes=&rows=off');
  assert.deepEqual(commitsFromQuery(q), full);
  assert.equal(commitsQuery({ graph: {}, rows: true }), '');
  assert.deepEqual(commitsFromQuery(null), { graph: {}, rows: true });
  assert.deepEqual(commitsFromQuery('mode=tree&orientation=up&draw=none&hidden=&layout=a:fold,b:line&scale=3&rows=on'), { graph: { layout: { b: 'line' } }, rows: true }, 'bad values fall to the defaults');
  assert.deepEqual(cleanGraph({ scale: 1 }), {}, 'a zoom of 1 cleans to nothing (M9 fix 213)');
  assert.deepEqual(cleanGraph({ scale: 0.67 }), { scale: 0.67 });
  assert.deepEqual(cleanGraph({ mode: 'graph', orientation: 'vertical', reverse: false, draw: 'all', hidden: [], solo: null, layout: {}, rows: false }), {}, 'the defaults clean to nothing');
  assert.deepEqual(commitsView('C:\\repo', full), { kind: 'commits', folder: 'C:\\repo', rows: false, graph: full.graph });
  assert.deepEqual(commitsView('C:\\repo', { graph: {}, rows: true }), { kind: 'commits', folder: 'C:\\repo' }, 'a record at the defaults is bare');
  assert.deepEqual(commitsView('C:\\repo', null), { kind: 'commits', folder: 'C:\\repo' });
});

test('an activity state round-trips through its query, the folder riding along under all for the toggle (M9 fix 178)', () => {
  const folder = { scope: 'folder' as const, folder: 'C:\\Users\\z\\code\\emerald', layers: 'band' as const, usage: true };
  const q = activityQuery(folder);
  assert.equal(q, 'scope=folder&folder=C%3A%5CUsers%5Cz%5Ccode%5Cemerald&layers=band');
  assert.deepEqual(activityFromQuery(q), folder);
  assert.deepEqual(activityFromQuery('scope=folder'), { scope: 'all', folder: null, layers: 'both', usage: true }, 'a folder scope without a folder is all');
  assert.deepEqual(activityFromQuery(null), { scope: 'all', folder: null, layers: 'both', usage: true });
  assert.equal(activityQuery({ scope: 'all', folder: null, layers: 'both', usage: true }), '');
  assert.equal(activityQuery({ scope: 'folder', folder: null, layers: 'lanes', usage: true }), 'layers=lanes', 'no folder, no scope');
  assert.deepEqual(activityView('2026-09-15', folder), { kind: 'activity', window: '2026-09-15', scope: 'folder', folder: folder.folder, layers: 'band' });
  assert.deepEqual(activityView('2026-09-15', { scope: 'all', folder: folder.folder, layers: 'both', usage: true }), { kind: 'activity', window: '2026-09-15', folder: folder.folder });
  // M9 fix 250: the panes scope with or without a folder, and M66's tab
  // read back as panes.
  assert.equal(activityQuery({ scope: 'panes', folder: null, layers: 'both', usage: true }), 'scope=panes');
  // M9 fix 261: the here scope rides the same way.
  assert.equal(activityQuery({ scope: 'here', folder: null, layers: 'both', usage: true }), 'scope=here');
  assert.deepEqual(activityView('2026-09-15', { scope: 'here', folder: null, layers: 'both', usage: true }), { kind: 'activity', window: '2026-09-15', scope: 'here' });
  assert.equal(activityFromQuery('scope=here').scope, 'here');
  assert.deepEqual(activityFromQuery('scope=panes'), { scope: 'panes', folder: null, layers: 'both', usage: true });
  assert.deepEqual(activityFromQuery('scope=tab'), { scope: 'panes', folder: null, layers: 'both', usage: true }, 'an old query reads as panes');
  assert.deepEqual(activityView('2026-09-15', { scope: 'panes', folder: folder.folder, layers: 'both', usage: true }), { kind: 'activity', window: '2026-09-15', scope: 'panes', folder: folder.folder });
  assert.deepEqual(activityView('2026-09-15', { scope: 'panes', folder: null, layers: 'both', usage: true }), { kind: 'activity', window: '2026-09-15', scope: 'panes' });
  assert.deepEqual(activityView('2026-09-15', null), { kind: 'activity', window: '2026-09-15' });
});

test("the usage row's flag rides as usage=off and usage: false, absent while shown (M9 fix 766)", () => {
  assert.equal(activityQuery({ scope: 'all', folder: null, layers: 'both', usage: false }), 'usage=off');
  assert.equal(activityFromQuery('usage=off').usage, false);
  assert.equal(activityFromQuery('').usage, true);
  assert.deepEqual(activityView('2026-09-15', { scope: 'all', folder: null, layers: 'both', usage: false }), { kind: 'activity', window: '2026-09-15', usage: false });
  assert.deepEqual(activityView('2026-09-15', { scope: 'all', folder: null, layers: 'both', usage: true }), { kind: 'activity', window: '2026-09-15' });
});
