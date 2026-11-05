import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ContextSkill } from '@emerald/shared';
import type { SkillHistory } from '../../preload/api.ts';
import {
  USED_SHOWN,
  contextUse,
  lastUsedWords,
  listingTokensText,
  mcpServerKey,
  moreUsedText,
  neverSummary,
  skillGroups,
  skillHistoryOf,
  skillRowTitle,
  skillSectionHead,
  skillSections,
  type SkillSection,
  skillSourceLabel,
  syncedFoldText,
  tokens7dText,
} from './skill-history-model.ts';

test('mcpServerKey: the wire prefix of an MCP tool, null for any other tool (fix 1039)', () => {
  assert.equal(mcpServerKey('mcp__claude-in-chrome__tabs_context_mcp'), 'claude-in-chrome');
  assert.equal(mcpServerKey('mcp__claude_ai_Wispr_Flow__get_meeting'), 'claude_ai_Wispr_Flow');
  assert.equal(mcpServerKey('Bash'), null);
});

// The user's /skill-doctor paste of 2026-10-31, as A10-pane.dc.html's RAW
// list draws it: name, source, context tokens, 7d tokens, uses, days since
// last use (null for never), less send-email, which the paste says is not
// in the listing and so is in no breakdown. The "< 20" rows are 15 each
// (the handoff's slip 6) but pdf, at 12, so the fold's smallest is the
// handoff's: no tie rule over four rows at 15 picks pdf.
const NOW = new Date(2026, 9, 31, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
type Row = [string, string, number, number, number, number | null];
const RAW: Row[] = [
  ['ado', 'userSettings', 250, 0, 0, null],
  ['adopt-batch-routine', 'userSettings', 280, 0, 0, null],
  ['qa-story-refinement', 'userSettings', 230, 0, 0, null],
  ['qa-test-case-creation', 'userSettings', 230, 0, 0, null],
  ['setup-otel', 'userSettings', 190, 0, 0, null],
  ['suggest-from-usage', 'projectSettings', 140, 0, 0, null],
  ['anthropic-skills:chrome-browser', 'syncedSkills', 260, 0, 0, null],
  ['anthropic-skills:computer-use', 'syncedSkills', 320, 0, 0, null],
  ['anthropic-skills:deep-research', 'syncedSkills', 200, 0, 0, null],
  ['anthropic-skills:docs', 'syncedSkills', 340, 0, 0, null],
  ['anthropic-skills:google-workspace', 'syncedSkills', 330, 0, 0, null],
  ['anthropic-skills:import-memory', 'syncedSkills', 60, 0, 0, null],
  ['anthropic-skills:loop-accomplishments', 'syncedSkills', 70, 0, 0, null],
  ['anthropic-skills:morning', 'syncedSkills', 15, 0, 0, null],
  ['anthropic-skills:pdf', 'syncedSkills', 12, 0, 0, null],
  ['anthropic-skills:pptx', 'syncedSkills', 15, 0, 0, null],
  ['anthropic-skills:xlsx', 'syncedSkills', 15, 0, 0, null],
  ['anthropic-skills:skill-creator', 'syncedSkills', 120, 0, 2, 41],
  ['design-handoff', 'userSettings', 230, 0, 29, 39],
  ['project-to-workflow', 'userSettings', 380, 0, 3, 14],
  ['anthropic-skills:built-in-browser', 'syncedSkills', 290, 0, 1, 14],
  ['db-box', 'userSettings', 170, 0, 12, 13],
  ['anthropic-skills:docx', 'syncedSkills', 320, 0, 3, 7],
  ['adopt-backlog-batch-routine', 'userSettings', 420, 0, 1, 6],
  ['atk-guide', 'userSettings', 230, 15_500_000, 8, 6],
  ['emmer-cli', 'userSettings', 290, 28_600_000, 6, 2],
  ['frontend-design', 'plugin', 80, 2_000_000, 4, 2],
  ['backoffice-sql-query-generator', 'userSettings', 120, 11_400_000, 7, 1],
  ['gh-sandbox', 'userSettings', 180, 1_600_000, 4, 1],
  ['backlog-inbox', 'userSettings', 200, 2_600_000, 7, 0],
  ['local-backlog', 'userSettings', 440, 36_700_000, 11, 0],
  ['session-retro', 'userSettings', 510, 79_500_000, 25, 0],
  ['batch', 'projectSettings', 250, 407_200_000, 93, 0],
];
const skillsOf = (rows: Row[]): ContextSkill[] => rows.map(([name, source, tokens]) => (source === 'plugin' ? { name, source, pluginName: name, tokens } : { name, source, tokens }));
// The plugin's skill is named with its plugin in the transcripts.
const historyOf = (rows: Row[]): { skills: Record<string, SkillHistory> } => ({
  skills: Object.fromEntries(
    rows
      .filter((r) => r[5] !== null)
      .map(([name, source, , tok7, uses, days]) => [source === 'plugin' ? `${name}:${name}` : name, { uses, lastUsedAt: NOW - days! * DAY, tokens7d: tok7 }]),
  ),
});

test('skillGroups: the paste\'s never used by where each is turned off, the used most recent first (fix 1040)', () => {
  const g = skillGroups(skillsOf(RAW), historyOf(RAW));
  assert.deepEqual(
    g.never.settings.map((s) => s.name),
    ['ado', 'adopt-batch-routine', 'qa-story-refinement', 'qa-test-case-creation', 'setup-otel', 'suggest-from-usage'],
  );
  assert.equal(g.never.synced.length, 11);
  assert.equal(g.used.length, 16);
  assert.deepEqual(g.used.slice(0, 4).map((s) => s.name), ['backlog-inbox', 'batch', 'local-backlog', 'session-retro'], 'today, then by name');
  assert.equal(g.used[g.used.length - 1]!.name, 'anthropic-skills:skill-creator', 'the longest ago last');
  assert.equal(listingTokensText(g.never.tokens), '~3k');
  assert.equal(syncedFoldText(g.never.synced), '11 skills, ~1.6k, from docs ~340 to pdf under 20');
  assert.equal(syncedFoldText(g.never.synced.slice(8, 9)), '1 skill, < 20, pdf');
  const rest = g.used.slice(USED_SHOWN);
  assert.equal(moreUsedText(rest, historyOf(RAW), NOW), '8 more, last used 6 to 41 days ago');
  assert.deepEqual(neverSummary(g), [
    '17 skills loaded and never invoked on this machine put ~3k tokens in every request.',
    '6 come from your settings: turn them off in /skills, or remove them from .claude/skills.',
    '11 are synced from claude.ai: turn them off on claude.ai; a deleted synced copy comes back on the next sync.',
  ]);
});

test('skillSections: this folder, yours with the synced, then plugins and built-in (fix 1055)', () => {
  const sections = skillSections(skillsOf(RAW), historyOf(RAW));
  assert.deepEqual(sections.map((s) => s.key), ['folder', 'yours', 'built-in']);
  const [folder, yours, builtIn] = sections as [SkillSection, SkillSection, SkillSection];
  const names = (l: ContextSkill[]): string[] => l.map((s) => s.name);
  assert.deepEqual(names(folder.never), ['suggest-from-usage']);
  assert.deepEqual(names(folder.used), ['batch']);
  assert.deepEqual(names(yours.never), ['ado', 'adopt-batch-routine', 'qa-story-refinement', 'qa-test-case-creation', 'setup-otel']);
  assert.equal(yours.synced.length, 11);
  assert.equal(yours.used.length, 14);
  assert.deepEqual(names(yours.used.slice(0, 4)), ['backlog-inbox', 'local-backlog', 'session-retro', 'backoffice-sql-query-generator']);
  assert.equal(yours.used[yours.used.length - 1]!.name, 'anthropic-skills:skill-creator');
  assert.deepEqual(builtIn.never, []);
  assert.deepEqual(names(builtIn.used), ['frontend-design']);
  assert.deepEqual(sections.map(skillSectionHead), ['this folder, 2, never used ~140 in every request', 'yours, 30, never used ~2.8k in every request', 'plugins and built-in, 1']);
  assert.equal(moreUsedText(yours.used.slice(USED_SHOWN), historyOf(RAW), NOW), '6 more, last used 7 to 41 days ago');
});

test('skillSections: every other source is one built-in section, and no skills make none (fix 1055)', () => {
  const rows: Row[] = [
    ['x', 'built-in', 10, 0, 0, null],
    ['y', 'policySettings', 5, 0, 0, null],
    ['z', 'mcp', 1, 0, 0, null],
    ['w', 'somethingNew', 1, 0, 0, null],
  ];
  const sections = skillSections(skillsOf(rows), historyOf(rows));
  assert.deepEqual(sections.map((s) => s.key), ['built-in']);
  assert.deepEqual(sections[0]!.never.map((s) => s.name), ['w', 'x', 'y', 'z']);
  assert.equal(skillSectionHead(sections[0]!), 'plugins and built-in, 4, never used < 20 in every request');
  assert.deepEqual(skillSections([], { skills: {} }), []);
});

test('the figures and words of a skill row', () => {
  assert.equal(listingTokensText(0), '-');
  assert.equal(listingTokensText(15), '< 20');
  assert.equal(listingTokensText(254), '~250');
  assert.equal(listingTokensText(1640), '~1.6k');
  assert.equal(tokens7dText(0), '-');
  assert.equal(tokens7dText(407_200_000), '407.2M');
  const noon3 = new Date(2026, 9, 28, 12, 0, 0).getTime();
  assert.equal(lastUsedWords(noon3, NOW), '3 days');
  assert.equal(lastUsedWords(new Date(2026, 9, 31, 0, 30, 0).getTime(), NOW), 'today');
  assert.equal(lastUsedWords(new Date(2026, 9, 30, 23, 59, 0).getTime(), new Date(2026, 9, 31, 0, 1, 0).getTime()), '1 day');
  assert.equal(lastUsedWords(undefined, NOW), 'never');
  const atk: ContextSkill = { name: 'atk-guide', source: 'userSettings', tokens: 230 };
  assert.equal(skillRowTitle(atk, { uses: 8, lastUsedAt: NOW, tokens7d: 15_500_000 }), 'From your settings; 15.5M tokens in the turns it ran, over the last 7 days; 8 uses');
  assert.equal(skillRowTitle(atk, { uses: 1, lastUsedAt: NOW, tokens7d: 0 }), 'From your settings; not run in the last 7 days; 1 use');
  assert.equal(skillRowTitle(atk, undefined), 'From your settings; never run on this machine');
  assert.equal(skillSourceLabel({ name: 'frontend-design', source: 'plugin', pluginName: 'frontend-design', tokens: 80 }), 'frontend-design plugin');
});

test('skillHistoryOf finds a plugin\'s skill under its plugin\'s name', () => {
  const h = { uses: 4, lastUsedAt: NOW, tokens7d: 2_000_000 };
  const skill: ContextSkill = { name: 'frontend-design', source: 'plugin', pluginName: 'frontend-design', tokens: 80 };
  assert.equal(skillHistoryOf({ skills: { 'frontend-design:frontend-design': h } }, skill), h);
  assert.equal(skillHistoryOf({ skills: {} }, skill), undefined);
});

test('contextUse credits a wire name to the breakdown\'s server through its tool, its prefix, or the prefix itself', () => {
  const used = contextUse(
    { mcpTools: { mcp__claude_ai_Wispr_Flow__x: 2, mcp__claude_ai_Wispr_Flow__y: 1, 'mcp__claude-in-chrome__navigate': 3, mcp__other__z: 1 }, agents: { 'emerald-batch-dev': 2 } },
    {
      mcpTools: [
        { name: 'mcp__claude_ai_Wispr_Flow__x', serverName: 'claude.ai Wispr Flow', tokens: 100, isLoaded: true },
        { name: 'mcp__claude-in-chrome__tabs_context_mcp', serverName: 'claude-in-chrome', tokens: 100, isLoaded: true },
      ],
    },
  );
  assert.ok(used !== null);
  assert.deepEqual(Object.fromEntries(used.mcpCalls), { 'claude.ai Wispr Flow': 3, 'claude-in-chrome': 3, other: 1 });
  assert.deepEqual(Object.fromEntries(used.agentCalls), { 'emerald-batch-dev': 2 });
  assert.equal(contextUse(null, null), null);
});
