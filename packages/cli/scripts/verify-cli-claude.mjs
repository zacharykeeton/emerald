// M6 acceptance, part 2, the plan's check: `emmer ls --json` run from a
// second Claude session lists the first one with the right state. Costs one
// short Claude turn. The first session is an interactive claude that just
// sits at its prompt (idle after SessionStart); the second is `claude -p`
// told to run the CLI and print its output, so it goes working and exits
// on its own, and its scrollback carries the listing.
//
// The daemon strips EMERALD_* from every session's environment but its own
// home and pipe (M9 fix 351), so the CLI inside the second session
// connects to the pipe this script's daemon is on. The script runs on the
// EMERALD_HOME the environment names, else a private one of its own (its own sessions.json, state.json, daemon.json and
// hooks.jsonl); since M9 fix 495 the pipe is named per user and per home,
// so the home's own pipe is a private one and the run needs no Emerald app
// closed (EMERALD_PIPE still names another, M9 fix 360). Since M9 fix 997
// every Claude here runs on a private Claude config under the home, the
// user's global config copied in and the login read in place, and the
// script installs emerald's hooks into that config itself, so nothing a
// turn saves reaches ~/.claude.
// Then (M9 fix 233) a third Claude the daemon did not start: a plain
// `claude -p` with this checkout's hook script named by a --settings
// file, whose hooks reach the private daemon off daemon.json under
// EMERALD_HOME, costing a second short turn.
// Logs to %TEMP%\emerald-verify\<home name>-cli-claude.log. The home is EMERALD_HOME when set (refused unless under %TEMP%) and %TEMP%\emerald-verify\cli-claude-home otherwise.
// Build first (npm run build).
// Run: npm run verify:cli-claude -w @emerald/cli
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killTree, processIdentity } from '@emerald/shared/process-identity';

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(cliDir, '..', '..');
const main = path.join(cliDir, 'dist', 'main.js');
// M9 fix 1052: the pair's home when the environment names one, so two
// runs on one box (two seats) no longer share a home and a log.
const home = process.env['EMERALD_HOME'] ?? path.join(os.tmpdir(), 'emerald-verify', 'cli-claude-home');
const logFile = path.join(os.tmpdir(), 'emerald-verify', `${path.basename(home)}-cli-claude.log`);
// M9 fix 997: the private Claude config, the same rule as cdp.mjs's
// harnessClaudeConfig, written out here since importing cdp.mjs reads
// EMERALD_HOME and the shots folder at import.
const claudeConfig = path.join(home, 'claude-config');
const realClaudeConfigSet = (process.env['CLAUDE_CONFIG_DIR']?.trim() ?? '') !== '';
const realClaudeConfig = process.env['CLAUDE_CONFIG_DIR']?.trim() || path.join(os.homedir(), '.claude');
const env = {
  ...process.env,
  EMERALD_HOME: home,
  CLAUDE_CONFIG_DIR: claudeConfig,
  CLAUDE_SECURESTORAGE_CONFIG_DIR: process.env['CLAUDE_SECURESTORAGE_CONFIG_DIR'] ?? realClaudeConfig,
};
const pipeWord = env.EMERALD_PIPE ? `the private pipe ${env.EMERALD_PIPE}` : "the home's own pipe";
const t0 = Date.now();

// M9 fix 1052: the home is removed whole below and may come from the
// environment, so only a folder under the temp folder is taken, never
// ~/.emerald. A home spelled in 8.3 form is refused too, loudly.
const tmpRoots = [os.tmpdir(), fs.realpathSync.native(os.tmpdir())].map((t) => path.resolve(t).toLowerCase() + path.sep);
const homeKey = path.resolve(home).toLowerCase();
if (homeKey === path.resolve(os.homedir(), '.emerald').toLowerCase() || !tmpRoots.some((t) => homeKey.startsWith(t))) {
  console.error(`[verify] refused: EMERALD_HOME ${home} is not a folder under ${os.tmpdir()}; this script removes its home whole, so it runs only on a private one`);
  process.exit(2);
}
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.writeFileSync(logFile, '');
// The global config copied whole, since the trust of the folders the
// turns run in lives in its projects; a copy taken mid-write by the
// user's own Claude is taken again.
fs.mkdirSync(claudeConfig, { recursive: true });
const globalSrc = realClaudeConfigSet ? path.join(realClaudeConfig, '.claude.json') : path.join(os.homedir(), '.claude.json');
if (!fs.existsSync(globalSrc)) {
  console.log(`[verify] note: no ${globalSrc} to copy; a Claude on ${claudeConfig} meets the first-run screens`);
} else {
  for (let attempt = 0; ; attempt += 1) {
    fs.copyFileSync(globalSrc, path.join(claudeConfig, '.claude.json'));
    try {
      JSON.parse(fs.readFileSync(path.join(claudeConfig, '.claude.json'), 'utf8'));
      break;
    } catch {
      if (attempt === 5) throw new Error(`the copy of ${globalSrc} is not JSON`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

// M9 fix 392: the script costs two real Claude turns, and the second
// session's exit and the plain `claude -p` each measured 37 to 41 s on a
// quiet-ish box, so a 40 s wait and a 100 s watchdog barely fit two of
// them; both waits are 90 s and the watchdog 300 s now. M9 fix 776's
// early session costs a third short turn. M9 fix 995's long session holds
// a turn on a 20 s ping and took about a minute in its probe.
const WATCHDOG_S = 480;
setTimeout(() => {
  log(`WATCHDOG: run exceeded ${WATCHDOG_S} s`);
  stopDaemonHard();
  process.exit(3);
}, WATCHDOG_S * 1000);

function log(msg) {
  const line = `[verify +${((Date.now() - t0) / 1000).toFixed(2)}s] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

function expect(cond, what) {
  if (!cond) {
    log(`FAIL: ${what}`);
    stopDaemonHard();
    process.exit(1);
  }
  log(`ok: ${what}`);
}

function emerald(...args) {
  const r = spawnSync(process.execPath, [main, ...args], { env, encoding: 'utf8', windowsHide: true });
  const out = r.stdout ?? '';
  const err = r.stderr ?? '';
  fs.appendFileSync(logFile, `$ emerald ${args.join(' ')}\n${out}${err}[exit ${r.status}]\n`);
  return { code: r.status, out, err };
}

function emeraldJson(...args) {
  const r = emerald(...args);
  let json = null;
  try {
    json = JSON.parse(r.out);
  } catch {
    // Left null; the caller's expect names the command.
  }
  return { ...r, json };
}

// M9 fix 1048: only while the pid is still the daemon daemon.json names,
// by the start time it wrote there; a crashed daemon leaves the file.
function stopDaemonHard() {
  let info;
  try {
    info = JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'));
  } catch {
    return; // No daemon.json, nothing to stop.
  }
  const identity = processIdentity(info.pid, info.startedAt);
  if (identity === 'same') killTree(info.pid);
  else if (identity === 'other') log(`note: daemon.json's pid ${info.pid} is another process now; left alone`);
}

function hookEvents(sessionId) {
  return hookLines(sessionId).map((e) => `${e.event}:${e.outcome}`);
}

// The lines whole, for the mod's mark (M9 fix 726).
function hookLines(sessionId) {
  try {
    return fs
      .readFileSync(path.join(home, 'logs', 'hooks.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((e) => e.sessionId === sessionId);
  } catch {
    return [];
  }
}

try {
  log(`log: ${logFile}`);
  // Preconditions: emerald's hooks are installed in the private Claude
  // config (M9 fix 997, by this script), its login reads signed in, and
  // nothing owns the pipe. Only the hooks and their script are asked for
  // (M9 fix 38): the text form's exit code also folds in the status line
  // wrapper, which names the Node that installed it, Emerald.exe on a
  // machine with the app installed and node.exe from this checkout, so it
  // said "differs" on every installed machine; the test only needs
  // Claude's hooks to reach the daemon.
  const privateSettings = path.join(claudeConfig, 'settings.json');
  let r = emerald('hooks', 'install', '--settings', privateSettings, '--json');
  expect(r.code === 0, `hooks installed into the private Claude config (exit ${r.code})`);
  r = emerald('hooks', 'status', '--settings', privateSettings, '--json');
  let status = null;
  try {
    status = JSON.parse(r.out);
  } catch {
    // Not JSON: the expect below says so.
  }
  const hooksReady = status !== null && Array.isArray(status.missing) && status.missing.length === 0 && status.scriptPresent === true;
  expect(hooksReady, `hooks installed in the private Claude config (${status === null ? r.out.trim() : `${status.installed?.length ?? 0} installed, missing ${JSON.stringify(status.missing)}, script ${status.scriptPresent ? 'present' : 'missing'}`})`);
  const auth = spawnSync('claude auth status --json', { env, shell: true, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  fs.appendFileSync(logFile, `$ claude auth status --json\n${auth.stdout ?? ''}${auth.stderr ?? ''}[exit ${auth.status}]\n`);
  let authStatus = null;
  try {
    authStatus = JSON.parse(auth.stdout ?? '');
  } catch {
    // Not JSON: the expect below says so.
  }
  const authDir = typeof authStatus?.configDirectory === 'string' ? authStatus.configDirectory : null;
  expect(
    authStatus?.loggedIn === true && authDir !== null && path.resolve(authDir).toLowerCase() === path.resolve(claudeConfig).toLowerCase(),
    `the private Claude config reads signed in (claude auth status: loggedIn ${authStatus?.loggedIn}, configDirectory ${authDir ?? (auth.stdout ?? '').trim().slice(0, 200)})`,
  );
  r = emerald('daemon', 'status');
  expect(r.code === 1, `no daemon on ${pipeWord} (a leftover of an earlier run: emmer daemon stop with this EMERALD_HOME)`);
  r = emerald('daemon', 'start');
  expect(r.code === 0, `daemon start on ${pipeWord} with the private home`);

  let j = emeraldJson('new', repoRoot, '--name', 'first', '--json');
  const first = j.json?.session;
  expect(j.code === 0 && first?.kind === 'claude' && first.state === 'starting', 'new: first Claude session is starting');
  r = emerald('wait', 'first', '--for', 'idle', '--timeout', '15000');
  expect(r.code === 0, `first went idle on SessionStart (${r.out.trim()})`);
  j = emeraldJson('ls', '--json');
  const firstRow = j.json?.sessions.find((s) => s.id === first.id);
  expect(typeof firstRow?.claudeSessionId === 'string' && firstRow.claudeSessionId.length > 0, 'first has its Claude session id bound');

  // The second session runs the CLI. Forward slashes because the Bash tool
  // runs through a POSIX shell on Windows, and the full path because the
  // daemon's PATH need not include the repo.
  const command = `node "${main.replace(/\\/g, '/')}" ls --json`;
  const prompt = `Run exactly this command with the Bash tool and reply with its complete raw output and nothing else: ${command}`;
  j = emeraldJson('new', repoRoot, '--name', 'second', '--json', '--', '-p', prompt, '--allowedTools', 'Bash(node:*)');
  const second = j.json?.session;
  expect(j.code === 0 && second?.kind === 'claude', 'new: second Claude session started with -p');
  r = emerald('wait', 'second', '--for', 'working', '--timeout', '20000');
  expect(r.code === 0, `second went working (${r.out.trim()})`);

  // The view from outside while the second session is on its turn.
  j = emeraldJson('ls', '--json');
  const rows = j.json?.sessions ?? [];
  const outsideFirst = rows.find((s) => s.id === first.id);
  const outsideSecond = rows.find((s) => s.id === second.id);
  expect(outsideFirst?.label === 'idle' && ['working', 'done', 'exited (0)'].includes(outsideSecond?.label ?? ''), `outside view: first ${outsideFirst?.label}, second ${outsideSecond?.label}`);
  expect(rows[0].id === second.id || rows[0].id === first.id, 'ls --json orders the live sessions first');

  r = emerald('wait', 'second', '--for', 'exited', '--timeout', '90000');
  expect(r.code === 0, `second exited after its turn (${r.out.trim()})`);
  j = emeraldJson('ls', '--json');
  const done = j.json?.sessions.find((s) => s.id === second.id);
  expect(done?.label === 'exited (0)' && done.exitCode === 0, 'second is exited (0)');

  // What the second session printed: the listing with the first session idle.
  r = emerald('read', 'second');
  const lines = r.out.split('\n');
  const idLine = lines.findIndex((l) => l.includes(`"id": "${first.id}"`));
  expect(idLine !== -1, 'second session printed the first session id');
  // The row runs to its closing brace, the one indented two less than its
  // fields (the fixed count this had from M6 fell behind as fields were
  // added, and since M42 a row holds a nested object, contextWindow, whose
  // own closing brace comes first).
  const indent = (lines[idLine].match(/^\s*/) ?? [''])[0].length;
  const rowEnd = lines.findIndex((l, i) => i > idLine && new RegExp(`^\\s{${Math.max(0, indent - 2)}}},?\\s*$`).test(l));
  const window = lines.slice(idLine, rowEnd === -1 ? idLine + 60 : rowEnd).join('\n');
  expect(window.includes('"name": "first"') && window.includes('"state": "idle"') && window.includes('"label": "idle"'), 'second session listed first as idle');
  expect(window.includes(`"claudeSessionId": "${firstRow.claudeSessionId}"`), 'second session saw the first session bound to its Claude session id');
  const firstEvents = hookEvents(first.id);
  const secondEvents = hookEvents(second.id);
  // The status line's posts (StatusLine, Measure) and the mod's Context
  // (M9 fix 1036, asked on the first Measure, and accepted on trust before
  // the bind) are not Claude's hook events and race SessionStart: on the
  // private config (M9 fix 997) the status line is this checkout's node
  // wrapper and landed first, where the user's installed one had landed
  // second.
  const firstHookEvents = firstEvents.filter((e) => !/^(StatusLine|Measure|Context):/.test(e));
  expect(firstHookEvents[0] === 'SessionStart:applied', `first hook events: ${firstEvents.join(' ')}`);
  expect(secondEvents.includes('SessionStart:applied') && secondEvents.includes('Stop:applied'), `second hook events: ${secondEvents.join(' ')}`);
  // M9 fix 726: the -p session loads --plugin-dir fresh.
  expect(hookLines(second.id).some((e) => e.event === 'Stop' && e.mod === true), "the -p session's Stop came from the mod");
  // M9 fix 741: first's mod opened its prompt channel at its start, so a
  // send --enter goes in through the mod with no Enter pause and lands as
  // one prompt; a --safe-mode session, whose mod never loads, is typed.
  expect(fs.readFileSync(path.join(home, 'logs', 'emmerd.log'), 'utf8').includes(`mod channel up for ${first.id.slice(0, 8)}`), "first's mod opened its prompt channel");
  const text741 = 'Reply with the single word mod-741 and nothing else.';
  let sentAt = Date.now();
  r = emerald('send', 'first', text741, '--enter');
  const elapsed741 = Date.now() - sentAt;
  expect(r.code === 0 && /through the emerald mod$/m.test(r.out) && elapsed741 < 1500, `send --enter went in through the mod with no Enter pause (${elapsed741} ms: ${r.out.trim()})`);
  r = emerald('wait', 'first', '--for', 'done', '--timeout', '90000');
  expect(r.code === 0, `first answered the submitted prompt (${r.out.trim()})`);
  j = emeraldJson('ls', '--json');
  const answered = j.json?.sessions.find((s) => s.id === first.id);
  expect(answered?.lastPrompt === text741 && (answered.lastReply ?? '').includes('mod-741'), `the submitted prompt landed as one line and was answered (${JSON.stringify({ lastPrompt: answered?.lastPrompt, lastReply: answered?.lastReply })})`);
  expect(hookLines(first.id).filter((e) => e.event === 'UserPromptSubmit').length === 1, 'one UserPromptSubmit for the submitted prompt');
  // M9 fix 1125 (1): the mod's channel is a long poll on the hook sink.
  // Past Limits.modPollHoldMs (20 s), so first's poll was answered empty
  // and asked again at least once.
  await new Promise((r) => setTimeout(r, 25000));
  expect(!fs.readFileSync(path.join(home, 'logs', 'emmerd.log'), 'utf8').includes(`mod channel down for ${first.id.slice(0, 8)}`), 'the poll held past its 20 s and was asked again, no down');
  const text1125 = 'Reply with the single word poll-1125 and nothing else.';
  sentAt = Date.now();
  r = emerald('send', 'first', text1125, '--enter');
  const elapsed1125 = Date.now() - sentAt;
  expect(r.code === 0 && /through the emerald mod$/m.test(r.out) && elapsed1125 < 1500, `send --enter after a held poll went in through the mod (${elapsed1125} ms: ${r.out.trim()})`);
  r = emerald('wait', 'first', '--for', 'done', '--timeout', '90000');
  expect(r.code === 0, `first answered the prompt routed after the held poll (${r.out.trim()})`);
  j = emeraldJson('ls', '--json');
  const answered1125 = j.json?.sessions.find((s) => s.id === first.id);
  expect(answered1125?.lastPrompt === text1125 && (answered1125.lastReply ?? '').includes('poll-1125'), `the prompt after the held poll landed and was answered (${JSON.stringify({ lastPrompt: answered1125?.lastPrompt, lastReply: answered1125?.lastReply })})`);
  // M9 fix 1125 (2): no mod-channel process from this checkout's CLI (the
  // person's installed emerald, whose Claudes may still run its own
  // resources\cli\dist\main.js mod-channel, is never counted). The query's
  // own powershell carries both strings in its filter text, so it leaves out
  // its own pid; without that it counted itself and read 1 on every run
  // (the install of fixes 1115 to 1138).
  const ps1125 = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*mod-channel*' -and $_.CommandLine -like '*${main}*' }).Count`], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  expect(ps1125.stdout.trim() === '0', `no mod-channel process from this checkout (${JSON.stringify(ps1125.stdout.trim())})`);
  log("M9 fix 1125: a prompt routed through first's mod after its poll was held past 20 s and asked again, and no mod-channel process from this checkout");
  j = emeraldJson('new', repoRoot, '--name', 'safe', '--json', '--', '--safe-mode');
  const safe = j.json?.session;
  expect(j.code === 0 && safe?.kind === 'claude', 'new: a --safe-mode Claude session');
  r = emerald('wait', 'safe', '--for', 'tui-idle', '--quiet-ms', '3000', '--timeout', '30000');
  expect(r.code === 0, `safe drew its prompt (${r.out.trim()})`);
  sentAt = Date.now();
  r = emerald('send', 'safe', 'Reply with the single word safe.', '--enter');
  expect(r.code === 0 && /^sent "Reply with the single word safe\." \+ Enter to [0-9a-f]{8} safe$/m.test(r.out) && Date.now() - sentAt >= 1500, `a --safe-mode session, whose mod never loads, takes the typed path with its pause (${r.out.trim()})`);
  expect(!fs.readFileSync(path.join(home, 'logs', 'emmerd.log'), 'utf8').includes(`mod channel up for ${safe.id.slice(0, 8)}`), 'and opened no channel');
  r = emerald('kill', 'safe');
  r = emerald('wait', 'safe', '--for', 'exited', '--timeout', '10000');
  expect(r.code === 0, 'safe exited');
  // M9 fix 776: a send the moment a hosted Claude went idle, before its
  // mod's channel is up, waits for the channel rather than being typed.
  j = emeraldJson('new', repoRoot, '--name', 'early', '--json');
  const early = j.json?.session;
  expect(j.code === 0 && early?.kind === 'claude', 'new: the early session');
  r = emerald('wait', 'early', '--for', 'idle', '--timeout', '15000');
  expect(r.code === 0, `early went idle (${r.out.trim()})`);
  sentAt = Date.now();
  r = emerald('send', 'early', 'Reply with the single word early-776 and nothing else.', '--enter');
  const elapsed776 = Date.now() - sentAt;
  expect(r.code === 0 && /through the emerald mod$/m.test(r.out) && elapsed776 < 4500, `fix 776: a send the moment a hosted Claude went idle waited for its channel and went in through the mod (${elapsed776} ms: ${r.out.trim()})`);
  r = emerald('wait', 'early', '--for', 'done', '--timeout', '90000');
  expect(r.code === 0, `early answered the held prompt (${r.out.trim()})`);
  j = emeraldJson('ls', '--json');
  const earlyRow = j.json?.sessions.find((s) => s.id === early.id);
  expect(earlyRow?.lastPrompt === 'Reply with the single word early-776 and nothing else.' && (earlyRow.lastReply ?? '').includes('early-776'), `the held prompt landed and was answered (${JSON.stringify({ lastPrompt: earlyRow?.lastPrompt, lastReply: earlyRow?.lastReply })})`);
  const awaited = fs.readFileSync(path.join(home, 'logs', 'emmerd.log'), 'utf8').includes(`mod channel awaited for ${early.id.slice(0, 8)}`);
  log(`note: the early send ${awaited ? 'waited for the channel' : 'found the channel up already (it can win the race)'}`);
  r = emerald('kill', 'early');
  r = emerald('wait', 'early', '--for', 'exited', '--timeout', '10000');
  expect(r.code === 0, 'early exited');
  log('M9 fix 741: a send --enter to a hosted Claude goes in through its mod; one under --safe-mode is typed; M9 fix 776: one sent the moment the session went idle waits for the channel');

  // M9 fix 995: a send --enter into a turn that runs a long tool call is
  // typed, says it is queued into the turn, and Claude Code takes it into
  // that turn at its next tool round (a queue-operation remove absorbed
  // mid-turn) rather than in a turn of its own after.
  j = emeraldJson('new', repoRoot, '--name', 'long', '--json', '--', '--allowedTools', 'Bash(ping:*)');
  const long = j.json?.session;
  expect(j.code === 0 && long?.kind === 'claude', 'new: the long session');
  r = emerald('wait', 'long', '--for', 'idle', '--timeout', '15000');
  expect(r.code === 0, `long went idle (${r.out.trim()})`);
  r = emerald('send', 'long', 'Use the Bash tool to run this exact command in the foreground, not in the background: ping -n 21 127.0.0.1. Then reply with the word long-995.', '--enter');
  expect(r.code === 0, `the ping prompt went in (${r.out.trim()})`);
  const longRow = () => emeraldJson('ls', '--json').json?.sessions.find((s) => s.id === long.id);
  const transcriptOf = (row) => (row?.transcriptPath && fs.existsSync(row.transcriptPath) ? fs.readFileSync(row.transcriptPath, 'utf8') : '');
  let bashAt = 0;
  for (const deadline = Date.now() + 60000; Date.now() < deadline; await new Promise((res) => setTimeout(res, 500))) {
    const row = longRow();
    if (row?.state === 'working' && /"type":"tool_use"[^\n]*"name":"Bash"/.test(transcriptOf(row))) {
      bashAt = Date.now();
      break;
    }
  }
  expect(bashAt > 0, 'long is working on its Bash call');
  await new Promise((res) => setTimeout(res, 2000));
  const text995 = 'Also end your reply with the word absorbed-995.';
  r = emerald('send', 'long', text995, '--enter');
  expect(r.code === 0 && /^queued into a turn running (under 1m|\d+m); it goes in at the turn's next tool call, or when that turn ends$/m.test(r.out), `a send into the running turn says it is queued into it (${r.out.trim()})`);
  r = emerald('wait', 'long', '--for', 'done', '--timeout', '90000');
  expect(r.code === 0, `long finished its turn (${r.out.trim()})`);
  const lines995 = transcriptOf(longRow()).split('\n').filter(Boolean);
  expect(lines995.some((l) => l.includes('"queue-operation"') && l.includes('"remove"') && l.includes('absorbed_mid_turn') && l.includes('absorbed-995')), 'the transcript took the line into the turn (queue-operation remove, absorbed_mid_turn)');
  expect(lines995.some((l) => l.includes('queued_command') && l.includes('absorbed-995')), 'and holds its queued_command attachment');
  // The row's lastReply is the reply's first paragraph (it read long-995
  // alone in the probe), so the marker is read off the turn's last text block.
  const replies995 = lines995.flatMap((l) => {
    try {
      const e = JSON.parse(l);
      return e.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content.filter((b) => b.type === 'text').map((b) => b.text) : [];
    } catch {
      return [];
    }
  });
  expect((replies995[replies995.length - 1] ?? '').includes('absorbed-995'), `the turn's reply reads the line (${JSON.stringify(replies995[replies995.length - 1] ?? null)})`);
  expect(hookLines(long.id).filter((e) => e.event === 'UserPromptSubmit').length === 2, 'one UserPromptSubmit for the absorbed line after the ping prompt, and no turn of its own');
  r = emerald('prompt', 'long', 'Reply with exactly two short paragraphs and use no tools: the first is the word first-1000 alone, the second the word second-1000 alone.', '--timeout', '90000');
  expect(r.code === 0 && r.out.includes('first-1000') && r.out.includes('second-1000'), `fix 1000: emmer prompt prints the whole reply, both paragraphs (${JSON.stringify(r.out.trim())})`);
  log('M9 fix 1000: emmer prompt prints the whole reply, read off the transcript');
  r = emerald('kill', 'long');
  r = emerald('wait', 'long', '--for', 'exited', '--timeout', '10000');
  expect(r.code === 0, 'long exited');
  log('M9 fix 995: a send into a long turn is typed, says queued, and enters that turn at its next tool round');

  // M9 fix 233: a Claude emerald did not start. This checkout's hook
  // wrapper is rendered for this Node, as an install does; a settings
  // file names it for four events; and
  // a plain claude -p in this (trusted) folder, with no session stamp
  // in its environment and EMERALD_HOME on the private home, posts under
  // its own conversation id with the unhosted mark. The daemon runs a
  // bare record for it, so the lines carry transitions and emerald
  // activity lists the track as outside, in this folder.
  const hooksDir = path.join(home, 'hooks-233');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookCmd = path.join(hooksDir, 'claude-hook.cmd');
  fs.writeFileSync(hookCmd, fs.readFileSync(path.join(cliDir, 'hooks', 'claude-hook.cmd'), 'utf8').replace('__EMERALD_NODE__', process.execPath).replace(/\r?\n/g, '\r\n'));
  const hookEntry = { hooks: [{ type: 'command', command: `"${hookCmd.replace(/\\/g, '/')}"`, timeout: 5 }] };
  const settings233 = path.join(home, 'settings-233.json');
  fs.writeFileSync(settings233, JSON.stringify({ hooks: { SessionStart: [hookEntry], UserPromptSubmit: [hookEntry], Stop: [hookEntry], SessionEnd: [hookEntry] } }));
  const plainEnv = { ...env };
  for (const k of ['EMERALD_SESSION_ID', 'EMERALD_HOOK_PORT', 'EMERALD_HOOK_TOKEN']) delete plainEnv[k];
  for (const k of ['CLAUDE_EFFORT', 'AI_AGENT', 'TRACEPARENT']) delete plainEnv[k]; // M9 fix 1067: what a parent Claude's Bash tool stamps, as the daemon's stampEnv drops it
  const before233 = Date.now();
  // One command string under the shell: claude is a .cmd or a .exe on
  // the PATH, and Node warns on an args list with shell set (DEP0190).
  const plain = spawnSync(`claude -p "Reply with the single word ok and nothing else." --settings "${settings233}"`, { cwd: repoRoot, env: plainEnv, encoding: 'utf8', windowsHide: true, shell: true, timeout: 90000 });
  fs.appendFileSync(logFile, `$ claude -p ... --settings settings-233.json\n${plain.stdout ?? ''}${plain.stderr ?? ''}[exit ${plain.status}]\n`);
  expect(plain.status === 0, `a plain claude -p ran with the fix 233 hook (exit ${plain.status}, ${((Date.now() - before233) / 1000).toFixed(1)} s)`);
  const unhostedLines = fs
    .readFileSync(path.join(home, 'logs', 'hooks.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.unhosted === true && e.at >= before233);
  const conv233 = unhostedLines[0]?.sessionId;
  expect(typeof conv233 === 'string' && conv233 !== first.id && conv233 !== second.id && unhostedLines.every((e) => e.sessionId === conv233), `the plain Claude's hooks landed unhosted under its own conversation id (${unhostedLines.map((e) => e.event).join(' ')})`);
  const unhostedEvents = unhostedLines.map((e) => `${e.event}:${e.outcome}${e.to === undefined ? '' : '>' + e.to}`);
  expect(unhostedLines.some((e) => e.event === 'UserPromptSubmit' && e.to === 'working') && unhostedLines.some((e) => e.event === 'Stop' && e.from === 'working'), `its lines carry the bare record's transitions: ${unhostedEvents.join(' ')}`);
  // M9 fix 260: the hooks `emmer hooks install` put in the Claude config's
  // settings read the port off daemon.json under EMERALD_HOME too, so every
  // event above was posted twice, once by each hook set, and the sink folds
  // the second. Since M9 fix 997 that second set is the private config's,
  // installed by this script, so the fold is exercised on every box rather
  // than only on one with the user's hooks installed.
  expect(new Set(unhostedLines.map((e) => e.event)).size === unhostedLines.length, `each of the plain Claude's events landed once (M9 fix 260): ${unhostedLines.map((e) => e.event).join(' ')}`);
  expect(unhostedLines.every((e) => e.mod !== true), 'the unhosted Claude posted through its hook file alone');
  j = emeraldJson('activity', '--json');
  const row233 = j.json?.sessions.find((x) => x.sessionId === conv233);
  expect(row233 !== undefined && row233.outside === true && row233.name === null && row233.spans.length >= 1 && typeof row233.cwd === 'string' && row233.cwd.toLowerCase() === repoRoot.toLowerCase(), `emmer activity lists the plain Claude as an outside track in this folder (${JSON.stringify(row233 && { outside: row233.outside, name: row233.name, spans: row233.spans.length, cwd: row233.cwd })})`);
  j = emeraldJson('ls', '--json');
  expect(!(j.json?.sessions ?? []).some((x) => x.id === conv233), 'and emmer ls does not list it (it is not a session)');

  r = emerald('kill', 'first');
  expect(r.code === 0, 'kill first');
  r = emerald('wait', 'first', '--for', 'exited', '--timeout', '5000');
  expect(r.code === 0, 'first exited');
  r = emerald('daemon', 'stop');
  expect(r.code === 0, 'daemon stop');
  log('PASS');
  process.exit(0);
} finally {
  stopDaemonHard();
}
