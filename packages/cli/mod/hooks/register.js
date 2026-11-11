// The emerald mod (M9 fix 725): posts every classic hook event to the
// daemon's hook sink from inside the Claude process, so an event costs no
// cmd.exe and curl.exe of its own. It only observes: it never answers and
// never rewrites, and the event always goes on to the rest of the chain.
// PreToolUse is skipped, since its `e` is the tool-call envelope rather
// than the hook's stdin JSON and would neither fold against the hook
// file's copy nor parse as a hook post; that event stays the hook file's.
// Only the events `emmer hooks install` puts in the settings are posted
// (HOOK_EVENTS in hooks-install.ts less PreToolUse; the CLI's mod test
// holds the two lists together): classic.* also raises events no settings
// hook carries, MessageDisplay once per streamed piece of a reply among
// them, which the probe of fix 725 saw and the daemon has no use for.
// A plain ES module with no build step: the CLI's tsc includes src alone.
const POSTED = new Set([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'Notification',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'CwdChanged',
]);

export function register(on) {
  on('classic.*', async ($, e, next) => {
    if (!POSTED.has(e.hook_event_name)) return next(e);
    // Literal names, so `claude plugin validate` can list what the mod reads.
    const sessionId = await $.env.get('EMERALD_SESSION_ID');
    const port = await $.env.get('EMERALD_HOOK_PORT');
    const token = await $.env.get('EMERALD_HOOK_TOKEN');
    // An unhosted Claude never gets the --plugin-dir flag; this guards one
    // that loads the mod anyway.
    if (!sessionId || !port || !token) return next(e);
    // Started before next() so it reaches the daemon ahead of the settings
    // hook's cmd.exe: the daemon keeps the first copy and folds the other.
    const post = $.http.fetch(`http://127.0.0.1:${port}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': token, 'X-Emerald-Session': sessionId, 'X-Emerald-Hook': 'emerald-mod' },
      body: JSON.stringify(e),
    }).catch(() => undefined);
    const result = await next(e);
    // curl's --max-time 1.5: a hung daemon costs a hook at most that.
    await Promise.race([post, $.clock.sleep(1500)]);
    return result;
  }).catch(($, e, next) => next(e));

  // M9 fixes 738 to 740: the spinner's word and a turn's start and end with
  // its usage, posted as emerald's own events. validate refuses one event
  // hooked twice in a module, so each hook's body is a named function a
  // merged block can call beside another's.
  // M9 fix 775 widens the matcher to a running call's progress row.
  on('ui.render', { component: ['Spinner', 'ToolProgress'] }, ($, e, next) => {
    if (e.component === 'ToolProgress') postToolRunning($, e);
    else postSpinnerWord($, e);
    return next(e);
  }).catch(($, e, next) => next(e));
  on('turn.start', async ($, e, next) => {
    const r = await next(e);
    postTurnStart($, e);
    return r;
  }).catch(($, e, next) => next(e));
  on('turn.complete', async ($, e, next) => {
    const r = await next(e);
    postTurnComplete($, e);
    return r;
  }).catch(($, e, next) => next(e));
  on('session.measure', async ($, e, next) => {
    const r = await next(e);
    postMeasure($, e);
    return r;
  }).catch(($, e, next) => next(e));

  // M9 fixes 741 and 742: the prompt channel and the ask, kept apart from the classic.* hook so the two branches merge clean.
  // The engine takes one hook per event in a module, so a branch that
  // hooks session.start too calls openPromptChannel from its own hook.
  on('session.start', async ($, e, next) => {
    const started = await next(e);
    await openPromptChannel($, e).catch(() => undefined);
    return started;
  }).catch(($, e, next) => next(e));

  on('tool.check', async ($, e, next) => {
    const result = await next(e);
    // A post that fails must not fail the hook, whose .catch would then
    // run the chain beneath a second time.
    await postToolAsk($, e, result).catch(() => undefined);
    return result;
  }).catch(($, e, next) => next(e));

  // M9 fix 769: each row the conversation keeps, posted once it is kept, so the chat view draws it before the transcript file has it.
  on('session.append', { door: APPEND_DOORS }, async ($, e, next) => {
    const stored = await next(e);
    postRow($, e, stored);
    return stored;
  }).catch(($, e, next) => next(e));

  // M9 fix 773: keep an idle session whole. The daemon decides from the session's mark and state; a manual or plugin compaction and a subagent's own always go on.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    const skip = await askKeepWhole($, e.trigger).catch(() => null);
    return skip ? { skip } : next(e);
  }).catch(($, e, next) => next(e));
}

// The word last posted, so a redraw of the same word posts nothing: the
// spinner draws once per input value, and the word holds for many draws.
let lastSpinnerWord = null;

// Posts one of emerald's own events to the hook sink as the classic hook
// posts, under the mod's header. Never awaited by a caller, so a slow or
// dead daemon never holds a draw or a turn; off a hosted session it
// returns at once.
async function postTurnEvent($, fields) {
  const sessionId = await $.env.get('EMERALD_SESSION_ID');
  const port = await $.env.get('EMERALD_HOOK_PORT');
  const token = await $.env.get('EMERALD_HOOK_TOKEN');
  if (!sessionId || !port || !token) return undefined;
  const conversation = await $.session.id();
  return $.http.fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': token, 'X-Emerald-Session': sessionId, 'X-Emerald-Hook': 'emerald-mod' },
    body: JSON.stringify({ session_id: conversation, ...fields }),
  });
}

function postSpinnerWord($, e) {
  const word = e.props?.word;
  if (typeof word !== 'string' || word === '' || word === lastSpinnerWord) return;
  lastSpinnerWord = word;
  void postTurnEvent($, { hook_event_name: 'Spinner', word, ...(typeof e.requestId === 'string' ? { spinner_id: e.requestId } : {}) }).catch(() => undefined);
}

// M9 fix 775: a running call's progress row, drawn only once the call
// runs, so after an ask it says the dialog was answered. Posted once per
// call: the ids posted are kept, the last 64, since the row redraws many
// times a call.
const runningPosted = new Set();

function postToolRunning($, e) {
  const id = e.props?.tool_use_id;
  if (typeof id !== 'string' || id === '' || runningPosted.has(id)) return;
  runningPosted.add(id);
  if (runningPosted.size > 64) runningPosted.delete(runningPosted.values().next().value);
  void postTurnEvent($, { hook_event_name: 'ToolRunning', tool_use_id: id }).catch(() => undefined);
}

// M9 fix 995: the running main-loop turn's id, or null, so a submit that
// arrives mid-turn can say at once that it waits for the turn's end.
let mainTurn = null;
// Submits taken off the channel whose $.prompt.submit has not settled; one
// behind another waits for the first's turn too.
let submitsOut = 0;

// A subagent's turns start too; only the main loop's is the row's.
function postTurnStart($, e) {
  if (e.agentId !== undefined) return;
  mainTurn = e.turnId ?? true;
  void postTurnEvent($, { hook_event_name: 'TurnStart', turn_id: e.turnId }).catch(() => undefined);
}

// A subagent's turn is posted too, since its usage is the person's cost,
// under turn_agent_id: an agent_id would send it down the daemon's agent path.
function postTurnComplete($, e) {
  if (e.agentId === undefined) mainTurn = null;
  void postTurnEvent($, {
    hook_event_name: 'TurnComplete',
    turn_id: e.turnId,
    ...(e.agentId !== undefined ? { turn_agent_id: e.agentId } : {}),
    reason: e.reason,
    is_aborted: e.isAborted,
    duration_ms: e.durationMs,
    ...(e.usage !== undefined ? { usage: e.usage } : {}),
  }).catch(() => undefined);
}

// The session's measure (M9 fix 739): the context, the account's rate-limit
// windows and the cost, raised whenever one moves. Everything under one key,
// so nothing meets the status line's own model, cost and context_window
// fields on the daemon's payload; the model is posted for the log alone.
function postMeasure($, e) {
  const measured = (async () => {
    const model = await $.session.model().catch(() => null);
    return postTurnEvent($, {
      hook_event_name: 'Measure',
      measure: { context: e.context, rateLimits: e.rateLimits, ...(e.cost !== undefined ? { cost: e.cost } : {}), changed: e.changed, model },
    });
  })();
  void measured.catch(() => undefined);
  // M9 fix 1036: a measure whose context moved asks for the breakdown too;
  // a limits-only measure asks nothing.
  if (Array.isArray(e.changed) && e.changed.includes('context')) void postContext($, 'summary').catch(() => undefined);
}

// M9 fix 1036: one summary ask out at a time, since measures can come a
// second apart and a summary in flight already answers the next; a full
// (the tab's Recount) always runs.
let contextAsked = false;

// The session's context breakdown, posted as Context: what
// $.session.usage({ breakdown }) answers, less gridRows, 12 to 25 KB that
// only repeat the categories (the tab draws its own grid). A summary
// estimates locally; a full counts each part with the token-count API.
async function postContext($, detail) {
  if (detail === 'summary') {
    if (contextAsked) return;
    contextAsked = true;
  }
  try {
    const usage = await $.session.usage({ breakdown: detail });
    const breakdown = usage?.context?.breakdown;
    if (!breakdown || typeof breakdown !== 'object') return;
    const { gridRows: _grid, ...rest } = breakdown;
    await postTurnEvent($, { hook_event_name: 'Context', detail, breakdown: rest });
  } finally {
    if (detail === 'summary') contextAsked = false;
  }
}


// M9 fix 742: a permission ask, posted to the daemon as it is decided
// (hook_event_name ToolAsk) so the row can say what is asked for before
// the dialog draws. Observe only: the decision goes on unchanged and the
// post is not awaited, so the ask never waits on the daemon. A query
// from another plugin ($.tool.check, no tool_use_id) asks nobody.
async function postToolAsk($, e, result) {
  if (result.decision !== 'ask' || e.tool_use_id === undefined) return;
  const sessionId = await $.env.get('EMERALD_SESSION_ID');
  const port = await $.env.get('EMERALD_HOOK_PORT');
  const token = await $.env.get('EMERALD_HOOK_TOKEN');
  if (!sessionId || !port || !token) return;
  const body = {
    hook_event_name: 'ToolAsk',
    session_id: await $.session.id(),
    tool_name: e.tool,
    tool_input: shortInput(e.input),
    tool_use_id: e.tool_use_id,
    ...(e.agentId ? { ask_agent_id: e.agentId } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.rule ? { rule: result.rule } : {}),
  };
  void $.http.fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': token, 'X-Emerald-Session': sessionId, 'X-Emerald-Hook': 'emerald-mod' },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

// The input's own scalar fields, each string cut to 200 characters, so a
// Write's content never travels whole.
function shortInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

// M9 fix 741: a prompt the daemon routes here (emmer send --enter, emmer
// prompt) is submitted by the mod rather than typed into the pty, where
// Claude Code's paste detection turns an Enter that arrives too soon into
// a newline (M5 gotcha 4). Since M9 fix 1125 the channel is a long poll on
// the hook sink: one request held per session, answered with the lines
// queued for it or with none after 20 s, and asked again at once, so the
// mod needs no process of its own (each emmer mod-channel held 24 MB). A
// submit waits for the turn in flight, as a typed line would queue behind
// it. A poll the daemon refuses ends the loop and leaves the session on
// the typed path.
// A poll that throws (the daemon restarting its sink, a fetch past its
// 30 s) is asked again after CHANNEL_RETRY_MS, and the loop ends after
// CHANNEL_RETRIES in a row.
const CHANNEL_RETRY_MS = 2000;
const CHANNEL_RETRIES = 5;
// One loop a process: a /clear's second session.start finds it running.
let channelOpen = false;

async function openPromptChannel($, e) {
  // A -p run has no prompt to queue into.
  if (!e.isInteractive) return;
  const sessionId = await $.env.get('EMERALD_SESSION_ID');
  const port = await $.env.get('EMERALD_HOOK_PORT');
  const token = await $.env.get('EMERALD_HOOK_TOKEN');
  if (!sessionId || !port || !token || channelOpen) return;
  channelOpen = true;
  const headers = { 'Content-Type': 'application/json', 'X-Emerald-Token': token, 'X-Emerald-Session': sessionId, 'X-Emerald-Hook': 'emerald-mod' };
  // A sleep or a fetch aborted as the environment unloads rejects; caught,
  // so it is never an unhandled rejection.
  void pollPrompts($, `http://127.0.0.1:${port}/channel`, headers)
    .catch(() => undefined)
    .finally(() => {
      channelOpen = false;
    });
}

async function pollPrompts($, url, headers) {
  // One chain, so prompts go in in the order they came.
  let chain = Promise.resolve();
  let failures = 0;
  for (;;) {
    let reply;
    try {
      reply = await $.http.fetch(url, { method: 'POST', headers, body: '{}' });
    } catch {
      failures += 1;
      if (failures >= CHANNEL_RETRIES) return;
      await $.clock.sleep(CHANNEL_RETRY_MS);
      continue;
    }
    failures = 0;
    // 409 a newer poll took over, 404 a sink without the route, 401 a
    // token the daemon no longer holds.
    if (reply.status !== 200) return;
    let lines;
    try {
      lines = JSON.parse(reply.text).lines;
    } catch {
      return;
    }
    if (!Array.isArray(lines)) return;
    for (const parsed of lines) chain = takeLine($, parsed, chain);
  }
}

// One line off the poll, and the submit chain as it stands after it.
function takeLine($, parsed, chain) {
  if (parsed === null || typeof parsed !== 'object') return chain;
  // M9 fix 1036: an ask for the context breakdown, never put on the
  // submit chain.
  if (parsed.context === 'summary' || parsed.context === 'full') {
    void postContext($, parsed.context).catch(() => undefined);
    return chain;
  }
  const { text, submitId } = parsed;
  if (typeof text !== 'string' || text === '') return chain;
  // M9 fix 995: a plugin's prompt runs once the session is idle, so
  // one that arrives mid-turn, or behind another still out, says so
  // at once; entered: true so an older daemon answers mod, which is
  // right for a prompt that will enter. The final word follows.
  if (typeof submitId === 'string' && (mainTurn !== null || submitsOut > 0)) {
    void postTurnEvent($, { hook_event_name: 'ModSubmit', submit_id: submitId, entered: true, queued: true }).catch(() => undefined);
  }
  submitsOut += 1;
  return chain
    .then(() => submitAndSay($, text, submitId))
    .catch(() => undefined)
    .finally(() => {
      submitsOut -= 1;
    });
}

// M9 fix 781: one submit, and the daemon told what it answered, under the
// id its push carried. The engine refuses a plugin's prompt with no turn
// while a person's Stop stands ({ drop: 'the session was stopped and
// nobody has sent input since' } on 2.1.301), and the send waiting on the
// daemon types such a prompt instead, as a person's input that clears the
// Stop. A submit that throws did not enter either. The word is posted,
// never awaited, so the chain moves on at once.
async function submitAndSay($, text, submitId) {
  let entered = false;
  let drop = null;
  try {
    const result = await $.prompt.submit({ text, asUser: true });
    if (result && typeof result.drop === 'string') drop = result.drop;
    else entered = true;
  } catch (err) {
    drop = err instanceof Error ? err.message : String(err);
  }
  if (typeof submitId !== 'string') return;
  void postTurnEvent($, { hook_event_name: 'ModSubmit', submit_id: submitId, entered, ...(drop === null ? {} : { drop }) }).catch(() => undefined);
}

// M9 fix 769: the rows the chat view draws ahead of the transcript file.
// Every door but `queue`, which is a queue record's text and no row of
// the conversation. A row travels in one POST to the hook sink, whose
// body limit is 1 MB, so long strings are capped: a reply or thought past
// ROW_STRING_CAP, or a tool input holding one, marks the row cut, and the
// view never draws a cut row (a cut hunk or reply would draw wrong until
// the file's line came), and a cut row goes with no blocks, its uuid and
// door still saying a row came. A tool result keeps only its text, sliced
// to ROW_RESULT_CAP, since the view reads only the exit code at its start;
// that cut is not marked. A row still past ROW_POST_CAP is cut too.
// M9 fix 920: no compaction door. Its summary row carries no
// isCompactSummary (rowForPost keeps type, role and isMeta), so on the fork
// it would fold as a prompt bubble; the file's line, which marks it, draws
// the note and its summary within one read.
const APPEND_DOORS = ['prompt', 'command', 'response', 'tool-result', 'tool-message', 'delivery', 'attachment', 'hook-context', 'note', 'notice'];
const ROW_STRING_CAP = 32768;
const ROW_RESULT_CAP = 4096;
const ROW_POST_CAP = 524288;

// A subagent's row is skipped (the view draws no side chain), as is any
// row that is neither a user's nor an assistant's. Never awaited, so a
// row is never held on the daemon.
function postRow($, e, stored) {
  if (e.agentId !== undefined) return;
  const message = stored?.message;
  if (!message || (message.type !== 'user' && message.type !== 'assistant')) return;
  const { row, cut } = rowForPost(message);
  void postTurnEvent($, { hook_event_name: 'Append', uuid: stored.uuid ?? e.uuid, door: e.door, row, ...(cut ? { cut: true } : {}) }).catch(() => undefined);
}

function rowForPost(message) {
  let cut = false;
  const content = [];
  for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      if (block.text.length > ROW_STRING_CAP) cut = true;
      content.push(block);
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      if (block.thinking.length > ROW_STRING_CAP) cut = true;
      content.push(block);
    } else if (block.type === 'tool_use') {
      if (holdsLongString(block.input)) cut = true;
      content.push(block);
    } else if (block.type === 'tool_result') {
      content.push(resultForPost(block));
    } else if (block.type === 'image' && message.type === 'user') {
      // A pasted image: the transcript's line draws it.
      continue;
    } else {
      content.push(block);
    }
  }
  const row = { type: message.type, ...(message.role ? { role: message.role } : {}), ...(message.isMeta ? { isMeta: true } : {}), content };
  // A cut row is never drawn, so its blocks would only cost the post.
  if (cut || JSON.stringify(row).length > ROW_POST_CAP) return { row: { ...row, content: [] }, cut: true };
  return { row, cut };
}

// A tool result's text alone, sliced, and its image as an empty one,
// which draws no thumbnail until the file's line brings the picture.
function resultForPost(block) {
  const parts = typeof block.content === 'string' ? [{ type: 'text', text: block.content }] : Array.isArray(block.content) ? block.content : [];
  const text = parts.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('\n').slice(0, ROW_RESULT_CAP);
  const image = parts.find((p) => p && p.type === 'image');
  const content = [{ type: 'text', text }];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.source?.media_type ?? 'image/png', data: '' } });
  return { type: 'tool_result', tool_use_id: block.tool_use_id, ...(block.is_error !== undefined ? { is_error: block.is_error } : {}), content };
}

function holdsLongString(value) {
  if (typeof value === 'string') return value.length > ROW_STRING_CAP;
  if (Array.isArray(value)) return value.some(holdsLongString);
  if (value !== null && typeof value === 'object') return Object.values(value).some(holdsLongString);
  return false;
}

// Asks the daemon whether to skip a compaction (M9 fix 773): the skip
// reason when the session is marked to keep whole and sits idle, else null.
// Off a hosted session, on a dead or slow daemon (the classic post's 1.5 s
// bound) or on any answer but a reason, null, and the compaction goes on.
async function askKeepWhole($, trigger) {
  const sessionId = await $.env.get('EMERALD_SESSION_ID');
  const port = await $.env.get('EMERALD_HOOK_PORT');
  const token = await $.env.get('EMERALD_HOOK_TOKEN');
  if (!sessionId || !port || !token) return null;
  const ask = $.http.fetch(`http://127.0.0.1:${port}/compact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': token, 'X-Emerald-Session': sessionId, 'X-Emerald-Hook': 'emerald-mod' },
    body: JSON.stringify({ trigger }),
  });
  // The sleep resolves with nothing, which reads as no answer.
  const reply = await Promise.race([ask, $.clock.sleep(1500)]);
  if (!reply || !reply.ok) return null;
  const skip = JSON.parse(reply.text).skip;
  return typeof skip === 'string' && skip !== '' ? skip : null;
}
