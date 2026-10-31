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
