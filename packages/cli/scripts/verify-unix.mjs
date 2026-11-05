// M9 fix 1017: verify:unix, the node-only smoke of the daemon and the CLI on
// macOS and Linux. No window: the daemon on its Unix socket in a private
// home, then a shell session driven through the CLI (start, idle, a typed
// line read back, exit, rm), then the stop and a read that nothing of the
// daemon's tree is left. Every line is `PASS <step>` or `FAIL <step>: <why>`;
// the first FAIL prints the daemon log's tail, cleans up and exits 1.
//
// Two modes, read off a first `daemon status --json`: with the caller's
// EMERALD_HOME naming a running daemon the script is attached (the macOS
// runner's smoke runs it against the packaged app's own daemon, fix 1028)
// and never starts or stops a daemon; otherwise it starts its own and
// stops it at the end.
//
// EMERALD_CLI names another CLI: a path ending .js, .mjs or .cjs runs under
// this node, any other runs as `sh <path>` (the staged bin/emmer shim, so its
// file mode never matters). EMERALD_PIPE is always dropped, so the socket is
// <home>/emmerd.sock.
//
// Run: npm run verify:unix -w @emerald/cli (build first: npm run build)
// Attached: EMERALD_HOME=<home> EMERALD_CLI=<app>/Contents/Resources/bin/emmer npm run verify:unix -w @emerald/cli
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') {
  console.log('verify:unix runs on macOS and Linux; on Windows run verify:cli');
  process.exit(2);
}

const t0 = Date.now();
const cli = process.env.EMERALD_CLI || fileURLToPath(new URL('../dist/main.js', import.meta.url));
const callerHome = process.env.EMERALD_HOME?.trim() || null;
const home = callerHome ?? fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-unix-'));
const sock = path.join(path.resolve(home), 'emmerd.sock');
const env = { ...process.env, EMERALD_HOME: home };
delete env.EMERALD_PIPE;

let steps = 0;
let mode = 'own';
// The daemon's tree as read while it ran: pid -> args, so the leftover read
// matches on the command line, never on a number a minute old.
const tree = new Map();
let work = null;

function pass(step) {
  steps += 1;
  console.log(`PASS ${step}`);
}

// One CLI call, synchronous: { code, out, err }.
function emmer(...args) {
  const js = /\.(c|m)?js$/.test(cli);
  const r = spawnSync(js ? process.execPath : 'sh', [cli, ...args], { env, encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, out: r.stdout ?? '', err: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
}

function emmerJson(...args) {
  const r = emmer(...args);
  let json = null;
  try {
    json = JSON.parse(r.out);
  } catch {
    // Left null; the step names the command.
  }
  return { ...r, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(timeoutMs, fn) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await sleep(150);
  }
}

// ps's table with each process's args, stdout alone (procps under wsl.exe
// writes a screen-size warning to stderr).
function psRows() {
  const r = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,args='], { encoding: 'utf8', timeout: 5000, env: { ...process.env, LC_ALL: 'C' } });
  const rows = [];
  for (const line of (r.stdout ?? '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] });
  }
  return rows;
}

// The daemon and its descendants, added to the tree read so far.
function recordTree(rootPid) {
  const rows = psRows();
  const seen = new Set();
  const walk = (p) => {
    if (seen.has(p)) return;
    seen.add(p);
    const row = rows.find((r) => r.pid === p);
    if (row) tree.set(p, row.args);
    for (const r of rows) if (r.ppid === p && r.pid !== p) walk(r.pid);
  };
  walk(rootPid);
}

function leftovers() {
  return psRows().filter((r) => tree.has(r.pid) && tree.get(r.pid) === r.args);
}

function cleanUp() {
  if (mode === 'own') {
    emmer('daemon', 'stop');
    for (const r of leftovers()) {
      try {
        process.kill(r.pid, 'SIGKILL');
      } catch {
        // Gone meanwhile.
      }
    }
  }
  if (work !== null) fs.rmSync(work, { recursive: true, force: true });
}

function logTail() {
  try {
    const lines = fs.readFileSync(path.join(home, 'logs', 'emmerd.log'), 'utf8').split('\n').filter((l) => l !== '');
    for (const l of lines.slice(-40)) console.log(`  log| ${l}`);
  } catch {
    console.log('  log| (no emmerd.log)');
  }
}

function fail(step, why) {
  console.log(`FAIL ${step}: ${why}`);
  logTail();
  cleanUp();
  if (callerHome === null) console.log(`the home is kept: ${home}`);
  process.exit(1);
}

setTimeout(() => {
  console.log('FAIL watchdog: the run passed 120 s');
  logTail();
  cleanUp();
  process.exit(3);
}, 120_000).unref();

const rowNamed = (name) => (emmerJson('ls', '--json').json?.sessions ?? []).find((s) => s.name === name) ?? null;

const n = Buffer.byteLength(sock);
if (n > 100) fail('socket path', `${sock} is ${n} bytes, over the 100 a Unix socket can take`);
pass(`socket path ${sock} is ${n} bytes`);

let st = emmerJson('daemon', 'status', '--json');
let daemonPid = null;
if (callerHome !== null && st.json?.running === true) {
  mode = 'attached';
  daemonPid = st.json.pid;
  pass(`attached to the running emmerd, pid ${daemonPid}`);
} else {
  if (!(st.code === 1 && st.json?.running === false)) fail('daemon status before the start', `expected not running with exit 1, got exit ${st.code} ${JSON.stringify(st.out + st.err)}`);
  pass('daemon status before the start: not running');
  const r = emmer('daemon', 'start');
  if (!(r.code === 0 && /^started emmerd \S+, pid \d+$/m.test(r.out))) fail('daemon start', `exit ${r.code} ${JSON.stringify(r.out + r.err)}`);
  pass('daemon start');
}

st = emmerJson('daemon', 'status', '--json');
if (!(st.code === 0 && st.json?.running === true && st.json.pipe === sock)) fail('daemon status names the socket', `exit ${st.code} ${JSON.stringify(st.out + st.err)}, wanted the pipe ${sock}`);
daemonPid = st.json.pid;
pass('daemon status names the socket');

// M9 fix 1069: off Windows there is no local feed folder, so a daemon of
// our own logs why the feed is off rather than a folder under its cwd.
if (mode === 'own') {
  const daemonLog = path.join(home, 'logs', 'emmerd.log');
  const readLog = () => {
    try {
      return fs.readFileSync(daemonLog, 'utf8');
    } catch {
      return '';
    }
  };
  const ok = await until(5000, () => readLog().includes('feed: off (not Windows)'));
  if (!ok || readLog().includes('feed: no folder at')) fail('the daemon serves no feed off Windows', `the log ${ok ? 'also names a feed folder' : 'has no "feed: off (not Windows)" line'}: ${JSON.stringify(readLog().split('\n').filter((l) => l.includes('feed:')))}`);
  pass('the daemon serves no feed off Windows');
}

{
  const r = emmer('feed', 'serve');
  if (!(r.code === 64 && /--dir <feed dir>/.test(r.err))) fail('feed serve with no --dir: a usage error', `exit ${r.code} ${JSON.stringify(r.out + r.err)}`);
  pass('feed serve with no --dir: a usage error');
}

let lst = null;
try {
  lst = fs.lstatSync(sock);
} catch (err) {
  fail('the socket is a socket of mode 600', String(err));
}
if (!(lst.isSocket() && (lst.mode & 0o777) === 0o600)) fail('the socket is a socket of mode 600', `socket ${lst.isSocket()}, mode ${(lst.mode & 0o777).toString(8)}`);
pass('the socket is a socket of mode 600');

const ls = emmerJson('ls', '--json');
if (mode === 'own') {
  if (!(ls.code === 0 && Array.isArray(ls.json?.sessions) && ls.json.sessions.length === 0)) fail('ls is empty', `exit ${ls.code} ${JSON.stringify(ls.out + ls.err)}`);
  pass('ls is empty');
} else {
  if (ls.code !== 0) fail('ls answers', `exit ${ls.code} ${JSON.stringify(ls.out + ls.err)}`);
  pass('ls answers');
}

work = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-unix-work-'));
const sh = emmerJson('shell', work, '--name', 'smoke', '--json');
if (!(sh.code === 0 && sh.json?.session?.kind === 'shell')) fail('shell starts', `exit ${sh.code} ${JSON.stringify(sh.out + sh.err)}`);
pass('shell starts');

if ((await until(10_000, () => rowNamed('smoke')?.state === 'idle')) === null) fail('shell is idle', `the row reads ${JSON.stringify(rowNamed('smoke')?.state)} after 10 s`);
pass('shell is idle');
if (mode === 'own') recordTree(daemonPid);

const marker = `EMERALD_UNIX_${Date.now()}`;
const sent = emmer('send', 'smoke', 'echo', marker, '--enter');
if (!(sent.code === 0 && sent.out.includes(`sent "echo ${marker}" + Enter`))) fail('send and read', `send: exit ${sent.code} ${JSON.stringify(sent.out + sent.err)}`);
const seen = await until(10_000, () => emmer('read', 'smoke', '--lines', '5').out.split(/\r?\n/).some((l) => l.trim() === marker));
if (seen === null) fail('send and read', `no line ${marker} in ${JSON.stringify(emmer('read', 'smoke', '--lines', '5').out)}`);
pass('send and read');

const ex = emmer('send', 'smoke', 'exit', '--enter');
if (ex.code !== 0) fail('shell exits', `send exit: exit ${ex.code} ${JSON.stringify(ex.out + ex.err)}`);
if ((await until(10_000, () => rowNamed('smoke')?.state === 'exited')) === null) fail('shell exits', `the row reads ${JSON.stringify(rowNamed('smoke')?.state)} after 10 s`);
pass('shell exits');

const rm = emmer('rm', 'smoke');
if (!(rm.code === 0 && rowNamed('smoke') === null)) fail('rm', `exit ${rm.code} ${JSON.stringify(rm.out + rm.err)}`);
pass('rm');

// M9 fix 1068: a bash and a zsh row report their folder, a running command
// and a cd. Each row is sent exit and rm'ed, so the stop's leftover read and
// smoke:mac's next step see none of them. A Mac's own bash is 3.2, with no
// PS0, so its row reads like cmd's: the folder, never running.
const workReal = fs.realpathSync(work);
const tmpReal = fs.realpathSync('/tmp');
const marksIds = ['bash'];
if (spawnSync('sh', ['-c', 'command -v zsh'], { encoding: 'utf8' }).status === 0) marksIds.push('zsh');
else console.log('[verify] note: no zsh on the PATH, the zsh row skipped');
for (const id of marksIds) {
  const name = `marks-${id}`;
  const row = () => rowNamed(name);
  const started = emmerJson('shell', work, '--shell', id, '--name', name, '--json');
  if (!(started.code === 0 && started.json?.session?.kind === 'shell')) fail(`${id} row starts`, `exit ${started.code} ${JSON.stringify(started.out + started.err)}`);
  if ((await until(10_000, () => row()?.shellCwd === workReal)) === null) fail(`${id} row reports its folder`, `the row reads shellCwd ${JSON.stringify(row()?.shellCwd)} after 10 s, wanted ${workReal}`);
  pass(`${id} row reports its folder`);
  let version = 9999;
  if (id === 'bash') {
    emmer('send', name, 'echo BV=$((BASH_VERSINFO[0]*100+BASH_VERSINFO[1]))', '--enter');
    const bv = await until(10_000, () => {
      const line = emmer('read', name, '--lines', '5').out.split(/\r?\n/).map((l) => l.trim()).find((l) => /^BV=(\d+)$/.test(l));
      return line === undefined ? null : Number(line.slice(3));
    });
    if (bv === null) fail('bash version', `no BV= line in ${JSON.stringify(emmer('read', name, '--lines', '5').out)}`);
    version = bv;
  }
  emmer('send', name, 'sleep 3', '--enter');
  if (version >= 404) {
    const step = `${id} row reads running while sleep 3 runs, then ok`;
    if ((await until(3000, () => row()?.command?.state === 'running')) === null) fail(step, `the row reads command ${JSON.stringify(row()?.command)} 3 s after sleep 3 was sent`);
    if ((await until(10_000, () => row()?.command?.state === 'ok' && row()?.command?.exitCode === 0)) === null) fail(step, `the row reads command ${JSON.stringify(row()?.command)} 10 s after sleep 3 ran`);
    pass(step);
  } else {
    const step = 'bash row below 4.4 reads no command, as cmd';
    await new Promise((r) => setTimeout(r, 1000));
    if (row()?.command != null) fail(step, `the row reads command ${JSON.stringify(row()?.command)} at 1 s, bash ${version}`);
    await new Promise((r) => setTimeout(r, 3000));
    if (row()?.command != null) fail(step, `the row reads command ${JSON.stringify(row()?.command)} after the prompt is back, bash ${version}`);
    pass(step);
  }
  emmer('send', name, 'cd /tmp', '--enter');
  if ((await until(10_000, () => row()?.shellCwd === tmpReal)) === null) fail(`${id} row follows cd /tmp`, `the row reads shellCwd ${JSON.stringify(row()?.shellCwd)} after 10 s, wanted ${tmpReal}`);
  pass(`${id} row follows cd /tmp`);
  emmer('send', name, 'exit', '--enter');
  if ((await until(10_000, () => row()?.state === 'exited')) === null) fail(`${id} row exits`, `the row reads ${JSON.stringify(row()?.state)} after 10 s`);
  const gone = emmer('rm', name);
  if (!(gone.code === 0 && row() === null)) fail(`${id} row rm`, `exit ${gone.code} ${JSON.stringify(gone.out + gone.err)}`);
}

if (mode === 'own') {
  recordTree(daemonPid);
  const stop = emmer('daemon', 'stop');
  if (!(stop.code === 0 && /^stopped emmerd, pid \d+/m.test(stop.out))) fail('daemon stop', `exit ${stop.code} ${JSON.stringify(stop.out + stop.err)}`);
  pass('daemon stop');
  const gone = await until(2000, () => !fs.existsSync(sock) && !fs.existsSync(path.join(home, 'daemon.json')));
  if (gone === null) fail('the socket and daemon.json are gone', `socket ${fs.existsSync(sock)}, daemon.json ${fs.existsSync(path.join(home, 'daemon.json'))}`);
  pass('the socket and daemon.json are gone');
  // Eight seconds covers the exit reaper's four (REAP_AFTER_MS).
  const clear = await until(8000, () => leftovers().length === 0);
  if (clear === null) fail('nothing left running', leftovers().map((r) => `${r.pid} ${r.args}`).join('; '));
  pass('nothing left running');
}

fs.rmSync(work, { recursive: true, force: true });
work = null;
if (callerHome === null) fs.rmSync(home, { recursive: true, force: true });
console.log(`PASS verify:unix, ${steps} steps in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(0);
