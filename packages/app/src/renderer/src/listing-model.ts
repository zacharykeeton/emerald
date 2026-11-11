import type { SkillListing, SkillOverrideEdit, SkillOverridesRead, SkillScope } from '../../preload/api.ts';

// The listing switch's words and rules (M9 fixes 1041 and 1042, the Context
// tab's design, docs/design/context-tab.md section 3): what Claude sees of
// a skill over Claude Code's four scopes, and the menu that sets it in
// this folder or in every folder. Pure, so node:test reads it; the
// component in ListingSwitch.tsx draws only what this returns.

export const LISTING_VALUES = ['on', 'name-only', 'user-invocable-only', 'off'] as const;

// The dropdown's and the note's words.
export const LISTING_WORD: Record<SkillListing, string> = { on: 'on', 'name-only': 'name only', 'user-invocable-only': '/ only', off: 'off' };
// The menu's.
export const LISTING_MENU_LABEL: Record<SkillListing, string> = { on: 'On', 'name-only': 'Name only', 'user-invocable-only': '/ only', off: 'Off' };

// The tail of the note after an `off`. Claude Code 2.1.316 sends the
// skill listing once and only adds to it (a name already sent in a
// session's `skill_listing` attachment is never taken back), so a running
// session keeps the line; should a later version start removing names,
// this becomes `from the next request`.
export const LISTING_NOTE_TAIL_OFF = 'new sessions start without';

// The board's `listing` column head.
export const LISTING_COLUMN_TITLE = 'What Claude sees of the skill: on, name only, / only (you can type it, Claude does not see it), or off';

// Claude.ai's page of the skills you have; the user picked it at the
// install of fixes 1030 to 1047, since the bare /customize/skills is the
// marketplace.
export const CLAUDE_AI_SKILLS_URL = 'https://claude.ai/customize/skills/yours';

// Whether skillOverrides reaches a skill synced from claude.ai. Claude
// Code 2.1.316 looks a synced skill up by its full name and its bare one,
// so it does; false draws `on claude.ai` in place of the dropdown, the
// shape for a version that stops.
export const SYNCED_SWITCHABLE: boolean = true;

const SYNCED_PREFIX = 'anthropic-skills:';

export function isSyncedName(name: string): boolean {
  return name.startsWith(SYNCED_PREFIX);
}

// How restrictive a value is, for the managed bare-name entry that tightens the result.
const STRICTNESS: Record<SkillListing, number> = { on: 0, 'name-only': 1, 'user-invocable-only': 2, off: 3 };

export interface ScopeValues {
  managed?: SkillListing;
  local?: SkillListing;
  project?: SkillListing;
  user?: SkillListing;
  bareIn?: SkillScope[];
}

// The skill's value in each scope that has one. A synced skill's entry may
// be under its full name or its bare one; a scope's full-name entry is its
// value, else its bare-name entry, and bareIn names the scopes that gave the
// bare one, since Claude Code (2.1.318, Mzt) looks the full name up in every
// scope before the bare name in any.
export function scopeValues(read: SkillOverridesRead | null, name: string): ScopeValues {
  const out: ScopeValues = {};
  if (read === null) return out;
  const bare = isSyncedName(name) ? name.slice(SYNCED_PREFIX.length) : null;
  const bareIn: SkillScope[] = [];
  for (const s of read.scopes) {
    let v: SkillListing | undefined = Object.prototype.hasOwnProperty.call(s.values, name) ? s.values[name] : undefined;
    if (v === undefined && bare !== null && bare !== '' && Object.prototype.hasOwnProperty.call(s.values, bare)) {
      v = s.values[bare];
      if (v !== undefined) bareIn.push(s.scope);
    }
    if (v !== undefined) out[s.scope] = v;
  }
  if (bareIn.length > 0) out.bareIn = bareIn;
  return out;
}

const ORDER: readonly SkillScope[] = ['managed', 'local', 'project', 'user'];

// The first scope whose value is the full name's, else the first with the bare name's, else on; then a managed bare-name value stricter than that wins (Claude Code's policySettings pass).
export function effectiveListing(v: ScopeValues): { value: SkillListing; scope: SkillScope | null } {
  const bareIn = v.bareIn ?? [];
  let result: { value: SkillListing; scope: SkillScope | null } | null = null;
  for (const s of ORDER) {
    const value = v[s];
    if (value !== undefined && !bareIn.includes(s)) { result = { value, scope: s }; break; }
  }
  if (result === null) {
    for (const s of ORDER) {
      const value = v[s];
      if (value !== undefined) { result = { value, scope: s }; break; }
    }
  }
  if (result === null) return { value: 'on', scope: null };
  const m = v.managed;
  if (m !== undefined && bareIn.includes('managed') && STRICTNESS[m] > STRICTNESS[result.value]) return { value: m, scope: 'managed' };
  return result;
}

export type ListingKind = 'switch' | 'plugin' | 'synced-locked';

// A synced skill first, since one delivered through a plugin that follows
// the synced state is still synced; then a plugin's, which skillOverrides
// does not reach; anything else (the user's, the repo's, managed, built-in,
// an MCP prompt, a source not known yet) has the switch.
export function listingKind(source: string, name: string): ListingKind {
  if (source === 'syncedSkills' || isSyncedName(name)) return SYNCED_SWITCHABLE ? 'switch' : 'synced-locked';
  if (source === 'plugin') return 'plugin';
  return 'switch';
}

const FROM: Record<SkillScope, string> = { user: ' · all', project: ' · repo', managed: ' · managed', local: '' };
const WHERE: Record<SkillScope, string> = {
  local: ', set in this folder',
  user: ', set for every folder',
  project: ", set in the repo's settings",
  managed: ', set by your organization',
};

export function listingButton(name: string, v: ScopeValues): { word: string; from: string; title: string; value: SkillListing } {
  const { value, scope } = effectiveListing(v);
  const word = LISTING_WORD[value];
  const from = scope === null ? '' : FROM[scope];
  const where = scope === null ? '' : WHERE[scope];
  return { word, from, title: `What Claude sees of ${name}: ${word}${where}; click to change it here or in every folder`, value };
}

export type ListingMenuRow =
  | { kind: 'heading'; label: string; title?: string }
  | { kind: 'row'; id: string; label: string; checked: boolean; hint?: string; disabled?: boolean; title?: string; write?: { scope: 'local' | 'user'; value: SkillListing | null } };

type Row = Extract<ListingMenuRow, { kind: 'row' }>;

// A row that writes, or a locked one (`write` undefined) that only shows
// a setting made elsewhere. A section whose file did not parse has every
// row disabled, the error as its title.
function row(id: string, label: string, checked: boolean, hint: string | undefined, write: Row['write'], error: string | undefined): Row {
  const r: Row = { kind: 'row', id, label, checked };
  if (hint !== undefined) r.hint = hint;
  if (write === undefined || error !== undefined) r.disabled = true;
  if (error !== undefined) r.title = error;
  if (write !== undefined) r.write = write;
  return r;
}

function heading(label: string, error: string | undefined): ListingMenuRow {
  return error === undefined ? { kind: 'heading', label } : { kind: 'heading', label, title: error };
}

// The dropdown's menu: this folder's five rows, every folder's four, and,
// when the repo or the organization sets the skill, a third section that
// shows it and cannot be changed here. Only the ticked row of a section
// carries a hint, saying whether that setting is the one in effect.
export function listingMenu(v: ScopeValues, errors: { local?: string; user?: string }): ListingMenuRow[] {
  const decides = effectiveListing(v).scope;
  const out: ListingMenuRow[] = [];

  out.push(heading('In this folder', errors.local));
  let localHint: string | undefined;
  if (v.local !== undefined) localHint = decides === 'local' ? 'in effect' : undefined;
  else if (decides === 'project') localHint = "uses the repo's";
  else if (decides !== 'managed') localHint = "uses every folder's";
  for (const value of LISTING_VALUES) {
    const ticked = v.local === value;
    out.push(row(`local:${value}`, LISTING_MENU_LABEL[value], ticked, ticked ? localHint : undefined, { scope: 'local', value }, errors.local));
  }
  out.push(row('local:none', 'No setting here', v.local === undefined, v.local === undefined ? localHint : undefined, { scope: 'local', value: null }, errors.local));

  out.push(heading('In every folder', errors.user));
  let userHint: string | undefined;
  if (decides === 'user' || decides === null) userHint = 'in effect';
  else if (decides === 'local') userHint = "this folder's setting wins";
  else if (decides === 'project') userHint = "the repo's setting wins";
  const userTicked = v.user ?? 'on';
  for (const value of LISTING_VALUES) {
    const ticked = userTicked === value;
    // No entry and `on` are one in every folder, so On removes the entry.
    out.push(row(`user:${value}`, LISTING_MENU_LABEL[value], ticked, ticked ? userHint : undefined, { scope: 'user', value: value === 'on' ? null : value }, errors.user));
  }

  if (v.managed !== undefined || v.project !== undefined) {
    out.push({ kind: 'heading', label: 'Set for everyone' });
    if (v.managed !== undefined) {
      out.push(row('managed', `${LISTING_MENU_LABEL[v.managed]} · managed`, true, decides === 'managed' ? 'in effect' : undefined, undefined, undefined));
    }
    if (v.project !== undefined) {
      let hint: string | undefined;
      if (decides === 'project') hint = 'in effect';
      else if (decides === 'local') hint = "this folder's setting wins";
      out.push(row('project', `${LISTING_MENU_LABEL[v.project]} · repo`, true, hint, undefined, undefined));
    }
  }
  return out;
}

// The group's names that are not off yet, in the given order.
export function othersToTurnOff(names: readonly string[], read: SkillOverridesRead | null): string[] {
  return names.filter((n) => effectiveListing(scopeValues(read, n)).value !== 'off');
}

// M9 fix 1105: one skill by its name, more as "these N"; a group whose every row is never used has no "other".
export function turnOffLabel(names: readonly string[]): string {
  return names.length === 1 ? `Turn off ${names[0]} ▾` : `Turn off these ${names.length} ▾`;
}

// The note under the group after a change. One change is one scope and
// one value (a menu pick is one name, the group button N names all off),
// so the value is the first edit's.
export function changeNote(edits: readonly SkillOverrideEdit[], scope: 'local' | 'user'): string {
  const names = edits.map((e) => e.name).join(', ');
  const many = edits.length > 1;
  const it = many ? 'them' : 'it';
  const where = scope === 'local' ? 'in this folder' : 'in every folder';
  const value = edits[0]?.value ?? null;
  if (value === null) {
    if (scope === 'local') return `${names} ${many ? 'have' : 'has'} no setting in this folder now; new sessions use every folder's`;
    return `${names} on in every folder; new sessions list ${it} again`;
  }
  if (value === 'off') return `${names} off ${where}; ${LISTING_NOTE_TAIL_OFF} ${it}`;
  if (value === 'name-only') return `${names} name only ${where}; new sessions list only ${many ? 'their' : 'its'} name`;
  if (value === 'user-invocable-only') return `${names} / only ${where}; new sessions keep ${it} for / alone`;
  return `${names} on ${where}; new sessions list ${it} again`;
}

export function listingNameClass(value: SkillListing): string {
  return value === 'off' ? 'listing-off-name' : '';
}
