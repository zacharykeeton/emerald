// M6 acceptance, part 1: the CLI end to end against a shell. Starts its own
// emmerd under a private EMERALD_HOME and EMERALD_PIPE, so it never touches the
// daemon behind an open Emerald app, then runs daemon, ls, shell, send, read,
// wait, set, kill, rm, resume and focus and checks exit codes, text and
// --json, then that a shell's `-- args` and its checkpoint survive kill,
// resume and a daemon restart, and (M37) prompt and explain against a
// shell running fake-claude.mjs, which posts the hooks a real turn would.
// Logs to %TEMP%\emerald-verify\<home name>-cli.log. Build first (npm run build).
// Run: npm run verify:cli -w @emerald/cli
// One block and what it needs: npm run verify:cli -w @emerald/cli -- --only fix-402
// The block names: npm run verify:cli -w @emerald/cli -- --list
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(cliDir, '..', '..');
const main = path.join(cliDir, 'dist', 'main.js');
// A private home and pipe of its own, unless the environment names others
// (several worktrees can then run this side by side).
const home = process.env.EMERALD_HOME ?? path.join(os.tmpdir(), 'emerald-verify', 'cli-home');
const logFile = path.join(os.tmpdir(), 'emerald-verify', `${path.basename(home)}-cli.log`);
const env = { ...process.env, EMERALD_HOME: home, EMERALD_PIPE: process.env.EMERALD_PIPE ?? '\\\\.\\pipe\\emmerd-verify-cli' };
const t0 = Date.now();

// M9 fix 426: the steps after `explain` with emmerd down are blocks, each
// a closure a run can skip; everything before them (the prelude: the
// daemon, the shells and the fake Claude every read up to there counts
// on) always runs. `--only <block>[,<block>]` runs the named blocks and
// every block they need, in file order; `--list` prints them. A name is
// a block's own or any fix id a block carries. `needs` holds both kinds
// of dependency: a binding one block makes and another reads (a `let`
// above the first block), and the state one leaves for the next (fix
// 240's daemon start serves the folder fix 239 published, and fix 320
// runs on that daemon and stops it). The same shape as verify:graph's,
// whose helper is blockRunner in packages/app/scripts/cdp.mjs; the cli
// package does not import that file, so this is a copy.
const BLOCKS = [
  { name: 'fix-239', fixes: ['fix-239'], needs: [] },
  { name: 'fix-240', fixes: ['fix-240'], needs: ['fix-239'] },
  { name: 'fix-320', fixes: ['fix-320'], needs: ['fix-240'] },
  { name: 'fix-379', fixes: ['fix-379', 'fix-403'], needs: [] },
  { name: 'fix-402', fixes: ['fix-402'], needs: [] },
  { name: 'fix-710', fixes: ['fix-710', 'fix-733'], needs: [] },
];
const { block, blocksRun } = blockRunner(BLOCKS);

function blockRunner(blocks, argv = process.argv.slice(2)) {
  const byName = new Map(blocks.map((b) => [b.name, b]));
  if (argv.includes('--list')) {
    console.log('the prelude always runs; the blocks, in order:');
    for (const b of blocks) {
      const also = b.fixes.filter((f) => f !== b.name);
      const neededBy = blocks.filter((x) => x.needs.includes(b.name)).map((x) => x.name);
      console.log(`  ${b.name}${also.length ? ` (also ${also.join(', ')})` : ''}${b.needs.length ? `; needs ${b.needs.join(', ')}` : ''}${neededBy.length ? `; needed by ${neededBy.join(', ')}` : ''}`);
    }
    process.exit(0);
  }
  let only = null;
  const at = argv.findIndex((a) => a === '--only' || a.startsWith('--only='));
  if (at !== -1) {
    const raw = argv[at] === '--only' ? (argv[at + 1] ?? '') : argv[at].slice('--only='.length);
    only = new Set();
    const add = (name) => {
      if (only.has(name)) return;
      only.add(name);
      for (const n of byName.get(name).needs) add(n);
    };
    for (const want of raw.split(',').map((x) => x.trim()).filter((x) => x !== '')) {
      const hits = byName.has(want) ? [want] : blocks.filter((b) => b.fixes.includes(want)).map((b) => b.name);
      if (hits.length === 0) {
        console.error(`[verify] no block named ${want}; --list names them`);
        process.exit(2);
      }
      // A block's own name wins over the ids other blocks carry; say so when
      // another block carries the name too, since its steps do not run.
      if (byName.has(want)) {
        const others = blocks.filter((b) => b.name !== want && b.fixes.includes(want)).map((b) => b.name);
        if (others.length > 0) console.log(`[verify] note: ${want} is also carried by ${others.join(', ')}; name it too for those steps`);
      }
      hits.forEach(add);
    }
    if (only.size === 0) {
      console.error('[verify] --only names no block; --list names them');
      process.exit(2);
    }
  }
  const ran = [];
  const skipped = [];
  const block = async (name, fn) => {
    if (!byName.has(name)) throw new Error(`block ${name} is not in the script's table`);
    if (only !== null && !only.has(name)) {
      log(`skipped ${name} (--only)`);
      skipped.push(name);
      return;
    }
    await fn();
    ran.push(name);
  };
  const blocksRun = () => {
    if (only === null && ran.length !== blocks.length) throw new Error(`expected every block to run, missing ${blocks.filter((b) => !ran.includes(b.name)).map((b) => b.name).join(', ')}`);
    return `blocks run: ${ran.join(', ')}${skipped.length ? `; skipped (--only): ${skipped.join(', ')}` : ''}`;
  };
  return { block, blocksRun };
}

fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.writeFileSync(logFile, '');

// 360 s since M9 fix 583 (240 since fix 402, 150 before, as verify:graph's
// went 300 to 420 to 600 for the same reason). The close-outs ran it in
// 118 to 133 s quiet; a seat under eight seats' load passed at 239 s,
// and another was cut off at 240 s in the batch of fixes 494 to 541 with
// every step passing, so 360 s is about three times a quiet run.
setTimeout(() => {
  log('WATCHDOG: run exceeded 360 s');
  stopDaemonHard();
  process.exit(3);
}, 360000);

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

// One CLI invocation, synchronous. Returns { code, out, err }.
function emerald(...args) {
  return emeraldEnv({}, ...args);
}

// The same with the child's environment adjusted: a key set to undefined
// is removed, the rest overlaid on the script's.
function emeraldEnv(extra, ...args) {
  const childEnv = { ...env };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  const r = spawnSync(process.execPath, [main, ...args], { env: childEnv, encoding: 'utf8', windowsHide: true });
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

// The same invocation, started in the background for wait.
function emeraldAsync(...args) {
  const child = spawn(process.execPath, [main, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, out })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(150);
  }
  expect(false, `${what} within ${timeoutMs} ms`);
}

function stopDaemonHard() {
  try {
    const { pid } = JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'));
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
  } catch {
    // No daemon.json, nothing to stop.
  }
}

try {
  log(`log: ${logFile}`);
  let r = emerald('daemon', 'status');
  expect(r.code === 1 && /not running/.test(r.out), 'daemon status: not running, exit 1');
  r = emerald('ls');
  expect(r.code === 1 && /emmerd is not running/.test(r.err), 'ls without a daemon: one-line error, exit 1');

  // M48: a claude.cmd first on the daemon's PATH, so every shell it spawns
  // finds the fake Claude under the name the resumed shell is handed. The
  // daemon inherits the CLI's environment on start.
  const shimDir = path.join(home, 'shim');
  fs.mkdirSync(shimDir, { recursive: true });
  fs.writeFileSync(path.join(shimDir, 'claude.cmd'), `@"${process.execPath}" "${path.join(cliDir, 'scripts', 'fake-claude.mjs')}" %*\r\n`);
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${shimDir};${env[pathKey] ?? ''}`;
  // M9 fix 232: the stall floor in seconds, so wait --for stale can be
  // read; the daemon checks every half floor. Six seconds clears every
  // working stretch the fake Claude holds (a Stop lands 300 ms after
  // each prompt), so only the quiet turn goes quiet.
  const STALE_MS = 6000;
  env.EMERALD_STALE_AFTER_MS = String(STALE_MS);
  // M9 fix 240: the daemon serves the update feed folder when it exists.
  // A private folder, not there yet, on a port the OS picks, so this
  // daemon never touches the real feed or its port; the folder is
  // published into at the end and a second daemon start serves it.
  const feedDir = path.join(home, 'feed');
  env.EMERALD_FEED_DIR = feedDir;
  env.EMERALD_FEED_PORT = '0';
  // M9 fix 245: a day ten days back seeded before the daemon starts (it
  // reads hooks.jsonl whole then): a session done at 02:00 with the box
  // left at 01:30 and someone back at 09:00, the next prompt at 09:05.
  // The daemon's own away and back lines name no session, so explain's
  // event counts below never see them.
  const awayDay = new Date(Date.now() - 10 * 86_400_000);
  awayDay.setHours(0, 0, 0, 0);
  const awayKey = `${awayDay.getFullYear()}-${String(awayDay.getMonth() + 1).padStart(2, '0')}-${String(awayDay.getDate()).padStart(2, '0')}`;
  const awayAt = (h, m) => awayDay.getTime() + h * 3_600_000 + m * 60_000;
  const awayLine = (at, event, from, to) => JSON.stringify({ at, sessionId: 'night', event, from, to, outcome: 'applied', payload: { session_id: 'sim-night', hook_event_name: event, cwd: home } });
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'logs', 'hooks.jsonl'),
    [awayLine(awayAt(1, 0), 'UserPromptSubmit', 'idle', 'working'), JSON.stringify({ at: awayAt(1, 30), presence: 'away' }), awayLine(awayAt(2, 0), 'Stop', 'working', 'done'), JSON.stringify({ at: awayAt(9, 0), presence: 'back' }), awayLine(awayAt(9, 5), 'UserPromptSubmit', 'done', 'working'), awayLine(awayAt(9, 15), 'Stop', 'working', 'done'), JSON.stringify({ at: awayAt(10, 0), capped: { window: 'five_hour', resetsAt: awayAt(12, 0) } }), ''].join('\n'),
  );
  // M9 fix 556: a folders.json the daemon cannot read is set aside at the
  // start, and daemon status names it (read below with the feed line).
  fs.writeFileSync(path.join(home, 'folders.json'), '{not json');
  r = emerald('daemon', 'start');
  expect(r.code === 0 && /^started emmerd/.test(r.out), 'daemon start');
  // M9 fix 341: emmer open with no window on the app topic is exit 69 and
  // one line; the path is made absolute before the daemon hears it, so a
  // relative one is refused the same way, and the usage lists the command.
  r = emerald('open', path.join(home, 'nothing.md'));
  expect(r.code === 69 && r.err.trim() === 'emmer: no window open; open the Emerald app', `open with no window: exit 69 and the line (${r.code}: ${JSON.stringify(r.err)})`);
  r = emerald('open');
  // The usage and the summary carry fix 375's --scheme, fix 376's
  // --beside and fix 404's rule for which of a session's panes it takes.
  expect(r.code === 64 && /missing file/.test(r.err) && /usage: emmer open <path \| url> \[--pane \| --beside \[<session>\]\] \[--scheme <name> \| --clear-scheme\] \[--json\]/.test(r.err), 'open with no path: usage, exit 64');
  expect(/^--beside takes the session's pane on the tab in front, else its first in tab order, and the reply names the pane and the tab$/m.test(r.err), `the usage's second line states the rule --beside picks by (${JSON.stringify(r.err)})`);
  // M9 fix 659: the third line says what a URL does.
  expect(/^a url \(http:\/\/, https:\/\/ or host:port, such as localhost:3000\) opens in a browser pane, beside the focused one or beside --beside's session$/m.test(r.err), `the usage's third line says a url opens a browser pane (${JSON.stringify(r.err)})`);
  r = emerald('help');
  expect(r.code === 0 && /^  open +open a file in the window as a tab, with --pane in a pane beside the focused one, or with --beside beside a session's pane \(the one on the tab in front, else the first in tab order\); --scheme picks the file's own colour scheme; a URL opens a browser pane$/m.test(r.out), 'help lists open with its summary');
  log('M9 fix 341: emmer open answers exit 69 with no window, its usage on no path, and is listed by help');
  // M9 fix 672: emmer browser's usage on no verb, an unknown verb, no
  // browser pane on the tab and no such pane; none opens a pane, so no
  // later read of the layout moves.
  expect(/^  browser +drive the page in a browser pane: a snapshot of its controls, a click, a fill, a key, a screenshot \(emmer help browser lists the verbs\)$/m.test(r.out), 'help lists browser with its summary');
  r = emerald('browser');
  expect(r.code === 64 && /missing verb/.test(r.err) && /^usage: emmer browser <verb> \[<args>\] \[--pane <id>\] \[--json\]$/m.test(r.err) && /^  snapshot {2,}the page's controls, each with a ref \(@e1\), its role, name, value and state$/m.test(r.err), `browser with no verb: the usage, exit 64 (${r.code}: ${JSON.stringify(r.err)})`);
  r = emerald('browser', 'frob');
  expect(r.code === 64 && r.err.split('\n')[0] === 'emmer: unknown verb "frob"; emmer help browser lists them', `browser frob: unknown verb, exit 64 (${r.code}: ${JSON.stringify(r.err)})`);
  r = emerald('browser', 'snapshot');
  expect(r.code === 1 && /^emmer: no browser pane on tab .+; emmer browser open <url> makes one$/m.test(r.err), `browser snapshot with no browser pane: exit 1 and the line (${r.code}: ${JSON.stringify(r.err)})`);
  r = emerald('browser', 'snapshot', '--pane', 'nosuchpane');
  expect(r.code === 1 && r.err.trim() === 'emmer: no pane nosuchpane', `browser snapshot --pane nosuchpane: exit 1 and the line (${r.code}: ${JSON.stringify(r.err)})`);
  log("M9 fix 672: emmer browser's usage, an unknown verb, no browser pane and no such pane, and help's summary");
  // M9 fix 741: the mod's channel command, which the mod starts itself.
  r = emerald('help');
  expect(/^  mod-channel +stream a session's queued prompts to the emerald mod, which starts this itself$/m.test(r.out), 'help lists mod-channel with its summary');
  r = emerald('mod-channel');
  expect(r.code === 64 && /missing session/.test(r.err) && /usage: emmer mod-channel <session>/.test(r.err), `mod-channel with no session: usage, exit 64 (${r.code}: ${JSON.stringify(r.err)})`);
  // M9 fix 677: emmer usage report reads files only. This home has the
  // night's four applied hook lines ten days back and no usage.jsonl.
  r = emerald('usage');
  expect(r.code === 64 && /missing action/.test(r.err) && /usage: emmer usage report \[--days <n>\]/.test(r.err), `usage with no action: exit 64 and the synopsis (${r.code}: ${JSON.stringify(r.err)})`);
  r = emerald('usage', 'report', '--days', '0');
  expect(r.code === 64 && r.err.includes('--days wants a whole number from 1 to 365, got 0'), `usage report --days 0: exit 64 (${r.code}: ${JSON.stringify(r.err)})`);
  r = emerald('usage', 'report');
  expect(r.code === 0 && /^# Emerald usage, the last 30 days \(\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\)$/m.test(r.out), `usage report: exit 0 and the heading (${r.code}: ${JSON.stringify(r.out.slice(0, 200))})`);
  expect(r.out.includes("Nothing recorded yet: the usage record is off until it is turned on from the speaker button's right-click menu (Usage record)."), 'usage report says nothing is recorded yet');
  expect(!r.out.includes('The record was') && r.out.includes('## Never used\n'), 'usage report with no record: no span line and the plain Never used heading');
  expect(r.out.includes(`| ${awayKey} | 1 | 1 | 4 |`), `usage report counts the night's day: one session, one project, four lines (${JSON.stringify(r.out)})`);
  r = emerald('help');
  expect(/^  usage +a markdown digest of how emerald is used, from the usage record and the hook log$/m.test(r.out), 'help lists usage with its summary');
  log('M9 fix 677: emmer usage report answers with no record, refuses a bad --days, and is listed by help');
  const awayJson = emeraldJson('activity', '--day', awayKey, '--json');
  const nightRow = (awayJson.json?.sessions ?? []).find((s) => s.sessionId === 'night');
  expect(awayJson.code === 0 && nightRow?.debt.length === 1 && nightRow.debt[0].kind === 'unread' && nightRow.debt[0].from === awayAt(9, 1) && nightRow.debt[0].to === awayAt(9, 5), `activity --day --json: the overnight done reads as the four minutes from the return plus the grace (${JSON.stringify(nightRow?.debt)})`);
  expect(nightRow.awayMs === (7 * 60 - 1) * 60_000 && awayJson.json.stats.awayMs === nightRow.awayMs && awayJson.json.stats.unreadMs === 4 * 60_000 && awayJson.json.stats.debtMs === 4 * 60_000, `the row and the day carry the docked figure, 6h 59m (${JSON.stringify({ awayMs: nightRow.awayMs, stats: awayJson.json.stats })})`);
  // M9 fix 285: a capped line with no freed is a band closed at its
  // reset, carried on the JSON form beside the sessions.
  expect(JSON.stringify(awayJson.json.capped) === JSON.stringify([{ from: awayAt(10, 0), to: awayAt(12, 0), window: 'five_hour', resetsAt: awayAt(12, 0) }]) && nightRow.cappedMs === 0, `activity --json carries the band closed at its reset (${JSON.stringify(awayJson.json.capped)})`);
  let j = emeraldJson('daemon', 'status', '--json');
  expect(j.code === 0 && j.json?.running === true && typeof j.json.pid === 'number', 'daemon status --json: running with a pid');
  expect(j.json.feed === null, `daemon status --json: no feed folder, feed null, got ${JSON.stringify(j.json.feed)}`);
  r = emerald('daemon', 'status');
  expect(/^feed: none$/m.test(r.out), `daemon status names no feed, got ${JSON.stringify(r.out)}`);
  expect(/^set aside: folders\.json\.bad-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/m.test(r.out) && j.json.setAside?.length === 1, `daemon status names the set-aside folders.json, got ${JSON.stringify(r.out)} and ${JSON.stringify(j.json.setAside)}`);
  log('M9 fix 556: a bad folders.json is set aside at the start and daemon status names it');
  // M9 fix 241: the daemon reads its version off its own package.json,
  // which the docs commit bumps with the other three; a batch that
  // forgets one fails here.
  const cliVersion = emerald('--version').out.trim();
  expect(/^0\.1\.\d+$/.test(cliVersion) && j.json.version === cliVersion, `the daemon's version is the CLI's own (cli ${cliVersion}, daemon ${j.json.version})`);
  expect(JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8')).version === cliVersion, 'daemon.json carries the same version');
  // M9 fix 612: daemon.json carries the pipe token, and a hello without it,
  // or with another, gets one error reply and the pipe closed.
  const pipeToken = JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8')).pipeToken;
  expect(typeof pipeToken === 'string' && /^[0-9a-f]{64}$/.test(pipeToken), `daemon.json carries a 64-hex pipeToken (${JSON.stringify(pipeToken)})`);
  const bareHello = (extra) =>
    new Promise((resolve) => {
      const sock = net.connect(env.EMERALD_PIPE);
      let text = '';
      const timer = setTimeout(() => {
        sock.destroy();
        resolve({ text, closed: false });
      }, 5000);
      sock.setEncoding('utf8');
      sock.on('data', (chunk) => (text += chunk));
      sock.on('error', () => {});
      sock.on('close', () => {
        clearTimeout(timer);
        resolve({ text, closed: true });
      });
      sock.on('connect', () => sock.write(JSON.stringify({ id: 1, type: 'hello', client: 'cli', protocolVersion: 1, ...extra }) + '\n'));
    });
  const noToken = await bareHello({});
  const noTokenReply = noToken.text.trim() === '' ? null : JSON.parse(noToken.text.trim());
  expect(noToken.closed && noTokenReply?.ok === false && noTokenReply.error?.code === 'token-required' && noTokenReply.error.message === 'hello without a token: this client predates the pipe token of M9 fix 612; use the emmer and the Emerald window of the same install as this emmerd', `a hello without the token: token-required and the close (${JSON.stringify(noToken)})`);
  const wrongToken = await bareHello({ token: '0'.repeat(64) });
  const wrongReply = wrongToken.text.trim() === '' ? null : JSON.parse(wrongToken.text.trim());
  expect(wrongToken.closed && wrongReply?.ok === false && wrongReply.error?.code === 'bad-token', `a hello with another token: bad-token and the close (${JSON.stringify(wrongToken)})`);
  log('M9 fix 612: a hello without the token, or with another, is refused and the pipe closed');
  r = emerald('daemon', 'start');
  expect(r.code === 0 && /already running/.test(r.out), 'daemon start twice is a no-op');

  r = emerald('ls');
  expect(r.code === 0 && r.out.trim() === 'no sessions', 'ls: no sessions');
  j = emeraldJson('ls', '--json');
  expect(j.code === 0 && Array.isArray(j.json?.sessions) && j.json.sessions.length === 0, 'ls --json: empty list');

  // Usage errors before any session exists.
  r = emerald('kill');
  expect(r.code === 64 && /missing session/.test(r.err) && /usage: emmer kill/.test(r.err), 'kill with no argument: usage, exit 64');
  r = emerald('ls', '--nope');
  expect(r.code === 64 && /Unknown option/.test(r.err), 'unknown option: exit 64');
  r = emerald('frobnicate');
  expect(r.code === 64 && /unknown command/.test(r.err), 'unknown command: exit 64');

  // M18: the skill prints, and travels with the hooks under a private
  // settings file (the hooks themselves are verify:hooks-prompt's job).
  r = emerald('skill');
  expect(r.code === 0 && /^---\r?\nname: emmer-cli\r?\n/.test(r.out) && /emmer set/.test(r.out), 'skill prints the shipped emmer-cli skill');
  const settings = path.join(home, 'claude', 'settings.json');
  const skillFile = path.join(home, 'claude', 'skills', 'emmer-cli', 'SKILL.md');
  j = emeraldJson('hooks', 'install', '--settings', settings, '--json');
  expect(j.code === 0 && j.json?.skill === skillFile && fs.readFileSync(skillFile, 'utf8') === r.out, 'hooks install writes the skill beside the settings file, as printed');
  j = emeraldJson('hooks', 'status', '--settings', settings, '--json');
  expect(j.code === 0 && j.json?.skill === true && j.json.complete === true && j.json.modPresent === true, 'hooks status --json: skill true, complete, the mod shipped');
  // M9 fix 606: one Test event through the installed hook reaches the
  // daemon this script started, read off the pipe's hooks.test.
  j = emeraldJson('hooks', 'status', '--settings', settings, '--test', '--json');
  expect(j.code === 0 && j.json?.test === 'passed', 'hooks status --test --json: a Test event through the installed hook reached emmerd');
  r = emerald('hooks', 'status', '--settings', settings, '--test');
  expect(r.code === 0 && /^test: passed, a Test event went through .*claude-hook\.cmd and reached emmerd$/m.test(r.out), 'hooks status --test names the script and the pass');
  fs.unlinkSync(skillFile);
  j = emeraldJson('hooks', 'status', '--settings', settings, '--json');
  expect(j.code === 1 && j.json?.skill === false && j.json.complete === false, 'without the skill the status is incomplete, exit 1');
  r = emerald('hooks', 'uninstall', '--settings', settings);
  expect(r.code === 0 && !fs.existsSync(path.dirname(skillFile)), 'hooks uninstall removes the skill folder');
  r = emerald('shell', 'C:\\emerald-no-such-dir');
  expect(r.code === 1 && /no such directory/.test(r.err), 'shell in a missing folder: exit 1');

  j = emeraldJson('shell', os.homedir(), '--name', 'alpha', '--json');
  const alpha = j.json?.session;
  expect(j.code === 0 && alpha?.kind === 'shell' && alpha.state === 'idle' && alpha.name === 'alpha', 'shell --json: idle shell named alpha');
  r = emerald('shell', repoRoot, '--name', 'beta');
  const beta = r.out.trim().split(/\s+/).at(-1);
  expect(r.code === 0 && /^[0-9a-f]{8}  idle  shell  beta  [0-9a-f-]{36}$/.test(r.out.trim()), 'shell: one line with the id');
  // M9 fix 624: --shell picks one of the installed shells; cmd is on
  // every box. An unknown id and --shell on emmer new are usage errors.
  // The cmd row goes again before the ls below, which counts two rows.
  j = emeraldJson('shell', os.homedir(), '--name', 'cmdrow', '--shell', 'cmd', '--json');
  expect(j.code === 0 && j.json?.session?.shell === 'cmd', `shell --shell cmd starts cmd, got ${JSON.stringify(j.json?.session?.shell)} exit ${j.code}`);
  r = emerald('shell', os.homedir(), '--shell', 'zsh');
  expect(r.code === 64 && r.err.includes('emmer: --shell must be one of pwsh, powershell, gitbash, cmd, got "zsh"'), `shell --shell zsh: usage, got ${r.code} ${JSON.stringify(r.err)}`);
  r = emerald('new', os.homedir(), '--shell', 'cmd');
  expect(r.code === 64 && r.err.includes("Unknown option '--shell'"), `new --shell: parseArgs' unknown option, got ${r.code} ${JSON.stringify(r.err)}`);
  r = emerald('kill', 'cmdrow');
  expect(r.code === 0, 'kill cmdrow');
  r = emerald('wait', 'cmdrow', '--for', 'exited', '--timeout', '10000');
  expect(r.code === 0, 'cmdrow exited');
  r = emerald('rm', 'cmdrow');
  expect(r.code === 0, 'rm cmdrow');
  log('M9 fix 624: emmer shell --shell cmd starts cmd, an unknown id and --shell on emmer new are usage errors');

  r = emerald('kill', 'nope');
  expect(r.code === 1 && /no session matches "nope"/.test(r.err), 'kill an unknown reference: exit 1');
  r = emerald('rm', 'alpha');
  expect(r.code === 1 && /alpha is idle; kill it first/.test(r.err), 'rm a live session: refused');

  // send and read: the shell echoes a marker, the CLI reads it back as lines.
  const marker = `EMERALD_CLI_${Date.now()}`;
  r = emerald('send', 'alpha', 'echo', marker, '--enter');
  expect(r.code === 0 && r.out.includes(`sent "echo ${marker}" + Enter`), 'send --enter');
  const lines = await until('marker in read --lines 3', () => {
    const out = emerald('read', 'alpha', '--lines', '3').out;
    return out.split('\n').some((l) => l === marker) ? out : null;
  });
  expect(/PS .*>.*echo EMERALD_CLI_/.test(lines), `read shows the prompt line with the typed command, got ${JSON.stringify(lines)}`);
  j = emeraldJson('read', 'alpha', '--lines', '2', '--json');
  expect(j.code === 0 && j.json?.sessionId === alpha.id && j.json.lines.length === 2 && j.json.lines[0] === marker, 'read --json --lines 2: the marker then the prompt');
  r = emerald('read', 'alpha', '--raw');
  expect(r.code === 0 && r.out.includes('\x1b[') && r.out.includes(marker), 'read --raw keeps the escapes');
  r = emerald('read', 'alpha');
  expect(r.code === 0 && !r.out.includes('\x1b') && r.out.includes(marker), 'read strips the escapes');

  // M17: a cursor from one read pages the next; tui-idle waits for the
  // output to go quiet; the screen is the frame, not the stream.
  j = emeraldJson('read', 'alpha', '--json');
  const cursor1 = j.json?.nextCursor;
  expect(j.code === 0 && j.json?.source === 'stream' && Number.isInteger(cursor1) && cursor1 > 0, 'read --json carries nextCursor');
  r = emerald('read', 'alpha', '--cursor', String(cursor1));
  expect(r.code === 0 && r.out.trim() === `nextCursor: ${cursor1}`, 'read --cursor at the end: nothing new, the same cursor back');
  // Eight ticks 300 ms apart: never quiet for 1.5 s while they run, then quiet.
  r = emerald('send', 'alpha', '1..8 | % { Write-Host "tick$_"; Start-Sleep -m 300 }', '--enter');
  let started = Date.now();
  r = emerald('wait', 'alpha', '--for', 'tui-idle', '--timeout', '600');
  expect(r.code === 2 && /timed out after 600 ms waiting for tui-idle/.test(r.err), 'wait --for tui-idle while the ticks run: timeout');
  j = emeraldJson('wait', 'alpha', '--for', 'tui-idle', '--timeout', '15000', '--json');
  const quietAfter = Date.now() - started;
  expect(j.code === 0 && j.json?.session?.id === alpha.id && quietAfter > 2500 && quietAfter < 8000, `wait --for tui-idle resolved once the ticks stopped (${quietAfter} ms after they started)`);
  r = emerald('read', 'alpha', '--cursor', String(cursor1));
  const cursor2 = Number((/nextCursor: (\d+)/.exec(r.out) ?? [])[1]);
  expect(r.code === 0 && r.out.includes('tick8') && !r.out.split('\n').includes(marker) && cursor2 > cursor1, 'read --cursor after the wait: only the new output, and a later cursor');
  j = emeraldJson('read', 'alpha', '--cursor', String(cursor2), '--json');
  expect(j.code === 0 && j.json?.lines.length === 0 && j.json.nextCursor === cursor2, 'read --cursor --json at the new end: no lines');
  r = emerald('read', 'alpha', '--screen', '--cursor', '1');
  expect(r.code === 64 && /--screen is the current frame/.test(r.err), 'read --screen with --cursor: usage');
  // Typed and taken back: the screen shows the bare prompt, the stream the fragments.
  emerald('send', 'alpha', 'ccc');
  emerald('wait', 'alpha', '--for', 'tui-idle', '--timeout', '5000', '--quiet-ms', '500');
  emerald('send', 'alpha', '\b\b\b');
  emerald('wait', 'alpha', '--for', 'tui-idle', '--timeout', '5000', '--quiet-ms', '500');
  j = emeraldJson('read', 'alpha', '--screen', '--json');
  const lastRow = j.json?.rows?.at(-1) ?? '';
  expect(j.code === 0 && j.json?.source === 'screen' && /^PS [^>]*>$/.test(lastRow) && j.json.rows.length <= 24 && Number.isInteger(j.json.nextCursor), `read --screen --json: the last row is the bare prompt (${JSON.stringify(lastRow)})`);
  r = emerald('read', 'alpha', '--screen');
  expect(r.code === 0 && r.out.trimEnd().split('\n').at(-1) === lastRow && !r.out.includes('\x1b'), 'read --screen prints the rows');

  // --interrupt stops a command that would run for ever; --for exit reports the code.
  emerald('send', 'alpha', 'ping -t 127.0.0.1', '--enter');
  await until('ping is replying', () => (emerald('read', 'alpha', '--lines', '3').out.includes('Reply from') ? true : null));
  r = emerald('send', 'alpha', '--interrupt');
  expect(r.code === 0 && r.out.includes('sent Ctrl+C to'), 'send --interrupt');
  r = emerald('wait', 'alpha', '--for', 'tui-idle', '--timeout', '10000');
  expect(r.code === 0 && /alpha is quiet after \d+ ms/.test(r.out), 'quiet again after the interrupt');
  j = emeraldJson('read', 'alpha', '--screen', '--json');
  expect(j.code === 0 && /^PS [^>]*>$/.test(j.json?.rows?.at(-1) ?? ''), 'the prompt is back after the interrupt');
  r = emerald('send', 'alpha', '--interrupt', 'echo', 'after', '--enter');
  expect(r.code === 0 && r.out.includes('sent Ctrl+C + "echo after" + Enter to'), 'send --interrupt with text and Enter');
  j = emeraldJson('shell', os.homedir(), '--name', 'delta', '--json');
  const delta = j.json?.session;
  emerald('send', 'delta', 'exit 7', '--enter');
  j = emeraldJson('wait', 'delta', '--for', 'exit', '--timeout', '10000', '--json');
  expect(j.code === 0 && j.json?.session?.id === delta?.id && j.json.exitCode === 7, 'wait --for exit --json carries the exit code');
  r = emerald('wait', 'delta', '--for', 'exit');
  expect(r.code === 0 && /delta exited with code 7 after \d+ ms/.test(r.out), 'wait --for exit on an exited session says the code at once');
  r = emerald('wait', 'delta', '--for', 'tui-idle');
  expect(r.code === 0 && /delta is quiet/.test(r.out), 'wait --for tui-idle on an exited session: quiet for good');
  r = emerald('rm', 'delta');
  expect(r.code === 0, 'rm delta');

  // wait: timeout, then a kill landing while waiting.
  started = Date.now();
  r = emerald('wait', 'alpha', '--for', 'exited', '--timeout', '500');
  expect(r.code === 2 && /timed out after 500 ms/.test(r.err) && Date.now() - started < 3000, 'wait --timeout: exit 2');
  j = emeraldJson('wait', 'alpha', '--for', 'idle', '--json');
  expect(j.code === 0 && j.json?.session?.id === alpha.id && j.json.waitedMs < 1000, 'wait for the current state returns at once');
  r = emerald('wait', 'alpha', '--for', 'banana');
  expect(r.code === 64 && /--for must be one of/.test(r.err), 'wait with a bad state: usage');
  const waiting = emeraldAsync('wait', 'alpha', '--for', 'exited', '--timeout', '10000');
  await sleep(500);
  r = emerald('kill', alpha.id.slice(0, 8));
  expect(r.code === 0 && r.out.trim() === `killed ${alpha.id.slice(0, 8)} alpha`, 'kill by id prefix');
  const waited = await waiting;
  expect(waited.code === 0 && /alpha is exited after \d+ ms/.test(waited.out), 'wait saw the exit through the subscription');

  // ls after the kill: sidebar order and badge words.
  j = emeraldJson('ls', '--json');
  const rows = j.json?.sessions ?? [];
  expect(rows.length === 2 && rows[0].name === 'beta' && rows[0].label === 'idle' && rows[0].group === repoRoot, 'ls --json: live beta first in its folder group');
  expect(rows[1].name === 'alpha' && rows[1].label === 'killed' && rows[1].group === 'exited' && rows[1].exitCode === -1073741510, 'ls --json: killed alpha in the exited group');
  expect(typeof rows[1].inStateMs === 'number' && rows[1].inStateMs < 10000, 'ls --json carries the time in state');
  r = emerald('ls');
  // The heading carries its units (M46): beta is one idle shell; the
  // exited group has none. The first line is the title bar's units over
  // every folder (M9 fix 88), the same one shell here.
  expect(new RegExp(`^❯1\\n${repoRoot.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}  ❯1\\n  [0-9a-f]{8}  idle +\\d+[sm]  shell +beta\\nexited\\n  [0-9a-f]{8}  killed +\\d+[sm]  shell +alpha\\n$`).test(r.out), `ls: the box line, then the grouped text listing with the heading's idle shell unit, got ${JSON.stringify(r.out)}`);

  // set: the checkpoint on beta, in --json and in the text listing, and
  // the usage errors.
  r = emerald('set', 'beta');
  expect(r.code === 64 && /nothing to set/.test(r.err), 'set with nothing to set: usage, exit 64');
  r = emerald('set', 'beta', '--phase', 'shipping');
  expect(r.code === 64 && /--phase must be one of todo, in-progress, in-review, done/.test(r.err), 'set with a bad phase: usage, exit 64');
  r = emerald('set', 'beta', '--comment', 'x', '--clear-comment');
  expect(r.code === 64 && /--comment and --clear-comment together/.test(r.err), 'set --comment with --clear-comment: usage');
  const note = 'reproduced the bug; testing a fix';
  r = emerald('set', 'beta', '--comment', `  ${note}  `, '--phase', 'in-progress');
  expect(r.code === 0 && r.out.trim() === `set ${beta.slice(0, 8)} beta: comment ${JSON.stringify(note)}, phase in-progress`, 'set writes a trimmed comment and a phase');
  j = emeraldJson('ls', '--json');
  const betaRow = (j.json?.sessions ?? []).find((s) => s.id === beta);
  expect(betaRow?.comment === note && betaRow.phase === 'in-progress', 'ls --json carries the checkpoint');
  r = emerald('ls');
  expect(new RegExp(`  idle \\[in-progress\\] +\\d+[sm]  shell +beta\\n            ${note}\\n`).test(r.out), 'ls: the phase beside the badge, the comment on its own line under the row');
  j = emeraldJson('set', 'beta', '--clear-comment', '--json');
  expect(j.code === 0 && j.json?.comment === null && j.json.phase === 'in-progress', 'set --clear-comment --json: the comment goes, the phase stays');
  r = emerald('set', 'beta', '--comment', '   ', '--clear-phase');
  expect(r.code === 0 && /: comment cleared, phase cleared$/.test(r.out.trim()), 'a blank comment clears it, --clear-phase clears the phase');
  r = emerald('ls');
  expect(/  idle +\d+[sm]  shell +beta\n/.test(r.out) && !r.out.includes(note), 'ls: a row with no checkpoint is as before');
  // M9 fix 511: the daemon bounds a checkpoint at 2000 characters and
  // the CLI prints its refusal as any refusal.
  r = emerald('set', 'beta', '--comment', 'x'.repeat(2001));
  expect(r.code === 1 && /^emmer: comment must be at most 2000 characters \(bad-request\)$/m.test(r.err), 'set with a comment past 2000 characters: the daemon refuses it, exit 1');

  // M9 fix 351: set with no session is the session the command runs in,
  // off the EMERALD_SESSION_ID the daemon stamps on every pty (beta's id in
  // the child's env stands in for a command typed into beta's pane), and
  // outside emerald the usage error names the variable. The unset case
  // deletes the variable outright, since this script may itself run in a
  // emerald pane and inherit one.
  r = emeraldEnv({ EMERALD_SESSION_ID: beta }, 'set', '--comment', 'checkpoint');
  expect(r.code === 0 && r.out.trim() === `set ${beta.slice(0, 8)} beta: comment "checkpoint"`, 'set with no session, EMERALD_SESSION_ID set: the checkpoint lands on that session');
  j = emeraldJson('ls', '--json');
  expect((j.json?.sessions ?? []).find((s) => s.id === beta)?.comment === 'checkpoint', 'ls --json carries the checkpoint set without a session');
  r = emeraldEnv({ EMERALD_SESSION_ID: undefined }, 'set', '--comment', 'checkpoint');
  expect(r.code === 64 && /not inside emerald \(EMERALD_SESSION_ID is not set\); name a session/.test(r.err), 'set with no session outside emerald: the usage error names the variable, exit 64');
  r = emerald('set', 'beta', '--clear-comment');
  expect(r.code === 0, 'the checkpoint set without a session cleared again');

  // set --color (M29): a palette name, a hex in either case, and a word
  // that is neither names the palette in the usage error.
  r = emerald('set', 'beta', '--color', 'teal');
  expect(r.code === 0 && r.out.trim() === `set ${beta.slice(0, 8)} beta: colour #69ceaa`, 'set --color teal');
  j = emeraldJson('ls', '--json');
  expect((j.json?.sessions ?? []).find((s) => s.id === beta)?.color === '#69ceaa', 'ls --json says #69ceaa');
  // M9 fix 133: the twelve's lilac, and a name of M68's twenty-four the
  // twelve do not have is unknown, while its hex is still a colour.
  r = emerald('set', 'beta', '--color', 'lilac');
  expect(r.code === 0 && r.out.trim() === `set ${beta.slice(0, 8)} beta: colour #ae7cbe`, 'set --color lilac');
  r = emerald('set', 'beta', '--color', 'plum');
  expect(r.code === 64, 'set --color plum, a name of the twenty-four and not the twelve, is unknown');
  j = emeraldJson('set', 'beta', '--color', '#ab6ea1', '--json');
  expect(j.code === 0 && j.json?.color === '#ab6ea1', "the twenty-four's plum by hex is still a colour");
  j = emeraldJson('set', 'beta', '--color', '#E06C75', '--json');
  expect(j.code === 0 && j.json?.color === '#e06c75', 'set --color with an upper-case hex lands lower-case');
  r = emerald('set', 'beta', '--color', 'mauve');
  expect(r.code === 64 && /--color must be one of red, orange, amber, olive, green, teal, cyan, sky, blue, violet, lilac, magenta or a hex colour/.test(r.err), 'set with a bad colour: usage naming the palette, exit 64');
  r = emerald('help', 'set');
  expect(/--color red\|orange\|amber\|olive\|green\|teal\|cyan\|sky\|blue\|violet\|lilac\|magenta\|#rrggbb/.test(r.out), 'help set lists the palette names');

  // set --scheme (M9 fix 244): the session's own colour scheme by name,
  // on the record and in ls --json, named by explain, cleared back to
  // the window's with --clear-scheme; a new session has none.
  j = emeraldJson('ls', '--json');
  expect((j.json?.sessions ?? []).find((s) => s.id === beta)?.scheme === null, "ls --json: a session starts on the window's scheme (null)");
  r = emerald('set', 'beta', '--scheme', 'Solarized Dark');
  expect(r.code === 0 && r.out.trim() === `set ${beta.slice(0, 8)} beta: scheme Solarized Dark`, 'set --scheme names the scheme');
  j = emeraldJson('ls', '--json');
  expect((j.json?.sessions ?? []).find((s) => s.id === beta)?.scheme === 'Solarized Dark', 'ls --json carries the scheme');
  r = emerald('explain', 'beta');
  expect(r.code === 0 && r.out.includes("colour scheme: Solarized Dark, this session's own (emmer set --scheme)"), 'explain names the scheme');
  r = emerald('set', 'beta', '--scheme', 'Dracula', '--clear-scheme');
  expect(r.code === 64 && /--scheme and --clear-scheme together/.test(r.err), 'set --scheme with --clear-scheme: usage, exit 64');
  r = emerald('set', 'beta', '--scheme', '  ');
  expect(r.code === 64 && /--scheme needs a name/.test(r.err), 'set --scheme with a blank name: usage, exit 64');
  j = emeraldJson('set', 'beta', '--clear-scheme', '--json');
  expect(j.code === 0 && j.json?.scheme === null, 'set --clear-scheme --json: the scheme goes');
  r = emerald('explain', 'beta');
  expect(r.code === 0 && !r.out.includes('colour scheme:'), "explain has no scheme line on the window's pick");

  // M37: prompt and explain against a shell running fake-claude.mjs, which
  // posts the hooks a real turn would. prompt is send --enter plus wait
  // with the two gates; explain reads the log the sink wrote.
  r = emerald('prompt', 'beta');
  expect(r.code === 64 && /missing text/.test(r.err), 'prompt with no text: usage, exit 64');
  j = emeraldJson('shell', cliDir, '--name', 'claudish', '--json');
  const claudish = j.json?.session;
  expect(j.code === 0 && claudish?.kind === 'shell', 'a shell for the fake Claude');
  emerald('send', 'claudish', 'node', path.join('scripts', 'fake-claude.mjs'), '--enter');
  await until('fake-claude ready', () => (emerald('read', 'claudish', '--lines', '3').out.includes('fake-claude ready') ? true : null));
  j = emeraldJson('ls', '--json');
  const claudishRow = (j.json?.sessions ?? []).find((s) => s.id === claudish.id);
  expect(claudishRow?.state === 'idle' && /^fake-\d+$/.test(claudishRow.claudeSessionId ?? ''), 'the fake Claude bound a session id with its SessionStart');
  started = Date.now();
  r = emerald('prompt', 'claudish', 'hello', 'there');
  expect(r.code === 0 && r.out.trim() === 'echo: hello there' && Date.now() - started < 5000, `prompt: the reply's first line, exit 0 (${Date.now() - started} ms)`);
  j = emeraldJson('prompt', 'claudish', 'again', '--json');
  expect(j.code === 0 && j.json?.state === 'done' && j.json.reply === 'echo: again' && j.json.session?.lastPrompt === 'again' && typeof j.json.waitedMs === 'number', 'prompt --json: the state, the reply and the session');
  r = emerald('explain', 'claudish');
  expect(r.code === 0 && /^[0-9a-f]{8} claudish  shell  done for \d+s \(since \d\d:\d\d:\d\d\)$/m.test(r.out), 'explain: the state line');
  expect(/^Claude session fake-\d+$/m.test(r.out) && /^last prompt: again$/m.test(r.out) && /^last reply: echo: again$/m.test(r.out), 'explain: the Claude session id and the last turn');
  expect(/^last 5 of 5 hook events from .*hooks\.jsonl, oldest first:$/m.test(r.out), 'explain: five events, all of them');
  expect(/^  \d\d:\d\d:\d\d  UserPromptSubmit  applied  done -> working$/m.test(r.out) && /^  \d\d:\d\d:\d\d  Stop              applied  working -> done$/m.test(r.out), 'explain: the transitions on the lines');
  j = emeraldJson('explain', 'claudish', '--lines', '2', '--json');
  expect(j.code === 0 && j.json?.total === 5 && j.json.events.length === 2 && j.json.events[1].event === 'Stop' && j.json.events[1].to === 'done' && j.json.session?.state === 'done', 'explain --lines 2 --json: the last two of five');
  // M9 fix 52: a Stop with a task still running is waiting, and the badge
  // says how many and the detail which; prompt would sit on it, since
  // waiting counts as still working, so send and wait drive it.
  emerald('send', 'claudish', 'pause', 'please', '--enter');
  r = emerald('wait', 'claudish', '--for', 'waiting', '--timeout', '5000');
  expect(r.code === 0, 'a Stop with a running shell goes waiting');
  r = emerald('ls');
  // The running shell is a unit after the name (M46), and on its folder's
  // heading claudish is one inactive agent (waiting is not working) with
  // its one shell running.
  expect(/^  [0-9a-f]{8}  waiting \(1\) +\d+s  claude  claudish  ❯1$/m.test(r.out), `ls prints the count in the badge and the shell unit after the name, got ${JSON.stringify(r.out.split(/\r?\n/).find((l) => l.includes('claudish')))}`);
  expect(new RegExp(`^${cliDir.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}  ✳1 ❯1$`, 'm').test(r.out), `ls: the heading's units, got ${JSON.stringify(r.out.split(/\r?\n/).find((l) => l.startsWith(cliDir)))}`);
  // M9 fix 90: --team lists the members under the row, the shell here.
  r = emerald('ls', '--team');
  expect(/^  [0-9a-f]{8}  waiting \(1\) +\d+s  claude  claudish  ❯1\n            shell · running \d+s · Wait for the verify run to finish$/m.test(r.out), `ls --team lists the running shell under claudish by its description, got ${JSON.stringify(r.out.split(/\r?\n/).filter((l) => l.includes('claudish') || l.startsWith('            ')))}`);
  j = emeraldJson('ls', '--json');
  const pausedRow = (j.json?.sessions ?? []).find((s) => s.id === claudish.id);
  expect(pausedRow?.label === 'waiting (1)' && pausedRow.waitingOn?.length === 1 && pausedRow.waitingOn[0].type === 'shell' && pausedRow.waitingOn[0].command === 'until grep -q EXIT verify.log; do sleep 5; done', 'ls --json carries the running task, the completed one left out');
  expect(pausedRow?.team?.length === 1 && pausedRow.team[0].id === 'bt2' && pausedRow.team[0].kind === 'shell' && pausedRow.team[0].outcome === 'running' && pausedRow.team[0].command === 'until grep -q EXIT verify.log; do sleep 5; done', 'ls --json carries the team (M46): the running shell as a member');
  // M9 fix 101: the shell unit is the running count, as Claude Code's own
  // status line prints it. A Stop listing three running shells reads ❯3;
  // the next Stop listing one alone reads ❯1, and the two it dropped are
  // finished on the --team lines, not in the unit.
  emerald('send', 'claudish', 'pause', 'more', '--enter');
  await until('three shells listed', () => ((emeraldJson('ls', '--json').json?.sessions ?? []).find((s) => s.id === claudish.id)?.team?.length === 3 ? true : null));
  r = emerald('ls');
  expect(/^  [0-9a-f]{8}  waiting \(3\) +\d+s  claude  claudish  ❯3$/m.test(r.out), `ls prints three shells running after the wider Stop, got ${JSON.stringify(r.out.split(/\r?\n/).find((l) => l.includes('claudish')))}`);
  emerald('send', 'claudish', 'pause', 'please', '--enter');
  await until('two shells finished', () => ((emeraldJson('ls', '--json').json?.sessions ?? []).find((s) => s.id === claudish.id)?.team ?? []).filter((m) => m.outcome === 'returned').length === 2 ? true : null);
  r = emerald('ls', '--team');
  expect(/^  [0-9a-f]{8}  waiting \(1\) +\d+s  claude  claudish  ❯1$/m.test(r.out), `ls prints the one shell still running and not the two that finished (fix 101), got ${JSON.stringify(r.out.split(/\r?\n/).find((l) => l.includes('claudish')))}`);
  const finishedLines = r.out.split(/\r?\n/).filter((l) => /^            shell · finished after \d+s · (Build the app|Run the unit tests)$/.test(l));
  expect(finishedLines.length === 2 && /^            shell · running \d+s · Wait for the verify run to finish$/m.test(r.out), `ls --team lists the finished shells under the row beside the running one, got ${JSON.stringify(r.out.split(/\r?\n/).filter((l) => l.startsWith('            ')))}`);
  r = emerald('explain', 'claudish');
  expect(/^[0-9a-f]{8} claudish  shell  waiting \(1\) for \d+s/m.test(r.out) && /^1 shell still running\. Claude carries on when one finishes\.$/m.test(r.out) && /^Wait for the verify run to finish$/m.test(r.out), 'explain prints the count and the task on its own line');
  r = emerald('prompt', 'claudish', 'ask', 'me');
  expect(r.code === 0 && /claudish needs input: permission after \d+ ms$/.test(r.out.trim()), 'prompt that ends in a question says so, exit 0');
  j = emeraldJson('ls', '--json');
  expect((j.json?.sessions ?? []).find((s) => s.id === claudish.id)?.waitingOn?.length === 0, 'the next turn drops the tasks');
  // M9 fix 742: the fake posts the mod's ToolAsk before its dialog, so the
  // row names the tool and its command rather than a bare tool call.
  expect((j.json?.sessions ?? []).find((s) => s.id === claudish.id)?.askedFor?.words === 'Bash: npm publish', 'ls --json carries the ask the mod posted');
  r = emerald('ls');
  expect(r.out.split(/\r?\n/).some((l) => l.includes('claudish') && l.endsWith('Allow? Bash: npm publish')), `ls ends claudish's row with the ask, got ${JSON.stringify(r.out.split(/\r?\n/).find((l) => l.includes('claudish')))}`);
  r = emerald('explain', 'claudish');
  expect(r.out.split(/\r?\n/).includes('waiting on: Allow? Bash: npm publish'), `explain's waiting on line names the ask, got ${JSON.stringify(r.out.split(/\r?\n/).find((l) => l.startsWith('waiting on:')))}`);
  r = emerald('prompt', 'claudish', 'yes');
  expect(r.code === 1 && /claudish needs input: permission; answer it first, or --force to send anyway/.test(r.err), 'gate one: prompt to a session that needs input is refused, exit 1');
  r = emerald('prompt', 'claudish', 'yes', '--force');
  expect(r.code === 0 && r.out.trim() === 'echo: yes', 'prompt --force sends anyway and waits');
  j = emeraldJson('ls', '--json');
  expect((j.json?.sessions ?? []).find((s) => s.id === claudish.id)?.askedFor === null, 'the next prompt cleared the ask');
  log("M9 fix 742: the mod's ask names the tool on ls and explain, and the next prompt clears it");
  // M9 fix 153: a turn that builds a checklist (three TaskCreates, two
  // TaskUpdates) puts the count after the badge, ls --json carries the
  // list, explain lists it with the one in progress marked, and the next
  // prompt a person types clears it.
  r = emerald('prompt', 'claudish', 'plan', 'the', 'work');
  expect(r.code === 0 && r.out.trim() === 'planned: plan the work', 'a plan turn ends done');
  r = emerald('ls');
  expect(/^  [0-9a-f]{8}  done 1\/3 +\d+s  claude  claudish$/m.test(r.out), `ls prints the checklist's count after the badge, got ${JSON.stringify(r.out.split(/\r?\n/).find((l) => l.includes('claudish')))}`);
  j = emeraldJson('ls', '--json');
  const planned = (j.json?.sessions ?? []).find((s) => s.id === claudish.id);
  expect(planned?.tasks?.length === 3 && planned.tasks.map((task) => `${task.id}:${task.status}`).join(' ') === '1:completed 2:in_progress 3:pending' && planned.tasks[1].activeForm === 'Wiring the hooks', `ls --json carries the list, got ${JSON.stringify(planned?.tasks)}`);
  r = emerald('explain', 'claudish');
  expect(/^tasks: 1 of 3 done\n  \[x\]  Extend the row\n  \[>\]  Wiring the hooks\n  \[ \]  Write the tests$/m.test(r.out), `explain lists the checklist with the one in progress marked, got ${JSON.stringify(r.out.split(/\r?\n/).filter((l) => l.startsWith('tasks:') || l.startsWith('  [')))}`);
  r = emerald('prompt', 'claudish', 'next');
  expect(r.code === 0, 'the next prompt goes through');
  r = emerald('ls');
  expect(/^  [0-9a-f]{8}  done +\d+s  claude  claudish$/m.test(r.out), `a fresh prompt clears the count, got ${JSON.stringify(r.out.split(/\r?\n/).find((l) => l.includes('claudish')))}`);
  expect(((emeraldJson('ls', '--json').json?.sessions ?? []).find((s) => s.id === claudish.id)?.tasks ?? []).length === 0, 'and the list');
  // M9 fix 232: a turn whose tool call hangs posts nothing past the
  // floor; the daemon flags it, wait --for stale returns, ls reads
  // `quiet Ns` in the state column with the flag in --json, explain
  // names the threshold, and the hook that ends the call clears it.
  r = emerald('wait', 'claudish', '--for', 'stale', '--timeout', '600');
  expect(r.code === 2 && /timed out after 600 ms waiting for stale/.test(r.err), 'wait --for stale on a session that is posting: timeout, exit 2');
  emerald('send', 'claudish', 'quiet', 'build', '--enter');
  await until('the fake Claude went quiet', () => (emerald('read', 'claudish', '--lines', '3').out.includes('fake-claude quiet') ? true : null));
  started = Date.now();
  r = emerald('wait', 'claudish', '--for', 'stale', '--timeout', String(STALE_MS * 4));
  const staleAfter = Date.now() - started;
  expect(r.code === 0 && /claudish is quiet \d+s after \d+ ms$/.test(r.out.trim()) && staleAfter < STALE_MS * 2, `wait --for stale returned with the word once the daemon flagged the silence (${staleAfter} ms on a ${STALE_MS} ms floor), got ${JSON.stringify(r.out.trim())}`);
  r = emerald('ls');
  expect(/^  [0-9a-f]{8}  quiet \d+s +\d+s  claude  claudish$/m.test(r.out), `ls prints quiet and the silence in the state column, got ${JSON.stringify(r.out.split(/\r?\n/).find((l) => l.includes('claudish')))}`);
  j = emeraldJson('ls', '--json');
  const quietRow = (j.json?.sessions ?? []).find((s) => s.id === claudish.id);
  expect(quietRow?.state === 'working' && quietRow.stale === true && /^quiet \d+s$/.test(quietRow.label) && quietRow.staleThresholdMs === STALE_MS, `ls --json: still working, stale, the label and the threshold it tripped, got ${JSON.stringify({ state: quietRow?.state, stale: quietRow?.stale, label: quietRow?.label, staleThresholdMs: quietRow?.staleThresholdMs })}`);
  r = emerald('explain', 'claudish');
  expect(/^[0-9a-f]{8} claudish  shell  quiet \d+s for \d+s/m.test(r.out) && /^No hook event for \d+s, past the 6s floor\. Claude may be stuck, or the hooks may not be installed: read its screen, then nudge it or kill it\.$/m.test(r.out), `explain names the silence and the threshold it tripped, got ${JSON.stringify(r.out.split(/\r?\n/).slice(0, 3))}`);
  expect(/^  \d\d:\d\d:\d\d  PreToolUse +applied/m.test(r.out), 'explain lists the PreToolUse the silence started after');
  r = emerald('wait', 'claudish', '--for', 'stale');
  expect(r.code === 0 && /claudish is quiet \d+s after \d+ ms$/.test(r.out.trim()), 'wait --for stale on a session already flagged returns at once');
  // M9 fix 741: --if-idle refuses the working row and sends nothing.
  r = emerald('prompt', 'claudish', 'more', '--if-idle');
  expect(r.code === 1 && /claudish is .+; --if-idle sends only to a session that is not working/.test(r.err), `prompt --if-idle refuses a working session, exit 1 (${r.code}: ${JSON.stringify(r.err)})`);
  r = emerald('send', 'claudish', 'more', '--enter', '--if-idle');
  expect(r.code === 1 && /claudish is .+; --if-idle sends only to a session that is not working/.test(r.err), `send --if-idle refuses a working session, exit 1 (${r.code}: ${JSON.stringify(r.err)})`);
  log('M9 fix 741: --if-idle refuses a working session on send and prompt');
  emerald('send', 'claudish', 'carry', 'on', '--enter');
  r = emerald('wait', 'claudish', '--for', 'done', '--timeout', '5000');
  expect(r.code === 0, 'the hung call ends and the turn with it');
  j = emeraldJson('ls', '--json');
  expect((j.json?.sessions ?? []).find((s) => s.id === claudish.id)?.stale === false, 'the hook cleared the flag');
  r = emerald('wait', 'claudish', '--for', 'banana');
  expect(r.code === 64 && /stale/.test(r.err), 'the usage lists stale among the targets');
  started = Date.now();
  r = emerald('prompt', 'claudish', 'quit');
  expect(r.code === 3 && /did not start working within 5000 ms; the text may be sitting in its input box/.test(r.err) && Date.now() - started > 4500, 'gate two: a session that does not go working is stalled, exit 3');
  await until('fake-claude bye', () => (emerald('read', 'claudish', '--lines', '3').out.includes('fake-claude bye') ? true : null));
  emerald('kill', 'claudish');
  r = emerald('wait', 'claudish', '--for', 'exited', '--timeout', '5000');
  expect(r.code === 0, 'claudish exited after kill');

  r = emerald('send', 'alpha', 'hi');
  expect(r.code === 1 && /has exited; resume it first/.test(r.err), 'send to an exited session: refused');
  r = emerald('wait', 'alpha', '--for', 'done');
  expect(r.code === 1 && /exited before reaching done/.test(r.err), 'wait for done on an exited session: exit 1');

  // resume brings alpha back under the same id; rm forgets it after a second kill.
  j = emeraldJson('resume', 'alpha', '--json');
  expect(j.code === 0 && j.json?.session?.id === alpha.id && j.json.session.state === 'idle', 'resume: same id, idle again');
  r = emerald('resume', 'alpha');
  expect(r.code === 1 && /is idle, not exited/.test(r.err), 'resume a live session: refused');
  const marker2 = `EMERALD_CLI2_${Date.now()}`;
  emerald('send', 'alpha', 'echo', marker2, '--enter');
  await until('marker in the resumed shell', () => (emerald('read', 'alpha', '--lines', '3').out.includes(marker2) ? true : null));
  emerald('kill', 'alpha');
  r = emerald('wait', 'alpha', '--for', 'exited', '--timeout', '5000');
  expect(r.code === 0, 'alpha exited again');
  r = emerald('rm', 'alpha');
  expect(r.code === 0 && r.out.trim() === `removed ${alpha.id.slice(0, 8)} alpha`, 'rm an exited session');
  j = emeraldJson('ls', '--json');
  expect(j.json?.sessions.length === 2 && j.json.sessions[0].name === 'beta' && j.json.sessions[1].name === 'claudish', 'ls --json: beta and the exited claudish remain');
  // The daemon writes sessions.json up to a quarter second after a change
  // (M9 fix 459), so the read waits for the removal to land; a read
  // mid-rename is tried again.
  const readSessionsFile = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(home, 'sessions.json'), 'utf8')).sessions;
    } catch {
      return null;
    }
  };
  await until('sessions.json marks alpha removed', () => typeof readSessionsFile()?.find((x) => x.id === alpha.id)?.removedAt === 'number', 3000);
  const sessionsFile = readSessionsFile();
  // M57: the removed record stays in the file, marked removedAt, so the timeline and the lanes can still name it.
  const alphaKept = sessionsFile.find((x) => x.id === alpha.id);
  const live = sessionsFile.filter((x) => x.removedAt == null).map((x) => x.name);
  expect(typeof alphaKept?.removedAt === 'number' && live.join(',') === 'beta,claudish', `sessions.json keeps alpha as removed (M57) and lists beta and claudish live, got ${JSON.stringify(sessionsFile.map((x) => [x.name, x.removedAt]))}`);

  // focus: the focused pane starts showing beta, then focus finds that pane.
  r = emerald('focus', 'beta');
  expect(r.code === 0 && /^showing [0-9a-f]{8} beta in pane /.test(r.out), 'focus puts beta in the focused pane');
  const state = JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8')).layout;
  // One layout tab since M36; its tree is what the single tree was.
  const tab = state.tabs.find((t) => t.id === state.currentTabId);
  expect(state.tabs.length === 1 && tab.root.kind === 'pane' && tab.root.sessionId === beta && tab.focusedPaneId === tab.root.id, 'state.json shows beta in the pane of the one tab');
  r = emerald('focus', 'beta');
  expect(r.code === 0 && /^focused [0-9a-f]{8} beta in pane /.test(r.out), 'focus again just focuses the pane');

  // Spawn args: a shell started with `-- -NoExit -Command ...` sets a
  // variable at startup. Reading it back after each resume proves the new
  // process was started with the same args, and the daemon restart in the
  // middle proves they came back from sessions.json.
  const stamp = `M8_${Date.now()}`;
  const gammaArgs = ['-NoExit', '-Command', `$env:EMERALD_M8='${stamp}'`];
  j = emeraldJson('shell', os.homedir(), '--name', 'gamma', '--json', '--', ...gammaArgs);
  const gamma = j.json?.session;
  expect(j.code === 0 && JSON.stringify(gamma?.args) === JSON.stringify(gammaArgs), 'shell -- args: the session carries them');
  const stampSeen = async (what) => {
    await until(what, () => {
      emerald('send', 'gamma', 'echo', '$env:EMERALD_M8', '--enter');
      return emerald('read', 'gamma', '--lines', '6').out.split('\n').includes(stamp) ? true : null;
    });
    expect(true, what);
  };
  await stampSeen('the args took effect in the shell');

  // focus --beside (M9 fix 91): beta holds the one pane, so gamma gets a
  // new pane split to its right and beta keeps its own; a second call
  // finds gamma's pane.
  r = emerald('focus', '--beside', 'gamma');
  expect(r.code === 0 && /^showing [0-9a-f]{8} gamma in pane /.test(r.out), 'focus --beside shows gamma');
  const besideState = JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8')).layout;
  const besideTab = besideState.tabs.find((t) => t.id === besideState.currentTabId);
  const besideRoot = besideTab.root;
  expect(besideRoot.kind === 'split' && besideRoot.direction === 'row' && besideRoot.first.sessionId === beta && besideRoot.second.sessionId === gamma.id && besideTab.focusedPaneId === besideRoot.second.id, 'state.json shows beta in the first pane and gamma focused in the new second pane');
  r = emerald('focus', '--beside', 'gamma');
  expect(r.code === 0 && /^focused [0-9a-f]{8} gamma in pane /.test(r.out), 'focus --beside on a shown session just focuses its pane');

  // ls orders as created by default (M32): beta's folder was there first,
  // so it leads; --by-state ranks the newest idle session first, which
  // puts gamma's folder on top.
  // The exited claudish (M37) sits in the exited group, last either way.
  j = emeraldJson('ls', '--json');
  expect(JSON.stringify((j.json?.sessions ?? []).map((s) => s.name)) === JSON.stringify(['beta', 'gamma', 'claudish']), 'ls --json: beta then gamma, as created, the exited one last');
  j = emeraldJson('ls', '--by-state', '--json');
  expect(JSON.stringify((j.json?.sessions ?? []).map((s) => s.name)) === JSON.stringify(['gamma', 'beta', 'claudish']), 'ls --by-state --json: gamma then beta, newest idle first');
  r = emerald('ls', '--by-state');
  expect(r.code === 0 && r.out.indexOf(os.homedir()) < r.out.indexOf(repoRoot), 'ls --by-state: the text listing leads with the folder of gamma');
  r = emerald('help', 'ls');
  expect(r.code === 0 && r.out.includes('--by-state'), 'help ls names --by-state');
  emerald('kill', 'gamma');
  r = emerald('wait', 'gamma', '--for', 'exited', '--timeout', '5000');
  expect(r.code === 0, 'gamma exited after kill');
  j = emeraldJson('resume', 'gamma', '--json');
  expect(j.code === 0 && JSON.stringify(j.json?.session?.args) === JSON.stringify(gammaArgs), 'resume: the session still carries the args');
  await stampSeen('the resumed shell was started with the args');

  // The checkpoint rides along: written before the daemon restart, read
  // back from sessions.json after it, and kept by the resume.
  r = emerald('set', 'gamma', '--comment', 'kept across a restart', '--phase', 'todo', '--color', 'violet');
  expect(r.code === 0, 'set on gamma before the restart');
  // The stop asks the daemon first (M9 fix 159), so it keeps gamma's
  // screen, which the stamp is on; explain prints it after the restart,
  // from the daemon and, with the daemon down, from sessions.json.
  r = emerald('daemon', 'stop');
  expect(r.code === 0 && /^stopped emmerd, pid \d+, \d+ screens? kept$/m.test(r.out), `daemon stop with gamma live keeps the screens, got ${JSON.stringify(r.out)}`);
  const keptOnDisk = JSON.parse(fs.readFileSync(path.join(home, 'sessions.json'), 'utf8')).sessions.find((s) => s.id === gamma.id)?.lastScreen ?? null;
  expect(keptOnDisk !== null && keptOnDisk.rows.includes(stamp), `sessions.json holds gamma's last screen with the stamp on it, got ${JSON.stringify(keptOnDisk?.rows?.slice(-4))}`);
  const keptLine = (out) => out.split(/\r?\n/).some((l) => l === `  | ${stamp}`);
  r = emerald('explain', 'gamma');
  expect(r.code === 0 && /^emmerd is not running; the session is as sessions\.json last wrote it$/m.test(r.out) && /^last screen, \d+ rows? kept when the process ended:$/m.test(r.out) && keptLine(r.out), `explain with the daemon down prints the kept screen from the file, got ${JSON.stringify(r.out.split(/\r?\n/).slice(0, 8))}`);
  r = emerald('daemon', 'start');
  expect(r.code === 0 && /^started emmerd/.test(r.out), 'daemon start again');
  j = emeraldJson('ls', '--json');
  const gammaRow = (j.json?.sessions ?? []).find((s) => s.id === gamma.id);
  expect(gammaRow?.state === 'exited' && JSON.stringify(gammaRow.args) === JSON.stringify(gammaArgs), 'ls --json after the restart: gamma exited with its args');
  r = emerald('explain', 'gamma');
  expect(r.code === 0 && !/not running/.test(r.out) && keptLine(r.out), `explain on the new daemon prints the kept screen from pty.screen, got ${JSON.stringify(r.out.split(/\r?\n/).slice(0, 8))}`);
  j = emeraldJson('read', 'gamma', '--screen', '--json');
  expect(j.code === 0 && j.json?.kept === true && j.json.rows.includes(stamp), `read --screen --json on the restored session is the kept frame, marked kept, got ${JSON.stringify(j.json)}`);
  expect(gammaRow?.comment === 'kept across a restart' && gammaRow.phase === 'todo', 'ls --json after the restart: the checkpoint came back');
  const onDisk = JSON.parse(fs.readFileSync(path.join(home, 'sessions.json'), 'utf8')).sessions.find((s) => s.id === gamma.id);
  expect(JSON.stringify(onDisk?.args) === JSON.stringify(gammaArgs), 'sessions.json holds the args');
  expect(onDisk?.comment === 'kept across a restart' && onDisk.phase === 'todo', 'sessions.json holds the checkpoint');
  expect(gammaRow?.color === '#b4acf9' && onDisk?.color === '#b4acf9', 'the set colour came back after the restart, from sessions.json');
  j = emeraldJson('resume', 'gamma', '--json');
  expect(j.code === 0 && j.json?.session?.state === 'idle', 'resume after the restart');
  expect(j.json?.session?.comment === 'kept across a restart' && j.json.session.phase === 'todo', 'resume keeps the checkpoint');
  await stampSeen('the shell resumed after a daemon restart was started with the args');
  emerald('kill', 'gamma');
  r = emerald('wait', 'gamma', '--for', 'exited', '--timeout', '5000');
  expect(r.code === 0, 'gamma exited again');

  // M48: a shell that hosted a conversation resumes in the folder Claude
  // started in, with claude --resume typed at its first prompt; the shim
  // above makes that line run the fake Claude, which plays the
  // conversation back. The prompt reports the long form of a path where
  // the temp folder may be the 8.3 form, so the folders are compared
  // against the real path.
  const hostedRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emmer-cli-hosted-')));
  const hostedSub = path.join(hostedRoot, 'sub');
  fs.mkdirSync(hostedSub);
  const sameFolder = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
  const rowOf = (id) => (emeraldJson('ls', '--json').json?.sessions ?? []).find((s) => s.id === id);
  j = emeraldJson('shell', hostedRoot, '--name', 'hosted', '--json');
  const hosted = j.json?.session;
  expect(j.code === 0 && hosted?.kind === 'shell' && hosted.conversation === null, 'a shell for the conversation to resume, none behind it yet');
  emerald('send', 'hosted', `cd '${hostedSub}'`, '--enter');
  await until('hosted in sub', () => (sameFolder(rowOf(hosted.id)?.cwd, hostedSub) ? true : null));
  emerald('send', 'hosted', 'claude', '--enter');
  await until('fake-claude ready in hosted', () => (emerald('read', 'hosted', '--lines', '3').out.includes('fake-claude ready') ? true : null));
  let hostedRow = rowOf(hosted.id);
  expect(/^fake-\d+$/.test(hostedRow?.claudeSessionId ?? '') && hostedRow.conversation?.id === hostedRow.claudeSessionId && sameFolder(hostedRow.conversation.cwd, hostedSub) && hostedRow.conversation.args.length === 0, `the conversation is bound with the folder Claude started in, got ${JSON.stringify(hostedRow?.conversation)}`);
  const convId = hostedRow.claudeSessionId;
  r = emerald('prompt', 'hosted', 'one', 'line');
  expect(r.code === 0 && r.out.trim() === 'echo: one line', 'one turn in the conversation');
  emerald('send', 'hosted', 'quit', '--enter');
  await until('fake-claude bye in hosted', () => (emerald('read', 'hosted', '--lines', '3').out.includes('fake-claude bye') ? true : null));
  await until('hosted unbound', () => (rowOf(hosted.id)?.claudeSessionId === null ? true : null));
  hostedRow = rowOf(hosted.id);
  expect(hostedRow.conversation?.id === convId, 'the conversation outlives SessionEnd');
  expect(sameFolder(hostedRow.cwd, hostedSub) && sameFolder(hostedRow.groupCwd, hostedSub), 'the shell is still in sub once Claude leaves');
  emerald('kill', 'hosted');
  r = emerald('wait', 'hosted', '--for', 'exited', '--timeout', '5000');
  expect(r.code === 0, 'hosted exited after kill');
  expect(rowOf(hosted.id)?.conversation?.id === convId, 'the conversation outlives the exit');
  const hooksBefore = fs.readFileSync(path.join(home, 'logs', 'hooks.jsonl'), 'utf8').split('\n').filter(Boolean).length;
  j = emeraldJson('resume', 'hosted', '--json');
  expect(j.code === 0 && j.json?.session?.kind === 'shell' && sameFolder(j.json.session.cwd, hostedSub) && sameFolder(j.json.session.groupCwd, hostedSub), `resume: a shell again, in the conversation's folder, got ${j.json?.session?.cwd}`);
  expect(j.json?.session?.conversation?.id === convId, 'resume: the conversation still on the record');
  await until('fake-claude ready again', () => (emerald('read', 'hosted', '--lines', '5').out.includes('fake-claude ready') ? true : null), 15000);
  r = emerald('read', 'hosted', '--lines', '5');
  expect(r.out.includes(`claude --resume ${convId}`), `the line was typed at the prompt, got ${JSON.stringify(r.out)}`);
  const resumeStart = fs
    .readFileSync(path.join(home, 'logs', 'hooks.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(hooksBefore)
    .map((l) => JSON.parse(l))
    .find((l) => l.sessionId === hosted.id && l.event === 'SessionStart');
  expect(resumeStart?.payload?.source === 'resume' && resumeStart.payload.session_id === convId && resumeStart.outcome === 'applied', `the resumed conversation reported in with source resume and the same id, got ${JSON.stringify(resumeStart?.payload)}`);
  hostedRow = rowOf(hosted.id);
  expect(hostedRow?.claudeSessionId === convId && hostedRow.conversation?.id === convId && sameFolder(hostedRow.conversation.cwd, hostedSub), 'bound again to the same conversation');
  r = emerald('prompt', 'hosted', 'back');
  expect(r.code === 0 && r.out.trim() === 'echo: back', 'a turn in the resumed conversation');
  emerald('send', 'hosted', 'quit', '--enter');
  await until('fake-claude bye again', () => (emerald('read', 'hosted', '--lines', '3').out.includes('fake-claude bye') ? true : null));
  await until('the shell prompt is back', () => (/PS [^\r\n]*sub>/.test(emerald('read', 'hosted', '--lines', '3').out) ? true : null));
  expect(rowOf(hosted.id)?.claudeSessionId === null && rowOf(hosted.id)?.state === 'idle', 'a shell again once Claude leaves');
  emerald('kill', 'hosted');
  r = emerald('wait', 'hosted', '--for', 'exited', '--timeout', '5000');
  expect(r.code === 0, 'hosted exited');

  r = emerald('daemon', 'stop');
  expect(r.code === 0 && /^stopped emmerd, pid \d+/.test(r.out), 'daemon stop');
  expect(!fs.existsSync(path.join(home, 'daemon.json')), 'daemon.json removed');
  r = emerald('daemon', 'status');
  expect(r.code === 1 && /^emmerd is not running$/m.test(r.out) && /^set aside: folders\.json\.bad-/m.test(r.out), 'daemon status after stop: exit 1, and the set-aside folders.json still named');
  r = emerald('daemon', 'stop');
  expect(r.code === 0 && /not running/.test(r.out), 'daemon stop twice is a no-op');
  // explain with the daemon down: the session from sessions.json, the
  // events from the log.
  r = emerald('explain', 'claudish');
  expect(r.code === 0 && /^[0-9a-f]{8} claudish  shell  killed for \d+[sm]/.test(r.out) && /^emmerd is not running; the session is as sessions.json last wrote it$/m.test(r.out), 'explain with emmerd down reads sessions.json');
  // 25 events since the plan turn (M9 fix 153) added its seven and the prompt after it two; explain shows its last 20 by default.
  // M9 fix 742: the ask's ToolAsk is one more, 30.
  expect(/^last 20 of 30 hook events/m.test(r.out) && /working -> done$/m.test(r.out) && /working -> needs-input$/m.test(r.out), `explain with emmerd down still lists the events, got ${JSON.stringify(r.out.split(/\r?\n/).find((l) => l.includes('hook events')))}`);
  r = emerald('explain', 'nobody');
  expect(r.code === 1 && /no session matches "nobody"/.test(r.err), 'explain an unknown session with emmerd down: exit 1');

  // Bindings one block makes and a later block reads (M9 fix 426); the
  // later block names the first in BLOCKS' needs, so --only runs both.
  let feedPort;
  await block('fix-239', async () => {
    // M9 fix 239: the update feed. A release folder the way dist leaves it
    // (a manifest naming an installer and its blockmap), published into a
    // feed folder under the private home, then served on a port the OS
    // picks and read back over http; a tampered installer is refused.
    const release = path.join(home, 'release');
    fs.mkdirSync(release, { recursive: true });
    const setupName = 'Emerald-setup-0.1.240-arm64.exe';
    fs.writeFileSync(path.join(release, setupName), 'not really an installer');
    fs.writeFileSync(path.join(release, `${setupName}.blockmap`), 'blocks');
    const setupHash = crypto.createHash('sha512').update(fs.readFileSync(path.join(release, setupName))).digest('base64');
    fs.writeFileSync(
      path.join(release, 'latest.yml'),
      ['version: 0.1.240', 'files:', `  - url: ${setupName}`, `    sha512: ${setupHash}`, '    size: 23', `path: ${setupName}`, `sha512: ${setupHash}`, "releaseDate: '2026-09-17T00:00:00.000Z'", ''].join('\n'),
    );
    r = emerald('feed', 'publish');
    expect(r.code === 64 && /missing release/.test(r.err), 'feed publish without a release dir: usage error');
    r = emerald('feed', 'publish', path.join(home, 'nowhere'), '--dir', feedDir);
    expect(r.code === 1 && /latest\.yml is missing/.test(r.err) && !fs.existsSync(feedDir), 'feed publish on a folder without a manifest: exit 1, nothing written');
    j = emeraldJson('feed', 'publish', release, '--dir', feedDir, '--json');
    expect(j.code === 0 && j.json?.version === '0.1.240' && j.json.files.join(',') === `latest.yml,${setupName},${setupName}.blockmap` && j.json.missing.length === 0, `feed publish --json copied the three files, got ${JSON.stringify(j.json)}`);
    // Compared sorted on both sides, so the installer's name can sort
    // either side of latest.yml (M9 fix 542).
    expect(fs.readdirSync(feedDir).sort().join(',') === ['latest.yml', setupName, `${setupName}.blockmap`].sort().join(','), 'the feed folder holds the manifest, the installer and the blockmap');
    r = emerald('feed', 'publish', release, '--dir', feedDir);
    expect(r.code === 0 && /^published emerald 0\.1\.240 to .*: latest\.yml, Emerald-setup-0\.1\.240-arm64\.exe, Emerald-setup-0\.1\.240-arm64\.exe\.blockmap$/m.test(r.out), `feed publish prints what it copied: ${r.out.trim()}`);
    fs.appendFileSync(path.join(release, setupName), ' tampered');
    r = emerald('feed', 'publish', release, '--dir', feedDir);
    expect(r.code === 1 && /does not match the sha512/.test(r.err), 'a tampered installer is refused');
    const serve = spawn(process.execPath, [main, 'feed', 'serve', '--dir', feedDir, '--port', '0', '--json'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let serveOut = '';
    serve.stdout.on('data', (d) => (serveOut += d));
    serve.stderr.on('data', (d) => (serveOut += d));
    const served = await until('feed serve to print its URL', () => {
      try {
        return JSON.parse(serveOut);
      } catch {
        return null;
      }
    });
    expect(served.dir === feedDir && served.port > 0 && served.url === `http://127.0.0.1:${served.port}/`, `feed serve --json names the folder and the port it took (${served.url})`);
    const manifest = await fetch(`${served.url}latest.yml`);
    expect(manifest.status === 200 && /^version: 0\.1\.240$/m.test(await manifest.text()), 'the served manifest is the published one');
    const setupRes = await fetch(`${served.url}${setupName}`, { headers: { range: 'bytes=0-2' } });
    expect(setupRes.status === 206 && (await setupRes.text()) === 'not' && setupRes.headers.get('content-range') === 'bytes 0-2/23', 'the served installer answers a byte range');
    expect((await fetch(`${served.url}missing.exe`)).status === 404, 'a file not in the feed is a 404');
    serve.kill();
    r = emerald('feed', 'serve', '--port', 'many');
    expect(r.code === 64 && /--port must be a whole number/.test(r.err), 'feed serve with a bad port: usage error');
    r = emerald('feed', 'nothing');
    expect(r.code === 64 && /unknown feed action/.test(r.err), 'an unknown feed action: usage error');
  });
  await block('fix-240', async () => {
    // M9 fix 240: with the folder published, a daemon start serves it on
    // its own, and daemon status says so.
    r = emerald('daemon', 'start');
    expect(r.code === 0 && /^started emmerd/.test(r.out), 'daemon start with a feed folder');
    j = emeraldJson('daemon', 'status', '--json');
    expect(j.code === 0 && j.json?.feed?.dir === feedDir && j.json.feed.port > 0, `daemon status --json names the feed folder and the port it took, got ${JSON.stringify(j.json?.feed)}`);
    feedPort = j.json.feed.port;
    r = emerald('daemon', 'status');
    expect(r.out.includes(`feed: serving ${feedDir} on ${feedPort}`), `daemon status prints the feed line, got ${JSON.stringify(r.out)}`);
    const daemonManifest = await fetch(`http://127.0.0.1:${feedPort}/latest.yml`);
    expect(daemonManifest.status === 200 && /^version: 0\.1\.240$/m.test(await daemonManifest.text()), 'the daemon serves the published manifest');
    expect((await fetch(`http://127.0.0.1:${feedPort}/missing.exe`)).status === 404, 'the daemon answers a 404 for a file not in the feed');
  });
  await block('fix-320', async () => {
    // M9 fix 320: emmer conflicts against a seeded repository. Twenty
    // lines in one file on main; worktrees a and b both rewrite line 1
    // (the pair), c adds a file of its own (clean); a shell started in
    // each, so each branch is a live session the daemon pairs. The
    // daemon polls after each spawn, so the pair lands within a second
    // or two; the head line, the pair line with the file in full and the
    // three base lines are read whole, then the no-pairs case with the
    // pair's shells gone and c's base still printed.
    const cfRoot = path.join(home, 'conflicts-repo');
    fs.rmSync(cfRoot, { recursive: true, force: true });
    fs.mkdirSync(cfRoot, { recursive: true });
    const cfGit = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    cfGit(cfRoot, 'init', '-q', '-b', 'main');
    cfGit(cfRoot, 'config', 'user.name', 'verify');
    cfGit(cfRoot, 'config', 'user.email', 'verify@example.invalid');
    cfGit(cfRoot, 'config', 'commit.gpgsign', 'false');
    const cfLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(cfRoot, 'f.txt'), cfLines.join('\n') + '\n');
    cfGit(cfRoot, 'add', 'f.txt');
    cfGit(cfRoot, 'commit', '-q', '-m', 'C0');
    const cfWt = {};
    for (const name of ['a', 'b', 'c']) {
      cfWt[name] = path.join(home, `conflicts-${name}`);
      fs.rmSync(cfWt[name], { recursive: true, force: true });
      cfGit(cfRoot, 'worktree', 'add', '-q', '-b', `collide-${name}`, cfWt[name], 'main');
    }
    fs.writeFileSync(path.join(cfWt.a, 'f.txt'), ['A'].concat(cfLines.slice(1)).join('\n') + '\n');
    cfGit(cfWt.a, 'commit', '-q', '-am', 'a');
    fs.writeFileSync(path.join(cfWt.b, 'f.txt'), ['B'].concat(cfLines.slice(1)).join('\n') + '\n');
    cfGit(cfWt.b, 'commit', '-q', '-am', 'b');
    fs.writeFileSync(path.join(cfWt.c, 'c.txt'), 'c\n');
    cfGit(cfWt.c, 'add', 'c.txt');
    cfGit(cfWt.c, 'commit', '-q', '-m', 'c');
    const cfShell = {};
    for (const name of ['a', 'b', 'c']) {
      j = emeraldJson('shell', cfWt[name], '--name', `collide-${name}`, '--json');
      expect(j.code === 0 && j.json?.session?.branch === `collide-${name}`, `a shell on collide-${name} (${JSON.stringify(j.json?.session?.branch)})`);
      cfShell[name] = j.json.session.id;
    }
    const cfPair = await until('conflicts --json to carry the a and b pair and three bases', () => {
      const c = emeraldJson('conflicts', '--json');
      return c.code === 0 && c.json?.conflicts?.length === 1 && Object.keys(c.json.base).length === 3 ? c.json : null;
    }, 20000);
    expect([cfPair.conflicts[0].a, cfPair.conflicts[0].b].sort().join(',') === [cfShell.a, cfShell.b].sort().join(',') && cfPair.conflicts[0].files.join(',') === 'f.txt', `the pair is a and b on f.txt (${JSON.stringify(cfPair.conflicts)})`);
    expect(['a', 'b', 'c'].every((n) => cfPair.base[cfShell[n]]?.ahead === 1 && cfPair.base[cfShell[n]].behind === 0 && cfPair.base[cfShell[n]].defaultBranch === 'main'), `each branch is 1 ahead, 0 behind main (${JSON.stringify(cfPair.base)})`);
    r = emerald('conflicts');
    const cfText = r.out.trimEnd().split(/\r?\n/);
    expect(r.code === 0 && cfText[0] === 'emerald · 3 sessions on 3 branches · 1 pair will conflict', `the head line counts the sessions, the branches and the pair (${JSON.stringify(cfText[0])})`);
    expect(cfText[1] === '' && /^  collide-a  collide-b  f\.txt$/.test(cfText[2]) && cfText[3] === '', `the pair line names both branches and the file in full (${JSON.stringify(cfText.slice(1, 4))})`);
    const cfBases = cfText.slice(4);
    expect(cfBases.length === 3 && cfBases.every((l) => /^  collide-[abc]  1 ahead, 0 behind main, forked \d+[smh] ago$/.test(l)), `three base lines, each 1 ahead, 0 behind main (${JSON.stringify(cfBases)})`);
    expect(cfBases.every((l) => l.split(/\s+ahead/)[0].length === cfBases[0].split(/\s+ahead/)[0].length), 'the base columns are padded alike');
    r = emerald('conflicts', '--folder', cfWt.c);
    expect(r.code === 0 && r.out.startsWith('emerald · 1 session on 1 branch · no pairs will conflict'), `--folder keeps one repository block (${JSON.stringify(r.out.split(/\r?\n/)[0])})`);
    // The pair's shells gone: no pairs, c's base still printed.
    for (const n of ['a', 'b']) emerald('kill', cfShell[n]);
    // Both of the pair, not a alone: the daemon drops the two bases as the
    // kills land, so a wait that gated on a and an assert that counted the
    // keys disagreed whenever b was a moment behind, which failed twice in
    // four runs at the batch of fixes 394 to 425 and is nothing to do with
    // what this block reads.
    const cfNone = await until('conflicts --json to drop the pair', () => {
      const c = emeraldJson('conflicts', '--json');
      return c.code === 0 && c.json?.conflicts?.length === 0 && c.json.base[cfShell.c] !== undefined && c.json.base[cfShell.a] === undefined && c.json.base[cfShell.b] === undefined ? c.json : null;
    }, 20000);
    expect(Object.keys(cfNone.base).length === 1, `only c keeps a base once a and b have exited (${JSON.stringify(Object.keys(cfNone.base))})`);
    r = emerald('conflicts');
    const cfTextNone = r.out.trimEnd().split(/\r?\n/);
    expect(cfTextNone[0] === 'emerald · 1 session on 1 branch · no pairs will conflict' && cfTextNone[1] === '' && /^  collide-c  1 ahead, 0 behind main/.test(cfTextNone[2]) && cfTextNone.length === 3, `with no pair the head line says so and the base still prints (${JSON.stringify(cfTextNone)})`);
    emerald('kill', cfShell.c);
    log('M9 fix 320: emmer conflicts prints the head line, the pair with its file in full and the bases padded alike, --json the wire shape, --folder one block, and the no-pairs form once the pair has exited');

    r = emerald('daemon', 'stop');
    expect(r.code === 0 && /^stopped emmerd/.test(r.out), 'daemon stop releases the feed');
    expect(await fetch(`http://127.0.0.1:${feedPort}/latest.yml`).then(() => false, () => true), 'the feed port is closed with the daemon');
  });

  await block('fix-379', async () => {
    // M9 fix 379: a pipe that nothing serves, and one whose server takes
    // the connection and drops it on the first frame (a daemon dying under
    // the command), each end in one line on stderr and exit 1, never a
    // stack and never silence. The dropping server is this process, so the
    // command runs asynchronously: a spawnSync would block the loop the
    // server's drop runs on, and the command would wait on a hello nobody
    // answers.
    r = emeraldEnv({ EMERALD_PIPE: '\\\\.\\pipe\\emmerd-verify-cli-nobody' }, 'ls');
    expect(r.code === 1 && r.err.trim() === 'emmer: emmerd is not running (run emmer daemon start, or open the Emerald app)', `ls on a pipe nothing serves: the one line, exit 1 (${JSON.stringify(r.err)})`);
    const dropPipe = `\\\\.\\pipe\\emmerd-verify-cli-drop-${process.pid}`;
    const dropServer = net.createServer((s) => s.once('data', () => s.destroy()));
    await new Promise((resolve, reject) => dropServer.once('error', reject).listen(dropPipe, resolve));
    const emeraldOnDrop = (...args) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [main, ...args], { env: { ...env, EMERALD_PIPE: dropPipe }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        const timer = setTimeout(() => child.kill(), 15000);
        child.on('close', (code) => {
          clearTimeout(timer);
          fs.appendFileSync(logFile, `$ emerald ${args.join(' ')} (on the dropping pipe)\n${out}${err}[exit ${code}]\n`);
          resolve({ code, out, err });
        });
      });
    try {
      for (const args of [['ls'], ['new', '.'], ['daemon', 'status']]) {
        r = await emeraldOnDrop(...args);
        const dropLines = r.err.trimEnd().split(/\r?\n/);
        expect(r.code === 1 && dropLines.length === 1 && /^emmer: .*emmerd pipe \\\\\.\\pipe\\emmerd-verify-cli-drop-\d+ closed/.test(dropLines[0]) && r.out === '', `${args.join(' ')} on a pipe that drops the hello: one line naming the pipe, exit 1 (${JSON.stringify(r.err)})`);
      }
      // M9 fix 403: the same failure on the --json form keeps running
      // false and names what went wrong, where the bare catch that built
      // status()'s own connection reported a pipe held by something that
      // would not talk as a daemon that is simply not running.
      r = await emeraldOnDrop('daemon', 'status', '--json');
      let dropJson = null;
      try {
        dropJson = JSON.parse(r.out);
      } catch {
        dropJson = null;
      }
      expect(r.code === 1 && dropJson?.running === false && typeof dropJson.error === 'string' && /emmerd pipe \\\\\.\\pipe\\emmerd-verify-cli-drop-\d+ closed/.test(dropJson.error) && r.err === '', `daemon status --json on a pipe that drops the hello: running false with the failure named on the record, exit 1 (${r.code}: ${JSON.stringify(r.out + r.err)})`);
    } finally {
      await new Promise((resolve) => dropServer.close(resolve));
    }
    log('M9 fix 379: a command on a pipe nothing serves, or one that drops the connection on the hello, prints one line naming the pipe and exits 1');
    log("M9 fix 403: daemon status speaks connect()'s vocabulary, the failure named on stderr and on the --json record rather than read as a daemon that is not running");
  });

  await block('fix-402', async () => {
    // M9 fix 402: a server that takes the connection and never answers the
    // hello held every command for good, since the CLI's request settled
    // only on a reply or on the socket going. The hello now races
    // EMERALD_HELLO_TIMEOUT_MS (5 s by default, overridden here so the block
    // stays quick) and the line is connect()'s own wording. The silent
    // server is this process again, so the command runs asynchronously.
    const silentPipe = `\\\\.\\pipe\\emmerd-verify-cli-silent-${process.pid}`;
    const silentSockets = [];
    // resume() so the socket reads the hello and notices the client going;
    // it never writes, which is the whole point.
    const silentServer = net.createServer((s) => {
      silentSockets.push(s);
      s.resume();
    });
    await new Promise((resolve, reject) => silentServer.once('error', reject).listen(silentPipe, resolve));
    const emeraldOnSilent = (...args) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [main, ...args], { env: { ...env, EMERALD_PIPE: silentPipe, EMERALD_HELLO_TIMEOUT_MS: '1000' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        const timer = setTimeout(() => child.kill(), 15000);
        child.on('close', (code) => {
          clearTimeout(timer);
          fs.appendFileSync(logFile, `$ emerald ${args.join(' ')} (on the silent pipe)\n${out}${err}[exit ${code}]\n`);
          resolve({ code, out, err });
        });
      });
    try {
      const silentAt = Date.now();
      r = await emeraldOnSilent('ls');
      const silentLines = r.err.trimEnd().split(/\r?\n/);
      expect(r.code === 1 && silentLines.length === 1 && silentLines[0] === 'emmer: emmerd refused the connection: hello timed out after 1000 ms' && r.out === '', `ls on a pipe whose server never answers the hello: the timed-out line once, exit 1 (${r.code}: ${JSON.stringify(r.err)})`);
      const silentTook = Date.now() - silentAt;
      expect(silentTook < 10000, `the command gave up on its own deadline rather than hanging (${silentTook} ms)`);
      // M9 fix 431: open and update say hello through the same connectHello
      // as ls now, so a silent daemon refuses them in the same one line.
      r = await emeraldOnSilent('open', path.join(home, 'sessions.json'));
      const openSilentLines = r.err.trimEnd().split(/\r?\n/);
      expect(r.code === 1 && openSilentLines.length === 1 && openSilentLines[0] === 'emmer: emmerd refused the connection: hello timed out after 1000 ms' && r.out === '', `open on a pipe whose server never answers the hello: the timed-out line once, exit 1 (${r.code}: ${JSON.stringify(r.err)})`);
      r = await emeraldOnSilent('update');
      const updateSilentLines = r.err.trimEnd().split(/\r?\n/);
      expect(r.code === 1 && updateSilentLines.length === 1 && updateSilentLines[0] === 'emmer: emmerd refused the connection: hello timed out after 1000 ms' && r.out === '', `update on a pipe whose server never answers the hello: the timed-out line once, exit 1 (${r.code}: ${JSON.stringify(r.err)})`);
    } finally {
      for (const s of silentSockets) s.destroy();
      await new Promise((resolve) => silentServer.close(resolve));
    }
    log('M9 fix 402: a command on a pipe whose server accepts and never answers the hello gives up at the deadline with one line, exit 1');
  });

  await block('fix-710', async () => {
    // M9 fix 710: entries pointing at files no longer there. Ours by shape
    // (an old home's claude-hook.cmd) counts against complete and the
    // install takes it out; a stranger's is named and left. A private
    // settings file under the script's home, never the user's.
    const deadSettings = path.join(home, 'claude-710', 'settings.json');
    const fwdHome = home.split(path.sep).join('/');
    j = emeraldJson('hooks', 'install', '--settings', deadSettings, '--json');
    expect(j.code === 0, `hooks install on the fix 710 settings: exit 0 (${j.code})`);
    const seeded = JSON.parse(fs.readFileSync(deadSettings, 'utf8'));
    const oldHook = `"${fwdHome}/old-home/hooks/claude-hook.cmd"`;
    const oldTool = `${fwdHome}/old-tool/hook.cmd --flag`;
    seeded.hooks.Stop.push({ hooks: [{ type: 'command', command: oldHook, timeout: 5 }] });
    seeded.hooks.SessionStart.push({ hooks: [{ type: 'command', command: oldHook, timeout: 5 }] });
    seeded.hooks.Stop.push({ hooks: [{ type: 'command', command: oldTool, timeout: 5 }] });
    fs.writeFileSync(deadSettings, JSON.stringify(seeded, null, 2));
    j = emeraldJson('hooks', 'status', '--settings', deadSettings, '--json');
    const dead = Array.isArray(j.json?.dead) ? j.json.dead : [];
    const oursDead = dead.filter((d) => d.ours).map((d) => d.event).sort();
    const theirsDead = dead.filter((d) => !d.ours);
    expect(
      j.code === 1 && j.json?.complete === false && dead.length === 3 && JSON.stringify(oursDead) === JSON.stringify(['SessionStart', 'Stop']) && theirsDead.length === 1 && theirsDead[0].path.endsWith('/old-tool/hook.cmd'),
      `hooks status --json names two dead entries of ours and a stranger's, complete false, exit 1 (${j.code}: ${JSON.stringify(dead)})`,
    );
    r = emerald('hooks', 'status', '--settings', deadSettings);
    expect(
      r.code === 1 &&
        /^missing file: Stop runs .*\/old-home\/hooks\/claude-hook\.cmd \(an old emerald entry; emmer hooks install takes it out\)$/m.test(r.out) &&
        /^missing file: Stop runs .*\/old-tool\/hook\.cmd \(not emerald's; left as it is\)$/m.test(r.out),
      `hooks status names each dead entry in a line, exit 1 (${r.code}: ${JSON.stringify(r.out)})`,
    );
    r = emerald('hooks', 'install', '--settings', deadSettings);
    expect(
      r.code === 0 && /^removed: 2 entries that pointed at missing files$/m.test(r.out) && /^missing file: Stop runs .*\/old-tool\/hook\.cmd \(not emerald's; left as it is\)$/m.test(r.out),
      `hooks install takes out ours and names the stranger's (${r.code}: ${JSON.stringify(r.out)})`,
    );
    j = emeraldJson('hooks', 'status', '--settings', deadSettings, '--json');
    const deadAfter = Array.isArray(j.json?.dead) ? j.json.dead : [];
    expect(j.code === 0 && j.json?.complete === true && deadAfter.length === 1 && deadAfter[0].ours === false, `after the install the status is complete with the stranger's entry alone (${j.code}: ${JSON.stringify(deadAfter)})`);
    const deadText = fs.readFileSync(deadSettings, 'utf8');
    expect(!deadText.includes('old-home') && deadText.includes('old-tool'), 'the file holds no old-home entry and still holds the old-tool one');
    r = emerald('hooks', 'uninstall', '--settings', deadSettings);
    expect(r.code === 0, `hooks uninstall tidies the fix 710 settings (${r.code})`);
    log("M9 fix 710: hooks status names entries pointing at missing files, install takes out emerald's and names anyone else's");
    // Uninstall takes out emerald's dead entries too (M9 fix 733): the old
    // home's two seeded again over a fresh install, the stranger's still there.
    r = emerald('hooks', 'install', '--settings', deadSettings);
    expect(r.code === 0, `hooks install again on the fix 710 settings (${r.code})`);
    const reseeded = JSON.parse(fs.readFileSync(deadSettings, 'utf8'));
    reseeded.hooks.Stop.push({ hooks: [{ type: 'command', command: oldHook, timeout: 5 }] });
    reseeded.hooks.SessionStart.push({ hooks: [{ type: 'command', command: oldHook, timeout: 5 }] });
    fs.writeFileSync(deadSettings, JSON.stringify(reseeded, null, 2));
    r = emerald('hooks', 'uninstall', '--settings', deadSettings);
    expect(
      r.code === 0 && /^removed: 2 entries that pointed at missing files$/m.test(r.out) && !fs.readFileSync(deadSettings, 'utf8').includes('old-home') && fs.readFileSync(deadSettings, 'utf8').includes('old-tool'),
      `hooks uninstall takes out emerald's dead entries and leaves the stranger's (${r.code}: ${JSON.stringify(r.out)})`,
    );
    log("M9 fix 733: hooks uninstall takes out emerald's dead entries too and leaves anyone else's");
  });

  log(blocksRun());
  log('PASS');
  process.exit(0);
} finally {
  stopDaemonHard();
}
