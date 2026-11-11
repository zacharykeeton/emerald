import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SkillListing, SkillOverridesRead, SkillScope } from '../../preload/api.ts';
import {
  changeNote,
  CLAUDE_AI_SKILLS_URL,
  effectiveListing,
  LISTING_NOTE_TAIL_OFF,
  listingButton,
  listingKind,
  listingMenu,
  listingNameClass,
  othersToTurnOff,
  scopeValues,
  turnOffLabel,
} from './listing-model.ts';
import type { ListingMenuRow } from './listing-model.ts';

// A read with the given values per scope, in Claude Code's order.
function readOf(values: Partial<Record<SkillScope, Record<string, SkillListing>>>, errors: Partial<Record<SkillScope, string>> = {}): SkillOverridesRead {
  const scopes: SkillScope[] = ['managed', 'local', 'project', 'user'];
  return {
    folder: 'C:\\work',
    scopes: scopes.map((scope) => {
      const s = { scope, path: `C:\\${scope}.json`, values: values[scope] ?? {} };
      const e = errors[scope];
      return e === undefined ? s : { ...s, error: e };
    }),
  };
}

// The rows as the tests compare them: the label, whether ticked, and the hint.
const shape = (rows: ListingMenuRow[]) => rows.map((r) => (r.kind === 'heading' ? `# ${r.label}` : `${r.checked ? '[x]' : '[ ]'} ${r.label}${r.hint ? ` (${r.hint})` : ''}`));

// The three boards' skills (A11 to A13): ado off in this folder,
// adopt-batch-routine off in every folder, qa-story-refinement off in
// every folder and on in this one.
const boards = readOf({
  local: { ado: 'off', 'qa-story-refinement': 'on' },
  user: { 'adopt-batch-routine': 'off', 'qa-story-refinement': 'off' },
});

test('the effective value is the first scope that has one, managed first (fix 1041)', () => {
  assert.deepEqual(effectiveListing({ managed: 'off', local: 'on', project: 'on', user: 'on' }), { value: 'off', scope: 'managed' });
  assert.deepEqual(effectiveListing({ local: 'name-only', project: 'off', user: 'off' }), { value: 'name-only', scope: 'local' });
  assert.deepEqual(effectiveListing({ project: 'user-invocable-only', user: 'off' }), { value: 'user-invocable-only', scope: 'project' });
  assert.deepEqual(effectiveListing({ user: 'off' }), { value: 'off', scope: 'user' });
  assert.deepEqual(effectiveListing({}), { value: 'on', scope: null });
  assert.deepEqual(scopeValues(null, 'ado'), {});
  assert.deepEqual(scopeValues(boards, 'qa-story-refinement'), { local: 'on', user: 'off' });
});

test("the dropdown's words for the boards' three skills (fix 1042)", () => {
  assert.deepEqual(listingButton('ado', scopeValues(boards, 'ado')), {
    word: 'off',
    from: '',
    title: 'What Claude sees of ado: off, set in this folder; click to change it here or in every folder',
    value: 'off',
  });
  assert.deepEqual(listingButton('adopt-batch-routine', scopeValues(boards, 'adopt-batch-routine')), {
    word: 'off',
    from: ' · all',
    title: 'What Claude sees of adopt-batch-routine: off, set for every folder; click to change it here or in every folder',
    value: 'off',
  });
  assert.equal(listingButton('qa-story-refinement', scopeValues(boards, 'qa-story-refinement')).word, 'on');
  assert.deepEqual(listingButton('docs', {}), { word: 'on', from: '', title: 'What Claude sees of docs: on; click to change it here or in every folder', value: 'on' });
  assert.equal(listingButton('x', { project: 'name-only' }).title, "What Claude sees of x: name only, set in the repo's settings; click to change it here or in every folder");
  assert.equal(listingButton('x', { managed: 'off' }).from, ' · managed');
  assert.equal(listingButton('x', { user: 'user-invocable-only' }).word, '/ only');
});

test("A12's menu: on in this folder wins over off in every folder (fix 1042)", () => {
  const rows = listingMenu(scopeValues(boards, 'qa-story-refinement'), {});
  assert.equal(rows.length, 11);
  assert.deepEqual(shape(rows), [
    '# In this folder',
    '[x] On (in effect)',
    '[ ] Name only',
    '[ ] / only',
    '[ ] Off',
    '[ ] No setting here',
    '# In every folder',
    '[ ] On',
    '[ ] Name only',
    '[ ] / only',
    "[x] Off (this folder's setting wins)",
  ]);
});

test("A13's menu: no setting here, off in every folder in effect (fix 1042)", () => {
  const rows = listingMenu(scopeValues(boards, 'adopt-batch-routine'), {});
  assert.equal(rows.length, 11);
  assert.deepEqual(shape(rows), [
    '# In this folder',
    '[ ] On',
    '[ ] Name only',
    '[ ] / only',
    '[ ] Off',
    "[x] No setting here (uses every folder's)",
    '# In every folder',
    '[ ] On',
    '[ ] Name only',
    '[ ] / only',
    '[x] Off (in effect)',
  ]);
  // A skill set nowhere: On in every folder is the one in effect.
  assert.deepEqual(shape(listingMenu({}, {})).filter((r) => r.startsWith('[x]')), ["[x] No setting here (uses every folder's)", '[x] On (in effect)']);
});

test('the writes: On in every folder removes the entry, On here writes on (fix 1042)', () => {
  const rows = listingMenu({}, {});
  const byId = new Map(rows.flatMap((r) => (r.kind === 'row' ? [[r.id, r] as const] : [])));
  assert.deepEqual([...byId.keys()], ['local:on', 'local:name-only', 'local:user-invocable-only', 'local:off', 'local:none', 'user:on', 'user:name-only', 'user:user-invocable-only', 'user:off']);
  assert.deepEqual(byId.get('user:on')!.write, { scope: 'user', value: null });
  assert.deepEqual(byId.get('user:off')!.write, { scope: 'user', value: 'off' });
  assert.deepEqual(byId.get('local:on')!.write, { scope: 'local', value: 'on' });
  assert.deepEqual(byId.get('local:none')!.write, { scope: 'local', value: null });
  assert.ok([...byId.values()].every((r) => r.disabled === undefined));
});

test("a repo or managed value gets the third section, locked, and its hint (fix 1042)", () => {
  const repo = listingMenu({ project: 'off' }, {});
  assert.deepEqual(shape(repo), [
    '# In this folder',
    '[ ] On',
    '[ ] Name only',
    '[ ] / only',
    '[ ] Off',
    "[x] No setting here (uses the repo's)",
    '# In every folder',
    "[x] On (the repo's setting wins)",
    '[ ] Name only',
    '[ ] / only',
    '[ ] Off',
    '# Set for everyone',
    '[x] Off · repo (in effect)',
  ]);
  const locked = repo[repo.length - 1]!;
  assert.ok(locked.kind === 'row' && locked.disabled === true && locked.write === undefined && locked.id === 'project');
  assert.equal(listingButton('x', { project: 'off' }).from, ' · repo');

  // A local value beats the repo's; managed beats both and no hint says in effect but its own.
  assert.deepEqual(shape(listingMenu({ local: 'on', project: 'off' }, {})).slice(-2), ['# Set for everyone', "[x] Off · repo (this folder's setting wins)"]);
  assert.deepEqual(shape(listingMenu({ managed: 'name-only', local: 'on', project: 'off', user: 'off' }, {})), [
    '# In this folder',
    '[x] On',
    '[ ] Name only',
    '[ ] / only',
    '[ ] Off',
    '[ ] No setting here',
    '# In every folder',
    '[ ] On',
    '[ ] Name only',
    '[ ] / only',
    '[x] Off',
    '# Set for everyone',
    '[x] Name only · managed (in effect)',
    '[x] Off · repo',
  ]);
});

test("a section whose file does not parse is disabled with the error as its title (fix 1042)", () => {
  const err = 'C:\\work\\.claude\\settings.local.json does not parse as JSON';
  const rows = listingMenu({}, { local: err });
  const local = rows.slice(0, 6);
  assert.deepEqual(local[0], { kind: 'heading', label: 'In this folder', title: err });
  assert.ok(local.slice(1).every((r) => r.kind === 'row' && r.disabled === true && r.title === err));
  assert.ok(rows.slice(7).every((r) => r.kind === 'row' && r.disabled === undefined && r.title === undefined));
});

test('the synced rule reads the full name first, in every scope, then the bare name (fixes 1041 and 1076)', () => {
  const read = readOf({ local: { 'anthropic-skills:docs': 'name-only', docs: 'off' }, user: { pdf: 'user-invocable-only', 'anthropic-skills:pdf': 'on' } });
  assert.deepEqual(scopeValues(read, 'anthropic-skills:docs'), { local: 'name-only' });
  assert.deepEqual(scopeValues(read, 'anthropic-skills:pdf'), { user: 'on' });
  const syn = 'anthropic-skills:docs';
  const across = readOf({ local: { docs: 'on' }, user: { [syn]: 'off' } });
  assert.deepEqual(scopeValues(across, syn), { local: 'on', user: 'off', bareIn: ['local'] });
  assert.deepEqual(effectiveListing(scopeValues(across, syn)), { value: 'off', scope: 'user' });
  assert.equal(listingButton(syn, scopeValues(across, syn)).from, ' · all');
  const bareOnly = readOf({ project: { docs: 'name-only' }, user: { docs: 'off' } });
  assert.deepEqual(scopeValues(bareOnly, syn), { project: 'name-only', user: 'off', bareIn: ['project', 'user'] });
  assert.deepEqual(effectiveListing(scopeValues(bareOnly, syn)), { value: 'name-only', scope: 'project' });
  const looser = readOf({ managed: { docs: 'name-only' }, user: { [syn]: 'off' } });
  assert.deepEqual(effectiveListing(scopeValues(looser, syn)), { value: 'off', scope: 'user' });
  const stricter = readOf({ managed: { docs: 'user-invocable-only' }, local: { [syn]: 'name-only' } });
  assert.deepEqual(scopeValues(stricter, syn), { managed: 'user-invocable-only', local: 'name-only', bareIn: ['managed'] });
  assert.deepEqual(effectiveListing(scopeValues(stricter, syn)), { value: 'user-invocable-only', scope: 'managed' });
  const fullManaged = readOf({ managed: { [syn]: 'on', docs: 'off' } });
  assert.deepEqual(scopeValues(fullManaged, syn), { managed: 'on' });
  assert.deepEqual(effectiveListing(scopeValues(fullManaged, syn)), { value: 'on', scope: 'managed' });
  // A skill that is not synced reads its own name only.
  assert.deepEqual(scopeValues(read, 'docs'), { local: 'off' });
  assert.deepEqual(scopeValues(read, 'pdf'), { user: 'user-invocable-only' });
  assert.equal(listingKind('plugin', 'superpowers:brainstorm'), 'plugin');
  assert.equal(listingKind('syncedSkills', 'anthropic-skills:docs'), 'switch');
  assert.equal(listingKind('plugin', 'anthropic-skills:docs'), 'switch');
  assert.equal(listingKind('userSettings', 'ado'), 'switch');
  assert.equal(listingKind('built-in', 'init'), 'switch');
  assert.equal(listingKind('something-new', 'x'), 'switch');
});

test("the group's button and the note after a change (fix 1042)", () => {
  const names = ['ado', 'adopt-batch-routine', 'qa-story-refinement', 'docs'];
  assert.deepEqual(othersToTurnOff(names, boards), ['qa-story-refinement', 'docs']);
  assert.deepEqual(othersToTurnOff(names, null), names);
  assert.equal(turnOffLabel(['ado']), 'Turn off ado ▾');
  assert.equal(turnOffLabel(['ado', 'docs']), 'Turn off these 2 ▾');
  const one = (value: SkillListing | null) => [{ name: 'ado', value }];
  const two = (value: SkillListing | null) => [{ name: 'ado', value }, { name: 'docs', value }];
  assert.equal(changeNote(one('off'), 'local'), `ado off in this folder; ${LISTING_NOTE_TAIL_OFF} it`);
  assert.equal(changeNote(two('off'), 'user'), 'ado, docs off in every folder; new sessions start without them');
  assert.equal(changeNote(one('name-only'), 'local'), 'ado name only in this folder; new sessions list only its name');
  assert.equal(changeNote(two('name-only'), 'user'), 'ado, docs name only in every folder; new sessions list only their name');
  assert.equal(changeNote(one('user-invocable-only'), 'user'), 'ado / only in every folder; new sessions keep it for / alone');
  assert.equal(changeNote(two('user-invocable-only'), 'local'), 'ado, docs / only in this folder; new sessions keep them for / alone');
  assert.equal(changeNote(one('on'), 'local'), 'ado on in this folder; new sessions list it again');
  assert.equal(changeNote(one(null), 'local'), "ado has no setting in this folder now; new sessions use every folder's");
  assert.equal(changeNote(two(null), 'local'), "ado, docs have no setting in this folder now; new sessions use every folder's");
  assert.equal(changeNote(one(null), 'user'), 'ado on in every folder; new sessions list it again');
  assert.equal(changeNote(two(null), 'user'), 'ado, docs on in every folder; new sessions list them again');
  assert.equal(listingNameClass('off'), 'listing-off-name');
  assert.equal(listingNameClass('name-only'), '');
});

test('the claude.ai button opens the skills you have (fix 1078)', () => {
  assert.equal(CLAUDE_AI_SKILLS_URL, 'https://claude.ai/customize/skills/yours');
});
