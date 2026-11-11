import { formatTokens } from '@emerald/shared';
import type { ContextBreakdown, ContextCategory, ContextMcpTool, ContextMemoryFile, ContextSkill, ContextSkills, SessionInfo } from '@emerald/shared';

// M9 fix 1037: the rail's Context tab, drawn from the emerald mod's
// breakdown of the context window (fix 1036's session.context). No JSX
// here, so node --test can import it; RailContext.tsx renders from it.

// The parts of a breakdown in the grid's order, which is /context's:
// other sits between skills and messages.
export type ContextPart = 'prompt' | 'tools' | 'mcp' | 'mcp-instructions' | 'agents' | 'memory' | 'skills' | 'other' | 'messages';
export const PART_ORDER: readonly ContextPart[] = ['prompt', 'tools', 'mcp', 'mcp-instructions', 'agents', 'memory', 'skills', 'other', 'messages'];

// The used rows' names as Claude Code 2.1.316 writes them (read off the
// bundle). The d.ts says to branch on kind, which tells the used rows
// apart from nothing, so this table is the one place a rename lands; an
// unknown used row still draws, as other.
const PART_BY_NAME: Readonly<Record<string, ContextPart>> = {
  'System prompt': 'prompt',
  'System tools': 'tools',
  'MCP tools': 'mcp',
  'MCP server instructions': 'mcp-instructions',
  'Custom agents': 'agents',
  'Memory files': 'memory',
  Skills: 'skills',
  Messages: 'messages',
};

export type GridPart = ContextPart | 'free' | 'buffer';

// What this session called, keyed by ContextMcpTool.serverName and
// ContextAgent.agentType; context-history's reader feeds it, and null
// draws no unused word, no unused count and no calls.
export interface ContextUse {
  mcpCalls: ReadonlyMap<string, number>;
  agentCalls: ReadonlyMap<string, number>;
}

export function partOf(c: ContextCategory): ContextPart | 'free' | 'buffer' | 'deferred' {
  if (c.kind === 'free' || c.kind === 'buffer' || c.kind === 'deferred') return c.kind;
  return PART_BY_NAME[c.name] ?? 'other';
}

// The legend's words; other takes the category's own name.
export const PART_NAMES: Readonly<Record<Exclude<ContextPart, 'other'>, string>> = {
  prompt: 'System prompt',
  tools: 'System tools',
  mcp: 'MCP tools',
  'mcp-instructions': 'MCP instructions',
  agents: 'Custom agents',
  memory: 'Memory files',
  skills: 'Skills',
  messages: 'Messages',
};

export interface PartRow {
  part: ContextPart;
  name: string;
  tokens: number;
  // Of the whole window (rawMaxTokens), so a hundred squares are the window.
  percent: number;
}

// One row per used category with tokens, in the grid's order; two other
// rows keep the breakdown's order between them.
export function contextParts(b: ContextBreakdown): PartRow[] {
  const rows: PartRow[] = [];
  for (const c of b.categories) {
    const part = partOf(c);
    if (part === 'free' || part === 'buffer' || part === 'deferred' || !(c.tokens > 0)) continue;
    rows.push({ part, name: part === 'other' ? c.name : PART_NAMES[part], tokens: c.tokens, percent: percentOf(c.tokens, b.rawMaxTokens) });
  }
  // Array.prototype.sort is stable, so rows of one part keep their order.
  return rows.sort((a, z) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(z.part));
}

function percentOf(tokens: number, window: number): number {
  if (!(window > 0)) return 0;
  // Rounded to a millionth so 38000 of 200000 is 19 and not 19.000000000000004,
  // which would take a twentieth square.
  return Math.round(((tokens * 100) / window) * 1e6) / 1e6;
}

function tokensOfKind(b: ContextBreakdown, kind: ContextCategory['kind']): number {
  let sum = 0;
  for (const c of b.categories) if (c.kind === kind && c.tokens > 0) sum += c.tokens;
  return sum;
}

export interface GridCell {
  part: GridPart;
  fill: 'full' | 'hollow' | 'ring' | 'buffer';
  // How full the part's last square is (1 on every other square).
  fraction: number;
  dim: boolean;
}

// /context's own rule (ContextGridSquare.squareFullness): a part takes
// ceil(percent) squares, all full but its last, which under 0.7 full is
// drawn hollow with its fraction. The buffer takes its rounded percent
// from the end, free space what is left between. A window near or past
// full stops the parts where the buffer starts, so there are never more
// than a hundred.
export const GRID_CELLS = 100;
const HOLLOW_BELOW = 0.7;

export function gridCells(b: ContextBreakdown, open: ContextPart | null): GridCell[] {
  const bufferCells = Math.max(0, Math.min(GRID_CELLS, Math.round(percentOf(tokensOfKind(b, 'buffer'), b.rawMaxTokens))));
  const limit = GRID_CELLS - bufferCells;
  const cells: GridCell[] = [];
  for (const row of contextParts(b)) {
    const n = Math.ceil(row.percent);
    const frac = Math.round((row.percent - Math.floor(row.percent)) * 1e6) / 1e6;
    const dim = open !== null && open !== row.part;
    for (let i = 0; i < n && cells.length < limit; i++) {
      const last = i === n - 1 && frac > 0;
      cells.push({ part: row.part, fill: last && frac < HOLLOW_BELOW ? 'hollow' : 'full', fraction: last ? frac : 1, dim });
    }
  }
  while (cells.length < limit) cells.push({ part: 'free', fill: 'ring', fraction: 1, dim: false });
  for (let i = 0; i < bufferCells; i++) cells.push({ part: 'buffer', fill: 'buffer', fraction: 1, dim: false });
  return cells;
}

export interface LegendRow {
  part: GridPart;
  name: string;
  tokens: string;
  percent: string;
  title: string;
  dim: boolean;
}

export function legendRows(b: ContextBreakdown, open: ContextPart | null): LegendRow[] {
  const rows: LegendRow[] = contextParts(b).map((r) => ({
    part: r.part,
    name: r.name,
    tokens: formatTokens(r.tokens),
    percent: percentText(r.tokens, b.rawMaxTokens),
    title: `${r.name}, ${formatTokens(r.tokens)} tokens`,
    dim: open !== null && open !== r.part,
  }));
  const free = tokensOfKind(b, 'free');
  const buffer = tokensOfKind(b, 'buffer');
  rows.push({ part: 'free', name: 'Free space', tokens: formatTokens(free), percent: percentText(free, b.rawMaxTokens), title: 'What the window has left before the buffer', dim: false });
  rows.push({ part: 'buffer', name: 'Autocompact buffer', tokens: formatTokens(buffer), percent: percentText(buffer, b.rawMaxTokens), title: 'Held back for compaction; Claude Code compacts when the free space runs into it', dim: false });
  return rows;
}

// One decimal by integer rounding, so 3.1k of 200k reads 1.6% and 11.3k
// 5.7% as the board does (a float toFixed of 1.55 is not reliable).
export function percentText(tokens: number, window: number): string {
  if (!(window > 0)) return '0.0%';
  return `${(Math.round((tokens * 1000) / window) / 10).toFixed(1)}%`;
}

export function fillLine(b: ContextBreakdown): string {
  return `${b.percentage}% full, ${formatTokens(b.totalTokens)} of ${formatTokens(b.rawMaxTokens)} tokens`;
}

export function compactLine(b: ContextBreakdown): string {
  const threshold = b.autoCompactThreshold;
  if (!b.isAutoCompactEnabled || threshold === undefined || !(b.rawMaxTokens > 0)) return 'auto-compact off';
  return `auto-compact at ${((threshold * 100) / b.rawMaxTokens).toFixed(1)}% (${formatTokens(tokensOfKind(b, 'buffer'))} buffer)`;
}

export function overheadLine(b: ContextBreakdown): string {
  let messages = 0;
  for (const c of b.categories) if (c.kind !== 'free' && c.kind !== 'buffer' && c.kind !== 'deferred' && partOf(c) === 'messages') messages += c.tokens;
  return `${formatTokens(Math.max(0, b.totalTokens - messages))} of it loads before the first prompt`;
}

// estimated until a Recount, then the local time it was counted.
export function asOfText(b: ContextBreakdown): string {
  if (b.detail !== 'full') return 'estimated';
  const d = new Date(b.at);
  return `counted ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// How long Recount reads counting with no full breakdown landing before
// it reads Recount again.
export const RECOUNT_MS = 30_000;

// M9 fix 1038: the sections under the picture, the tab's states and the
// names a transcript lists for a Claude emerald did not start.

// How long an asked mod has to answer before the tab says it cannot ask.
export const CONTEXT_ASK_MS = 10_000;

// M9 fix 1040: the handoff's built words, now the columns and the switch
// are on the tab.
export const CONTEXT_FOOTER = 'context: what a part puts in every request. uses and last used: every session on this machine; unused: not called in this one. each skill is switched in its listing column; plugins in /plugin, synced skills on claude.ai.';

export type ContextAsk = { asked: boolean; mod: boolean };
export type ContextState = 'old' | 'none' | 'shell' | 'loaded' | 'outside' | 'fresh' | 'reading';

// M9 fix 1102: words for a conversation with no reply yet, which has no
// breakdown to show and is not a Claude emerald failed to start.
export const CONTEXT_FRESH_TEXT = 'A new conversation; the breakdown comes with its first reply';

// True while the session's current conversation has had no reply: none on
// the record (a fresh start), or the last one came before the current
// conversation's span began (a /clear opens a span after the old reply).
// A span of another conversation says nothing about this one.
export function awaitsFirstReply(session: Pick<SessionInfo, 'claudeSessionId' | 'lastReplyAt' | 'spans'>): boolean {
  const reply = session.lastReplyAt ?? null;
  if (reply === null) return true;
  const span = session.spans?.at(-1);
  return span !== undefined && span.conversation === session.claudeSessionId && reply < span.startedAt;
}

// First match wins: the daemon's level, no session, a plain shell (one
// with Claude typed in it has a claudeSessionId and is a Claude here, the
// rule of Sidebar.tsx), a breakdown whatever the reply said, a mod nobody
// can ask (outside), a mod that never answered on a conversation with no
// reply yet (fresh, M9 fix 1102) or one that has replied (reading), and
// otherwise still reading.
export function contextState({ session, supported, reply, askedAt, now }: { session: SessionInfo | null; supported: boolean; reply: ContextAsk | null; askedAt: number | null; now: number }): ContextState {
  if (!supported) return 'old';
  if (session === null) return 'none';
  if (session.kind === 'shell' && session.claudeSessionId === null) return 'shell';
  if (session.context !== undefined) return 'loaded';
  if (reply !== null && !reply.asked && !reply.mod) return 'outside';
  if (reply !== null && reply.asked && askedAt !== null && now - askedAt >= CONTEXT_ASK_MS) {
    if (!reply.mod) return 'outside';
    return awaitsFirstReply(session) ? 'fresh' : 'reading';
  }
  return 'reading';
}

export interface SectionHead {
  // part and name together key a head, since two other rows may share a part.
  part: ContextPart;
  name: string;
  tokens: number;
  count: number | null;
  unused: number | null;
  title: string;
}

function loadedServers(b: ContextBreakdown): Map<string, ContextMcpTool[]> {
  const by = new Map<string, ContextMcpTool[]>();
  for (const t of b.mcpTools) {
    if (!t.isLoaded) continue;
    const list = by.get(t.serverName);
    if (list === undefined) by.set(t.serverName, [t]);
    else list.push(t);
  }
  return by;
}

// One head per part row, largest first, ties in the grid's order.
export function sectionHeads(b: ContextBreakdown, used: ContextUse | null): SectionHead[] {
  const servers = loadedServers(b);
  const loadedTools = [...servers.values()].reduce((n, l) => n + l.length, 0);
  const skills = b.skills?.skillFrontmatter.length ?? null;
  const heads = contextParts(b).map((r): SectionHead => {
    let count: number | null = null;
    let unused: number | null = null;
    let title = r.name;
    if (r.part === 'memory') {
      count = b.memoryFiles.length;
      title = 'CLAUDE.md files and auto memory';
    } else if (r.part === 'mcp') {
      count = servers.size;
      if (used !== null) unused = [...servers.keys()].filter((s) => !((used.mcpCalls.get(s) ?? 0) > 0)).length;
      title = `The tool schemas of ${servers.size} MCP servers, ${loadedTools} tools`;
    } else if (r.part === 'agents') {
      count = b.agents.length;
      if (used !== null) unused = b.agents.filter((a) => !((used.agentCalls.get(a.agentType) ?? 0) > 0)).length;
      title = `The descriptions of ${b.agents.length} custom agents the Agent tool carries`;
    } else if (r.part === 'skills') {
      count = skills;
      title = `The listing of ${skills ?? 0} skills, sent with every request`;
    } else if (r.part === 'messages') title = 'The conversation so far: prompts, replies and tool results';
    else if (r.part === 'tools') title = "Claude Code's own tools";
    else if (r.part === 'prompt') title = "Claude Code's system prompt";
    else if (r.part === 'mcp-instructions') title = 'What the MCP servers tell Claude about themselves';
    return { part: r.part, name: r.name, tokens: r.tokens, count, unused, title };
  });
  return heads.sort((a, z) => z.tokens - a.tokens || PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(z.part));
}

// Whether a head opens: a part with at least one item row.
export function headHasItems(b: ContextBreakdown, part: ContextPart): boolean {
  if (part === 'memory') return b.memoryFiles.length > 0;
  if (part === 'mcp') return loadedServers(b).size > 0;
  if (part === 'agents') return b.agents.length > 0;
  if (part === 'skills') return (b.skills?.skillFrontmatter.length ?? 0) > 0;
  return false;
}

function splitPath(p: string): { parent: string; name: string } {
  const at = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return at < 0 ? { parent: '', name: p } : { parent: p.slice(0, at), name: p.slice(at + 1) };
}

// Where a memory file loads from: auto memory, or its folder shortened
// under the home folder and its type (~\code\emerald · project). Until the
// home folder is known, the full folder.
export function memoryWhere(file: ContextMemoryFile, home: string | null): string {
  if (file.type === 'AutoMem') return 'auto memory';
  const { parent } = splitPath(file.path);
  let folder = parent;
  if (home !== null && home !== '') {
    const h = home.replace(/[\\/]+$/, '');
    const sep = h.includes('/') && !h.includes('\\') ? '/' : '\\';
    if (parent.toLowerCase() === h.toLowerCase()) folder = '~';
    else if (parent.toLowerCase().startsWith(`${h.toLowerCase()}${sep}`)) folder = `~${parent.slice(h.length)}`;
  }
  return `${folder} · ${file.type.toLowerCase()}`;
}

export interface MemoryRow {
  path: string;
  name: string;
  where: string;
  tokens: number;
}

export function memoryRows(b: ContextBreakdown, home: string | null): MemoryRow[] {
  return [...b.memoryFiles].sort((a, z) => z.tokens - a.tokens).map((f) => ({ path: f.path, name: splitPath(f.path).name, where: memoryWhere(f, home), tokens: f.tokens }));
}

export interface ServerRow {
  server: string;
  tools: number;
  tokens: number;
  // In this session, when context-history's reader knows; null otherwise.
  calls: number | null;
  unused: boolean;
  top: Array<{ name: string; tokens: number }>;
  rest: number;
  restTokens: number;
}

export const SERVER_TOP = 4;

// The loaded tools by server, largest first; a server opens to its four
// largest tools and a line for the rest.
export function serverRows(b: ContextBreakdown, used: ContextUse | null): ServerRow[] {
  const rows: ServerRow[] = [];
  for (const [server, tools] of loadedServers(b)) {
    const sorted = [...tools].sort((a, z) => z.tokens - a.tokens);
    const prefix = `mcp__${server}__`;
    const top = sorted.slice(0, SERVER_TOP).map((t) => ({ name: t.name.startsWith(prefix) ? t.name.slice(prefix.length) : t.name, tokens: t.tokens }));
    const rest = sorted.slice(SERVER_TOP);
    const calls = used === null ? null : (used.mcpCalls.get(server) ?? 0);
    rows.push({ server, tools: tools.length, tokens: tools.reduce((n, t) => n + t.tokens, 0), calls, unused: calls === 0, top, rest: rest.length, restTokens: rest.reduce((n, t) => n + t.tokens, 0) });
  }
  return rows.sort((a, z) => z.tokens - a.tokens);
}

// M9 fix 1040: one tool and one call are singular, as a server with one
// tool called once (the history's fixture) reads.
export function serverSub(r: ServerRow): string {
  const tools = r.tools === 1 ? '1 tool' : `${r.tools} tools`;
  if (r.calls === null || r.calls <= 0) return tools;
  return `${tools} · ${callsText(r.calls)}`;
}

export function callsText(n: number): string {
  return n === 1 ? '1 call' : `${n} calls`;
}

export function restLine(r: ServerRow): string {
  return `${r.rest} more, ${formatTokens(r.restTokens)}`;
}

export function agentSource(source: string): string {
  if (source === 'projectSettings') return 'project';
  if (source === 'userSettings') return 'user';
  if (source === 'plugin') return 'plugin';
  return source;
}

export interface AgentRow {
  agentType: string;
  source: string;
  tokens: number;
  unused: boolean;
}

export function agentRows(b: ContextBreakdown, used: ContextUse | null): AgentRow[] {
  return [...b.agents]
    .sort((a, z) => z.tokens - a.tokens)
    .map((a) => ({ agentType: a.agentType, source: agentSource(a.source), tokens: a.tokens, unused: used !== null && !((used.agentCalls.get(a.agentType) ?? 0) > 0) }));
}

// A skill's source in the pane view's words, which context-history reuses.
export function skillSourceLabel(skill: ContextSkill): string {
  switch (skill.source) {
    case 'userSettings':
      return 'your settings';
    case 'projectSettings':
      return 'this folder';
    case 'syncedSkills':
      return 'claude.ai sync';
    case 'plugin':
      return skill.pluginName === undefined || skill.pluginName === '' ? 'plugin' : `${skill.pluginName} plugin`;
    case 'policySettings':
      return 'managed';
    case 'built-in':
      return 'built-in';
    case 'mcp':
      return 'MCP';
    default:
      return skill.source;
  }
}

export function skillRows(skills: ContextSkills): Array<{ name: string; source: string; tokens: number }> {
  return [...skills.skillFrontmatter].sort((a, z) => z.tokens - a.tokens).map((s) => ({ name: s.name, source: skillSourceLabel(s), tokens: s.tokens }));
}

// The Not in the window row: the tools not loaded and the deferred
// categories' tokens; null when nothing is deferred.
export function deferredRow(b: ContextBreakdown): { count: number; tokens: number } | null {
  if (!b.categories.some((c) => c.kind === 'deferred')) return null;
  return { count: b.mcpTools.filter((t) => !t.isLoaded).length, tokens: tokensOfKind(b, 'deferred') };
}

export interface TranscriptNames {
  memoryFiles: string[];
  mcpServers: string[];
  skills: string[];
  agents: string[];
}

// The names a transcript's attachment lines list, for a Claude emerald did
// not start (A5): every instructions attachment's files, distinct; the last
// skill listing's names; the MCP servers added less those removed, in
// order; the custom agents added less those removed and the built-in ones.
// Shapes read off this machine's transcripts of 2026-10-31.
export function transcriptNames(text: string): TranscriptNames {
  const memory: string[] = [];
  let skills: string[] = [];
  const servers: string[] = [];
  const agents: string[] = [];
  const builtIn = new Set<string>();
  const drop = (list: string[], names: unknown) => {
    if (!Array.isArray(names)) return;
    for (const n of names) {
      const at = list.indexOf(String(n));
      if (at >= 0) list.splice(at, 1);
    }
  };
  const add = (list: string[], names: unknown) => {
    if (!Array.isArray(names)) return;
    for (const n of names) if (typeof n === 'string' && !list.includes(n)) list.push(n);
  };
  for (const line of text.split('\n')) {
    if (!line.includes('"attachment"')) continue;
    let a: Record<string, unknown>;
    try {
      const o = JSON.parse(line) as { type?: unknown; attachment?: unknown };
      if (o.type !== 'attachment' || typeof o.attachment !== 'object' || o.attachment === null) continue;
      a = o.attachment as Record<string, unknown>;
    } catch {
      continue;
    }
    if (a['type'] === 'instructions' && Array.isArray(a['files'])) {
      add(
        memory,
        (a['files'] as unknown[]).map((f) => (typeof f === 'object' && f !== null ? (f as { path?: unknown }).path : undefined)).filter((p) => typeof p === 'string'),
      );
    } else if (a['type'] === 'skill_listing' && Array.isArray(a['names'])) {
      skills = (a['names'] as unknown[]).filter((n): n is string => typeof n === 'string');
    } else if (a['type'] === 'mcp_instructions_delta') {
      add(servers, a['addedNames']);
      drop(servers, a['removedNames']);
    } else if (a['type'] === 'agent_listing_delta') {
      add(agents, a['addedTypes']);
      drop(agents, a['removedTypes']);
      if (Array.isArray(a['builtInTypes'])) for (const t of a['builtInTypes'] as unknown[]) builtIn.add(String(t));
    }
  }
  return { memoryFiles: memory, mcpServers: servers, skills, agents: agents.filter((t) => !builtIn.has(t)) };
}
