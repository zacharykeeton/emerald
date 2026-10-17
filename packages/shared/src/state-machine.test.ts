import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensUp, type NeedsInputReason, type SessionInfo, type SessionSpan, type SessionState, type SessionTask, type TeamMember } from './session.ts';
import { Limits } from './limits.ts';
import { SUMMARY_MAX, autoNameFor, classifyHook, groupTasksByOwner, initialState, namesUnknownTask, readTask, reduce, sortTasks, tasksOfAgent, type HookPayload, type SessionEvent } from './state-machine.ts';
import { agentLineText, contextText, contextTitle, hasState, runningKind, tallyText, taskProgress, taskTally, tasksText } from './session-label.ts';

const ALL_STATES: SessionState[] = ['starting', 'idle', 'working', 'waiting', 'needs-input', 'done', 'errored', 'exited'];
const BOUND = 'claude-session-1';
const T0 = 1_000_000;

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'emerald-1',
    kind: 'claude',
    name: 'repo',
    spawnCwd: 'C:\\repo',
    args: [],
    autoName: true,
    branch: null,
    lastPrompt: null,
    lastReply: null,
    cwd: 'C:\\repo',
    groupCwd: 'C:\\repo',
    state: 'idle',
    stateSince: T0,
    lastEventAt: null,
    stale: false,
    needsInputReason: null,
    errorType: null,
    waitingOn: [],
    team: [],
    conversation: null,
    shellCwd: null,
    commits: [],
    model: null,
    contextPercent: null,
    contextWindow: null,
    tokens: null,
    comment: null,
    phase: null,
    color: '#61afef',
    title: null,
    transcriptPath: null,
    liveReply: null,
    liveTool: null,
    claudeSessionId: BOUND,
    pid: 123,
    exitCode: null,
    createdAt: T0,
    ...overrides,
  };
}

function hook(name: string, extra: Partial<HookPayload> = {}, at = T0 + 5000): SessionEvent {
  return { type: 'hook', at, payload: { hook_event_name: name, session_id: BOUND, cwd: 'C:\\repo', ...extra } };
}

// One row per line of the table in docs/PLAN.md. `to` is null when the row
// says "no change"; `reason` is the needs-input reason expected afterwards
// (undefined means "whatever it was before").
interface Row {
  label: string;
  event: SessionEvent;
  to: SessionState | null;
  reason?: NeedsInputReason | null;
}

const rows: Row[] = [
  { label: 'SessionStart startup', event: hook('SessionStart', { source: 'startup' }), to: 'idle', reason: null },
  { label: 'SessionStart resume', event: hook('SessionStart', { source: 'resume' }), to: 'idle', reason: null },
  { label: 'SessionStart clear', event: hook('SessionStart', { source: 'clear' }), to: 'idle', reason: null },
  { label: 'SessionStart fork', event: hook('SessionStart', { source: 'fork' }), to: 'idle', reason: null },
  { label: 'SessionStart compact', event: hook('SessionStart', { source: 'compact' }), to: null },
  { label: 'SessionStart compact via session_start_type', event: hook('SessionStart', { session_start_type: 'compact' }), to: null },
  { label: 'UserPromptSubmit', event: hook('UserPromptSubmit'), to: 'working', reason: null },
  { label: 'PreToolUse', event: hook('PreToolUse', { tool_name: 'Bash' }), to: 'working', reason: null },
  { label: 'PostToolUse', event: hook('PostToolUse'), to: 'working', reason: null },
  { label: 'PostToolUseFailure', event: hook('PostToolUseFailure'), to: 'working', reason: null },
  { label: 'PermissionDenied', event: hook('PermissionDenied'), to: 'working', reason: null },
  // The team's events say nothing about the parent's state (M46).
  { label: 'SubagentStart with agent_id', event: hook('SubagentStart', { agent_id: 'a1', agent_type: 'fork' }), to: null },
  { label: 'SubagentStop with agent_id', event: hook('SubagentStop', { agent_id: 'a1', agent_type: 'fork' }), to: null },
  { label: 'PreCompact', event: hook('PreCompact'), to: 'working', reason: null },
  { label: 'PostCompact', event: hook('PostCompact'), to: 'working', reason: null },
  { label: 'PermissionRequest', event: hook('PermissionRequest'), to: 'needs-input', reason: 'permission' },
  { label: 'Notification permission_prompt', event: hook('Notification', { notification_type: 'permission_prompt' }), to: 'needs-input', reason: 'permission' },
  { label: 'Notification elicitation_dialog', event: hook('Notification', { notification_type: 'elicitation_dialog' }), to: 'needs-input', reason: 'elicitation' },
  { label: 'Notification elicitation_url_dialog', event: hook('Notification', { notification_type: 'elicitation_url_dialog' }), to: 'needs-input', reason: 'elicitation' },
  { label: 'Notification agent_needs_input', event: hook('Notification', { notification_type: 'agent_needs_input' }), to: 'needs-input', reason: 'question' },
  { label: 'Notification idle_prompt', event: hook('Notification', { notification_type: 'idle_prompt' }), to: null },
  { label: 'Notification auth_success', event: hook('Notification', { notification_type: 'auth_success' }), to: null },
  { label: 'Notification agent_completed', event: hook('Notification', { notification_type: 'agent_completed' }), to: null },
  { label: 'Notification without a type', event: hook('Notification'), to: null },
  // A type named after an Object.prototype member is no known type (M9 fix 510).
  { label: 'Notification constructor', event: hook('Notification', { notification_type: 'constructor' }), to: null },
  { label: 'Notification __proto__', event: hook('Notification', { notification_type: '__proto__' }), to: null },
  { label: 'Notification toString', event: hook('Notification', { notification_type: 'toString' }), to: null },
  { label: 'Stop', event: hook('Stop'), to: 'done', reason: null },
  { label: 'Stop with an empty background_tasks', event: hook('Stop', { background_tasks: [] }), to: 'done', reason: null },
  { label: 'Stop with a finished background task', event: hook('Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'completed' }] }), to: 'done', reason: null },
  { label: 'Stop with a running subagent', event: hook('Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'M30' }] }), to: 'waiting', reason: null },
  { label: 'Stop with a running shell', event: hook('Stop', { background_tasks: [{ id: 's1', type: 'shell', status: 'completed' }, { id: 's2', type: 'shell', status: 'running' }] }), to: 'waiting', reason: null },
  { label: 'Stop with a malformed background_tasks', event: hook('Stop', { background_tasks: 'running' }), to: 'done', reason: null },
  { label: 'StopFailure', event: hook('StopFailure', { error_type: 'rate_limit' }), to: 'errored', reason: null },
  { label: 'SessionEnd', event: hook('SessionEnd'), to: 'idle', reason: null },
  { label: 'CwdChanged', event: hook('CwdChanged', { cwd: 'C:\\elsewhere', previous_cwd: 'C:\\repo' }), to: null },
  { label: 'unknown hook name', event: hook('SomethingNew'), to: null },
  { label: 'pty.exit', event: { type: 'pty.exit', exitCode: 3, at: T0 + 5000 }, to: 'exited', reason: null },
];

for (const row of rows) {
  test(`table: ${row.label} from every state`, () => {
    for (const from of ALL_STATES) {
      const make = () => session({ state: from, needsInputReason: from === 'needs-input' ? 'permission' : null });
      const before = make();
      const after = reduce(before, row.event);
      // A hook after the exit leaves an exited session exited (M9 fix 174).
      const expected = from === 'exited' && row.event.type === 'hook' ? 'exited' : (row.to ?? from);
      assert.equal(after.state, expected, `${row.label} from ${from}`);
      // A hook after the exit leaves the ask as the exit left it (M9 fix 506).
      if (row.reason !== undefined) assert.equal(after.needsInputReason, from === 'exited' && row.event.type === 'hook' ? null : row.reason, `${row.label} reason from ${from}`);
      if (expected === from) {
        assert.equal(after.stateSince, before.stateSince, `${row.label} from ${from} must not move stateSince`);
      } else {
        assert.equal(after.stateSince, row.event.at, `${row.label} from ${from} moves stateSince to the event time`);
      }
      if (row.event.type === 'hook') {
        assert.equal(after.lastEventAt, row.event.at, `${row.label} from ${from} refreshes lastEventAt`);
      }
      assert.deepEqual(before, make(), 'reduce is pure');
    }
  });
}

test('initialState: claude starts starting, shell starts idle', () => {
  assert.equal(initialState('claude'), 'starting');
  assert.equal(initialState('shell'), 'idle');
});

test('trust: the dialog read moves only a starting row to needs-input/trust, and only that ask back (M9 fix 808)', () => {
  const shown: SessionEvent = { type: 'trust', shown: true, at: T0 + 10 };
  const gone: SessionEvent = { type: 'trust', shown: false, at: T0 + 20 };
  // A fresh Claude has bound no conversation yet.
  const asking = reduce(session({ state: 'starting', claudeSessionId: null }), shown);
  assert.equal(asking.state, 'needs-input');
  assert.equal(asking.needsInputReason, 'trust');
  assert.equal(asking.stateSince, T0 + 10);
  for (const state of ['idle', 'working'] as const) {
    const s = session({ state });
    assert.equal(reduce(s, shown), s, `shown moves nothing from ${state}`);
  }
  const permission = session({ state: 'needs-input', needsInputReason: 'permission' });
  assert.equal(reduce(permission, shown), permission, 'shown leaves a permission ask alone');
  assert.equal(reduce(permission, gone), permission, 'gone leaves a permission ask alone');
  const back = reduce(asking, gone);
  assert.equal(back.state, 'starting');
  assert.equal(back.needsInputReason, null);
  const started = reduce(asking, { type: 'hook', payload: { hook_event_name: 'SessionStart', session_id: '11111111-2222-3333-4444-555555555555', cwd: 'C:\\repo', source: 'startup' }, at: T0 + 30 });
  assert.equal(started.state, 'idle');
  assert.equal(started.needsInputReason, null);
  const exited = reduce(asking, { type: 'pty.exit', exitCode: 0, at: T0 + 40 });
  assert.equal(exited.state, 'exited');
  assert.equal(exited.needsInputReason, null);
});

test('the first SessionStart binds claudeSessionId and later ones do not rebind', () => {
  const unbound = session({ claudeSessionId: null, state: 'starting' });
  const bound = reduce(unbound, hook('SessionStart', { source: 'startup', session_id: 'first' }));
  assert.equal(bound.claudeSessionId, 'first');
  assert.equal(bound.state, 'idle');
  const again = reduce(bound, hook('SessionStart', { source: 'clear', session_id: 'first' }));
  assert.equal(again.claudeSessionId, 'first');
  // A SessionStart under another id with the conversation still open is
  // a nested claude's and stays dropped (M9 fix 185 accepts one after a
  // SessionEnd alone).
  assert.equal(classifyHook(bound, { hook_event_name: 'SessionStart', session_id: 'nested', source: 'startup' }), 'ignored-foreign');
  assert.equal(reduce(bound, hook('SessionStart', { source: 'startup', session_id: 'nested' })).claudeSessionId, 'first');
  // A compact binds too if somehow first, since it still names our session.
  const viaCompact = reduce(unbound, hook('SessionStart', { source: 'compact', session_id: 'c' }));
  assert.equal(viaCompact.claudeSessionId, 'c');
  assert.equal(viaCompact.state, 'starting');
});

// M9 fix 185: what Claude Code 2.1.272 posts for a /clear, read off a
// real one: SessionEnd reason=clear on the old id, then SessionStart
// source=clear on a new id with a new transcript.
test('spans: a /clear closes the conversation span and opens the next under the new id (M9 fix 185)', () => {
  const unbound = session({ claudeSessionId: null, state: 'starting', spans: [] });
  const first = reduce(unbound, hook('SessionStart', { source: 'startup', session_id: 'first', transcript_path: 'C:\\t\\first.jsonl' }, T0 + 10));
  assert.deepEqual(first.spans, [{ conversation: 'first', remoteSessionId: null, startedAt: T0 + 10, endedAt: null, startHead: null }]);
  const ended = reduce(first, hook('SessionEnd', { reason: 'clear', session_id: 'first', transcript_path: 'C:\\t\\first.jsonl' }, T0 + 500));
  assert.deepEqual(ended.spans, [{ conversation: 'first', remoteSessionId: null, startedAt: T0 + 10, endedAt: T0 + 500, startHead: null }]);
  assert.equal(ended.claudeSessionId, 'first', 'a Claude session keeps its id at the end');
  const start = { hook_event_name: 'SessionStart', session_id: 'second', source: 'clear', cwd: 'C:\\repo', transcript_path: 'C:\\t\\second.jsonl' };
  assert.equal(classifyHook(ended, start), 'applied', 'the first SessionStart after a SessionEnd is the pane\'s own, whatever its id');
  const second = reduce(ended, { type: 'hook', at: T0 + 600, payload: start });
  assert.equal(second.claudeSessionId, 'second', 'rebound to the new conversation');
  assert.equal(second.conversation?.id, 'second');
  assert.equal(second.transcriptPath, 'C:\\t\\second.jsonl');
  assert.equal(second.state, 'idle');
  assert.deepEqual(second.spans, [
    { conversation: 'first', remoteSessionId: null, startedAt: T0 + 10, endedAt: T0 + 500, startHead: null },
    { conversation: 'second', remoteSessionId: null, startedAt: T0 + 600, endedAt: null, startHead: null },
  ]);
  // Every later hook of the new conversation lands.
  assert.equal(reduce(second, hook('UserPromptSubmit', { session_id: 'second', prompt: 'go' }, T0 + 700)).state, 'working');
  // A compact never touches the list.
  assert.equal(reduce(second, hook('SessionStart', { source: 'compact', session_id: 'second' }, T0 + 800)).spans, second.spans);
  // The same conversation reporting in again (a resume after a restart)
  // reopens its closed span rather than adding one.
  const exited = reduce(second, { type: 'pty.exit', exitCode: 0, at: T0 + 900 });
  assert.equal(exited.spans?.at(-1)?.endedAt, T0 + 900, 'the process going closes the open span');
  const resumed = reduce({ ...exited, state: 'starting' }, hook('SessionStart', { source: 'resume', session_id: 'second' }, T0 + 1000));
  assert.deepEqual(resumed.spans?.map((x) => [x.conversation, x.endedAt]), [['first', T0 + 500], ['second', null]]);
});

test('spans: a record from before the field reads as one span off its own fields, and a shell that ran claude twice has two (M9 fix 185)', () => {
  const before = session({ claudeSessionId: 'old', remoteSessionId: 'session_r', startHead: 'h'.repeat(40), createdAt: T0 - 100 });
  assert.equal(before.spans, undefined);
  const ended = reduce(before, hook('SessionEnd', { reason: 'clear', session_id: 'old' }, T0 + 5));
  assert.deepEqual(ended.spans, [{ conversation: 'old', remoteSessionId: 'session_r', startedAt: T0 - 100, endedAt: T0 + 5, startHead: 'h'.repeat(40) }]);
  const cleared = reduce(ended, hook('SessionStart', { source: 'clear', session_id: 'new' }, T0 + 6));
  assert.equal(cleared.spans?.length, 2);
  assert.equal(cleared.claudeSessionId, 'new');
  // A shell: claude, exit, claude again is two spans too, the shell's
  // own unbinding in between.
  const shell = session({ kind: 'shell', claudeSessionId: null, spans: [] });
  const one = reduce(shell, hook('SessionStart', { source: 'startup', session_id: 'a' }, T0 + 1));
  const left = reduce(one, hook('SessionEnd', { reason: 'prompt_input_exit', session_id: 'a' }, T0 + 2));
  assert.equal(left.claudeSessionId, null);
  assert.equal(left.spans?.[0]?.endedAt, T0 + 2);
  const two = reduce(left, hook('SessionStart', { source: 'startup', session_id: 'b' }, T0 + 3));
  assert.deepEqual(two.spans?.map((x) => x.conversation), ['a', 'b']);
  const backToB = reduce(reduce(two, hook('SessionEnd', { session_id: 'b' }, T0 + 4)), hook('SessionStart', { source: 'resume', session_id: 'b' }, T0 + 5));
  assert.deepEqual(backToB.spans?.map((x) => [x.conversation, x.endedAt]), [['a', T0 + 2], ['b', null]], 'the same conversation resumed reopens its span');
});

// M9 fix 378: the spawn's record has no spans field and no id, and the
// first SessionStart binds the id before it opens the span, so the
// fallback used to see the id it was about to open and read the span as
// open since the shell's creation. A shell opened at T0 whose person
// types claude two hours on gets a first span from that SessionStart.
test('spans: a fresh shell record with no spans opens its first span at the SessionStart, not at its creation (M9 fix 378)', () => {
  const HOUR = 3_600_000;
  const shell = session({ kind: 'shell', claudeSessionId: null, createdAt: T0, startHead: 's'.repeat(40) });
  assert.equal(shell.spans, undefined);
  const bound = reduce(shell, hook('SessionStart', { source: 'startup', session_id: 'late' }, T0 + 2 * HOUR));
  assert.equal(bound.claudeSessionId, 'late');
  assert.deepEqual(bound.spans, [{ conversation: 'late', remoteSessionId: null, startedAt: T0 + 2 * HOUR, endedAt: null, startHead: null }], 'the span starts at the hook and its head is left for the daemon to read');
  assert.equal(bound.startHead, 's'.repeat(40), 'the record keeps the shell\'s own start commit');
  // A Claude session's record is the same shape and reads the same way.
  const claude = session({ claudeSessionId: null, state: 'starting', createdAt: T0 });
  assert.equal(claude.spans, undefined);
  assert.deepEqual(reduce(claude, hook('SessionStart', { source: 'startup', session_id: 'c' }, T0 + 5)).spans?.map((x) => x.startedAt), [T0 + 5]);
  // A record from before the field with its id already bound (a file
  // written before M9 fix 185, read back) still reads as one open span
  // since its creation, and the same conversation reporting in again
  // keeps it.
  const legacy = session({ claudeSessionId: 'old', remoteSessionId: null, createdAt: T0 - 100, startHead: 'h'.repeat(40) });
  assert.equal(legacy.spans, undefined);
  const resumed = reduce(legacy, hook('SessionStart', { source: 'resume', session_id: 'old' }, T0 + 7));
  assert.deepEqual(resumed.spans, [{ conversation: 'old', remoteSessionId: null, startedAt: T0 - 100, endedAt: null, startHead: 'h'.repeat(40) }]);
});

test('events carrying agent_id are ignored entirely', () => {
  const before = session({ state: 'working', lastEventAt: T0 + 1 });
  const after = reduce(before, hook('Stop', { agent_id: 'agent-7' }));
  assert.equal(after, before, 'same object back: nothing to broadcast');
  assert.equal(classifyHook(before, { hook_event_name: 'Stop', session_id: BOUND, agent_id: 'x' }), 'ignored-agent');
  // An empty agent_id is not a subagent marker.
  assert.equal(reduce(before, hook('Stop', { agent_id: '' })).state, 'done');
});

// The hooks a real turn produces (M46), in the order the log shows them:
// the Agent tool's PostToolUse lands before the SubagentStart it names.
const AGENT_TOOL = { tool_name: 'Agent', tool_input: { description: 'Verify the history panel', subagent_type: 'Explore' }, tool_response: { agentId: 'a1', description: 'Verify the history panel', status: 'async_launched' } };

test('team: a SubagentStart then its SubagentStop is one returned member, and the parent does not move', () => {
  const before = session({ state: 'working', stateSince: T0 });
  const started = reduce(before, hook('SubagentStart', { agent_id: 'a1', agent_type: 'fork' }, T0 + 10));
  assert.equal(started.state, 'working');
  assert.equal(started.stateSince, T0, 'no transition');
  assert.equal(started.lastEventAt, T0 + 10, 'still a sign of life');
  assert.deepEqual(started.team, [{ id: 'a1', kind: 'agent', type: 'fork', description: null, command: null, startedAt: T0 + 10, endedAt: null, outcome: 'running', cwd: null, branch: null, commits: [], activity: null }]);
  assert.equal(reduce(started, hook('SubagentStart', { agent_id: 'a1', agent_type: 'fork' }, T0 + 11)).team, started.team, 'the same start again changes nothing');
  const stopped = reduce(started, hook('SubagentStop', { agent_id: 'a1', agent_type: 'fork' }, T0 + 40));
  assert.deepEqual(stopped.team, [{ ...started.team[0]!, endedAt: T0 + 40, outcome: 'returned' }]);
  assert.equal(stopped.state, 'working');
  // A stop for an id nobody started (an inner agent) is nothing.
  assert.equal(reduce(stopped, hook('SubagentStop', { agent_id: 'inner', agent_type: '' }, T0 + 41)).team, stopped.team);
  assert.equal(classifyHook(before, { hook_event_name: 'SubagentStart', session_id: BOUND, agent_id: 'a1' }), 'applied');
  // Every other hook fired inside the subagent is still dropped, except a
  // known member's own Bash and PowerShell calls (M61, fix 106), which the daemon reads for the
  // member's folder and commits and the reducer never sees.
  assert.equal(classifyHook(before, { hook_event_name: 'PreToolUse', session_id: BOUND, agent_id: 'a1' }), 'ignored-agent');
  assert.equal(classifyHook(started, { hook_event_name: 'PreToolUse', session_id: BOUND, agent_id: 'a1', tool_name: 'Bash' }), 'applied-agent');
  assert.equal(classifyHook(started, { hook_event_name: 'PostToolUse', session_id: BOUND, agent_id: 'a1', tool_name: 'Bash' }), 'applied-agent');
  assert.equal(classifyHook(started, { hook_event_name: 'PostToolUseFailure', session_id: BOUND, agent_id: 'a1', tool_name: 'Bash' }), 'applied-agent');
  assert.equal(classifyHook(started, { hook_event_name: 'PostToolUse', session_id: BOUND, agent_id: 'a1', tool_name: 'PowerShell' }), 'applied-agent', 'the PowerShell tool moves HEAD too (M9 fix 106)');
  assert.equal(classifyHook(started, { hook_event_name: 'PostToolUse', session_id: BOUND, agent_id: 'a1', tool_name: 'Read' }), 'ignored-agent', 'only the command tools');
  // M9 fix 394: and the member's own two task tools, which the reducer
  // reads for the agentId the task files cannot carry. TodoWrite is not
  // among them: it would replace the parent's list whole.
  assert.equal(classifyHook(started, { hook_event_name: 'PostToolUse', session_id: BOUND, agent_id: 'a1', tool_name: 'TaskCreate' }), 'applied-agent');
  assert.equal(classifyHook(started, { hook_event_name: 'PostToolUse', session_id: BOUND, agent_id: 'a1', tool_name: 'TaskUpdate' }), 'applied-agent');
  assert.equal(classifyHook(started, { hook_event_name: 'PostToolUse', session_id: BOUND, agent_id: 'a1', tool_name: 'TodoWrite' }), 'ignored-agent', "a member does not replace its parent's list");
  assert.equal(classifyHook(started, { hook_event_name: 'PostToolUse', session_id: BOUND, agent_id: 'inner', tool_name: 'Bash' }), 'ignored-agent', 'an agent nobody started');
  assert.equal(classifyHook(started, { hook_event_name: 'Stop', session_id: BOUND, agent_id: 'a1' }), 'ignored-agent', 'not a tool hook');
  assert.equal(classifyHook(started, { hook_event_name: 'PostToolUse', session_id: 'other', agent_id: 'a1', tool_name: 'Bash' }), 'ignored-agent', 'a foreign conversation');
});

test('team: the Agent tool binds the description by id, before or after the start', () => {
  const working = session({ state: 'working' });
  const posted = reduce(working, hook('PostToolUse', AGENT_TOOL, T0 + 5));
  assert.equal(posted.state, 'working');
  assert.deepEqual(posted.team, [{ id: 'a1', kind: 'agent', type: 'Explore', description: 'Verify the history panel', command: null, startedAt: T0 + 5, endedAt: null, outcome: 'running', cwd: null, branch: null, commits: [], activity: null }]);
  const started = reduce(posted, hook('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }, T0 + 6));
  assert.equal(started.team, posted.team, 'the start after the post adds nothing');
  // The other order: the start first, the post fills the words in.
  const first = reduce(working, hook('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }, T0 + 5));
  const filled = reduce(first, hook('PostToolUse', AGENT_TOOL, T0 + 6));
  assert.deepEqual(filled.team, [{ ...first.team[0]!, type: 'Explore', description: 'Verify the history panel' }]);
  // A PostToolUse of another tool, or one without an agent id, is no member.
  assert.deepEqual(reduce(working, hook('PostToolUse', { tool_name: 'Bash', tool_response: { agentId: 'x' } })).team, []);
  assert.deepEqual(reduce(working, hook('PostToolUse', { tool_name: 'Agent', tool_response: { status: 'done' } })).team, []);
});

test('team: a Stop with a running subagent and a running shell gives waiting (2) and two members, and the next Stop returns what it leaves out', () => {
  const working = reduce(session({ state: 'working' }), hook('SubagentStart', { agent_id: 'a1', agent_type: 'fork' }, T0 + 5));
  const tasks = [
    { id: 'a1', type: 'subagent', status: 'running', description: 'Build M46' },
    { id: 's1', type: 'shell', status: 'running', description: 'the verify run', command: 'npm run verify:m9\nsecond line' },
    { id: 's0', type: 'shell', status: 'completed', command: 'npm test' },
  ];
  const paused = reduce(working, hook('Stop', { background_tasks: tasks }, T0 + 20));
  assert.equal(paused.state, 'waiting');
  assert.equal(paused.waitingOn.length, 2);
  assert.deepEqual(paused.team.map((m) => [m.id, m.kind, m.outcome, m.description, m.command]), [
    ['a1', 'agent', 'running', 'Build M46', null],
    ['s1', 'shell', 'running', 'the verify run', 'npm run verify:m9'],
  ]);
  assert.equal(paused.team[0]!.type, 'fork', 'the start named the type');
  assert.equal(reduce(paused, hook('Stop', { background_tasks: tasks }, T0 + 21)).team, paused.team, 'the same Stop again keeps the team');
  // The shell finished: the next Stop no longer lists it.
  const woken = reduce(paused, hook('UserPromptSubmit', { prompt: '<task-notification> shell s1 done' }, T0 + 30));
  assert.equal(woken.team, paused.team, 'a task notification keeps the team');
  const again = reduce(woken, hook('Stop', { background_tasks: [tasks[0]] }, T0 + 40));
  assert.equal(again.state, 'waiting');
  assert.deepEqual(again.team.map((m) => [m.id, m.outcome, m.endedAt]), [['a1', 'running', null], ['s1', 'returned', T0 + 40]]);
  // Everything back: done, and the members stay as returned until a person types.
  const done = reduce(reduce(again, hook('UserPromptSubmit', { prompt: '<task-notification> agent a1 done' }, T0 + 50)), hook('Stop', { background_tasks: [] }, T0 + 60));
  assert.equal(done.state, 'done');
  assert.deepEqual(done.team.map((m) => m.outcome), ['returned', 'returned']);
  assert.equal(done.waitingOn.length, 0);
  const typed = reduce(done, hook('UserPromptSubmit', { prompt: 'now the docs' }, T0 + 70));
  assert.deepEqual(typed.team, [], 'a typed prompt clears the returned members');
  assert.equal(reduce(typed, hook('UserPromptSubmit', { prompt: 'again' }, T0 + 71)).team, typed.team, 'nothing to drop keeps the array');
});

test('team: a new conversation, a SessionEnd and an exit clear it; a state change alone does not', () => {
  const running = reduce(session({ state: 'working' }), hook('SubagentStart', { agent_id: 'a1', agent_type: 'fork' }));
  assert.equal(running.team.length, 1);
  assert.deepEqual(reduce(running, hook('SessionEnd')).team, []);
  assert.deepEqual(reduce(running, { type: 'pty.exit', exitCode: 0, at: T0 + 9 }).team, []);
  assert.deepEqual(reduce(running, hook('SessionStart', { source: 'clear' })).team, []);
  assert.equal(reduce(running, hook('SessionStart', { source: 'compact' })).team, running.team, 'a compact is the same conversation');
  assert.equal(reduce(running, hook('PermissionRequest')).team, running.team);
  assert.equal(reduce(running, hook('Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'running' }] })).team, running.team, 'listed as still running, unchanged');
  assert.equal(reduce(running, { type: 'ack', at: T0 + 9 }).team, running.team);
});

test("team (M9 fix 138): a dropped member's commits fold into the session's list with the agent on them, a hash the session holds takes the agent on its entry, and the live team keeps its own", () => {
  const h = (ch: string) => ch.repeat(40);
  const commits = [{ hash: h('a'), at: T0 + 1 }, { hash: h('b'), at: T0 + 2 }];
  let s = reduce(session({ state: 'working', commits: [{ hash: h('0'), at: T0 }, { hash: h('b'), at: T0 + 3 }] }), hook('SubagentStart', { agent_id: 'a1', agent_type: 'fork' }));
  s = reduce(s, hook('SubagentStart', { agent_id: 'a2', agent_type: 'fork' }));
  s = { ...s, team: s.team.map((m) => (m.id === 'a1' ? { ...m, branch: 'wt', description: 'the lane', commits } : { ...m, commits: [{ hash: h('c'), at: T0 + 4 }] })) };
  const agent = { id: 'a1', branch: 'wt', type: 'fork', description: 'the lane' };
  // a1 returns and the next prompt drops it: a folds in by time, b takes
  // the agent on the entry the session has, a2 still out keeps c to itself.
  const returned = reduce(s, hook('SubagentStop', { agent_id: 'a1', agent_type: 'fork' }));
  const prompted = reduce(returned, hook('UserPromptSubmit', { prompt: 'next' }));
  assert.deepEqual(prompted.team.map((m) => m.id), ['a2']);
  assert.deepEqual(prompted.commits, [{ hash: h('0'), at: T0 }, { hash: h('a'), at: T0 + 1, agent }, { hash: h('b'), at: T0 + 3, agent }]);
  // A task notification drops nobody, so nothing folds yet.
  assert.equal(reduce(returned, hook('UserPromptSubmit', { prompt: '<task-notification>done</task-notification>' })).commits, returned.commits);
  // SessionEnd clears the whole team: a2's commit folds too, the shell member's nothing.
  const withShell = reduce(prompted, hook('SubagentStart', { agent_id: 'sh', agent_type: 'shell' }));
  const ended = reduce({ ...withShell, team: withShell.team.map((m) => (m.id === 'sh' ? { ...m, kind: 'shell' as const, commits: [{ hash: h('d'), at: T0 + 5 }] } : m)) }, hook('SessionEnd'));
  assert.deepEqual(ended.team, []);
  assert.deepEqual(ended.commits.map((c) => [c.hash[0], c.agent?.id ?? null]), [['0', null], ['a', 'a1'], ['b', 'a1'], ['c', 'a2']]);
  // A member with no commits leaves the list as it was.
  const bare = reduce(reduce(session({ state: 'working' }), hook('SubagentStart', { agent_id: 'a3', agent_type: 'fork' })), hook('SessionEnd'));
  assert.deepEqual(bare.commits, []);
});

test('events from a different session_id are ignored once bound', () => {
  const before = session({ state: 'working' });
  assert.equal(reduce(before, hook('Stop', { session_id: 'nested-claude-p' })), before);
  assert.equal(reduce(before, hook('SessionStart', { source: 'startup', session_id: 'nested' })), before);
  assert.equal(classifyHook(before, { hook_event_name: 'Stop', session_id: 'other' }), 'ignored-foreign');
  // Not yet bound: any session_id is accepted but only SessionStart binds.
  const unbound = session({ claudeSessionId: null });
  const after = reduce(unbound, hook('UserPromptSubmit', { session_id: 'whoever' }));
  assert.equal(after.state, 'working');
  assert.equal(after.claudeSessionId, null);
});

test('stateSince only moves on a real state change', () => {
  const working = session({ state: 'working', stateSince: T0 });
  const stillWorking = reduce(working, hook('PreToolUse', {}, T0 + 60_000));
  assert.equal(stillWorking.state, 'working');
  assert.equal(stillWorking.stateSince, T0);
  assert.equal(stillWorking.lastEventAt, T0 + 60_000);
  // Same state, different reason: the clock keeps running from the first block.
  const blocked = reduce(working, hook('PermissionRequest', {}, T0 + 1000));
  const reBlocked = reduce(blocked, hook('Notification', { notification_type: 'agent_needs_input' }, T0 + 9000));
  assert.equal(reBlocked.stateSince, T0 + 1000);
  assert.equal(reBlocked.needsInputReason, 'question');
});

test('needs-input is cleared by the next working event', () => {
  const blocked = reduce(session({ state: 'working' }), hook('PermissionRequest'));
  assert.equal(blocked.needsInputReason, 'permission');
  const resumed = reduce(blocked, hook('PostToolUse'));
  assert.equal(resumed.state, 'working');
  assert.equal(resumed.needsInputReason, null);
});

test('StopFailure records error_type and the next prompt clears it', () => {
  const failed = reduce(session({ state: 'working' }), hook('StopFailure', { error_type: 'server_error' }));
  assert.equal(failed.state, 'errored');
  assert.equal(failed.errorType, 'server_error');
  assert.equal(reduce(session({ state: 'working' }), hook('StopFailure')).errorType, 'unknown');
  const retried = reduce(failed, hook('UserPromptSubmit'));
  assert.equal(retried.state, 'working');
  assert.equal(retried.errorType, null);
});

test('CwdChanged renames a session nobody named, and leaves a chosen name alone', () => {
  const followed = reduce(session({ state: 'working' }), hook('CwdChanged', { cwd: 'C:/work/elsewhere', previous_cwd: 'C:\\repo' }));
  assert.equal(followed.name, 'elsewhere', 'forward slashes from the hook are fine');
  const named = reduce(session({ name: 'mine', autoName: false }), hook('CwdChanged', { cwd: 'C:\\elsewhere' }));
  assert.equal(named.name, 'mine');
  assert.equal(named.cwd, 'C:\\elsewhere');
  // A drive root has no folder name; the old one stays rather than going blank.
  assert.equal(reduce(session(), hook('CwdChanged', { cwd: 'D:\\' })).name, 'repo');
});

test("any hook of the session's own moves it to the cwd it reports (M9 fix 113), a member's or a foreign one does not", () => {
  const moved = reduce(session({ state: 'working' }), hook('PreToolUse', { cwd: 'C:\\logs', tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.equal(moved.cwd, 'C:\\logs', 'a tool call in another folder places the session there');
  assert.equal(moved.groupCwd, 'C:\\repo', 'a Claude session keeps its heading');
  const back = reduce(moved, hook('PostToolUse', { cwd: 'C:\\repo', tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.equal(back.cwd, 'C:\\repo', 'and the next hook brings it back with no CwdChanged in between');
  const agent = reduce(session({ state: 'working' }), hook('PreToolUse', { cwd: 'C:\\worktree', agent_id: 'ag-1', tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.equal(agent.cwd, 'C:\\repo', "a subagent's hook says where the agent is, not the session");
  const foreign = reduce(session({ state: 'working' }), hook('PreToolUse', { cwd: 'C:\\other', session_id: 'someone-else' }));
  assert.equal(foreign.cwd, 'C:\\repo', 'a foreign hook is ignored whole');
  const unbound = reduce(session({ kind: 'shell', claudeSessionId: null, state: 'idle' }), hook('PreToolUse', { cwd: 'C:\\sim', tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.equal(unbound.cwd, 'C:\\repo', "a shell nothing has bound keeps its prompt's folder");
  const bound = reduce(reduce(session({ kind: 'shell', claudeSessionId: null, state: 'idle' }), hook('SessionStart', { source: 'startup' })), hook('PreToolUse', { cwd: 'C:\\sim', tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.equal(bound.cwd, 'C:\\sim', 'and follows once SessionStart has bound it');
});

test('CwdChanged updates cwd without touching state', () => {
  const after = reduce(session({ state: 'working' }), hook('CwdChanged', { cwd: 'C:\\elsewhere', previous_cwd: 'C:\\repo' }));
  assert.equal(after.cwd, 'C:\\elsewhere');
  assert.equal(after.state, 'working');
  const noDir = reduce(session(), hook('CwdChanged', { cwd: '' }));
  assert.equal(noDir.cwd, 'C:\\repo');
});

test('pty.exit always wins and records the exit code', () => {
  const blocked = session({ state: 'needs-input', needsInputReason: 'permission', stale: true });
  const after = reduce(blocked, { type: 'pty.exit', exitCode: 1, at: T0 + 10 });
  assert.equal(after.state, 'exited');
  assert.equal(after.exitCode, 1);
  assert.equal(after.pid, null);
  assert.equal(after.stale, false);
  assert.equal(after.needsInputReason, null);
});

test('a hook after the exit does not revive the session (M9 fix 174)', () => {
  const gone = reduce(session({ state: 'idle', pid: 4242 }), { type: 'pty.exit', exitCode: 1, at: T0 + 10 });
  assert.equal(gone.state, 'exited');
  const late = reduce(gone, hook('SessionEnd', {}, T0 + 12));
  assert.equal(late.state, 'exited');
  assert.equal(late.stateSince, gone.stateSince);
  assert.equal(late.pid, null);
  assert.equal(late.lastEventAt, T0 + 12);
  const stop = reduce(gone, hook('Stop', {}, T0 + 12));
  assert.equal(stop.state, 'exited');
  // A shell's SessionEnd still unbinds the Claude that ran in it (the
  // hook's own session id is the bound one, as classifyHook wants).
  const shell = reduce(session({ kind: 'shell', state: 'working', claudeSessionId: 'c1' }), { type: 'pty.exit', exitCode: 0, at: T0 + 10 });
  const unbound = reduce(shell, hook('SessionEnd', { session_id: 'c1' }, T0 + 12));
  assert.equal(unbound.state, 'exited');
  assert.equal(unbound.claudeSessionId, null);
});

test('a hook after the exit puts no team, pause list or ask back on the row (M9 fix 506)', () => {
  const gone = reduce(session({ state: 'working', pid: 4242 }), { type: 'pty.exit', exitCode: 1, at: T0 + 10 });
  const late: [string, SessionEvent][] = [
    ['an Agent PostToolUse', hook('PostToolUse', { tool_name: 'Agent', tool_input: { description: 'M30' }, tool_response: { agentId: 'a1' } }, T0 + 20)],
    ['a SubagentStart', hook('SubagentStart', { agent_id: 'a1' }, T0 + 21)],
    ['a Stop with a running subagent', hook('Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'M30' }] }, T0 + 22)],
    ['a PermissionRequest', hook('PermissionRequest', { tool_name: 'Bash' }, T0 + 23)],
  ];
  for (const [label, event] of late) {
    const after = reduce(gone, event);
    assert.equal(after.state, 'exited', label);
    assert.deepEqual(after.team, [], `${label} adds no member`);
    assert.deepEqual(after.waitingOn, [], `${label} sets no pause list`);
    assert.equal(after.needsInputReason, null, `${label} sets no ask`);
    assert.equal(after.lastEventAt, event.at, `${label} still moves lastEventAt`);
  }
});

test('a task notification is not the prompt: it keeps lastPrompt, clears the reply and goes working', () => {
  const answered = reduce(reduce(session(), hook('UserPromptSubmit', { prompt: 'build M30' })), hook('Stop', { last_assistant_message: 'Agent 5 is done.' }));
  const woken = reduce(answered, hook('UserPromptSubmit', { prompt: '  <task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>' }));
  assert.equal(woken.state, 'working');
  assert.equal(woken.lastPrompt, 'build M30', 'the ask stays');
  assert.equal(woken.lastReply, null, 'the reply to it is on its way');
  assert.equal(woken.errorType, null);
  // Only the tag at the start counts; a person quoting it mid-prompt is a prompt.
  const quoted = reduce(woken, hook('UserPromptSubmit', { prompt: 'why does <task-notification> show on my row' }));
  assert.equal(quoted.lastPrompt, 'why does <task-notification> show on my row');
});

test('a Stop takes the reply whether it ends waiting or done', () => {
  const running = [{ id: 'a1', type: 'subagent', status: 'running' }];
  const paused = reduce(session({ state: 'working' }), hook('Stop', { last_assistant_message: 'Agent 5 is done, waiting on 1 to 4.', background_tasks: running }));
  assert.equal(paused.state, 'waiting');
  assert.equal(paused.lastReply, 'Agent 5 is done, waiting on 1 to 4.');
  // The next Stop decides again: with nothing running it is a real finish.
  const finished = reduce(reduce(paused, hook('UserPromptSubmit', { prompt: '<task-notification> agent 4 done' })), hook('Stop', { last_assistant_message: 'All done.', background_tasks: [] }));
  assert.equal(finished.state, 'done');
  assert.equal(finished.lastReply, 'All done.');
});

test('a waiting session keeps the running tasks the Stop listed, and the next turn drops them', () => {
  const longCommand = 'until grep -q EXIT log; do sleep 5; done' + ' # ' + 'x'.repeat(200) + '\nsecond line';
  const tasks = [
    { id: 'a1', type: 'subagent', status: 'running', description: 'Verify the history panel' },
    { id: 's1', type: 'shell', status: 'completed', description: 'done already', command: 'npm test' },
    { id: 's2', type: 'shell', status: 'running', description: '  ', command: longCommand },
  ];
  const paused = reduce(session({ state: 'working' }), hook('Stop', { last_assistant_message: 'Waiting.', background_tasks: tasks }));
  assert.equal(paused.state, 'waiting');
  assert.equal(paused.waitingOn.length, 2, 'only the running entries');
  assert.deepEqual(paused.waitingOn[0], { type: 'subagent', description: 'Verify the history panel', command: null });
  assert.equal(paused.waitingOn[1]!.type, 'shell');
  assert.equal(paused.waitingOn[1]!.description, null, 'a blank description is none');
  const command = paused.waitingOn[1]!.command!;
  assert.ok(command.startsWith('until grep -q EXIT log; do sleep 5; done'), 'the first line of the command');
  assert.ok(!command.includes('second line') && command.length === 120 && command.endsWith('…'), `cut to a line, got ${command.length}`);
  // The same Stop again says the same thing and keeps the same list.
  assert.equal(reduce(paused, hook('Stop', { last_assistant_message: 'Waiting.', background_tasks: tasks })).waitingOn, paused.waitingOn);
  // A second pause replaces the list rather than adding to it.
  const again = reduce(paused, hook('Stop', { background_tasks: [{ id: 'a9', type: 'subagent', status: 'running', description: 'Another' }] }));
  assert.deepEqual(again.waitingOn, [{ type: 'subagent', description: 'Another', command: null }]);
  // The tasks go with the state: a new turn, a plain finish and an exit have none.
  const working = reduce(paused, hook('UserPromptSubmit', { prompt: '<task-notification> agent 1 done' }));
  assert.equal(working.state, 'working');
  assert.deepEqual(working.waitingOn, []);
  const finished = reduce(working, hook('Stop', { last_assistant_message: 'All done.', background_tasks: [] }));
  assert.equal(finished.state, 'done');
  assert.deepEqual(finished.waitingOn, []);
  assert.deepEqual(reduce(paused, { type: 'pty.exit', exitCode: 0, at: T0 + 1 }).waitingOn, []);
  // An entry with no type is a task; a missing list is none, as before.
  assert.deepEqual(reduce(session({ state: 'working' }), hook('Stop', { background_tasks: [{ id: 'q', status: 'running' }] })).waitingOn, [{ type: 'task', description: null, command: null }]);
  assert.equal(reduce(session({ state: 'working' }), hook('Stop', {})).state, 'done');
});

test('ack moves done to idle and nothing else', () => {
  const done = session({ state: 'done', stateSince: T0 });
  const acked = reduce(done, { type: 'ack', at: T0 + 7 });
  assert.equal(acked.state, 'idle');
  assert.equal(acked.stateSince, T0 + 7);
  for (const from of ALL_STATES.filter((s) => s !== 'done')) {
    const s = session({ state: from });
    assert.equal(reduce(s, { type: 'ack', at: T0 + 7 }), s, `ack from ${from}`);
  }
});

test('stale-check flags a quiet working session and the next hook clears it', () => {
  const working = session({ state: 'working', stateSince: T0, lastEventAt: T0 });
  const check = (at: number): SessionEvent => ({ type: 'stale-check', at, staleAfterMs: 600_000 });
  assert.equal(reduce(working, check(T0 + 599_999)), working, 'not yet');
  const stale = reduce(working, check(T0 + 600_000));
  assert.equal(stale.stale, true);
  assert.equal(stale.state, 'working');
  assert.equal(stale.stateSince, T0);
  // The threshold it tripped rides with the flag (M9 fix 232), so the
  // badge and emmer explain can name it, and goes with it.
  assert.equal(stale.staleThresholdMs, 600_000);
  assert.equal(reduce(stale, check(T0 + 700_000)), stale, 'already flagged, nothing new');
  const refreshed = reduce(stale, hook('PostToolUse', {}, T0 + 700_000));
  assert.equal(refreshed.stale, false);
  assert.equal(refreshed.staleThresholdMs, null);
  // Only working sessions go stale; a blocked one is waiting on the user, not on Claude.
  for (const from of ALL_STATES.filter((s) => s !== 'working')) {
    const s = session({ state: from, lastEventAt: T0 });
    assert.equal(reduce(s, check(T0 + 900_000)), s, `stale-check from ${from}`);
  }
  // No hook yet at all: measure from when work started.
  const fresh = session({ state: 'working', stateSince: T0 + 100, lastEventAt: null });
  assert.equal(reduce(fresh, check(T0 + 600_099)).stale, false);
  assert.equal(reduce(fresh, check(T0 + 600_100)).stale, true);
});

test("a known member's hook refreshes the parent's stale clock (M9 fix 507)", () => {
  const check = (at: number): SessionEvent => ({ type: 'stale-check', at, staleAfterMs: 600_000 });
  const parent = reduce(session({ state: 'working', stateSince: T0, lastEventAt: T0 }), hook('SubagentStart', { agent_id: 'a1' }, T0));
  assert.equal(parent.team.length, 1);
  const heard = reduce(parent, hook('PostToolUse', { agent_id: 'a1', tool_name: 'Read' }, T0 + 540_000));
  assert.equal(heard.teamEventAt, T0 + 540_000);
  assert.equal(heard.lastEventAt, T0, "the session's own clock stays");
  assert.equal(reduce(heard, check(T0 + 700_000)).stale, false, 'the member spoke 160 s ago');
  assert.equal(reduce(heard, check(T0 + 1_140_000)).stale, true, "ten minutes after the member's last word");
  // A burst is one push a minute.
  assert.equal(reduce(heard, hook('PostToolUse', { agent_id: 'a1', tool_name: 'Read' }, T0 + 570_000)), heard);
  // An agent nobody started is not a member and moves nothing.
  assert.equal(reduce(heard, hook('PostToolUse', { agent_id: 'zz', tool_name: 'Read' }, T0 + 700_000)).teamEventAt, T0 + 540_000);
  // A member's hook clears a flag already up.
  const flagged = reduce(parent, check(T0 + 600_000));
  assert.equal(flagged.stale, true);
  const cleared = reduce(flagged, hook('PostToolUse', { agent_id: 'a1', tool_name: 'Read' }, T0 + 650_000));
  assert.equal(cleared.stale, false);
  assert.equal(cleared.staleThresholdMs, null);
});

test('a SessionStart binds only an id of the shape a conversation id has (M9 fix 508)', () => {
  for (const bad of ['x; Remove-Item ~', '..\\..\\x']) {
    const fresh = session({ kind: 'shell', claudeSessionId: null });
    const after = reduce(fresh, hook('SessionStart', { source: 'startup', session_id: bad }));
    assert.equal(after.claudeSessionId, null, bad);
    assert.equal(after.conversation, null, bad);
    assert.equal(after.spans, undefined, bad);
    assert.equal(after.state, 'idle', 'the rest of the SessionStart still applies');
  }
});

test('SessionStart places the session in its cwd and renames it while the name is automatic', () => {
  const shell = session({ kind: 'shell', name: 'Temp', cwd: 'C:\\Temp', spawnCwd: 'C:\\Temp', claudeSessionId: null });
  const started = reduce(shell, hook('SessionStart', { source: 'startup', cwd: 'C:\\code\\emerald' }));
  assert.equal(started.cwd, 'C:\\code\\emerald');
  assert.equal(started.name, 'emerald');
  assert.equal(started.state, 'idle');
  const named = reduce(session({ name: 'mine', autoName: false, cwd: 'C:\\Temp' }), hook('SessionStart', { source: 'startup', cwd: 'C:\\code\\emerald' }));
  assert.equal(named.cwd, 'C:\\code\\emerald', 'the folder moves');
  assert.equal(named.name, 'mine', 'a chosen name stays');
  // A compact reports the same cwd and changes nothing.
  const working = session({ state: 'working', cwd: 'C:\\repo' });
  assert.equal(reduce(working, hook('SessionStart', { source: 'compact', cwd: 'C:\\repo' })).cwd, 'C:\\repo');
});

// M9 fix 34. The daemon sets `title` on the record and then sends the
// event, so the reducer reads the title off the session.
const titled = (s: SessionInfo, title: string | null): SessionInfo => reduce({ ...s, title }, { type: 'title', at: T0 + 10 });

test('a title names a session nobody named while a Claude is bound, and the titles before a name do not', () => {
  const unnamed = session();
  assert.equal(titled(unnamed, 'claude').name, 'repo', 'the bare process title');
  assert.equal(titled(unnamed, '✳ Claude Code').name, 'repo', 'the TUI before the conversation has a name');
  assert.equal(titled(unnamed, '✳ Session').name, 'repo', 'the name Claude gives a conversation with nothing to name (fix 55)');
  assert.equal(titled(unnamed, '').name, 'repo');
  const named = titled(unnamed, '◐ Git log hash');
  assert.equal(named.name, 'Git log hash', 'the glyph goes');
  const flipped = { ...named, title: '◑ Git log hash' };
  assert.equal(reduce(flipped, { type: 'title', at: T0 + 11 }), flipped, 'a glyph flip is identity, so the daemon does not save it');
  assert.equal(titled(named, '✳ Second name').name, 'Second name');
  // The empty title Claude writes on exit renames nothing; SessionEnd
  // puts the name back on the folder (M9 fix 74).
  assert.deepEqual(titled(named, null), { ...named, title: null }, 'a cleared title is left alone');
  assert.equal(reduce(named, hook('SessionEnd')).name, 'repo');
  const chosen = session({ name: 'mine', autoName: false });
  assert.equal(titled(chosen, '◐ Git log hash').name, 'mine', 'a chosen name holds');
  // A shell with no Claude bound sets titles of its own (a path, a program).
  const shell = session({ kind: 'shell', claudeSessionId: null, name: 'repo' });
  assert.equal(titled(shell, 'C:\\repo').name, 'repo');
  assert.equal(titled(shell, '◐ Git log hash').name, 'repo', 'not even one that looks like Claude');
  // A bound shell's own title, on the record until Claude writes one, has
  // no glyph and names nothing either.
  assert.equal(titled(unnamed, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe').name, 'repo');
  assert.equal(titled(unnamed, 'Windows PowerShell').name, 'repo');
});

test('SessionEnd puts an automatic name back on the folder, and SessionStart picks a title up', () => {
  const named = titled(session({ state: 'working' }), '◐ Git log hash');
  const left = reduce(named, hook('SessionEnd'));
  assert.equal(left.name, 'repo', 'a Claude session keeps its id but Claude has left');
  assert.equal(left.claudeSessionId, BOUND);
  const shell = titled(reduce(session({ kind: 'shell', claudeSessionId: null }), hook('SessionStart', { source: 'startup' })), '◐ Git log hash');
  assert.equal(shell.name, 'Git log hash');
  assert.equal(reduce(shell, hook('SessionEnd')).name, 'repo');
  // The title can name the conversation before the hook binds the id (a
  // resume in a shell); SessionStart recomputes.
  const early = session({ kind: 'shell', claudeSessionId: null, title: '✳ Git log hash' });
  assert.equal(early.name, 'repo');
  assert.equal(reduce(early, hook('SessionStart', { source: 'resume' })).name, 'Git log hash');
  // A chosen name survives all of it.
  const chosen = session({ name: 'mine', autoName: false, title: '◐ Git log hash' });
  assert.equal(reduce(chosen, hook('SessionEnd')).name, 'mine');
});

test('a folder change keeps a title name, and autoNameFor says null for a drive root', () => {
  const named = titled(session(), '◐ Git log hash');
  const moved = reduce(named, hook('CwdChanged', { cwd: 'C:\\elsewhere' }));
  assert.equal(moved.cwd, 'C:\\elsewhere');
  assert.equal(moved.name, 'Git log hash', 'the title still says more than the folder');
  assert.equal(autoNameFor({ cwd: 'D:\\', claudeSessionId: null, title: null }), null);
  assert.equal(autoNameFor({ cwd: 'D:\\', claudeSessionId: BOUND, title: '◐ Git log hash' }), 'Git log hash');
  assert.equal(autoNameFor({ cwd: 'C:\\repo', claudeSessionId: BOUND, title: '✳ Claude Code' }), 'repo');
  assert.equal(autoNameFor({ cwd: 'C:\\repo', claudeSessionId: BOUND, title: '✳ Session' }), 'repo', 'fix 55');
  assert.equal(autoNameFor({ cwd: 'C:\\repo', claudeSessionId: BOUND, title: '✳ Session notes' }), 'Session notes', 'only the bare word says nothing');
});

test('a cwd event from the shell prompt places the session without counting as a hook', () => {
  const shell = session({ kind: 'shell', name: 'Temp', cwd: 'C:\\Temp', spawnCwd: 'C:\\Temp', lastEventAt: null });
  const moved = reduce(shell, { type: 'cwd', cwd: 'C:\\code', at: T0 + 1 });
  assert.equal(moved.cwd, 'C:\\code');
  assert.equal(moved.name, 'code');
  assert.equal(moved.lastEventAt, null);
  assert.equal(moved.state, 'idle');
  assert.equal(reduce(moved, { type: 'cwd', cwd: 'C:\\code', at: T0 + 2 }), moved, 'the same folder again changes nothing');
});

test('the group folder follows a shell and stays where Claude started (M9 fix 60)', () => {
  // A plain shell's cd moves both.
  const shell = session({ kind: 'shell', cwd: 'C:\\Temp', groupCwd: 'C:\\Temp', spawnCwd: 'C:\\Temp', claudeSessionId: null });
  const moved = reduce(shell, { type: 'cwd', cwd: 'C:\\code', at: T0 + 1 });
  assert.equal(moved.groupCwd, 'C:\\code');
  // Claude starting in another folder places and groups the session there.
  const started = reduce(shell, hook('SessionStart', { source: 'startup', cwd: 'C:\\code\\emerald' }));
  assert.equal(started.groupCwd, 'C:\\code\\emerald');
  // A bound session that enters a worktree keeps its group, and the live
  // folder still moves; a claude kind with no id yet is a Claude too.
  const entered = reduce(started, hook('CwdChanged', { cwd: 'C:\\code\\emerald-wt\\fix', previous_cwd: 'C:\\code\\emerald' }));
  assert.equal(entered.cwd, 'C:\\code\\emerald-wt\\fix');
  assert.equal(entered.groupCwd, 'C:\\code\\emerald');
  assert.equal(entered.name, 'fix', 'the automatic name follows the live folder');
  const claudeKind = reduce(session({ claudeSessionId: null }), { type: 'cwd', cwd: 'C:\\elsewhere', at: T0 + 1 });
  assert.equal(claudeKind.groupCwd, 'C:\\repo');
  // A compact reports the same cwd and moves nothing.
  assert.equal(reduce(entered, hook('SessionStart', { source: 'compact', cwd: 'C:\\code\\emerald-wt\\fix' })).groupCwd, 'C:\\code\\emerald');
  // When Claude leaves a shell that has not reported its own folder yet,
  // both folders stay until its prompt does (M9 fix 74 changed this from
  // grouping under the hook cwd), and then move together.
  const left = reduce(entered, hook('SessionEnd'));
  assert.equal(left.claudeSessionId, null);
  assert.equal(left.cwd, 'C:\\code\\emerald-wt\\fix');
  assert.equal(left.groupCwd, 'C:\\code\\emerald');
  const reported = reduce(left, { type: 'cwd', cwd: 'C:\\Temp', at: T0 + 2 });
  assert.equal(reported.cwd, 'C:\\Temp');
  assert.equal(reported.groupCwd, 'C:\\Temp');
  // A Claude session keeps its id and its group.
  const claudeLeft = reduce(session({ cwd: 'C:\\repo\\sub', groupCwd: 'C:\\repo' }), hook('SessionEnd'));
  assert.equal(claudeLeft.groupCwd, 'C:\\repo');
});

test('the last turn: a prompt sets lastPrompt and clears the reply, Stop sets lastReply, both first line only', () => {
  const asked = reduce(session({ lastReply: 'old answer' }), hook('UserPromptSubmit', { prompt: '  commit this\nand then some' }));
  assert.equal(asked.lastPrompt, 'commit this');
  assert.equal(asked.lastReply, null, 'a new prompt clears the old reply');
  const answered = reduce(asked, hook('Stop', { last_assistant_message: '\n\nCommitted as 97af82b.\nTwelve files.' }));
  assert.equal(answered.lastReply, 'Committed as 97af82b.');
  assert.equal(answered.lastPrompt, 'commit this');
  // An empty prompt or reply keeps what was there rather than blanking the row.
  const blank = reduce(answered, hook('UserPromptSubmit', { prompt: '   ' }));
  assert.equal(blank.lastPrompt, 'commit this');
  assert.equal(blank.lastReply, 'Committed as 97af82b.');
  assert.equal(reduce(answered, hook('Stop', {})).lastReply, 'Committed as 97af82b.');
  const long = reduce(answered, hook('UserPromptSubmit', { prompt: 'x'.repeat(500) }));
  assert.equal(long.lastPrompt?.length, SUMMARY_MAX);
  assert.ok(long.lastPrompt?.endsWith('…'));
});

test('M73: the turn carries the time its prompt and its reply landed, a blank one keeping the last time', () => {
  const asked = reduce(session({ lastReply: 'old answer', lastReplyAt: T0 }), hook('UserPromptSubmit', { prompt: 'commit this' }, T0 + 1000));
  assert.equal(asked.lastPromptAt, T0 + 1000, 'the prompt is timed at its hook');
  assert.equal(asked.lastReplyAt, null, 'a new prompt clears the old reply and its time');
  const answered = reduce(asked, hook('Stop', { last_assistant_message: 'Committed.' }, T0 + 9000));
  assert.equal(answered.lastReplyAt, T0 + 9000, 'the reply is timed at its Stop');
  assert.equal(answered.lastPromptAt, T0 + 1000);
  const blank = reduce(answered, hook('UserPromptSubmit', { prompt: '   ' }, T0 + 12000));
  assert.equal(blank.lastPromptAt, T0 + 1000, 'an empty prompt keeps the last one and its time');
  assert.equal(blank.lastReplyAt, T0 + 9000);
  assert.equal(reduce(answered, hook('Stop', {}, T0 + 13000)).lastReplyAt, T0 + 9000, 'a Stop with no text keeps the reply and its time');
  const woken = reduce(answered, hook('UserPromptSubmit', { prompt: '<task-notification> agent a1 done' }, T0 + 14000));
  assert.equal(woken.lastPromptAt, T0 + 1000, 'a task notification is not a prompt of the person and keeps the time');
  assert.equal(woken.lastReplyAt, null, 'the reply to it is on its way');
});

test('contextText and contextTitle read the status line fields', () => {
  assert.equal(contextText(session()), null, 'nothing reported yet');
  assert.equal(contextText(session({ model: 'Fable', contextPercent: 42 })), 'Fable · 42%');
  assert.equal(contextText(session({ contextPercent: 7 })), '7%');
  assert.equal(contextText(session({ model: 'Opus' })), 'Opus');
  assert.equal(contextTitle(session({ model: 'Fable', contextPercent: 42 })), 'Model: Fable\nContext window 42% full');
});

test('StatusLine records the model and the context percent and touches nothing else', () => {
  for (const from of ALL_STATES) {
    const before = session({ state: from, lastEventAt: T0 + 1 });
    const after = reduce(before, hook('StatusLine', { model: { id: 'claude-fable-5-1', display_name: 'Fable' }, context_window: { used_percentage: 41.6 } }));
    assert.equal(after.model, 'Fable', `model from ${from}`);
    assert.equal(after.contextPercent, 42, 'rounded');
    assert.equal(after.state, from, 'a status line says nothing about the state');
    assert.equal(after.stateSince, before.stateSince);
    assert.equal(after.lastEventAt, T0 + 1, 'nor about whether Claude is alive');
  }
  const known = session({ model: 'Fable', contextPercent: 42 });
  assert.equal(reduce(known, hook('StatusLine', { model: { display_name: 'Fable' }, context_window: { used_percentage: 42.2 } })), known, 'same object when nothing changed');
  // A missing or malformed field keeps the last value; the id stands in for a missing display name.
  const partial = reduce(known, hook('StatusLine', { context_window: { used_percentage: 250 } }));
  assert.equal(partial.model, 'Fable');
  assert.equal(partial.contextPercent, 100, 'clamped');
  const byId = reduce(known, hook('StatusLine', { model: { id: 'claude-opus-5' }, context_window: { used_percentage: 'lots' as unknown as number } }));
  assert.equal(byId.model, 'claude-opus-5');
  assert.equal(byId.contextPercent, 42);
  // Foreign and subagent status lines are ignored like any other event.
  assert.equal(reduce(known, hook('StatusLine', { session_id: 'other', model: { display_name: 'Opus' } })), known);
  assert.equal(classifyHook(known, { hook_event_name: 'StatusLine', session_id: BOUND }), 'applied');
});

test('StatusLine records the context window token counts, a part at a time, and a shell SessionEnd clears them', () => {
  const full = { context_window_size: 1000000, total_input_tokens: 116045, used_percentage: 12, current_usage: { input_tokens: 2, output_tokens: 212, cache_creation_input_tokens: 299, cache_read_input_tokens: 115744 } };
  const seen = reduce(session(), hook('StatusLine', { model: { display_name: 'Opus 5' }, context_window: full }));
  assert.deepEqual(seen.contextWindow, { size: 1000000, used: 116045, cacheRead: 115744, cacheWrite: 299, fresh: 2, output: 212 });
  assert.equal(seen.contextPercent, 12);
  // The verify scripts' fake status lines carry the percentage alone: the counts stay as they were, null included.
  assert.equal(reduce(session(), hook('StatusLine', { context_window: { used_percentage: 7 } })).contextWindow, null, 'no size, nothing to take shares over');
  const same = reduce(seen, hook('StatusLine', { context_window: { used_percentage: 12 } }));
  assert.equal(same.contextWindow, seen.contextWindow, 'the same object when no count moved');
  assert.equal(same, seen);
  // A count that is missing or malformed keeps its last value; a size that arrives alone sets the rest to 0.
  const partial = reduce(seen, hook('StatusLine', { context_window: { total_input_tokens: 120000, current_usage: { output_tokens: 'many' as unknown as number } } }));
  assert.deepEqual(partial.contextWindow, { size: 1000000, used: 120000, cacheRead: 115744, cacheWrite: 299, fresh: 2, output: 212 });
  assert.deepEqual(reduce(session(), hook('StatusLine', { context_window: { context_window_size: 200000 } })).contextWindow, { size: 200000, used: 0, cacheRead: 0, cacheWrite: 0, fresh: 0, output: 0 });
  // A shell's Claude took its numbers with it (fix 39's rule); a Claude session keeps them as the last reading.
  const shell = reduce(reduce(session({ kind: 'shell', claudeSessionId: null }), hook('SessionStart', { source: 'startup' })), hook('StatusLine', { context_window: full }));
  assert.notEqual(shell.contextWindow, null);
  assert.equal(reduce(shell, hook('SessionEnd', { reason: 'exit' })).contextWindow, null);
  assert.notEqual(reduce(seen, hook('SessionEnd', { reason: 'exit' })).contextWindow, null);
});

test('StatusLine sums the counts over requests (M9 fix 143), a streaming line replacing its request\'s output, and a shell SessionEnd clears the sum', () => {
  const line = (input: number, write: number, read: number, output: number) => hook('StatusLine', { context_window: { context_window_size: 1000000, total_input_tokens: input + write + read, used_percentage: 6, current_usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: write, cache_read_input_tokens: read } } });
  // A real status line's totals are the last request's, and one request posts several lines while its reply streams.
  const first = reduce(session(), line(2, 14649, 40100, 2));
  assert.deepEqual(first.tokens, { fresh: 2, cacheWrite: 14649, cacheRead: 40100, output: 2 });
  const streamed = reduce(first, line(2, 14649, 40100, 130));
  assert.deepEqual(streamed.tokens, { fresh: 2, cacheWrite: 14649, cacheRead: 40100, output: 130 }, 'the same split is the same request: its output replaces, nothing is added');
  assert.equal(reduce(streamed, line(2, 14649, 40100, 130)), streamed, 'the same line again changes nothing');
  const second = reduce(streamed, line(2, 3869, 54749, 134));
  assert.deepEqual(second.tokens, { fresh: 4, cacheWrite: 18518, cacheRead: 94849, output: 264 }, 'a new split adds all four');
  assert.equal(tokensUp(second.tokens!), 113371);
  // A line with no counts (the verify scripts' fakes) leaves the sum; a sum that never started stays null.
  assert.equal(reduce(second, hook('StatusLine', { context_window: { used_percentage: 9 } })).tokens, second.tokens);
  assert.equal(reduce(session(), hook('StatusLine', { context_window: { used_percentage: 9 } })).tokens, null);
  // A record restored with its window but no sum (written before the field) starts the sum with the next request, whatever the window says.
  const restored = reduce({ ...second, tokens: null }, line(2, 3869, 54749, 200));
  assert.deepEqual(restored.tokens, { fresh: 2, cacheWrite: 3869, cacheRead: 54749, output: 200 });
  // A shell's Claude takes its sum with it, as it takes the window; a Claude session keeps the sum as the last reading.
  const shell = reduce(reduce(session({ kind: 'shell', claudeSessionId: null }), hook('SessionStart', { source: 'startup' })), line(2, 100, 200, 5));
  assert.notEqual(shell.tokens, null);
  assert.equal(reduce(shell, hook('SessionEnd', { reason: 'exit' })).tokens, null);
  assert.notEqual(reduce(second, hook('SessionEnd', { reason: 'exit' })).tokens, null);
});

test('StatusLine reads the cost Claude Code reports (M9 fix 154), keeps it over a line without one and clears it with the sum', () => {
  const costed = (usd: number) => hook('StatusLine', { context_window: { used_percentage: 6 }, cost: { total_cost_usd: usd } });
  assert.equal(session().costUsd ?? null, null);
  const first = reduce(session(), costed(1.4029585));
  assert.equal(first.costUsd, 1.4029585);
  assert.equal(reduce(first, costed(1.4029585)), first, 'the same figure again changes nothing');
  const more = reduce(first, costed(6.797));
  assert.equal(more.costUsd, 6.797);
  assert.equal(reduce(more, hook('StatusLine', { context_window: { used_percentage: 9 } })).costUsd, 6.797, 'a line without the block keeps the last figure');
  assert.equal(reduce(more, hook('StatusLine', { cost: { total_cost_usd: -1 } })).costUsd, 6.797, 'a malformed figure is ignored');
  assert.equal(reduce(more, hook('StatusLine', { cost: { total_cost_usd: 'lots' as unknown as number } })).costUsd, 6.797);
  // A shell's Claude takes its figure with it, as it takes the sum; a Claude session keeps it as the last reading.
  const shell = reduce(reduce(session({ kind: 'shell', claudeSessionId: null }), hook('SessionStart', { source: 'startup' })), costed(0.5));
  assert.equal(shell.costUsd, 0.5);
  assert.equal(reduce(shell, hook('SessionEnd', { reason: 'exit' })).costUsd, null);
  assert.equal(reduce(more, hook('SessionEnd', { reason: 'exit' })).costUsd, 6.797);
});

test('StatusLine keeps the prompt cache\'s TTL, expiry and warmth (M9 fix 772), keeps it over a line without the block and over a Measure, and a line with no expiry clears it', () => {
  const start = session({ state: 'done', lastEventAt: T0 });
  const line = hook('StatusLine', { context_window: { used_percentage: 6 }, prompt_cache: { warm: true, ttl: '1h', expires_at: 1792090000, requests: 3 } });
  assert.equal(start.cache ?? null, null);
  const warm = reduce(start, line);
  assert.deepEqual(warm.cache, { ttl: '1h', expiresAt: 1792090000000, warm: true });
  assert.equal(warm.state, 'done');
  assert.equal(warm.lastEventAt, T0, 'a status line moves no state');
  assert.equal(reduce(warm, line), warm, 'the same line again returns the same record');
  const without = reduce(warm, hook('StatusLine', { context_window: { used_percentage: 7 } }));
  assert.equal(without.cache, warm.cache, 'a line without the block keeps the last');
  const measured = reduce(warm, hook('Measure', { measure: { context: { percent: 10 } } }));
  assert.equal(measured.cache, warm.cache, 'a measure keeps it');
  assert.equal(measured.state, 'done');
  assert.equal(reduce(warm, hook('StatusLine', { prompt_cache: { warm: false, ttl: '1h', expires_at: null } })).cache, null, 'no expiry: no cache tokens on the last response');
  assert.equal(reduce(warm, hook('StatusLine', { prompt_cache: { warm: true, ttl: '10m', expires_at: 1792090000 } })).cache, null, 'a TTL Claude Code does not write');
  assert.deepEqual(reduce(warm, hook('StatusLine', { prompt_cache: { warm: false, ttl: '1h', expires_at: 1792090000 } })).cache, { ttl: '1h', expiresAt: 1792090000000, warm: false });
  // A shell whose Claude leaves takes the cache with it.
  const shell = reduce(reduce(session({ kind: 'shell', claudeSessionId: null }), hook('SessionStart', { source: 'startup' })), line);
  assert.equal(shell.cache?.ttl, '1h');
  assert.equal(reduce(shell, hook('SessionEnd', { reason: 'exit' })).cache, null);
});

test('StatusLine sets the effort off effort.level (M9 fix 799): a line with a model and no effort clears it, a line with no model block and a Measure keep it, a shell\'s exit clears it', () => {
  const opus = { id: 'claude-opus-5-5', display_name: 'Opus 5.5' };
  const start = session({ state: 'done', lastEventAt: T0 });
  assert.equal(start.effort ?? null, null);
  const line = hook('StatusLine', { model: opus, effort: { level: 'high' } });
  const high = reduce(start, line);
  assert.equal(high.effort, 'high');
  assert.equal(high.model, 'Opus 5.5');
  assert.equal(high.state, 'done');
  assert.equal(high.lastEventAt, T0, 'a status line moves no state');
  assert.equal(reduce(high, line), high, 'the same line again returns the same record');
  const sonnet = reduce(high, hook('StatusLine', { model: { id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5' }, effort: { level: 'medium' } }));
  assert.equal(sonnet.effort, 'medium', 'a /model switch posts the new model\'s level');
  assert.equal(sonnet.model, 'Sonnet 5.5');
  assert.equal(reduce(high, hook('StatusLine', { context_window: { used_percentage: 7 } })).effort, 'high', 'a line with no model block keeps it');
  assert.equal(reduce(high, hook('Measure', { measure: { context: { percent: 10 } } })).effort, 'high', 'a measure keeps it');
  assert.equal(reduce(high, hook('StatusLine', { model: opus })).effort, null, 'a model with no effort setting clears it');
  assert.equal(reduce(high, hook('StatusLine', { model: opus, effort: { level: '' } })).effort, null, 'an empty level reads as none');
  // A shell whose Claude leaves takes the effort with it.
  const shell = reduce(reduce(session({ kind: 'shell', claudeSessionId: null }), hook('SessionStart', { source: 'startup' })), line);
  assert.equal(shell.effort, 'high');
  assert.equal(reduce(shell, hook('SessionEnd', { reason: 'exit' })).effort, null);
});

test('runningKind: a shell says claude while a Claude session id is bound, and SessionEnd unbinds a shell only', () => {
  const shell = session({ kind: 'shell', claudeSessionId: null });
  assert.equal(runningKind(shell), 'shell');
  assert.equal(runningKind(session({ kind: 'claude', claudeSessionId: null, state: 'starting' })), 'claude', 'a Claude session before its SessionStart');
  const running = reduce(shell, hook('SessionStart', { source: 'startup' }));
  assert.equal(running.claudeSessionId, BOUND);
  assert.equal(runningKind(running), 'claude');
  const left = reduce(running, hook('SessionEnd', { reason: 'prompt_input_exit' }));
  assert.equal(left.state, 'idle');
  assert.equal(left.claudeSessionId, null, 'a shell forgets the Claude that left');
  assert.equal(runningKind(left), 'shell');
  assert.equal(hasState(left), false, 'and shows no state again');
  // The next claude in the same shell binds afresh rather than being foreign.
  const again = reduce(left, hook('SessionStart', { source: 'startup', session_id: 'second' }));
  assert.equal(again.claudeSessionId, 'second');
  // A Claude session keeps its id through SessionEnd: --resume needs it.
  const claude = reduce(session({ state: 'working' }), hook('SessionEnd'));
  assert.equal(claude.state, 'idle');
  assert.equal(claude.claudeSessionId, BOUND);
  assert.equal(runningKind(claude), 'claude');
  // A foreign SessionEnd (a nested claude -p leaving) unbinds nothing.
  assert.equal(reduce(running, hook('SessionEnd', { session_id: 'nested' })), running);
});

test('the conversation: SessionStart binds it with its folder, a compact does not, and SessionEnd keeps it (M48)', () => {
  const started = reduce(session({ claudeSessionId: null, args: ['--model', 'opus'], conversation: null }), hook('SessionStart', { source: 'startup', session_id: 'conv-1', cwd: 'C:\\repo\\sub' }));
  assert.deepEqual(started.conversation, { id: 'conv-1', cwd: 'C:\\repo\\sub', args: ['--model', 'opus'] }, 'a Claude session remembers its args');
  assert.notEqual(started.conversation!.args, started.args, 'a copy, not the same array');
  // A shell's args are the shell's, so the conversation carries none.
  const shell = reduce(session({ kind: 'shell', claudeSessionId: null, args: ['-NoProfile'] }), hook('SessionStart', { source: 'startup', session_id: 'conv-2', cwd: 'C:\\elsewhere' }));
  assert.deepEqual(shell.conversation, { id: 'conv-2', cwd: 'C:\\elsewhere', args: [] });
  // A compact is the same conversation mid-turn, and a SessionStart with
  // no folder or no id binds nothing.
  assert.equal(reduce(started, hook('SessionStart', { source: 'compact', session_id: 'conv-1', cwd: 'C:\\other' })).conversation, started.conversation);
  assert.equal(reduce(session({ conversation: null }), hook('SessionStart', { source: 'startup', session_id: '', cwd: 'C:\\repo' })).conversation, null);
  assert.equal(reduce(session({ conversation: null }), hook('SessionStart', { source: 'startup', session_id: BOUND, cwd: '' })).conversation, null);
  // A resume's SessionStart says the same thing and rewrites nothing.
  const again = reduce(started, hook('SessionStart', { source: 'resume', session_id: 'conv-1', cwd: 'C:\\repo\\sub' }));
  assert.equal(again.conversation, started.conversation);
  // The next conversation replaces it; SessionEnd and the exit keep it.
  const next = reduce(shell, hook('SessionEnd', { session_id: 'conv-2' }));
  assert.deepEqual(next.conversation, { id: 'conv-2', cwd: 'C:\\elsewhere', args: [] }, 'a shell keeps the conversation Claude left');
  assert.equal(next.claudeSessionId, null);
  assert.deepEqual(reduce(next, { type: 'pty.exit', exitCode: 0, at: T0 + 20 }).conversation, next.conversation);
  const replaced = reduce(next, hook('SessionStart', { source: 'startup', session_id: 'conv-3', cwd: 'C:\\elsewhere' }));
  assert.equal(replaced.conversation!.id, 'conv-3');
});

test('a shell keeps its own folder apart from the hook cwd, and SessionEnd puts the row straight back there (M9 fix 74)', () => {
  const shell = session({ kind: 'shell', cwd: 'C:\\Temp', groupCwd: 'C:\\Temp', spawnCwd: 'C:\\Temp', claudeSessionId: null, name: 'Temp' });
  // The prompt's report sets shellCwd; the same folder again is identity.
  const prompted = reduce(shell, { type: 'cwd', cwd: 'C:\\code\\emerald', at: T0 + 1 });
  assert.equal(prompted.shellCwd, 'C:\\code\\emerald');
  assert.equal(prompted.cwd, 'C:\\code\\emerald');
  assert.equal(reduce(prompted, { type: 'cwd', cwd: 'C:\\code\\emerald', at: T0 + 2 }), prompted);
  // A Claude-kind session has no prompt of its own.
  assert.equal(reduce(session({ claudeSessionId: null }), { type: 'cwd', cwd: 'C:\\elsewhere', at: T0 + 1 }).shellCwd, null);
  // Claude starts in the shell, moves itself with a Bash cd, and leaves:
  // the hook cwd moved the live folder and the name, the group held, and
  // SessionEnd puts both folders and the name back where the shell is,
  // in one step.
  const started = reduce(prompted, hook('SessionStart', { source: 'startup', session_id: 'conv-1', cwd: 'C:\\code\\emerald' }));
  const moved = reduce(started, hook('CwdChanged', { session_id: 'conv-1', cwd: 'C:\\code\\emerald\\packages\\app', previous_cwd: 'C:\\code\\emerald' }));
  assert.equal(moved.cwd, 'C:\\code\\emerald\\packages\\app');
  assert.equal(moved.name, 'app');
  assert.equal(moved.shellCwd, 'C:\\code\\emerald', 'the hook cwd does not touch the shell\'s own');
  const left = reduce(moved, hook('SessionEnd', { session_id: 'conv-1' }));
  assert.equal(left.cwd, 'C:\\code\\emerald');
  assert.equal(left.groupCwd, 'C:\\code\\emerald');
  assert.equal(left.name, 'emerald');
  assert.equal(left.claudeSessionId, null);
  // The prompt that follows reports the same folder, so nothing moves twice.
  assert.equal(reduce(left, { type: 'cwd', cwd: 'C:\\code\\emerald', at: T0 + 30 }), left);
  // A Claude session's SessionEnd moves nothing.
  const claude = reduce(session({ cwd: 'C:\\repo\\sub', groupCwd: 'C:\\repo' }), hook('SessionEnd'));
  assert.equal(claude.cwd, 'C:\\repo\\sub');
  assert.equal(claude.groupCwd, 'C:\\repo');
});

test('SessionEnd takes the model and the context percent off a shell and leaves them on a Claude session (M9 fix 39)', () => {
  const status = hook('StatusLine', { model: { id: 'claude-opus-5', display_name: 'Opus 5' }, context_window: { used_percentage: 21 } });
  const shell = reduce(reduce(session({ kind: 'shell', claudeSessionId: null }), hook('SessionStart', { source: 'startup' })), status);
  assert.equal(shell.model, 'Opus 5');
  assert.equal(shell.contextPercent, 21);
  const left = reduce(shell, hook('SessionEnd', { reason: 'prompt_input_exit' }));
  assert.equal(left.model, null, 'a shell back at its prompt has no model');
  assert.equal(left.contextPercent, null, 'nor a context fill');
  // A Claude session that exits keeps them as its last known reading; its
  // resume starts them over in the manager.
  const claude = reduce(reduce(session({ state: 'working' }), status), hook('SessionEnd'));
  assert.equal(claude.model, 'Opus 5');
  assert.equal(claude.contextPercent, 21);
  // A foreign SessionEnd touches neither.
  assert.equal(reduce(shell, hook('SessionEnd', { session_id: 'nested' })), shell);
});

test('the transcript path binds from the first hook that carries one and a resume names it again (M47)', () => {
  const p = 'C:\Users\me\.claude\projects\C--repo\claude-session-1.jsonl';
  const started = reduce(session({ state: 'starting' }), hook('SessionStart', { source: 'startup', transcript_path: p }));
  assert.equal(started.transcriptPath, p);
  // A later hook naming the same file changes nothing; one with none leaves it.
  const same = reduce(started, hook('UserPromptSubmit', { transcript_path: p }));
  assert.equal(same.transcriptPath, p);
  assert.equal(reduce(same, hook('PreToolUse')).transcriptPath, p);
  assert.equal(reduce(same, hook('PreToolUse', { transcript_path: '' })).transcriptPath, p);
  // A --resume's SessionStart carries the path of the conversation it picked up.
  const other = 'C:\Users\me\.claude\projects\C--repo\other.jsonl';
  assert.equal(reduce(same, hook('SessionStart', { source: 'resume', transcript_path: other })).transcriptPath, other);
  // A hook that is dropped binds nothing.
  assert.equal(reduce(session(), hook('PreToolUse', { agent_id: 'agent-1', transcript_path: p })).transcriptPath, null);
  // A shell's SessionEnd drops it with the id; a Claude session keeps it.
  const shell = reduce(session({ kind: 'shell', claudeSessionId: null }), hook('SessionStart', { source: 'startup', transcript_path: p }));
  assert.equal(shell.transcriptPath, p);
  assert.equal(reduce(shell, hook('SessionEnd')).transcriptPath, null);
  assert.equal(reduce(started, hook('SessionEnd')).transcriptPath, p);
});

test('liveReply is cleared by a prompt and by the turn ending, and kept by a permission prompt (M47)', () => {
  const working = session({ state: 'working', lastPrompt: 'read the log', liveReply: 'Reading the log.' });
  // A prompt starts the next turn's text over, a task notification too.
  assert.equal(reduce(working, hook('UserPromptSubmit', { prompt: 'and the diff' })).liveReply, null);
  assert.equal(reduce(working, hook('UserPromptSubmit', { prompt: '<task-notification>done</task-notification>' })).liveReply, null);
  // Mid-turn events leave it: the daemon owns the text while the turn runs.
  assert.equal(reduce(working, hook('PreToolUse')).liveReply, 'Reading the log.');
  const asked = reduce(working, hook('PermissionRequest'));
  assert.equal(asked.state, 'needs-input');
  assert.equal(asked.liveReply, 'Reading the log.', 'a permission prompt is mid-turn');
  assert.equal(reduce(asked, hook('PostToolUse')).liveReply, 'Reading the log.', 'and the turn goes on with it');
  // The Stop's reply takes over the line.
  const done = reduce(working, hook('Stop', { last_assistant_message: 'Read it.' }));
  assert.equal(done.state, 'done');
  assert.equal(done.liveReply, null);
  assert.equal(done.lastReply, 'Read it.');
  assert.equal(reduce(working, hook('Stop', { background_tasks: [{ status: 'running', type: 'shell', command: 'npm test' }] })).liveReply, null, 'a pause ends the turn too');
  assert.equal(reduce(working, hook('StopFailure', { error_type: 'rate_limit' })).liveReply, null);
  assert.equal(reduce(working, { type: 'pty.exit', exitCode: 0, at: T0 + 9000 }).liveReply, null);
  // A stale flag is not a state change, so the text stays.
  assert.equal(reduce(working, { type: 'stale-check', at: T0 + 20 * 60_000, staleAfterMs: 1000 }).liveReply, 'Reading the log.');
});

test('liveVerb: the spinner word fills only an empty agent line, and goes with the turn (M9 fix 158)', () => {
  const blank = session({ state: 'working', lastPrompt: 'also keep:', lastReply: null, liveReply: null, liveTool: null, title: null });
  assert.equal(agentLineText(blank), '', 'nothing has landed: the line is blank');
  const grinding = { ...blank, liveVerb: 'Grinding' };
  assert.equal(agentLineText(grinding), 'Grinding', 'the spinner word fills the blank');
  assert.equal(agentLineText({ ...grinding, lastReply: 'Read it.' }), 'Read it.', 'the last turn comes first');
  assert.equal(agentLineText({ ...grinding, liveTool: 'running a command' }), 'running a command', 'and so does the tool phrase');
  assert.equal(agentLineText({ ...grinding, title: '◐ Reading the log' }), 'Reading the log', "and the title's activity");
  assert.equal(agentLineText({ ...grinding, state: 'done' }), '', 'a row not working shows no word, whatever the record holds');
  // The reducer clears it where it clears the live reply: a new turn,
  // the turn's end, the process's exit; a permission prompt keeps it.
  assert.equal(reduce(grinding, hook('UserPromptSubmit', { prompt: 'and the diff' })).liveVerb, null);
  assert.equal(reduce(grinding, hook('PreToolUse')).liveVerb, 'Grinding');
  assert.equal(reduce(grinding, hook('PermissionRequest')).liveVerb, 'Grinding', 'a permission prompt is mid-turn');
  assert.equal(reduce(grinding, hook('Stop', { last_assistant_message: 'Read it.' })).liveVerb, null);
  assert.equal(reduce(grinding, { type: 'pty.exit', exitCode: 0, at: T0 + 9000 }).liveVerb, null);
  assert.equal(reduce(grinding, { type: 'stale-check', at: T0 + 20 * 60_000, staleAfterMs: 1000 }).liveVerb, 'Grinding');
});

test('liveTool: a PreToolUse takes the agent line as a verb phrase until text, a prompt or the turn ending (M9 fix 79)', () => {
  const working = session({ state: 'working', lastPrompt: 'read the log', liveReply: 'Reading the log.' });
  const reading = reduce(working, hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'C:\\code\\docs\\BACKLOG.md' } }));
  assert.equal(reading.liveTool, 'Reading BACKLOG.md');
  assert.equal(reading.liveReply, null, 'the call is later than the text, so the text goes');
  assert.equal(reading.state, 'working');
  // The Bash description is the line as it is; the same call again changes nothing.
  const bash = reduce(reading, hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'cat docs/BACKLOG.md', description: 'Reading the backlog file' } }));
  assert.equal(bash.liveTool, 'Reading the backlog file');
  assert.equal(reduce(bash, hook('PreToolUse', { tool_name: 'Bash', tool_input: { description: 'Reading the backlog file' } })).liveTool, 'Reading the backlog file');
  // A PreToolUse with no tool named leaves both alone.
  assert.equal(reduce(working, hook('PreToolUse')).liveReply, 'Reading the log.');
  assert.equal(reduce(working, hook('PreToolUse')).liveTool, null);
  // The call ends with the turn, with a prompt, and is kept by a permission prompt.
  assert.equal(reduce(bash, hook('UserPromptSubmit', { prompt: 'now the diff' })).liveTool, null);
  const asked = reduce(bash, hook('PermissionRequest'));
  assert.equal(asked.state, 'needs-input');
  assert.equal(asked.liveTool, 'Reading the backlog file', 'a permission prompt is mid-turn');
  assert.equal(reduce(asked, hook('PostToolUse', { tool_name: 'Bash' })).liveTool, 'Reading the backlog file', 'the call is over but the line waits for text');
  const done = reduce(bash, hook('Stop', { last_assistant_message: 'Read it.' }));
  assert.equal(done.liveTool, null);
  assert.equal(done.lastReply, 'Read it.');
  assert.equal(reduce(bash, hook('StopFailure', { error_type: 'rate_limit' })).liveTool, null);
  assert.equal(reduce(bash, { type: 'pty.exit', exitCode: 0, at: T0 + 9000 }).liveTool, null);
  assert.equal(reduce(bash, { type: 'stale-check', at: T0 + 20 * 60_000, staleAfterMs: 1000 }).liveTool, 'Reading the backlog file');
});

test("an agent's permission prompt holds the row until the agent's own next event (M9 fix 109)", () => {
  const working = reduce(session({ state: 'working' }), hook('SubagentStart', { agent_id: 'a1', agent_type: 'fork' }, T0 + 10));
  const agent = (name: string, extra: Partial<HookPayload> = {}, at = T0 + 20) => hook(name, { agent_id: 'a1', ...extra }, at);
  // The agent asks: the row says so, and the member says which tool.
  const asked = reduce(working, agent('PermissionRequest', { tool_name: 'Edit' }));
  assert.equal(asked.state, 'needs-input');
  assert.equal(asked.needsInputReason, 'agent-permission');
  assert.equal(asked.team[0]!.permission, 'Edit');
  // The parent's permission_prompt for the same prompt keeps whose it is.
  const notified = reduce(asked, hook('Notification', { notification_type: 'permission_prompt' }, T0 + 21));
  assert.equal(notified.needsInputReason, 'agent-permission');
  assert.equal(notified.state, 'needs-input');
  // The parent's own call answers nothing: the prompt stays on show.
  const parentBusy = reduce(notified, hook('PreToolUse', { tool_name: 'Read' }, T0 + 22));
  assert.equal(parentBusy.state, 'needs-input');
  assert.equal(parentBusy.needsInputReason, 'agent-permission');
  // The agent's own PostToolUse (a Bash, the applied-agent kind) releases it to the parent's turn.
  const released = reduce(parentBusy, agent('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git status' } }, T0 + 30));
  assert.equal(released.state, 'working');
  assert.equal(released.needsInputReason, null);
  assert.equal(released.team[0]!.permission, null);
  // A failure and a denial release the same way; a tool nobody asked for changes nothing.
  assert.equal(reduce(asked, agent('PostToolUseFailure', { tool_name: 'Edit' }, T0 + 30)).state, 'working');
  assert.equal(reduce(asked, agent('PermissionDenied', { tool_name: 'Edit' }, T0 + 30)).state, 'working');
  assert.deepEqual(reduce(working, agent('PostToolUse', { tool_name: 'Read' }, T0 + 30)), { ...working, teamEventAt: T0 + 30 }, 'no ask, no change but the member clock (M9 fix 507)');
  // The agent's return releases it too.
  const returned = reduce(asked, agent('SubagentStop', { agent_type: 'fork' }, T0 + 30));
  assert.equal(returned.state, 'working');
  assert.equal(returned.team[0]!.outcome, 'returned');
  // A typed prompt is a new turn: the ask goes with the members.
  assert.equal(reduce(asked, hook('UserPromptSubmit', { prompt: 'again' }, T0 + 30)).state, 'working');
  // An inner agent nobody started, and a foreign conversation's agent, are not members.
  assert.equal(reduce(working, hook('PermissionRequest', { agent_id: 'inner', tool_name: 'Edit' })), working);
  assert.equal(reduce(working, hook('PermissionRequest', { agent_id: 'a1', session_id: 'other', tool_name: 'Edit' })), working);
});

test("an agent's answered prompt puts a paused row back at waiting with its list (M9 fix 109)", () => {
  const working = reduce(session({ state: 'working' }), hook('SubagentStart', { agent_id: 'a1', agent_type: 'fork' }, T0 + 10));
  const paused = reduce(working, hook('Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'Build it' }] }, T0 + 20));
  assert.equal(paused.state, 'waiting');
  const asked = reduce(paused, hook('PermissionRequest', { agent_id: 'a1', tool_name: 'Bash' }, T0 + 30));
  assert.equal(asked.state, 'needs-input');
  assert.equal(asked.needsInputReason, 'agent-permission');
  assert.equal(asked.waitingOn.length, 1, 'the pause keeps its list through the prompt');
  const back = reduce(asked, hook('PostToolUse', { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'npm test' } }, T0 + 40));
  assert.equal(back.state, 'waiting');
  assert.equal(back.waitingOn.length, 1);
  assert.equal(back.needsInputReason, null);
  // A Stop that pauses while the agent still asks keeps the prompt on show.
  const askedMidTurn = reduce(working, hook('PermissionRequest', { agent_id: 'a1', tool_name: 'Bash' }, T0 + 30));
  const pausedAsking = reduce(askedMidTurn, hook('Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'running' }] }, T0 + 31));
  assert.equal(pausedAsking.state, 'needs-input');
  assert.equal(pausedAsking.needsInputReason, 'agent-permission');
  assert.equal(pausedAsking.waitingOn.length, 1);
  assert.equal(reduce(pausedAsking, hook('PostToolUse', { agent_id: 'a1', tool_name: 'Bash' }, T0 + 40)).state, 'waiting');
  // With two agents out, only the one that asked releases.
  const two = reduce(asked, hook('SubagentStart', { agent_id: 'a2', agent_type: 'fork' }, T0 + 32));
  assert.equal(reduce(two, hook('PostToolUse', { agent_id: 'a2', tool_name: 'Bash' }, T0 + 33)).state, 'needs-input', "another agent's call is not the answer");
  assert.equal(reduce(two, hook('PostToolUse', { agent_id: 'a1', tool_name: 'Bash' }, T0 + 33)).state, 'waiting');
});

test("an agent's event never releases a question or the parent's own permission (M9 fix 109)", () => {
  const working = reduce(session({ state: 'working' }), hook('SubagentStart', { agent_id: 'a1', agent_type: 'fork' }, T0 + 10));
  const question = reduce(working, hook('Notification', { notification_type: 'agent_needs_input' }, T0 + 20));
  assert.equal(question.needsInputReason, 'question');
  const stillAsking = reduce(question, hook('PostToolUse', { agent_id: 'a1', tool_name: 'Bash' }, T0 + 30));
  assert.equal(stillAsking.state, 'needs-input');
  assert.equal(stillAsking.needsInputReason, 'question');
  // The parent's own permission blocks harder: the agent's ask beside it
  // is marked and waits, and the agent's answer changes nothing.
  const own = reduce(working, hook('PermissionRequest', { tool_name: 'Bash' }, T0 + 20));
  const both = reduce(own, hook('PermissionRequest', { agent_id: 'a1', tool_name: 'Edit' }, T0 + 21));
  assert.equal(both.needsInputReason, 'permission');
  assert.equal(both.team[0]!.permission, 'Edit');
  const agentDone = reduce(both, hook('PostToolUse', { agent_id: 'a1', tool_name: 'Edit' }, T0 + 22));
  assert.equal(agentDone.state, 'needs-input');
  assert.equal(agentDone.needsInputReason, 'permission');
  // The parent's own answer releases it as ever.
  assert.equal(reduce(agentDone, hook('PostToolUse', { tool_name: 'Bash' }, T0 + 23)).state, 'working');
});

test("Claude's task list off its tool calls (M9 fix 153): TaskCreate adds, TaskUpdate moves one by id, TodoWrite replaces, a person's prompt clears, a subagent's calls do not count", () => {
  const create = (id: string, subject: string, activeForm: string | null = null) => hook('PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject, ...(activeForm === null ? {} : { activeForm }) }, tool_response: { task: { id, subject } } });
  const update = (taskId: string, fields: Record<string, unknown>) => hook('PostToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId, ...fields }, tool_response: { success: true, taskId } });
  const t1 = reduce(session({ state: 'working' }), create('1', 'Extend the row', 'Extending the row'));
  assert.deepEqual(t1.tasks, [{ id: '1', subject: 'Extend the row', activeForm: 'Extending the row', status: 'pending' }]);
  assert.equal(taskProgress(t1)?.current, null, 'nothing in progress yet');
  const t3 = reduce(reduce(t1, create('2', 'Wire the hooks')), create('3', 'Write the tests', 'Writing the tests'));
  assert.deepEqual(t3.tasks!.map((t) => t.id), ['1', '2', '3']);
  assert.deepEqual(taskProgress(t3), { done: 0, total: 3, current: null });
  const going = reduce(t3, update('1', { status: 'in_progress' }));
  assert.deepEqual(taskProgress(going), { done: 0, total: 3, current: 'Extending the row' }, 'the activeForm is the current line');
  assert.equal(agentLineText({ ...going, liveTool: 'running a command' }), 'Extending the row', 'the agent line prefers the task in progress to the tool phrase');
  assert.equal(agentLineText({ ...going, liveTool: 'running a command', liveReply: 'Some text' }), 'Some text', 'but not to the text Claude wrote');
  const two = reduce(reduce(going, update('1', { status: 'completed' })), update('2', { status: 'completed' }));
  assert.deepEqual(taskProgress(two), { done: 2, total: 3, current: null });
  assert.equal(tasksText(two), '2/3');
  // M9 fix 372: the lid's tally keeps a finished list where taskProgress goes null.
  assert.deepEqual(taskTally(two), { done: 2, total: 3, current: null });
  assert.equal(tallyText(taskTally(two)!), '2 of 3 tasks');
  const all = reduce(two, update('3', { status: 'completed' }));
  assert.equal(taskProgress(all), null, 'the row goes quiet at done');
  assert.deepEqual(taskTally(all), { done: 3, total: 3, current: null }, 'the lid keeps the full bar');
  assert.equal(tallyText(taskTally(all)!), '3 of 3 tasks');
  assert.equal(taskTally(session({ state: 'working' })), null, 'no list, no tally');
  assert.equal(tallyText({ done: 0, total: 1, current: null }), '0 of 1 task');
  // The subject of a task with no activeForm stands in for it.
  assert.equal(taskProgress(reduce(two, update('2', { status: 'in_progress' })))?.current, 'Wire the hooks');
  // A repeated update changes nothing; an unknown id changes nothing (the daemon reads the files for it).
  assert.equal(reduce(two, update('2', { status: 'completed' })).tasks, two.tasks);
  assert.equal(reduce(two, update('9', { status: 'completed' })).tasks, two.tasks);
  const payloadOf = (e: SessionEvent) => (e as { payload: HookPayload }).payload;
  assert.equal(namesUnknownTask(two, payloadOf(update('9', { status: 'completed' }))), true);
  assert.equal(namesUnknownTask(two, payloadOf(update('2', { status: 'completed' }))), false);
  // Words can move too; deleted takes the task out.
  assert.equal(reduce(two, update('3', { subject: 'Write the unit tests' })).tasks![2]!.subject, 'Write the unit tests');
  assert.deepEqual(reduce(two, update('3', { status: 'deleted' })).tasks!.map((t) => t.id), ['1', '2']);
  // All done is no count, so a finished list goes quiet.
  const done = reduce(two, update('3', { status: 'completed' }));
  assert.equal(taskProgress(done), null);
  assert.equal(tasksText(done), null);
  // A create with no id in the response (an older build) takes the next number.
  const older = reduce(two, hook('PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'One more' }, tool_response: 'Task created' }));
  assert.equal(older.tasks![3]!.id, '4');
  // A person's prompt clears the list; a task notification is the same turn and keeps it.
  assert.deepEqual(reduce(two, hook('UserPromptSubmit', { prompt: '<task-notification>done</task-notification>' })).tasks, two.tasks);
  assert.deepEqual(reduce(two, hook('UserPromptSubmit', { prompt: 'carry on' })).tasks, []);
  // TodoWrite (older builds) replaces the list whole, its entries numbered in order.
  const todo = reduce(two, hook('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Read the code', activeForm: 'Reading the code', status: 'completed' }, { content: 'Change it', activeForm: 'Changing it', status: 'in_progress' }, { content: 'Not a task' }] } }));
  assert.deepEqual(todo.tasks, [{ id: '1', subject: 'Read the code', activeForm: 'Reading the code', status: 'completed' }, { id: '2', subject: 'Change it', activeForm: 'Changing it', status: 'in_progress' }], 'an entry with no status is skipped');
  // A subagent's own task calls land in the same list (M9 fix 394, since
  // Claude Code writes them into the parent's own task folder) carrying
  // the member that made them; a TodoWrite of a member's is still dropped.
  const withAgent = reduce(two, hook('SubagentStart', { agent_id: 'ag1', agent_type: 'fork' }));
  const agentMade = reduce(withAgent, hook('PostToolUse', { agent_id: 'ag1', tool_name: 'TaskCreate', tool_input: { subject: 'Agent task' }, tool_response: { task: { id: '4', subject: 'Agent task' } } }));
  assert.deepEqual(agentMade.tasks!.map((t) => [t.id, t.agentId]), [['1', undefined], ['2', undefined], ['3', undefined], ['4', 'ag1']]);
  assert.deepEqual(tasksOfAgent(agentMade, 'ag1').map((t) => t.subject), ['Agent task']);
  assert.deepEqual(tasksOfAgent(agentMade, 'nobody'), [], 'a member no task names draws no strip');
  assert.equal(reduce(withAgent, hook('PostToolUse', { agent_id: 'ag1', tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Theirs', status: 'pending' }] } })).tasks, withAgent.tasks);
  // An update of the member's own moves it and keeps the owner; an update
  // from the member of a task created before it was known stamps it.
  const agentDone = reduce(agentMade, hook('PostToolUse', { agent_id: 'ag1', tool_name: 'TaskUpdate', tool_input: { taskId: '4', status: 'completed' }, tool_response: { success: true, taskId: '4' } }));
  assert.deepEqual(agentDone.tasks![3], { id: '4', subject: 'Agent task', activeForm: null, status: 'completed', agentId: 'ag1' });
  const stamped = reduce(agentMade, hook('PostToolUse', { agent_id: 'ag1', tool_name: 'TaskUpdate', tool_input: { taskId: '3' }, tool_response: { success: true, taskId: '3' } }));
  assert.equal(stamped.tasks![2]!.agentId, 'ag1', 'a member updating a task it was never seen to create owns it from then on');
  // The parent's own count is every task whatever the owner; the reread
  // off the files keeps what the hooks attributed, and a task the hooks
  // never saw stays unowned.
  assert.deepEqual(taskTally(agentMade), { done: 2, total: 4, current: null });
  const reread = reduce(agentMade, { type: 'tasks', at: T0 + 9100, tasks: agentMade.tasks!.map(({ agentId: _drop, ...t }) => t).concat([{ id: '5', subject: 'From the folder', activeForm: null, status: 'pending' }]) });
  assert.deepEqual(reread.tasks!.map((t) => [t.id, t.agentId]), [['1', undefined], ['2', undefined], ['3', undefined], ['4', 'ag1'], ['5', undefined]]);
  assert.equal(reduce(reread, { type: 'tasks', at: T0 + 9200, tasks: reread.tasks!.map(({ agentId: _drop, ...t }) => t) }), reread, 'the same files twice is no push once the owners ride through');
  // A member that has come back owns nothing new: its hooks are dropped.
  const backAgain = reduce(agentMade, hook('SubagentStop', { agent_id: 'ag1', agent_type: 'fork' }));
  assert.equal(reduce(backAgain, hook('PostToolUse', { agent_id: 'ag1', tool_name: 'TaskCreate', tool_input: { subject: 'Too late' }, tool_response: { task: { id: '6', subject: 'Too late' } } })).tasks, backAgain.tasks);
  // The files event replaces the list when it differs and is no push when it does not.
  const fromFiles = reduce(two, { type: 'tasks', at: T0 + 9000, tasks: [{ id: '1', subject: 'Extend the row', activeForm: 'Extending the row', status: 'completed' }] });
  assert.equal(fromFiles.tasks!.length, 1);
  assert.equal(reduce(fromFiles, { type: 'tasks', at: T0 + 9500, tasks: fromFiles.tasks! }), fromFiles);
  // A shell's Claude takes its list with it; a Claude session keeps it as the last reading.
  const shell = reduce(reduce(session({ kind: 'shell', claudeSessionId: null }), hook('SessionStart', { source: 'startup' })), create('1', 'Shell task'));
  assert.equal(shell.tasks!.length, 1);
  assert.deepEqual(reduce(shell, hook('SessionEnd', { reason: 'exit' })).tasks, []);
  assert.equal(reduce(two, hook('SessionEnd', { reason: 'exit' })).tasks!.length, 3);
});

test('groupTasksByOwner (M9 fix 435): the parent first with no heading, then each member with a task under its name, in team order, a member with none absent', () => {
  const create = (id: string, subject: string) => hook('PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject }, tool_response: { task: { id, subject } } });
  const own = reduce(reduce(reduce(session({ state: 'working' }), create('1', 'Extend the row')), create('2', 'Wire the hooks')), create('3', 'Write the tests'));
  const withFork = reduce(own, hook('SubagentStart', { agent_id: 'ag1', agent_type: 'fork' }));
  const forkAgentMade = reduce(withFork, hook('PostToolUse', { agent_id: 'ag1', tool_name: 'TaskCreate', tool_input: { subject: 'Wrap the runway' }, tool_response: { task: { id: '4', subject: 'Wrap the runway' } } }));
  const withExplore = reduce(forkAgentMade, hook('SubagentStart', { agent_id: 'ag2', agent_type: 'Explore' }));
  const withDescribed = reduce(withExplore, hook('PostToolUse', { tool_name: 'Agent', tool_input: { description: 'Find the roster reads', subagent_type: 'fork' }, tool_response: { agentId: 'ag1', description: 'Find the roster reads', status: 'async_launched' } }));
  // ag2 (Explore) never makes a task of its own; ag1 (fork) does, and its
  // description (the Agent tool's PostToolUse) outranks its bare type.
  const groups = groupTasksByOwner(withDescribed);
  assert.equal(groups.length, 2, 'the untouched member draws no group');
  assert.equal(groups[0]!.agentId, null);
  assert.equal(groups[0]!.name, null, 'the own group has no heading');
  assert.deepEqual(groups[0]!.tasks.map((t) => t.id), ['1', '2', '3']);
  assert.equal(groups[1]!.agentId, 'ag1');
  assert.equal(groups[1]!.name, 'Find the roster reads', "the fork's own name, not its bare type");
  assert.deepEqual(groups[1]!.tasks.map((t) => t.id), ['4']);
  // No task of anybody's own leaves the own group out too.
  assert.equal(groupTasksByOwner(reduce(session({ state: 'working' }), hook('SubagentStart', { agent_id: 'ag1', agent_type: 'fork' }))).length, 0);
  // A member with no description and no type is grouped under the bare kind.
  const bareMade = reduce(reduce(session({ state: 'working' }), hook('SubagentStart', { agent_id: 'ag3' })), hook('PostToolUse', { agent_id: 'ag3', tool_name: 'TaskCreate', tool_input: { subject: 'Bare task' }, tool_response: { task: { id: '1', subject: 'Bare task' } } }));
  assert.equal(groupTasksByOwner(bareMade)[0]!.name, 'agent');
});

test('readTask and sortTasks (M9 fix 153): a task file as Claude Code writes it, a numeric id from the file name, and 10 after 9', () => {
  assert.deepEqual(readTask({ id: '3', subject: 'Wire it', description: 'long', activeForm: 'Wiring it', status: 'completed', blocks: [], blockedBy: [] }), { id: '3', subject: 'Wire it', activeForm: 'Wiring it', status: 'completed' });
  assert.deepEqual(readTask({ subject: 'No id', status: 'pending' }, '12'), { id: '12', subject: 'No id', activeForm: null, status: 'pending' });
  assert.equal(readTask({ subject: 'Bad status', status: 'later' }), null);
  assert.equal(readTask({ status: 'pending' }), null, 'no subject is no task');
  assert.equal(readTask('nope'), null);
  assert.deepEqual(sortTasks([{ id: '10', subject: 'j', activeForm: null, status: 'pending' }, { id: '9', subject: 'i', activeForm: null, status: 'pending' }, { id: '2', subject: 'b', activeForm: null, status: 'pending' }]).map((t) => t.id), ['2', '9', '10']);
});

test('shell marks (M9 fix 196): C runs the command, D ends it by its code, a long one puts a plain shell at done or errored, the next C or an ack puts it back', () => {
  const mark = (s: SessionInfo, m: 'A' | 'C' | 'D', at: number, code: number | null = null): SessionInfo => reduce(s, { type: 'shell-mark', mark: m, code, at, doneAfterMs: 60_000 });
  const shell = session({ kind: 'shell', claudeSessionId: null, state: 'idle' });
  assert.equal(mark(shell, 'A', T0 + 1), shell, 'A changes nothing');
  assert.equal(mark(shell, 'D', T0 + 1), shell, 'a D with no code and no command changes nothing');
  const running = mark(shell, 'C', T0 + 1000);
  assert.deepEqual(running.command, { state: 'running', exitCode: null, startedAt: T0 + 1000, endedAt: null });
  assert.equal(running.state, 'idle', 'a running command is not a state');
  const ok = mark(running, 'D', T0 + 3000, 0);
  assert.deepEqual(ok.command, { state: 'ok', exitCode: 0, startedAt: T0 + 1000, endedAt: T0 + 3000 });
  assert.equal(ok.state, 'idle', 'two seconds is too short to want anyone');
  assert.equal(mark(ok, 'D', T0 + 3100, 0), ok, 'a D after a D changes nothing');
  const failed = mark(mark(ok, 'C', T0 + 4000), 'D', T0 + 5000, 3);
  assert.deepEqual(failed.command, { state: 'failed', exitCode: 3, startedAt: T0 + 4000, endedAt: T0 + 5000 });
  assert.equal(failed.state, 'idle');
  // A long command's end is a done or an errored, with stateSince at the end.
  const long = mark(mark(failed, 'C', T0 + 10_000), 'D', T0 + 70_000, 0);
  assert.equal(long.state, 'done');
  assert.equal(long.stateSince, T0 + 70_000);
  const longFailed = mark(mark(failed, 'C', T0 + 10_000), 'D', T0 + 70_000, 1);
  assert.equal(longFailed.state, 'errored');
  assert.equal(reduce(long, { type: 'ack', at: T0 + 80_000 }).state, 'idle', 'an ack clears the done');
  assert.equal(reduce(longFailed, { type: 'ack', at: T0 + 80_000 }).state, 'idle', 'and the errored, on a plain shell');
  assert.equal(reduce(session({ state: 'errored', errorType: 'api' }), { type: 'ack', at: T0 }).state, 'errored', "a Claude's errored waits for the next prompt");
  const cleared = mark(longFailed, 'C', T0 + 90_000);
  assert.equal(cleared.state, 'idle', 'the next command clears the badge');
  assert.equal(cleared.command!.state, 'running');
  // A D with a code and no C before it (no PSReadLine) still records the end, as a command of no length.
  const bare = mark(shell, 'D', T0 + 1000, 2);
  assert.deepEqual(bare.command, { state: 'failed', exitCode: 2, startedAt: T0 + 1000, endedAt: T0 + 1000 });
  assert.equal(bare.state, 'idle');
  // A shell Claude runs in is not moved by a command no hook of the
  // conversation landed in (M9 fix 360 reads the hook clock against the
  // C): the hooks own the state.
  const bound = mark(mark(session({ kind: 'shell', claudeSessionId: BOUND, state: 'done', lastEventAt: T0 + 500 }), 'C', T0 + 1000), 'D', T0 + 70_000, 0);
  assert.equal(bound.state, 'done', 'a bound shell keeps what the hooks set');
  assert.equal(bound.claudeSessionId, BOUND, 'and its binding');
  assert.equal(bound.command!.state, 'ok', 'the command is still recorded');
  // The command a hook of the still-open conversation landed in was claude, gone without a SessionEnd (M9 fix 360: Claude Code 2.1.272 and later post none on /exit): the prompt's return is the leaving. The shell is a fresh one, with no spans field, whose first span opens at its SessionStart (M9 fix 378; it read as open since the shell's creation before).
  const opened = reduce(reduce(mark(session({ kind: 'shell', claudeSessionId: null, state: 'idle', shellCwd: 'C:\\repo\\sub', cwd: 'C:\\repo\\sub' }), 'C', T0 + 1000), hook('SessionStart', { source: 'startup', transcript_path: 'C:\\t.jsonl' }, T0 + 2000)), hook('Stop', {}, T0 + 30_000));
  assert.equal(opened.claudeSessionId, BOUND);
  assert.equal(opened.state, 'done');
  assert.deepEqual(opened.spans!.map((x) => [x.startedAt, x.endedAt]), [[T0 + 2000, null]], 'the first span starts at the SessionStart');
  const left = mark(opened, 'D', T0 + 40_000, 0);
  assert.equal(left.claudeSessionId, null, 'the shell is a shell again');
  assert.equal(left.state, 'idle', 'leaving Claude is the person\'s own act, however short the visit');
  assert.equal(left.stateSince, T0 + 40_000);
  assert.equal(left.spans!.at(-1)!.endedAt, T0 + 40_000, 'the span closed at the prompt');
  assert.equal(left.conversation?.id, BOUND, 'the conversation stays for a resume');
  assert.equal(left.transcriptPath, null);
  assert.equal(left.lastEventAt, null);
  assert.equal(left.cwd, 'C:\\repo\\sub', 'back where the prompt last was');
  assert.deepEqual(left.command, { state: 'ok', exitCode: 0, startedAt: T0 + 1000, endedAt: T0 + 40_000 });
  // A SessionEnd that does arrive after the prompt moves nothing.
  const late = reduce(left, hook('SessionEnd', { reason: 'exit', transcript_path: 'C:\\t.jsonl' }, T0 + 40_100));
  assert.equal(late.claudeSessionId, null);
  assert.equal(late.state, 'idle');
  assert.equal(late.stateSince, T0 + 40_000, 'the row was already idle');
  assert.equal(late.spans!.at(-1)!.endedAt, T0 + 40_000, 'the span stays closed where it closed');
  assert.equal(late.transcriptPath, null);
  // The same conversation resumed at the prompt (claude --resume typed, M48) reopens its span with its old start; its /exit is the leaving again.
  const resumed = reduce(mark(left, 'C', T0 + 50_000), hook('SessionStart', { source: 'resume' }, T0 + 52_000));
  assert.equal(resumed.claudeSessionId, BOUND);
  assert.deepEqual(resumed.spans!.map((x) => [x.startedAt, x.endedAt]), [[T0 + 2000, null]], 'the old span, open again');
  const leftAgain = mark(resumed, 'D', T0 + 55_000, 0);
  assert.equal(leftAgain.claudeSessionId, null, 'a shell again after the resumed conversation\'s /exit');
  assert.equal(leftAgain.state, 'idle');
  assert.deepEqual(leftAgain.spans!.map((x) => [x.startedAt, x.endedAt]), [[T0 + 2000, T0 + 55_000]]);
  // And a command after that, with the shell plain, is a plain command again.
  const plainAgain = mark(mark(leftAgain, 'C', T0 + 60_000), 'D', T0 + 130_000, 0);
  assert.equal(plainAgain.state, 'done', 'a long plain command wants someone');
  // The command that hosted a conversation (a span closed after its C) ends without wanting anyone.
  const hosted = mark(reduce(reduce(mark(shell, 'C', T0 + 1000), hook('SessionStart', { source: 'startup' }, T0 + 2000)), hook('SessionEnd', { reason: 'exit' }, T0 + 60_000 + 5000)), 'D', T0 + 70_000, 0);
  assert.equal(hosted.claudeSessionId, null);
  assert.equal(hosted.state, 'idle', 'leaving Claude is the person\'s own act');
  assert.equal(hosted.command!.state, 'ok');
});

test('a cmd row (M9 fix 649): its prompt back with Claude bound and a hook landed is the leaving; before any hook, on another shell or with no Claude, a bare D changes nothing', () => {
  const mark = (s: SessionInfo, m: 'A' | 'C' | 'D', at: number, code: number | null = null): SessionInfo => reduce(s, { type: 'shell-mark', mark: m, code, at, doneAfterMs: 60_000 });
  const cmd = session({ kind: 'shell', shell: 'cmd', claudeSessionId: null, state: 'idle', shellCwd: 'C:\\repo\\sub', cwd: 'C:\\repo\\sub' });
  const bound = reduce(reduce(cmd, hook('SessionStart', { source: 'startup', transcript_path: 'C:\\t.jsonl' }, T0 + 2000)), hook('Stop', {}, T0 + 30_000));
  assert.equal(bound.claudeSessionId, BOUND);
  assert.equal(bound.state, 'done');
  // (1) cmd writes no C, so the bare D of its prompt coming back is the leaving.
  const left = mark(bound, 'D', T0 + 40_000);
  assert.equal(left.claudeSessionId, null, 'the cmd row is a shell again');
  assert.equal(left.state, 'idle');
  assert.equal(left.stateSince, T0 + 40_000);
  assert.equal(left.lastEventAt, null);
  assert.equal(left.transcriptPath, null);
  assert.equal(left.cwd, 'C:\\repo\\sub', 'back where the prompt last was');
  assert.equal(left.command ?? null, null, 'cmd never shows a command');
  assert.equal(left.spans!.at(-1)!.endedAt, T0 + 40_000, 'the span closed at the prompt');
  assert.equal(left.conversation?.id, BOUND, 'the conversation stays for a resume');
  // (2) A SessionEnd that does arrive after the prompt moves nothing.
  const late = reduce(left, hook('SessionEnd', { reason: 'exit', transcript_path: 'C:\\t.jsonl' }, T0 + 40_100));
  assert.equal(late.claudeSessionId, null);
  assert.equal(late.state, 'idle');
  assert.equal(late.stateSince, T0 + 40_000, 'the row was already idle');
  // (3) The next prompt on the plain row changes nothing.
  assert.equal(mark(left, 'D', T0 + 41_000), left, 'a bare D on the plain cmd row changes nothing');
  // (4) Before any hook (a resumed row's first prompt) the D changes nothing.
  const resumed = session({ kind: 'shell', shell: 'cmd', claudeSessionId: BOUND, lastEventAt: null, state: 'idle' });
  assert.equal(mark(resumed, 'D', T0 + 1000), resumed, 'no hook landed yet');
  // (5) Another shell writes C, so fix 360 reads its D, not this rule.
  const pwsh = { ...bound, shell: 'pwsh' as const };
  assert.equal(mark(pwsh, 'D', T0 + 40_000), pwsh, 'a bare D in a pwsh row changes nothing');
  // (6) No Claude bound: a plain cmd row's prompt changes nothing.
  assert.equal(mark(cmd, 'D', T0 + 1000), cmd, 'a plain cmd prompt changes nothing');
});

test('a record keeps its last 200 spans (M9 fix 509)', () => {
  const spans: SessionSpan[] = Array.from({ length: Limits.spansKept }, (_, i) => ({ conversation: `c${i}`, remoteSessionId: null, startedAt: T0 + i, endedAt: T0 + i + 1, startHead: null }));
  const after = reduce(session({ claudeSessionId: 'c199', spans }), hook('SessionStart', { source: 'clear', session_id: 'fresh' }, T0 + 10_000));
  assert.equal(after.spans!.length, Limits.spansKept);
  assert.equal(after.spans![0]!.conversation, 'c1', 'the oldest went');
  assert.equal(after.spans!.at(-1)!.conversation, 'fresh');
  assert.equal(after.spans!.at(-1)!.endedAt, null);
});

test('a task list keeps its last 500 (M9 fix 509)', () => {
  const todos = Array.from({ length: Limits.tasksKept + 1 }, (_, i) => ({ content: `task ${i + 1}`, status: 'pending' }));
  const written = reduce(session({ state: 'working' }), hook('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos } }));
  assert.equal(written.tasks!.length, Limits.tasksKept);
  assert.equal(written.tasks![0]!.subject, 'task 2', 'the first entry went');
  const full: SessionTask[] = Array.from({ length: Limits.tasksKept }, (_, i) => ({ id: String(i + 1), subject: `t${i + 1}`, activeForm: null, status: 'pending' }));
  const created = reduce(session({ state: 'working', tasks: full }), hook('PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'the new one' }, tool_response: { task: { id: '501' } } }));
  assert.equal(created.tasks!.length, Limits.tasksKept);
  assert.equal(created.tasks!.at(-1)!.subject, 'the new one');
  assert.equal(created.tasks![0]!.id, '2', 'the lowest id went');
  const reread = reduce(session({ state: 'working' }), { type: 'tasks', at: T0 + 1, tasks: [...full, { id: '501', subject: 't501', activeForm: null, status: 'pending' }] });
  assert.equal(reread.tasks!.length, Limits.tasksKept);
  assert.equal(reread.tasks![0]!.id, '2');
});

test('a team keeps its last 200 members, the dropped one\'s commits folded into the session (M9 fix 509)', () => {
  const member = (i: number): TeamMember => ({ id: `a${i}`, kind: 'agent', type: null, description: null, command: null, startedAt: T0 + i, endedAt: null, outcome: 'running', cwd: null, branch: null, commits: i === 0 ? [{ hash: 'f'.repeat(40), at: T0 + 1 }] : [], activity: null });
  const team = Array.from({ length: Limits.teamKept }, (_, i) => member(i));
  const after = reduce(session({ state: 'working', team }), hook('SubagentStart', { agent_id: 'new' }, T0 + 9000));
  assert.equal(after.team.length, Limits.teamKept);
  assert.equal(after.team[0]!.id, 'a1', 'the oldest went');
  assert.equal(after.team.at(-1)!.id, 'new');
  assert.equal(after.commits.length, 1);
  assert.equal(after.commits[0]!.hash, 'f'.repeat(40));
  assert.equal(after.commits[0]!.agent?.id, 'a0', 'the commit keeps its agent');
});

test('the mod\'s Spinner sets the word while a turn runs and nowhere else (M9 fix 738)', () => {
  const working = reduce(session({ state: 'working' }), hook('Spinner', { word: 'Perusing' }));
  assert.equal(working.liveVerb, 'Perusing');
  assert.equal(working.state, 'working');
  assert.equal(reduce(session({ state: 'needs-input', needsInputReason: 'permission' }), hook('Spinner', { word: 'Perusing' })).liveVerb, 'Perusing');
  assert.equal(reduce(session({ state: 'idle' }), hook('Spinner', { word: 'Perusing' })).liveVerb ?? null, null);
  assert.equal(reduce(session({ state: 'working', liveVerb: 'Grinding' }), hook('Spinner', { word: '' })).liveVerb, 'Grinding', 'an empty word keeps the last');
});

test('an aborted TurnComplete puts a running turn at idle with the live fields cleared (M9 fix 738)', () => {
  const live = { liveVerb: 'Perusing', liveReply: 'half a reply', liveTool: null };
  for (const state of ['working', 'needs-input'] as const) {
    const after = reduce(session({ state, ...live }), hook('TurnComplete', { turn_id: 't-1', is_aborted: true, reason: 'aborted' }));
    assert.equal(after.state, 'idle', `${state} goes to idle`);
    assert.equal(after.liveVerb, null);
    assert.equal(after.liveReply, null);
    assert.equal(after.needsInputReason, null);
  }
  assert.equal(reduce(session({ state: 'done' }), hook('TurnComplete', { turn_id: 't-1', is_aborted: true })).state, 'done', 'a done session stays done');
  assert.equal(reduce(session({ state: 'working' }), hook('TurnComplete', { turn_id: 't-2', is_aborted: true, turn_agent_id: 'a1' })).state, 'working', 'a subagent\'s aborted turn moves nothing');
  assert.equal(reduce(session({ state: 'working' }), hook('TurnComplete', { turn_id: 't-3', is_aborted: false, reason: 'answer' })).state, 'idle', 'a turn that ended with no Stop is idle whatever is_aborted says (fix 774)');
});

test('an Escape at a permission dialog (TurnComplete reason answer, no Stop) puts the row at idle with the ask gone (M9 fix 774)', () => {
  let s = reduce(session({ state: 'working' }), hook('PermissionRequest', { tool_name: 'Bash' }));
  s = reduce(s, hook('ToolAsk', { tool_name: 'Bash', tool_input: { command: 'ping -n 1 127.0.0.1' }, tool_use_id: 'u1' }));
  assert.equal(s.state, 'needs-input');
  const after = reduce(s, hook('TurnComplete', { turn_id: 't-1', reason: 'answer', is_aborted: false }));
  assert.equal(after.state, 'idle');
  assert.equal(after.needsInputReason, null);
  assert.equal(after.askedFor, null);
});

// M9 fix 801: the order an AskUserQuestion posts in (the capture's hooks
// log), cancelled with Escape: fix 774's rule frees the row.
test('an AskUserQuestion cancelled with Escape puts the row at idle with the ask gone (M9 fix 801)', () => {
  let s = reduce(session({ state: 'idle' }), hook('UserPromptSubmit', { prompt: 'ask me' }, T0 + 10));
  s = reduce(s, hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'u1' }, T0 + 20));
  s = reduce(s, hook('ToolAsk', { tool_name: 'AskUserQuestion', tool_input: {}, tool_use_id: 'u1' }, T0 + 21));
  s = reduce(s, hook('PermissionRequest', { tool_name: 'AskUserQuestion' }, T0 + 22));
  s = reduce(s, hook('Notification', { notification_type: 'permission_prompt' }, T0 + 30));
  assert.equal(s.state, 'needs-input');
  assert.equal(s.needsInputReason, 'question', 'fix 802');
  const after = reduce(s, hook('TurnComplete', { turn_id: 't-1', reason: 'answer', is_aborted: false }, T0 + 40));
  assert.equal(after.state, 'idle');
  assert.equal(after.needsInputReason, null);
  assert.equal(after.askedFor, null);
});

// M9 fix 802: the captured order of an AskUserQuestion reads as a
// question through its PermissionRequest and the permission_prompt after
// it; a Bash call in the same order stays a permission.
test('an AskUserQuestion asks a question, not a permission, through its permission_prompt (M9 fix 802)', () => {
  const run = (tool: string) => {
    let s = reduce(session({ state: 'idle' }), hook('UserPromptSubmit', { prompt: 'ask me' }, T0 + 10));
    s = reduce(s, hook('PreToolUse', { tool_name: tool, tool_use_id: 'u1' }, T0 + 20));
    s = reduce(s, hook('ToolAsk', { tool_name: tool, tool_input: {}, tool_use_id: 'u1' }, T0 + 21));
    const asked = reduce(s, hook('PermissionRequest', { tool_name: tool }, T0 + 22));
    const notified = reduce(asked, hook('Notification', { notification_type: 'permission_prompt' }, T0 + 30));
    return { asked, notified };
  };
  const q = run('AskUserQuestion');
  assert.equal(q.asked.state, 'needs-input');
  assert.equal(q.asked.needsInputReason, 'question');
  assert.equal(q.notified.state, 'needs-input');
  assert.equal(q.notified.needsInputReason, 'question');
  const b = run('Bash');
  assert.equal(b.asked.needsInputReason, 'permission');
  assert.equal(b.notified.needsInputReason, 'permission');
});

test('a finished turn replayed in its recorded order (Stop before TurnComplete) ends done, not idle (M9 fix 774)', () => {
  let s = reduce(session({ state: 'idle' }), hook('UserPromptSubmit', { prompt: 'ping it' }, T0 + 10));
  s = reduce(s, hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'u1' }, T0 + 20));
  s = reduce(s, hook('ToolAsk', { tool_name: 'Bash', tool_input: { command: 'ping -n 1 127.0.0.1' }, tool_use_id: 'u1' }, T0 + 21));
  s = reduce(s, hook('PermissionRequest', { tool_name: 'Bash' }, T0 + 22));
  s = reduce(s, hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'u1' }, T0 + 30));
  s = reduce(s, hook('Stop', {}, T0 + 40));
  assert.equal(s.state, 'done');
  s = reduce(s, hook('TurnComplete', { turn_id: 't-1', is_aborted: false }, T0 + 41));
  assert.equal(s.state, 'done', 'the TurnComplete after a Stop moves nothing');
});

test('a top-level TurnComplete leaves a paused turn waiting on an asking member alone (M9 fix 774)', () => {
  const working = reduce(session({ state: 'working' }), hook('SubagentStart', { agent_id: 'a1', agent_type: 'fork' }, T0 + 10));
  const askedMidTurn = reduce(working, hook('PermissionRequest', { agent_id: 'a1', tool_name: 'Bash' }, T0 + 30));
  const pausedAsking = reduce(askedMidTurn, hook('Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'running' }] }, T0 + 31));
  assert.equal(pausedAsking.needsInputReason, 'agent-permission');
  const after = reduce(pausedAsking, hook('TurnComplete', { turn_id: 't-1', is_aborted: false }, T0 + 32));
  assert.equal(after.state, 'needs-input');
  assert.equal(after.needsInputReason, 'agent-permission');
});

test("a member's TurnComplete keeps the parent's ask (M9 fix 774)", () => {
  const asked = reduce(session({ state: 'working' }), hook('ToolAsk', { tool_name: 'Bash', tool_input: { command: 'npm publish' }, tool_use_id: 'u1' }));
  const after = reduce(asked, hook('TurnComplete', { turn_id: 't-2', is_aborted: false, turn_agent_id: 'a1' }));
  assert.equal(after.askedFor?.words, 'Bash: npm publish');
});

test("the mod's ToolRunning for the asked call puts an answered permission back at working (M9 fix 775)", () => {
  let s = reduce(session({ state: 'idle' }), hook('UserPromptSubmit', { prompt: 'ping it' }, T0 + 10));
  s = reduce(s, hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'u1' }, T0 + 20));
  s = reduce(s, hook('ToolAsk', { tool_name: 'Bash', tool_input: { command: 'ping -n 11 127.0.0.1' }, tool_use_id: 'u1' }, T0 + 21));
  s = reduce(s, hook('PermissionRequest', { tool_name: 'Bash' }, T0 + 22));
  assert.equal(s.state, 'needs-input');
  const running = reduce(s, hook('ToolRunning', { tool_use_id: 'u1' }, T0 + 30));
  assert.equal(running.state, 'working');
  assert.equal(running.needsInputReason, null);
  assert.equal(running.askedFor, null);
  // (2) Another call's progress answers nothing.
  const other = reduce(s, hook('ToolRunning', { tool_use_id: 'u2' }, T0 + 30));
  assert.equal(other.state, 'needs-input');
  assert.equal(other.askedFor?.words, 'Bash: ping -n 11 127.0.0.1');
});

test("ToolRunning moves neither an agent's ask nor an idle row (M9 fix 775)", () => {
  const working = reduce(session({ state: 'working' }), hook('SubagentStart', { agent_id: 'a1', agent_type: 'fork' }, T0 + 10));
  const agentAsk = reduce(working, hook('PermissionRequest', { agent_id: 'a1', tool_name: 'Bash' }, T0 + 30));
  assert.equal(agentAsk.needsInputReason, 'agent-permission');
  const after = reduce(agentAsk, hook('ToolRunning', { tool_use_id: 'u9' }, T0 + 31));
  assert.equal(after.state, 'needs-input');
  assert.equal(after.needsInputReason, 'agent-permission');
  assert.equal(reduce(session({ state: 'idle' }), hook('ToolRunning', { tool_use_id: 'u1' })).state, 'idle');
});

test('a Measure sets the context percent and the cost and leaves the model, the state and the clock (M9 fix 739)', () => {
  const before = session({ state: 'working', model: 'Opus 5.5', lastEventAt: T0 + 1 });
  const after = reduce(before, hook('Measure', { measure: { context: { percent: 25, window: 200000, tokens: 50000 }, cost: { usd: 1.5 }, rateLimits: [], changed: ['context', 'cost'], model: 'claude-opus-5-5' } }));
  assert.equal(after.contextPercent, 25);
  assert.equal(after.costUsd, 1.5);
  assert.equal(after.contextWindow?.size, 200000);
  assert.equal(after.contextWindow?.used, 50000);
  assert.equal(after.model, 'Opus 5.5', 'the row keeps the status line\'s name');
  assert.equal(after.state, 'working');
  assert.equal(after.lastEventAt, T0 + 1, 'a measure says nothing about whether Claude is busy');
  assert.equal(reduce(after, hook('Measure', { measure: { changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] } })), after, 'a limits-only measure changes nothing on the row');
});

test('TurnStart moves nothing but the clock (M9 fix 738)', () => {
  const after = reduce(session({ state: 'idle' }), hook('TurnStart', { turn_id: 't-1' }));
  assert.equal(after.state, 'idle');
  assert.equal(after.lastEventAt, T0 + 5000);
});

test("a ToolAsk names the ask without moving the state, a PermissionRequest keeps it, the call's PostToolUse clears it (M9 fix 742)", () => {
  const asked = reduce(session({ state: 'working', needsInputReason: null }), hook('ToolAsk', { tool_name: 'Bash', tool_input: { command: 'npm publish' }, tool_use_id: 'u1' }));
  assert.equal(asked.state, 'working');
  assert.equal(asked.askedFor?.words, 'Bash: npm publish');
  assert.equal(asked.askedFor?.toolUseId, 'u1');
  const dialog = reduce(asked, hook('PermissionRequest', { tool_name: 'Bash' }));
  assert.equal(dialog.state, 'needs-input');
  assert.equal(dialog.askedFor?.words, 'Bash: npm publish', 'the dialog keeps it');
  const other = reduce(dialog, hook('PostToolUse', { tool_name: 'Read', tool_use_id: 'u2' }));
  assert.equal(other.askedFor?.words, 'Bash: npm publish', "another call's end keeps it");
  assert.equal(reduce(other, hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'u1' })).askedFor, null, "the call's own end clears it");
});

test("a new prompt clears the ask, and an agent's ToolAsk is applied with its agent named (M9 fix 742)", () => {
  const asked = reduce(session({ state: 'working' }), hook('ToolAsk', { tool_name: 'Bash', tool_input: { command: 'npm publish' }, tool_use_id: 'u1' }));
  assert.equal(reduce(asked, hook('UserPromptSubmit', { prompt: 'next' })).askedFor, null);
  const payload: HookPayload = { hook_event_name: 'ToolAsk', session_id: BOUND, tool_name: 'Edit', tool_input: { file_path: 'C:/r/a.ts' }, tool_use_id: 'u3', ask_agent_id: 'a1' };
  assert.equal(classifyHook(session({ state: 'working' }), payload), 'applied');
  const agentAsk = reduce(session({ state: 'working' }), { type: 'hook', at: T0 + 5000, payload });
  assert.equal(agentAsk.askedFor?.agentId, 'a1');
  assert.equal(agentAsk.askedFor?.words, 'Edit: a.ts');
});

test('an automatic compaction at idle, waiting or done puts the row back when it ends (M9 fix 812)', () => {
  const auto = { trigger: 'auto' };
  for (const state of ['idle', 'done'] as const) {
    const pre = reduce(session({ state, stateSince: T0 }), hook('PreCompact', auto, T0 + 10));
    assert.equal(pre.state, 'working', `${state}: PreCompact puts the row at working`);
    assert.deepEqual(pre.compactFrom, { state, since: T0 }, `${state}: the record names where it was`);
    const restarted = reduce(pre, hook('SessionStart', { source: 'compact' }, T0 + 20));
    assert.equal(restarted.state, 'working', `${state}: the compaction's SessionStart keeps it working`);
    assert.deepEqual(restarted.compactFrom, { state, since: T0 }, `${state}: and keeps the record`);
    const post = reduce(restarted, hook('PostCompact', auto, T0 + 30));
    assert.equal(post.state, state, `${state}: PostCompact puts it back`);
    assert.equal(post.stateSince, T0, `${state}: with its age`);
    assert.equal(post.compactFrom, null, `${state}: and drops the record`);
  }
  const task = { type: 'local_bash', description: 'npm test', command: 'npm test' };
  const waiting = session({ state: 'waiting', stateSince: T0, waitingOn: [task] });
  const waitPre = reduce(waiting, hook('PreCompact', auto, T0 + 10));
  assert.equal(waitPre.state, 'working');
  const waitPost = reduce(waitPre, hook('PostCompact', auto, T0 + 30));
  assert.equal(waitPost.state, 'waiting', 'a waiting row comes back waiting');
  assert.deepEqual(waitPost.waitingOn, [task], 'with the list it was waiting on');
  assert.equal(waitPost.stateSince, T0);

  const busy = reduce(reduce(session({ state: 'working', stateSince: T0 }), hook('PreCompact', auto, T0 + 10)), hook('PostCompact', auto, T0 + 30));
  assert.equal(busy.state, 'working', 'a full window mid-turn stays working');
  assert.equal(busy.compactFrom ?? null, null, 'and records nothing');
  assert.equal(Object.hasOwn(busy, 'compactFrom'), false, 'nor touches the key');

  const manual = reduce(reduce(session({ state: 'idle', stateSince: T0 }), hook('PreCompact', { trigger: 'manual' }, T0 + 10)), hook('PostCompact', { trigger: 'manual' }, T0 + 30));
  assert.equal(manual.state, 'working', 'a typed /compact is left as it was');

  const idlePre = reduce(session({ state: 'idle', stateSince: T0 }), hook('PreCompact', auto, T0 + 10));
  const prompted = reduce(idlePre, hook('UserPromptSubmit', { prompt: 'go on' }, T0 + 20));
  assert.equal(prompted.compactFrom, null, 'a prompt during the compaction clears the record');
  assert.equal(reduce(prompted, hook('PostCompact', auto, T0 + 30)).state, 'working', 'and the PostCompact stays at working');
  const stopped = reduce(idlePre, hook('Stop', {}, T0 + 20));
  assert.equal(stopped.state, 'done');
  assert.equal(stopped.compactFrom, null, 'a Stop during the compaction clears the record');
  const gone = reduce(idlePre, { type: 'pty.exit', at: T0 + 20, exitCode: 0 });
  assert.equal(gone.state, 'exited');
  assert.equal(gone.compactFrom, null, 'an exit during the compaction clears the record');
});

test("a Claude session keeps its SessionEnd's reason through the exit, and a SessionStart clears it (M9 fix 813)", () => {
  const end = hook('SessionEnd', { reason: 'prompt_input_exit' }, T0 + 10);
  const exit: SessionEvent = { type: 'pty.exit', at: T0 + 20, exitCode: 0 };
  const endFirst = reduce(reduce(session({ state: 'idle' }), end), exit);
  assert.equal(endFirst.state, 'exited');
  assert.equal(endFirst.endReason, 'prompt_input_exit', 'the SessionEnd before the exit');
  const exitFirst = reduce(reduce(session({ state: 'idle' }), { ...exit, at: T0 + 5 }), end);
  assert.equal(exitFirst.state, 'exited');
  assert.equal(exitFirst.endReason, 'prompt_input_exit', 'the SessionEnd after the exit');
  const resumed = reduce({ ...endFirst, state: 'starting', pid: 9 }, hook('SessionStart', { source: 'resume' }, T0 + 30));
  assert.equal(resumed.endReason, null, 'a SessionStart clears it');
  const shell = reduce(session({ kind: 'shell', state: 'idle' }), end);
  assert.equal(Object.hasOwn(shell, 'endReason'), false, 'a shell hosting Claude keeps nothing');
  const plain = reduce(session({ state: 'idle' }), hook('SessionEnd', {}, T0 + 10));
  assert.equal(Object.hasOwn(plain, 'endReason'), false, 'a SessionEnd with no reason leaves the key alone');
});
