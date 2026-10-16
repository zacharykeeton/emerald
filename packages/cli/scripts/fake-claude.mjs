// A stand-in for Claude Code inside an emmer shell, for verify:cli: reads
// lines from its terminal and posts the hooks a real turn would, with the
// session id, port and token the daemon stamped on the shell's
// environment. Each line is a prompt: UserPromptSubmit at once, then a
// Stop with "echo: <line>" as the reply a moment later. A line starting
// with "ask" posts a PermissionRequest instead, and stays there until the
// next line, which answers it; one starting with "pause" posts a Stop with
// a shell still running in background_tasks (M9 fix 52); one starting
// with "plan" posts the task tool calls a turn with a checklist makes
// (M9 fix 153), three TaskCreates and two TaskUpdates, before its Stop;
// one starting with "quiet" posts a PreToolUse and then nothing (M9 fix
// 232, a tool call that hangs), until the next line, which posts the
// PostToolUse and a Stop. "quit" ends it.
// With --resume <id> it plays that conversation: the same session id, and
// a SessionStart with source resume, as claude --resume reports (M48).
import readline from 'node:readline';

const sessionId = process.env.EMERALD_SESSION_ID;
const port = process.env.EMERALD_HOOK_PORT;
const token = process.env.EMERALD_HOOK_TOKEN;
if (!sessionId || !port || !token) {
  console.error('fake-claude: not inside an emerald session with a hook sink');
  process.exit(2);
}
const resumeAt = process.argv.indexOf('--resume');
const resumed = resumeAt >= 0 ? process.argv[resumeAt + 1] ?? null : null;
const claudeSessionId = resumed ?? `fake-${process.pid}`;

async function post(payload) {
  const res = await fetch(`http://127.0.0.1:${port}/hook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': token, 'X-Emerald-Session': sessionId },
    body: JSON.stringify({ session_id: claudeSessionId, cwd: process.cwd(), ...payload }),
  });
  if (res.status !== 204) console.error(`fake-claude: hook ${payload.hook_event_name} got ${res.status}`);
}

await post({ hook_event_name: 'SessionStart', source: resumed === null ? 'startup' : 'resume' });
console.log('fake-claude ready');
const rl = readline.createInterface({ input: process.stdin });
let hung = null;
for await (const line of rl) {
  const text = line.trim();
  if (text === '') continue;
  if (text === 'quit') break;
  if (hung !== null) {
    // The hung call ends: its PostToolUse, then the turn's Stop.
    await post({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: hung }, tool_response: { stdout: '' } });
    await post({ hook_event_name: 'Stop', last_assistant_message: `resumed: ${text}` });
    console.log(`fake-claude resumed: ${text}`);
    hung = null;
    continue;
  }
  await post({ hook_event_name: 'UserPromptSubmit', prompt: text });
  await new Promise((r) => setTimeout(r, 300));
  if (text.startsWith('quiet')) {
    hung = 'node -e "setTimeout(() => {}, 660000)"';
    await post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: hung } });
    console.log(`fake-claude quiet: ${text}`);
  } else if (text.startsWith('ask')) {
    // The emerald mod's ask at the decision (M9 fix 742), then the dialog.
    await post({ hook_event_name: 'ToolAsk', tool_name: 'Bash', tool_input: { command: 'npm publish' }, tool_use_id: 'fake-ask-1' });
    await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    console.log(`fake-claude asks: ${text}`);
  } else if (text.startsWith('pause')) {
    // "pause more" lists two shells beyond the usual one, so a later
    // plain "pause" drops them from the list and they read as finished
    // (M9 fix 101, the running count on the row).
    const more = text.startsWith('pause more')
      ? [
          { id: 'bt3', type: 'shell', status: 'running', description: 'Build the app', command: 'npm run build -w @emerald/app' },
          { id: 'bt4', type: 'shell', status: 'running', description: 'Run the unit tests', command: 'npm test' },
        ]
      : [];
    await post({
      hook_event_name: 'Stop',
      last_assistant_message: `paused: ${text}`,
      background_tasks: [
        { id: 'bt1', type: 'shell', status: 'completed', description: 'Already finished', command: 'npm test' },
        { id: 'bt2', type: 'shell', status: 'running', description: 'Wait for the verify run to finish', command: 'until grep -q EXIT verify.log; do sleep 5; done' },
        ...more,
      ],
    });
    console.log(`fake-claude paused: ${text}`);
  } else if (text.startsWith('plan')) {
    const subjects = [['Extend the row', 'Extending the row'], ['Wire the hooks', 'Wiring the hooks'], ['Write the tests', 'Writing the tests']];
    for (const [i, [subject, activeForm]] of subjects.entries()) {
      await post({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject, activeForm, description: subject }, tool_response: { task: { id: String(i + 1), subject } } });
    }
    await post({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: { success: true, taskId: '1' } });
    await post({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '2', status: 'in_progress' }, tool_response: { success: true, taskId: '2' } });
    await post({ hook_event_name: 'Stop', last_assistant_message: `planned: ${text}` });
    console.log(`fake-claude planned: ${text}`);
  } else {
    await post({ hook_event_name: 'Stop', last_assistant_message: `echo: ${text}\nsecond line` });
    console.log(`fake-claude replied: ${text}`);
  }
}
await post({ hook_event_name: 'SessionEnd', reason: 'exit' });
console.log('fake-claude bye');
// readline keeps stdin open after the loop breaks, and the shell's prompt
// only comes back once the process is gone (M48 waits on it).
rl.close();
process.stdin.destroy();
