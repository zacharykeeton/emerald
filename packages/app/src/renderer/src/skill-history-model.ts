import { formatTokens } from '@emerald/shared';
import type { ContextBreakdown, ContextSkill } from '@emerald/shared';
import type { ContextHistory, SessionUse, SkillHistory } from '../../preload/api.ts';
import { skillSourceLabel } from './context-model.ts';
import type { ContextUse } from './context-model.ts';

// The source's words are context-model.ts's, which fix 1038's plain
// section drew; re-exported so the Skills rows and the pane read one.
export { skillSourceLabel };

// The Context tab's history of skills and MCP servers (M9 fixes 1039 and
// 1040): what the main process reads off every transcript on the machine
// (context-history.ts), turned into the rows, the words and the groups the
// Skills section and the pane view draw. Pure, so node:test covers it; the
// main process imports mcpServerKey, so nothing here may reach the DOM.

// The server part of an MCP tool's wire name, `mcp__<server>__<tool>`, or
// null for a tool that is not an MCP server's. The wire prefix is not
// always the server's display name (`claude_ai_Wispr_Flow` against
// `claude.ai Wispr Flow`), so the history keys servers by it and the
// renderer maps it through the breakdown's tool names.
export function mcpServerKey(wireName: string): string | null {
  const m = /^mcp__(.+?)__/.exec(wireName);
  return m === null ? null : m[1]!;
}

// The rail shows the eight most recently used skills and folds the rest.
export const USED_SHOWN = 8;

const DAY_MS = 24 * 60 * 60 * 1000;
const SYNCED_PREFIX = 'anthropic-skills:';

type Skills = Pick<ContextHistory, 'skills'>;

// A skill's history: by its own name, else, for a plugin's skill listed
// without its plugin, as `<plugin>:<name>`, which is how the Skill call
// names it. Undefined for a skill never run on this machine.
export function skillHistoryOf(history: Skills, skill: ContextSkill): SkillHistory | undefined {
  const own = history.skills[skill.name];
  if (own !== undefined) return own;
  if (skill.pluginName !== undefined && !skill.name.includes(':')) return history.skills[`${skill.pluginName}:${skill.name}`];
  return undefined;
}


// A skill's line in the listing, as /skill-doctor writes it: a dash for
// none, `< 20`, tens under a thousand, then the app's short form.
export function listingTokensText(n: number): string {
  if (n <= 0) return '-';
  if (n < 20) return '< 20';
  if (n < 1000) return `~${Math.round(n / 10) * 10}`;
  return `~${formatTokens(n)}`;
}

export function tokens7dText(n: number): string {
  return n <= 0 ? '-' : formatTokens(n);
}

// Whole local calendar days between two moments, so neither the time of
// day nor a daylight-saving change moves the count.
export function calendarDaysBetween(at: number, now: number): number {
  const a = new Date(at);
  const b = new Date(now);
  const from = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const to = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((to - from) / DAY_MS);
}

export function lastUsedWords(at: number | null | undefined, now: number): string {
  if (at === null || at === undefined) return 'never';
  const days = Math.max(0, calendarDaysBetween(at, now));
  if (days === 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

export interface SkillGroups {
  never: { settings: ContextSkill[]; synced: ContextSkill[]; tokens: number };
  used: ContextSkill[];
}

// The Skills section's groups: the never used by where each is turned
// off (claude.ai for a synced one, settings for every other, a plugin's
// among them), each by name, and the used most recent first. A skill
// switched off in its listing stays in its group; the row says `off`.
export function skillGroups(skills: readonly ContextSkill[], history: Skills): SkillGroups {
  const settings: ContextSkill[] = [];
  const synced: ContextSkill[] = [];
  const used: Array<{ skill: ContextSkill; at: number }> = [];
  let tokens = 0;
  for (const skill of skills) {
    const h = skillHistoryOf(history, skill);
    if (h !== undefined) {
      used.push({ skill, at: h.lastUsedAt });
      continue;
    }
    tokens += skill.tokens;
    if (skill.source === 'syncedSkills') synced.push(skill);
    else settings.push(skill);
  }
  const byName = (a: ContextSkill, b: ContextSkill): number => a.name.localeCompare(b.name);
  settings.sort(byName);
  synced.sort(byName);
  used.sort((a, b) => b.at - a.at || a.skill.name.localeCompare(b.skill.name));
  return { never: { settings, synced, tokens }, used: used.map((u) => u.skill) };
}

// M9 fix 1055: the Skills section by where each skill lives, in a fixed
// order, the empty ones left out. Inside a group the rows keep fix 1040's
// order: the never used by name (synced ones apart, for the fold), then
// the used most recent first.
export type SkillSectionKey = 'folder' | 'yours' | 'built-in';
export const SKILL_SECTION_HEADS: Record<SkillSectionKey, string> = { folder: 'this folder', yours: 'yours', 'built-in': 'plugins and built-in' };
export interface SkillSection {
  key: SkillSectionKey;
  never: ContextSkill[];
  synced: ContextSkill[];
  used: ContextSkill[];
  tokens: number;
  count: number;
}

export function skillSectionKey(skill: ContextSkill): SkillSectionKey {
  if (skill.source === 'projectSettings') return 'folder';
  if (skill.source === 'userSettings' || skill.source === 'syncedSkills') return 'yours';
  return 'built-in';
}

export function skillSections(skills: readonly ContextSkill[], history: Skills): SkillSection[] {
  const order: SkillSectionKey[] = ['folder', 'yours', 'built-in'];
  const out: SkillSection[] = [];
  for (const key of order) {
    const part = skills.filter((s) => skillSectionKey(s) === key);
    if (part.length === 0) continue;
    const g = skillGroups(part, history);
    out.push({ key, never: g.never.settings, synced: g.never.synced, used: g.used, tokens: g.never.tokens, count: part.length });
  }
  return out;
}

export function skillSectionHead(section: SkillSection): string {
  const base = `${SKILL_SECTION_HEADS[section.key]}, ${section.count}`;
  if (section.never.length + section.synced.length === 0) return base;
  return `${base}, never used ${listingTokensText(section.tokens)} in every request`;
}

function syncedName(name: string): string {
  return name.startsWith(SYNCED_PREFIX) ? name.slice(SYNCED_PREFIX.length) : name;
}

function foldTokens(n: number): string {
  return n > 0 && n < 20 ? 'under 20' : listingTokensText(n);
}

// The synced group folded to one row: how many, what they cost together,
// and the largest and the smallest.
export function syncedFoldText(synced: readonly ContextSkill[]): string {
  const sum = synced.reduce((n, s) => n + s.tokens, 0);
  if (synced.length === 0) return '0 skills';
  const sorted = [...synced].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
  if (sorted.length === 1) return `1 skill, ${listingTokensText(sum)}, ${syncedName(sorted[0]!.name)}`;
  const big = sorted[0]!;
  const small = sorted[sorted.length - 1]!;
  return `${sorted.length} skills, ${listingTokensText(sum)}, from ${syncedName(big.name)} ${foldTokens(big.tokens)} to ${syncedName(small.name)} ${foldTokens(small.tokens)}`;
}

function daysAgo(days: number): string {
  if (days === 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// The button under the eight most recent: how many more, and how long ago
// they ran.
export function moreUsedText(rest: readonly ContextSkill[], history: Skills, now: number): string {
  const days = rest.map((s) => Math.max(0, calendarDaysBetween(skillHistoryOf(history, s)?.lastUsedAt ?? now, now)));
  const a = Math.min(...days);
  const b = Math.max(...days);
  const when = a === b ? daysAgo(a) : `${a} to ${b} days ago`;
  return `${rest.length} more, last used ${when}`;
}

// A skill row's tooltip: where it comes from, the 7d tokens and the uses,
// which live here since the row's last column is the listing dropdown.
export function skillRowTitle(skill: ContextSkill, h: SkillHistory | undefined): string {
  const from = `From ${skillSourceLabel(skill)}`;
  if (h === undefined) return `${from}; never run on this machine`;
  const uses = h.uses === 1 ? '1 use' : `${h.uses} uses`;
  if (h.tokens7d <= 0) return `${from}; not run in the last 7 days; ${uses}`;
  return `${from}; ${tokens7dText(h.tokens7d)} tokens in the turns it ran, over the last 7 days; ${uses}`;
}

// The session's calls by server and agent, the shape RailContext's `used`
// takes. Each MCP tool's wire name goes to the breakdown's server that
// lists the tool, else to a server whose tools share its wire prefix,
// else to the prefix itself.
export function contextUse(session: SessionUse | null, breakdown: Pick<ContextBreakdown, 'mcpTools'> | null): ContextUse | null {
  if (session === null) return null;
  const byTool = new Map<string, string>();
  const byPrefix = new Map<string, string>();
  for (const tool of breakdown?.mcpTools ?? []) {
    byTool.set(tool.name, tool.serverName);
    const key = mcpServerKey(tool.name);
    if (key !== null && !byPrefix.has(key)) byPrefix.set(key, tool.serverName);
  }
  const mcpCalls = new Map<string, number>();
  for (const [wire, calls] of Object.entries(session.mcpTools)) {
    const key = mcpServerKey(wire);
    const server = byTool.get(wire) ?? (key === null ? undefined : byPrefix.get(key)) ?? key ?? wire;
    mcpCalls.set(server, (mcpCalls.get(server) ?? 0) + calls);
  }
  return { mcpCalls, agentCalls: new Map(Object.entries(session.agents)) };
}

// The pane's summary over the never used, a line each, the empty ones
// left out.
export function neverSummary(groups: SkillGroups): string[] {
  const { settings, synced, tokens } = groups.never;
  const n = settings.length + synced.length;
  if (n === 0) return [];
  const lines = [`${n === 1 ? '1 skill' : `${n} skills`} loaded and never invoked on this machine ${n === 1 ? 'puts' : 'put'} ${listingTokensText(tokens)} tokens in every request.`];
  if (settings.length > 0) lines.push(`${settings.length} ${settings.length === 1 ? 'comes' : 'come'} from your settings: turn them off in /skills, or remove them from .claude/skills.`);
  if (synced.length > 0) lines.push(`${synced.length} ${synced.length === 1 ? 'is' : 'are'} synced from claude.ai: turn them off on claude.ai; a deleted synced copy comes back on the next sync.`);
  return lines;
}
