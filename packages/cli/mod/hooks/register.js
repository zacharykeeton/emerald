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

// A subagent's turns start too; only the main loop's is the row's.
function postTurnStart($, e) {
  if (e.agentId !== undefined) return;
  void postTurnEvent($, { hook_event_name: 'TurnStart', turn_id: e.turnId }).catch(() => undefined);
}

// A subagent's turn is posted too, since its usage is the person's cost,
// under turn_agent_id: an agent_id would send it down the daemon's agent path.
function postTurnComplete($, e) {
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
// a newline (M5 gotcha 4). The daemon launches the session with the
// channel's command in EMERALD_MOD_CHANNEL; the child prints one JSON line
// per prompt and lives as long as the session. A submit waits for the
// turn in flight, as a typed line would queue behind it. A channel that
// dies leaves the session on the typed path, since the daemon drops it
// when its pipe closes.
async function openPromptChannel($, e) {
  // A -p run has no prompt to queue into.
  if (!e.isInteractive) return;
  const channel = await $.env.get('EMERALD_MOD_CHANNEL');
  const sessionId = await $.env.get('EMERALD_SESSION_ID');
  if (!channel || !sessionId) return;
  let argv;
  try {
    argv = JSON.parse(channel);
  } catch {
    return;
  }
  if (!Array.isArray(argv) || argv.length === 0) return;
  void streamPrompts($, [...argv, sessionId]);
}

async function streamPrompts($, argv) {
  // One chain, so prompts go in in the order they came.
  let chain = Promise.resolve();
  let buffer = '';
  try {
    // ELECTRON_RUN_AS_NODE for an installed daemon's Emerald.exe, which the
    // pty's environment strips; plain node ignores it.
    const child = $.process.spawn({ argv, env: { ELECTRON_RUN_AS_NODE: '1' } });
    for await (const piece of child) {
      if (piece.stream !== 'stdout') continue;
      buffer += piece.text;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let text;
        let submitId;
        try {
          ({ text, submitId } = JSON.parse(line));
        } catch {
          continue;
        }
        if (typeof text !== 'string' || text === '') continue;
        chain = chain.then(() => submitAndSay($, text, submitId)).catch(() => undefined);
      }
    }
  } catch {
    // The channel could not start or died; the typed path stays.
  }
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
const APPEND_DOORS = ['prompt', 'command', 'response', 'tool-result', 'tool-message', 'delivery', 'attachment', 'hook-context', 'note', 'compaction', 'notice'];
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
