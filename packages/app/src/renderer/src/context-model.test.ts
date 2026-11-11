import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ContextBreakdown, ContextCategory, ContextMcpTool, SessionInfo } from '@emerald/shared';
import {
  CONTEXT_ASK_MS,
  CONTEXT_FRESH_TEXT,
  agentRows,
  agentSource,
  asOfText,
  awaitsFirstReply,
  compactLine,
  contextParts,
  contextState,
  deferredRow,
  fillLine,
  gridCells,
  legendRows,
  memoryRows,
  memoryWhere,
  overheadLine,
  partOf,
  percentText,
  restLine,
  sectionHeads,
  serverRows,
  serverSub,
  skillSourceLabel,
  transcriptNames,
} from './context-model.ts';

// The handoff's invented reading (docs/design/context-tab.md, section 6).
const used = (name: string, tokens: number): ContextCategory => ({ name, tokens, color: 'x', isDeferred: false, kind: 'used' });
const CATEGORIES: ContextCategory[] = [
  used('System prompt', 3100),
  used('System tools', 14200),
  used('MCP tools', 9800),
  used('MCP server instructions', 1600),
  used('Custom agents', 1200),
  used('Memory files', 11300),
  used('Skills', 7200),
  used('Messages', 38000),
  { name: 'Free space', tokens: 80600, color: 'x', isDeferred: false, kind: 'free' },
  { name: 'Autocompact buffer', tokens: 33000, color: 'x', isDeferred: false, kind: 'buffer' },
  { name: 'MCP tools (deferred)', tokens: 21400, color: 'x', isDeferred: true, kind: 'deferred' },
];

// Section 6's lists: claude-in-chrome's 14 loaded tools sum 6100,
// Wispr_Flow's 16 sum 3700 (four named, the other twelve 2380), and 62
// tools not loaded.
const tools = (server: string, n: number, total: number, named: Array<[string, number]> = []): ContextMcpTool[] => {
  const list: ContextMcpTool[] = named.map(([name, tokens]) => ({ name: `mcp__${server}__${name}`, serverName: server, tokens, isLoaded: true }));
  const left = total - named.reduce((s, [, t]) => s + t, 0);
  const rest = n - named.length;
  for (let i = 0; i < rest; i++) {
    const tokens = Math.floor(left / rest) + (i < left % rest ? 1 : 0);
    list.push({ name: `mcp__${server}__tool_${i}`, serverName: server, tokens, isLoaded: true });
  }
  return list;
};
const MCP_TOOLS: ContextMcpTool[] = [
  ...tools('claude-in-chrome', 14, 6100),
  ...tools('Wispr_Flow', 16, 3700, [
    ['search_meetings', 410],
    ['get_meeting', 380],
    ['list_upcoming_meetings', 290],
    ['get_scratchpad_note', 240],
  ]),
  ...Array.from({ length: 62 }, (_, i): ContextMcpTool => ({ name: `mcp__claude_ai_Gmail__t${i}`, serverName: 'claude_ai_Gmail', tokens: 300, isLoaded: false })),
];

const FIXTURE: ContextBreakdown = {
  categories: CATEGORIES,
  totalTokens: 86400,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  autocompactSource: 'default',
  percentage: 43,
  model: 'Opus 5.5',
  memoryFiles: [
    { path: 'C:\\Users\\x\\code\\emerald\\CLAUDE.md', type: 'Project', tokens: 8700 },
    { path: 'C:\\Users\\x\\.claude\\projects\\C--Users-x-code-emerald\\memory\\MEMORY.md', type: 'AutoMem', tokens: 1700 },
    { path: 'C:\\Users\\x\\.claude\\CLAUDE.md', type: 'User', tokens: 900 },
  ],
  mcpTools: MCP_TOOLS,
  agents: [
    { agentType: 'emerald-batch-dev', source: 'projectSettings', tokens: 520 },
    { agentType: 'claude', source: 'userSettings', tokens: 410 },
    { agentType: 'workflow-guide', source: 'plugin', tokens: 270 },
  ],
  skills: {
    totalSkills: 3,
    includedSkills: 3,
    tokens: 7200,
    skillFrontmatter: [
      { name: 'ado', source: 'userSettings', tokens: 300 },
      { name: 'pdf', source: 'syncedSkills', tokens: 15 },
      { name: 'batch', source: 'projectSettings', tokens: 400 },
    ],
  },
  autoCompactThreshold: 167000,
  isAutoCompactEnabled: true,
  apiUsage: null,
  at: 0,
  detail: 'summary',
};

function countBy<T>(xs: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}

test('the invented reading fills the grid as the board does (M9 fix 1037)', () => {
  const cells = gridCells(FIXTURE, null);
  assert.equal(cells.length, 100);
  assert.deepEqual(countBy(cells, (c) => c.part), { prompt: 2, tools: 8, mcp: 5, 'mcp-instructions': 1, agents: 1, memory: 6, skills: 4, messages: 19, free: 37, buffer: 17 });
  assert.ok(cells.slice(83).every((c) => c.part === 'buffer' && c.fill === 'buffer'), 'the buffer is the last 17');
  assert.ok(cells.filter((c) => c.part === 'free').every((c) => c.fill === 'ring'));
  const hollow = cells.filter((c) => c.fill === 'hollow');
  assert.deepEqual(
    hollow.map((c) => [c.part, c.fraction.toFixed(2)]),
    [
      ['prompt', '0.55'],
      ['tools', '0.10'],
      ['agents', '0.60'],
      ['memory', '0.65'],
      ['skills', '0.60'],
    ],
  );
  const lastOf = (part: string) => cells.filter((c) => c.part === part).at(-1)!;
  assert.equal(lastOf('mcp').fill, 'full');
  assert.equal(lastOf('mcp').fraction.toFixed(2), '0.90');
  assert.equal(lastOf('mcp-instructions').fill, 'full');
  assert.equal(lastOf('mcp-instructions').fraction.toFixed(2), '0.80');
  assert.ok(cells.filter((c) => c.part === 'messages').every((c) => c.fill === 'full' && c.fraction === 1), 'a whole 19 percent has no partial square');
  assert.ok(cells.every((c) => !c.dim), 'nothing open, nothing dimmed');
});

test('an open part dims every other part and never free or buffer (M9 fix 1037)', () => {
  const cells = gridCells(FIXTURE, 'memory');
  assert.equal(cells.filter((c) => c.part === 'memory' && !c.dim).length, 6);
  assert.ok(cells.filter((c) => c.part !== 'memory' && c.part !== 'free' && c.part !== 'buffer').every((c) => c.dim));
  assert.ok(cells.filter((c) => c.part === 'free' || c.part === 'buffer').every((c) => !c.dim));
  const legend = legendRows(FIXTURE, 'memory');
  assert.deepEqual(
    legend.filter((r) => !r.dim).map((r) => r.part),
    ['memory', 'free', 'buffer'],
  );
});

test('the legend reads ten rows with the board percents and tokens (M9 fix 1037)', () => {
  const rows = legendRows(FIXTURE, null);
  assert.equal(rows.length, 10);
  assert.deepEqual(
    rows.map((r) => r.percent),
    ['1.6%', '7.1%', '4.9%', '0.8%', '0.6%', '5.7%', '3.6%', '19.0%', '40.3%', '16.5%'],
  );
  assert.deepEqual(
    rows.map((r) => r.tokens),
    ['3.1k', '14.2k', '9.8k', '1.6k', '1.2k', '11.3k', '7.2k', '38k', '80.6k', '33k'],
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ['System prompt', 'System tools', 'MCP tools', 'MCP instructions', 'Custom agents', 'Memory files', 'Skills', 'Messages', 'Free space', 'Autocompact buffer'],
  );
  assert.equal(rows[0]!.title, 'System prompt, 3.1k tokens');
  assert.equal(rows[8]!.title, 'What the window has left before the buffer');
  assert.equal(rows[9]!.title, 'Held back for compaction; Claude Code compacts when the free space runs into it');
});

test('the lines under the picture read the board words (M9 fix 1037)', () => {
  assert.equal(fillLine(FIXTURE), '43% full, 86.4k of 200k tokens');
  assert.equal(compactLine(FIXTURE), 'auto-compact at 83.5% (33k buffer)');
  assert.equal(compactLine({ ...FIXTURE, isAutoCompactEnabled: false }), 'auto-compact off');
  const { autoCompactThreshold: _t, ...noThreshold } = FIXTURE;
  assert.equal(compactLine(noThreshold), 'auto-compact off');
  assert.equal(overheadLine(FIXTURE), '48.4k of it loads before the first prompt');
  assert.equal(percentText(3100, 200000), '1.6%');
  assert.equal(percentText(11300, 200000), '5.7%');
});

test('an over-full window stops the parts where the buffer starts (M9 fix 1037)', () => {
  const over: ContextBreakdown = {
    ...FIXTURE,
    categories: [used('System tools', 40000), used('Messages', 150000), { name: 'Autocompact buffer', tokens: 33000, color: 'x', isDeferred: false, kind: 'buffer' }],
  };
  const cells = gridCells(over, null);
  assert.equal(cells.length, 100);
  const counts = countBy(cells, (c) => (c.part === 'free' || c.part === 'buffer' ? c.part : 'part'));
  assert.deepEqual(counts, { part: 83, buffer: 17 });
});

test('an unknown used row is other, drawn between skills and messages (M9 fix 1037)', () => {
  const notes = used('Plugin notes', 2000);
  assert.equal(partOf(notes), 'other');
  assert.equal(partOf(CATEGORIES[8]!), 'free');
  assert.equal(partOf(CATEGORIES[10]!), 'deferred');
  const b: ContextBreakdown = { ...FIXTURE, categories: [...CATEGORIES.slice(0, 7), CATEGORIES[7]!, notes, ...CATEGORIES.slice(8)] };
  const order = contextParts(b).map((r) => r.name);
  assert.deepEqual(order.slice(6), ['Skills', 'Plugin notes', 'Messages']);
  const cells = gridCells(b, null);
  const firstOther = cells.findIndex((c) => c.part === 'other');
  assert.ok(cells[firstOther - 1]!.part === 'skills' && cells.filter((c) => c.part === 'other').length === 1);
  assert.equal(cells[firstOther + 1]!.part, 'messages');
});

test('a counted breakdown says when, a summary says estimated (M9 fix 1037)', () => {
  const at = new Date(2026, 9, 31, 14, 32, 5).getTime();
  assert.equal(asOfText({ ...FIXTURE, detail: 'full', at }), 'counted 14:32');
  assert.equal(asOfText({ ...FIXTURE, detail: 'full', at: new Date(2026, 9, 31, 9, 5).getTime() }), 'counted 09:05');
  assert.equal(asOfText(FIXTURE), 'estimated');
});

const callsUsed = (mcp: Array<[string, number]>, agents: Array<[string, number]> = []) => ({ mcpCalls: new Map(mcp), agentCalls: new Map(agents) });

test('the sections sort by tokens, largest first (M9 fix 1038)', () => {
  const heads = sectionHeads(FIXTURE, null);
  assert.deepEqual(
    heads.map((h) => h.name),
    ['Messages', 'System tools', 'Memory files', 'MCP tools', 'Skills', 'System prompt', 'MCP instructions', 'Custom agents'],
  );
  const by = (name: string) => heads.find((h) => h.name === name)!;
  assert.equal(by('Memory files').count, 3);
  assert.equal(by('MCP tools').count, 2);
  assert.equal(by('Custom agents').count, 3);
  assert.equal(by('Skills').count, 3);
  assert.equal(by('Messages').count, null);
  assert.equal(by('MCP instructions').count, null);
  assert.equal(by('MCP tools').title, 'The tool schemas of 2 MCP servers, 30 tools');
  assert.equal(by('Custom agents').title, 'The descriptions of 3 custom agents the Agent tool carries');
  assert.ok(heads.every((h) => h.unused === null), 'with used null, no unused count anywhere');
  // A tie keeps the grid's order.
  const tie: ContextBreakdown = { ...FIXTURE, categories: [used('Skills', 500), used('System prompt', 500)] };
  assert.deepEqual(
    sectionHeads(tie, null).map((h) => h.part),
    ['prompt', 'skills'],
  );
});

test('memory files read where they load from (M9 fix 1038)', () => {
  const rows = memoryRows(FIXTURE, 'C:\\Users\\x');
  assert.deepEqual(
    rows.map((r) => [r.name, r.where]),
    [
      ['CLAUDE.md', '~\\code\\emerald · project'],
      ['MEMORY.md', 'auto memory'],
      ['CLAUDE.md', '~\\.claude · user'],
    ],
  );
  assert.equal(memoryWhere(FIXTURE.memoryFiles[0]!, null), 'C:\\Users\\x\\code\\emerald · project');
  assert.equal(memoryWhere({ path: 'C:\\Users\\x\\CLAUDE.md', type: 'User', tokens: 1 }, 'C:\\Users\\x\\'), '~ · user');
});

test('the MCP servers, their tools and their calls (M9 fix 1038)', () => {
  const rows = serverRows(FIXTURE, null);
  assert.deepEqual(
    rows.map((r) => [r.server, serverSub(r), r.tokens]),
    [
      ['claude-in-chrome', '14 tools', 6100],
      ['Wispr_Flow', '16 tools', 3700],
    ],
  );
  assert.ok(rows.every((r) => !r.unused && r.calls === null));
  const wispr = rows[1]!;
  assert.deepEqual(
    wispr.top.map((t) => t.name),
    ['search_meetings', 'get_meeting', 'list_upcoming_meetings', 'get_scratchpad_note'],
  );
  assert.equal(restLine(wispr), '12 more, 2.4k');
  const u = callsUsed([['claude-in-chrome', 3]]);
  const usedRows = serverRows(FIXTURE, u);
  assert.equal(serverSub(usedRows[0]!), '14 tools · 3 calls');
  assert.equal(usedRows[0]!.unused, false);
  assert.equal(usedRows[1]!.unused, true);
  const heads = sectionHeads(FIXTURE, u);
  assert.equal(heads.find((h) => h.part === 'mcp')!.unused, 1);
  assert.equal(heads.find((h) => h.part === 'agents')!.unused, 3);
});

test('the custom agents and their sources (M9 fix 1038)', () => {
  assert.deepEqual(
    agentRows(FIXTURE, null).map((a) => [a.agentType, a.source, a.unused]),
    [
      ['emerald-batch-dev', 'project', false],
      ['claude', 'user', false],
      ['workflow-guide', 'plugin', false],
    ],
  );
  assert.ok(agentRows(FIXTURE, callsUsed([])).every((a) => a.unused));
  assert.equal(agentSource('somewhere'), 'somewhere');
});

test('the deferred tools are outside the window (M9 fix 1038)', () => {
  assert.deepEqual(deferredRow(FIXTURE), { count: 62, tokens: 21400 });
  assert.equal(deferredRow({ ...FIXTURE, categories: CATEGORIES.slice(0, 10) }), null);
});

test('a skill source in the pane view words (M9 fix 1038)', () => {
  const s = (source: string, pluginName?: string) => skillSourceLabel({ name: 'x', source, tokens: 1, ...(pluginName === undefined ? {} : { pluginName }) });
  assert.equal(s('userSettings'), 'your settings');
  assert.equal(s('projectSettings'), 'this folder');
  assert.equal(s('syncedSkills'), 'claude.ai sync');
  assert.equal(s('plugin', 'atk'), 'atk plugin');
  assert.equal(s('plugin'), 'plugin');
  assert.equal(s('policySettings'), 'managed');
  assert.equal(s('built-in'), 'built-in');
  assert.equal(s('mcp'), 'MCP');
  assert.equal(s('somethingNew'), 'somethingNew');
});

test('a transcript lists its names, less the removed and the built-in (M9 fix 1038)', () => {
  const line = (attachment: unknown) => JSON.stringify({ type: 'attachment', attachment });
  const text = [
    line({ type: 'instructions', files: [{ path: 'C:\\a\\CLAUDE.md', type: 'Project', content: 'x' }, { path: 'C:\\a\\CLAUDE.md', type: 'Project' }] }),
    line({ type: 'skill_listing', names: ['ado', 'batch'], skillCount: 2 }),
    line({ type: 'mcp_instructions_delta', addedNames: ['claude-in-chrome', 'Wispr_Flow'], removedNames: [] }),
    JSON.stringify({ type: 'user', message: { content: 'an "attachment" word in a prompt' } }),
    line({ type: 'mcp_instructions_delta', addedNames: [], removedNames: ['Wispr_Flow'] }),
    line({ type: 'agent_listing_delta', addedTypes: ['claude', 'emerald-batch-dev', 'Explore'], removedTypes: [], builtInTypes: ['Explore'] }),
    'not json',
  ].join('\n');
  assert.deepEqual(transcriptNames(text), { memoryFiles: ['C:\\a\\CLAUDE.md'], mcpServers: ['claude-in-chrome'], skills: ['ado', 'batch'], agents: ['claude', 'emerald-batch-dev'] });
});

test('awaitsFirstReply: no reply, or the last one before this conversation\'s span began (M9 fix 1102)', () => {
  const span = (conversation: string, startedAt: number) => [{ conversation, remoteSessionId: null, startedAt, endedAt: null, startHead: null }];
  assert.equal(awaitsFirstReply({ claudeSessionId: 'c1' }), true);
  assert.equal(awaitsFirstReply({ claudeSessionId: 'c1', lastReplyAt: null }), true);
  assert.equal(awaitsFirstReply({ claudeSessionId: 'c1', lastReplyAt: 500 }), false);
  assert.equal(awaitsFirstReply({ claudeSessionId: 'c1', lastReplyAt: 500, spans: span('c1', 800) }), true);
  assert.equal(awaitsFirstReply({ claudeSessionId: 'c1', lastReplyAt: 500, spans: span('c1', 500) }), false);
  assert.equal(awaitsFirstReply({ claudeSessionId: 'c1', lastReplyAt: 500, spans: span('c0', 800) }), false);
  assert.equal(CONTEXT_FRESH_TEXT, 'A new conversation; the breakdown comes with its first reply');
});

test('the tab state, first match wins (M9 fix 1038)', () => {
  const claude = { id: 's1', kind: 'claude', claudeSessionId: 'c1' } as unknown as SessionInfo;
  const loaded = { ...claude, context: FIXTURE } as SessionInfo;
  const shell = { id: 's2', kind: 'shell', claudeSessionId: null } as unknown as SessionInfo;
  const hosted = { ...shell, claudeSessionId: 'c2' } as SessionInfo;
  const st = (session: SessionInfo | null, reply: { asked: boolean; mod: boolean } | null, after = 0, supported = true) => contextState({ session, supported, reply, askedAt: 1000, now: 1000 + after });
  assert.equal(st(loaded, null, 0, false), 'old');
  assert.equal(st(null, null), 'none');
  assert.equal(st(shell, null), 'shell');
  assert.equal(st(hosted, null), 'reading', 'a shell with Claude typed in it is a Claude');
  assert.equal(st(loaded, { asked: false, mod: false }), 'loaded', 'a breakdown wins over the reply');
  assert.equal(st(claude, { asked: false, mod: false }), 'outside');
  assert.equal(st(claude, { asked: true, mod: true }, CONTEXT_ASK_MS - 1000), 'reading');
  assert.equal(st(claude, { asked: true, mod: true }, CONTEXT_ASK_MS), 'fresh', 'a conversation with no reply yet (M9 fix 1102)');
  const replied = { ...claude, lastReplyAt: 500 } as SessionInfo;
  assert.equal(st(replied, { asked: true, mod: true }, CONTEXT_ASK_MS), 'reading', 'a mod asked on a conversation that has replied waits for its next measure');
  const span = (conversation: string) => [{ conversation, remoteSessionId: null, startedAt: 800, endedAt: null, startHead: null }];
  assert.equal(st({ ...replied, spans: span('c1') } as SessionInfo, { asked: true, mod: true }, CONTEXT_ASK_MS), 'fresh', 'a /clear after the last reply');
  assert.equal(st({ ...replied, spans: span('c0') } as SessionInfo, { asked: true, mod: true }, CONTEXT_ASK_MS), 'reading', 'a span of another conversation leaves the reply counting');
  assert.equal(st(claude, { asked: true, mod: false }, CONTEXT_ASK_MS), 'outside');
  assert.equal(st(claude, { asked: false, mod: true }, CONTEXT_ASK_MS * 5), 'reading', 'a Claude in a shell waits for its next Measure');
  assert.equal(st(claude, null), 'reading');
});
