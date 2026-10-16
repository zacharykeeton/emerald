// M6 acceptance, part 2, the plan's check: `emmer ls --json` run from a
// second Claude session lists the first one with the right state. Costs one
// short Claude turn. The first session is an interactive claude that just
// sits at its prompt (idle after SessionStart); the second is `claude -p`
// told to run the CLI and print its output, so it goes working and exits
// on its own, and its scrollback carries the listing.
//
// The daemon strips EMERALD_* from every session's environment but its own
// home and pipe (M9 fix 351), so the CLI inside the second session
// connects to the pipe this script's daemon is on. The script keeps a
// private EMERALD_HOME (its own sessions.json, state.json, daemon.json and
// hooks.jsonl); since M9 fix 495 the pipe is named per user and per home,
// so the home's own pipe is a private one and the run needs no Emerald app
// closed (EMERALD_PIPE still names another, M9 fix 360). Needs the hooks installed in
// ~/.claude/settings.json (emmer hooks install).
// Then (M9 fix 233) a third Claude the daemon did not start: a plain
// `claude -p` with this checkout's hook script named by a --settings
// file, whose hooks reach the private daemon off daemon.json under
// EMERALD_HOME, costing a second short turn.
// Logs to %TEMP%\emerald-verify\cli-claude.log. Build first (npm run build).
// Run: npm run verify:cli-claude -w @emerald/cli
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(cliDir, '..', '..');
const main = path.join(cliDir, 'dist', 'main.js');
const home = path.join(os.tmpdir(), 'emerald-verify', 'cli-claude-home');
const logFile = path.join(os.tmpdir(), 'emerald-verify', 'cli-claude.log');
const env = { ...process.env, EMERALD_HOME: home };
const pipeWord = env.EMERALD_PIPE ? `the private pipe ${env.EMERALD_PIPE}` : "the home's own pipe";
const t0 = Date.now();

fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(logFile, '');

// M9 fix 392: the script costs two real Claude turns, and the second
// session's exit and the plain `claude -p` each measured 37 to 41 s on a
// quiet-ish box, so a 40 s wait and a 100 s watchdog barely fit two of
// them; both waits are 90 s and the watchdog 300 s now. M9 fix 776's
// early session costs a third short turn.
const WATCHDOG_S = 360;
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

function stopDaemonHard() {
  try {
    const { pid } = JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'));
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
  } catch {
    // No daemon.json, nothing to stop.
  }
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
  // Preconditions: the real hooks are installed, and nothing owns the pipe.
  // Only the hooks and their script are asked for (M9 fix 38): the text
  // form's exit code also folds in the status line wrapper, which names
  // the Node that installed it, Emerald.exe on a machine with the app
  // installed and node.exe from this checkout, so it said "differs" on
  // every installed machine; the test only needs Claude's hooks to reach
  // the daemon.
  const realEnv = { ...env };
  delete realEnv.EMERALD_HOME;
  let r = spawnSync(process.execPath, [main, 'hooks', 'status', '--json'], { env: realEnv, encoding: 'utf8' });
  let status = null;
  try {
    status = JSON.parse(r.stdout);
  } catch {
    // Not JSON: the expect below says so.
  }
  const hooksReady = status !== null && Array.isArray(status.missing) && status.missing.length === 0 && status.scriptPresent === true;
  expect(hooksReady, `hooks installed in the real settings (${status === null ? r.stdout.trim() : `${status.installed?.length ?? 0} installed, missing ${JSON.stringify(status.missing)}, script ${status.scriptPresent ? 'present' : 'missing'}`})`);
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
  expect(firstEvents[0] === 'SessionStart:applied', `first hook events: ${firstEvents.join(' ')}`);
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
  // M9 fix 260: the hooks `emmer hooks install` put in the user's settings
  // read the port off daemon.json under EMERALD_HOME too, so on a box with
  // them installed every event above was posted twice, once by each hook
  // set, and the sink folds the second; on a box without them the unit
  // test is the proof and this reads one post per event either way.
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
