// The typing-lag bench (M9 fix 226): how long a keystroke into a plain
// shell pane takes to echo while other panes run Claude turns. A bench
// and not a verify: it prints one table, round by round, and fails only
// on the loose ceiling at the end (the p90 at eight loaded shells within
// CEILING_MULTIPLE of the idle round's), so a later change that costs
// the keyboard shows.
//
// The load is synthetic and shaped like a turn: each loaded shell runs
// load-turn.mjs (Ink's redraw at a real turn's byte rate) in a worktree
// of the scratch repository, sits in a pane of a second layout tab, and
// gets a turn's hooks through the sink at a turn's rate, SessionStart
// and UserPromptSubmit, then a PreToolUse and PostToolUse pair around a
// real `git commit` every second or two so the daemon reads HEAD and
// spawns git as for a real turn, and Stop at the end. The typed pane is
// a plain PowerShell in the repository's root on the first tab.
//
// The trip is measured in the renderer: a keydown on the pane's textarea
// is matched to the first pty.output of that session carrying the typed
// letter (PSReadLine echoes the letter, or redraws the line with it), so
// the figure is keydown to echo bytes in the renderer, the whole path
// through the main process, the pipe, the daemon, conpty and the shell
// and back. Sixty keys at a typist's pace and one forty-character
// Input.insertText burst per round; rounds at zero, two, four and eight
// loaded shells, then eight at LOAD_TURN_RATE 8 (a shell cat-ing a file
// in every pane), each after ten seconds of warm-up. Beside the trip:
// the CPU of the daemon, the app's main and renderer processes and the
// load shells over the round (two Win32_Process snapshots; a fraction of
// one core) and the whole box, and the event-loop delay the daemon and
// the main process log every two seconds under EMERALD_LOOP_DELAY (the
// window's worst p99 and max).
//
// --real N replaces the last round's load with N real Claudes started in
// this checkout as verify:cli-claude starts them (claude -p with a
// prompt that runs a few git reads), the same trip measured while their
// turns run; it costs N turns and is run by hand. --real-cwd <dir> is the
// folder they run in (the checkout by default; it must be one Claude
// Code already trusts, since a fresh folder stops at the trust dialog).
// --shown puts the loaded sessions in panes of the typed tab instead of a
// tab of their own (M9 fix 238), since the person's panes show the
// working sessions and a mirror per pane takes every chunk through
// term.write, which the hidden tab never pays for. --trace takes a
// Performance trace of the app over every round (the real round takes
// one anyway) and prints the renderer's and the main process's long
// tasks with what was in them; the trace files land beside the log.
//
// Uses a private home and pipe unless the environment names them; run
// it with the app built. How to run it, and its baseline, are in
// docs/HANDBOOK.md, under Acceptance scripts (bench:latency).
// Run: npm run bench:latency -w @emerald/app
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addGroupTab, gridTree, paneShowing } from '@emerald/shared';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'bench-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-bench';
// Both processes log their loop delay under this (loop-delay.ts in the
// daemon and in the app's main); the daemon inherits it through the app.
process.env['EMERALD_LOOP_DELAY'] = '1';
const { expect, freshPort, getLayout, getTabs, killTree, launch, sleep, startSession, step, stopDaemon, zreq, daemonPid, emeraldHome } = await import('./cdp.mjs');

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, '..', '..', '..');
const loadScript = path.join(scriptsDir, 'load-turn.mjs');
const realArg = process.argv.indexOf('--real');
const REAL = realArg === -1 ? 0 : Math.max(1, Number(process.argv[realArg + 1]) || 1);
const realCwdArg = process.argv.indexOf('--real-cwd');
const REAL_CWD = realCwdArg === -1 ? repoRoot : path.resolve(process.argv[realCwdArg + 1]);
const SHOWN = process.argv.includes('--shown');
const TRACE = process.argv.includes('--trace') || REAL > 0;
// --quick [N] is the idle round and one at N loaded shells (four by
// default) alone, for iterating on a fix.
const quickArg = process.argv.indexOf('--quick');
const QUICK = quickArg !== -1;
const QUICK_SHELLS = QUICK ? Math.max(1, Number(process.argv[quickArg + 1]) || 4) : 0;
const ROUNDS = QUICK
  ? [
      { shells: 0, rate: 1 },
      { shells: QUICK_SHELLS, rate: 1 },
    ]
  : [
      { shells: 0, rate: 1 },
      { shells: 2, rate: 1 },
      { shells: 4, rate: 1 },
      { shells: 8, rate: 1 },
      { shells: 8, rate: 8 },
    ];
const KEYS = 60;
const KEY_GAP_MS = 100;
const BURST = 'the quick brown fox jumps over the lazy dog';
const WARMUP_MS = 10000;
// The ceiling: the p90 of the eight-shell round against the idle round's
// (floored at 30 ms, since an idle p90 of a few milliseconds would make
// any multiple meaningless), judged only when the box was under
// CEILING_BOX_BUSY over the round, since past that the figure says more
// about the box than the app. Set from the fixed numbers of 2026-09-16
// on this machine with git off both loops: idle p90 43 to 57 ms, eight
// loaded 105 to 188 ms with the box 42 to 65 percent busy from six other
// worktrees building and testing; before the fix, eight loaded read 215
// to 882 ms with the main process's loop standing still for one to 3.7
// seconds at a time.
const CEILING_MULTIPLE = 4;
const CEILING_FLOOR_MS = 30;
const CEILING_BOX_BUSY = 0.7;
const logFile = path.join(os.tmpdir(), 'emerald-verify', 'bench-latency.log');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.writeFileSync(logFile, '');
const say = (msg) => {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n');
};

let app = null;
setTimeout(() => {
  console.error('[bench] WATCHDOG: run exceeded 600 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 600000);

// The scratch repository: one commit on main, and a worktree per loaded
// shell so each commits on a branch of its own without touching the
// others' index. The temp directory comes back in 8.3 form on this
// machine, so the path is resolved to what the daemon will say.
const repoShort = path.join(os.tmpdir(), 'emerald-verify', `bench-repo-${process.pid}`);
fs.rmSync(repoShort, { recursive: true, force: true });
fs.mkdirSync(repoShort, { recursive: true });
const repo = fs.realpathSync.native(repoShort);
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
git(repo, 'init', '-q', '-b', 'main');
git(repo, 'config', 'user.name', 'bench');
git(repo, 'config', 'user.email', 'bench@example.invalid');
git(repo, 'config', 'commit.gpgsign', 'false');
fs.writeFileSync(path.join(repo, 'README.md'), 'bench\n');
git(repo, 'add', 'README.md');
git(repo, 'commit', '-q', '-m', 'start');
const worktrees = [];
const worktreeFor = (i) => {
  if (worktrees[i] !== undefined) return worktrees[i];
  const wt = path.join(repo, '..', `bench-wt-${process.pid}-${i}`);
  git(repo, 'worktree', 'add', '-q', '-b', `load-${i}`, wt, 'main');
  worktrees[i] = fs.realpathSync.native(wt);
  return worktrees[i];
};
const commitAsync = (cwd, msg) =>
  new Promise((resolve) => execFile('git', ['commit', '-q', '--allow-empty', '-m', msg], { cwd, windowsHide: true }, () => resolve()));

const daemonInfo = () => JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
const post = async (sessionId, cwd, payload) => {
  const daemon = daemonInfo();
  const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
    method: 'POST',
    headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sessionId },
    body: JSON.stringify({ session_id: `sim-${sessionId}`, cwd, ...payload }),
  });
  if (res.status !== 204) say(`[bench] sink answered ${res.status} for ${payload.hook_event_name}`);
};

// A process snapshot: pid, parent, name and CPU time so far (100 ns
// units), plus the box's idle time, from one CIM call. Two of these
// around a round give each process's share of a core over it.
const snapshot = () => {
  const ps = [
    "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|electron|emerald|powershell|pwsh|git|conhost|OpenConsole|claude)' } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; prio = $_.Priority; cpu = [int64]($_.UserModeTime + $_.KernelModeTime); cmd = if ($_.CommandLine) { $_.CommandLine.Substring(0, [Math]::Min(200, $_.CommandLine.Length)) } else { '' } } };",
    "$c = Get-CimInstance Win32_PerfRawData_PerfOS_Processor -Filter \"Name='_Total'\";",
    '[pscustomobject]@{ at = [int64](Get-Date).ToFileTimeUtc(); idle = [int64]$c.PercentProcessorTime; ts = [int64]$c.Timestamp_Sys100NS; procs = @($p) } | ConvertTo-Json -Compress -Depth 4',
  ].join(' ');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`snapshot failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const descendants = (procs, roots) => {
  const set = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) {
      if (!set.has(p.pid) && set.has(p.ppid)) {
        set.add(p.pid);
        grew = true;
      }
    }
  }
  return set;
};
// Cores used by a set of pids between two snapshots: the CPU time delta
// over the wall time, as a fraction of one core; a process born or gone
// between the snapshots counts what both saw.
const cores = (a, b, pids) => {
  const before = new Map(a.procs.map((p) => [p.pid, p.cpu]));
  let used = 0;
  for (const p of b.procs) {
    if (!pids.has(p.pid)) continue;
    used += p.cpu - (before.get(p.pid) ?? 0);
  }
  const wall = b.at - a.at;
  return wall <= 0 ? 0 : used / wall;
};
const boxBusy = (a, b) => {
  const dts = b.ts - a.ts;
  return dts <= 0 ? 0 : 1 - (b.idle - a.idle) / dts;
};
const nCores = os.cpus().length;

// The box, the build and the tools, so a table from another machine says what it was taken on.
const boxInfo = () => {
  const ps = [
    "$c = Get-CimInstance Win32_Processor | Select-Object -First 1;",
    '$s = Get-CimInstance Win32_ComputerSystem;',
    '$o = Get-CimInstance Win32_OperatingSystem;',
    '[pscustomobject]@{ cpu = $c.Name.Trim(); cores = $c.NumberOfCores; logical = $c.NumberOfLogicalProcessors; mhz = $c.MaxClockSpeed; memGb = [Math]::Round($s.TotalPhysicalMemory / 1GB, 1); model = ($s.Manufacturer + " " + $s.Model).Trim(); os = ($o.Caption + " " + $o.Version) } | ConvertTo-Json -Compress',
  ].join(' ');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const box = r.status === 0 && r.stdout.trim() ? JSON.parse(r.stdout) : { cpu: '?', cores: nCores, logical: nCores, mhz: 0, memGb: 0, model: '?', os: os.release() };
  const tool = (cmd, args) => {
    const t = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    return t.status === 0 ? t.stdout.trim().split('\n')[0].trim() : '?';
  };
  return {
    ...box,
    node: process.version,
    // Through cmd, since claude is a .cmd shim or an exe depending on how
    // it was installed.
    claude: tool('cmd.exe', ['/d', '/c', 'claude --version']),
    commit: tool('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD']),
    branch: tool('git', ['-C', repoRoot, 'branch', '--show-current']),
  };
};

// Every process of the trees a keystroke or a turn crosses, with its
// share of a core over the round: the app's main, renderer, gpu and
// utility processes, the daemon and its git workers' conhosts, each
// loaded session's tree (a claude.exe and the node it forks, or the load
// shell), and, outside the trees, whatever else on the box matched the
// snapshot's name filter (the user's own emerald and Claudes, a build in
// another worktree), so the round says who owned the CPU.
const processRows = (a, b, mainPid, dPid, loadRoots) => {
  const before = new Map(a.procs.map((p) => [p.pid, p.cpu]));
  const wall = b.at - a.at;
  const share = (p) => (wall <= 0 ? 0 : (p.cpu - (before.get(p.pid) ?? 0)) / wall);
  const daemonTree = descendants(b.procs, [dPid]);
  const appTree = descendants(b.procs, [mainPid]);
  // The load trees and the daemon come before the app's tree, since the
  // app spawned the daemon and the daemon's ptys hold every session.
  const loadTrees = loadRoots.map((root) => descendants(b.procs, [root]));
  const roleOf = (p) => {
    for (const [i, tree] of loadTrees.entries()) {
      if (tree.has(p.pid)) return `load ${i}`;
    }
    if (p.pid === dPid) return 'daemon';
    if (daemonTree.has(p.pid)) return 'daemon child';
    if (p.pid === mainPid) return 'app main';
    if (appTree.has(p.pid)) {
      const m = /--type=([a-z-]+)/.exec(p.cmd);
      return `app ${m === null ? 'child' : m[1].replace('-process', '')}`;
    }
    return 'outside';
  };
  return b.procs
    .map((p) => ({ pid: p.pid, name: p.name, role: roleOf(p), cores: share(p) }))
    .filter((r) => r.cores >= 0.005)
    .sort((x, y) => y.cores - x.cores);
};

// A Performance trace over a round, through the page's devtools session:
// Tracing.start reports every process's events (the renderer, the
// browser process that is Electron's main, the gpu process), collected
// as they stream and written whole to a file beside the log.
const traceStart = async (s) => {
  const chunks = [];
  const off = s.on('Tracing.dataCollected', (p) => chunks.push(...p.value));
  let done;
  const complete = new Promise((r) => {
    done = r;
  });
  const offDone = s.on('Tracing.tracingComplete', () => done());
  await s.send('Tracing.start', {
    categories: '-*,devtools.timeline,disabled-by-default-devtools.timeline,v8.execute,blink.user_timing,toplevel',
    transferMode: 'ReportEvents',
  });
  return async (file) => {
    await s.send('Tracing.end');
    await Promise.race([complete, sleep(20000)]);
    off();
    offDone();
    fs.writeFileSync(file, JSON.stringify({ traceEvents: chunks }));
    return chunks;
  };
};
// The long tasks of a thread in a trace: the complete events named
// RunTask (or the loop's own MessageLoop::RunTask) of 50 ms and up on the
// named thread, each with the self time of what ran inside it by event
// name, so a task reads as "FunctionCall 80, Layout 30" and not a bar.
const traceTasks = (events, threadName) => {
  const threads = events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === threadName).map((e) => `${e.pid}:${e.tid}`);
  const own = events.filter((e) => e.ph === 'X' && typeof e.dur === 'number' && threads.includes(`${e.pid}:${e.tid}`)).sort((x, y) => x.ts - y.ts || y.dur - x.dur);
  const busy = own.filter((e) => e.name === 'RunTask' || e.name === 'MessageLoop::RunTask').reduce((sum, e) => sum + e.dur, 0);
  const span = own.length === 0 ? 0 : own[own.length - 1].ts + own[own.length - 1].dur - own[0].ts;
  const tasks = [];
  for (let i = 0; i < own.length; i++) {
    const t = own[i];
    if ((t.name !== 'RunTask' && t.name !== 'MessageLoop::RunTask') || t.dur < 50000) continue;
    const end = t.ts + t.dur;
    // Self time by name inside the task: a stack over the events nested
    // in it, each event's duration less its children's.
    const self = new Map();
    const stack = [];
    for (let j = i + 1; j < own.length && own[j].ts < end; j++) {
      const e = own[j];
      while (stack.length > 0 && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent !== undefined) self.set(parent.name, (self.get(parent.name) ?? 0) - e.dur);
      self.set(e.name, (self.get(e.name) ?? 0) + e.dur);
      stack.push(e);
    }
    const parts = [...self.entries()]
      .filter(([, us]) => us >= 5000)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 4)
      .map(([name, us]) => `${name} ${Math.round(us / 1000)}`);
    tasks.push({ ms: t.dur / 1000, parts: parts.join(', ') });
  }
  tasks.sort((x, y) => y.ms - x.ms);
  return { n: tasks.length, busy: span <= 0 ? 0 : busy / span, tasks: tasks.slice(0, 5) };
};

// The daemon's echo lines inside a window (pty.input to the session's
// next byte out): conpty and the shell's own leg of the trip, the typed
// shell's alone, since a keyless input into another pane (the focus
// click after a layout change) once read as a 12.7 s echo.
const echoes = (file, fromIso, toIso, sessionId) => {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  const own = `"sessionId":${JSON.stringify(sessionId)}`;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  for (const l of text.split('\n')) {
    if (!l.includes(' echo ') || !l.includes(own)) continue;
    const m = /"ms":\s*([\d.]+)/.exec(l);
    if (m === null) continue;
    // The line is stamped when the byte came out; the input must be in
    // the window too, since a pane's mount sends the pty an answer to a
    // replayed terminal query (conpty's own DA, which it eats) whose
    // "next byte out" is the round's first echo, 13 s later.
    const at = Date.parse(l.slice(0, 24));
    const ms = Number(m[1]);
    if (at - ms < from || at > to) continue;
    out.push(ms);
  }
  return out;
};
// The loop-delay lines of a log inside a window: the worst p99 and max.
const loopDelay = (file, fromIso, toIso) => {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let p99 = 0;
  let max = 0;
  let n = 0;
  for (const l of text.split('\n')) {
    if (!l.includes('loop delay')) continue;
    const at = l.slice(0, 24);
    if (at < fromIso || at > toIso) continue;
    const m99 = /p99"?[=:]\s*([\d.]+)/.exec(l);
    const mMax = /max"?[=:]\s*([\d.]+)/.exec(l);
    if (m99 === null || mMax === null) continue;
    n += 1;
    p99 = Math.max(p99, Number(m99[1]));
    max = Math.max(max, Number(mMax[1]));
  }
  return n === 0 ? null : { p99, max, n };
};
const q = (arr, p) => {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const ms1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const pct = (v) => `${Math.round(v * 100)}%`;

const box = boxInfo();
const boxLine = `${box.model}; ${box.cpu}, ${box.cores} cores / ${box.logical} logical at ${box.mhz} MHz, ${box.memGb} GB; ${box.os}; node ${box.node}; Claude Code ${box.claude}; emerald ${box.commit} (${box.branch})${SHOWN ? '; loaded sessions shown in the typed tab' : ''}`;
say(`[bench] box: ${boxLine}`);
const s = await launch(freshPort(), { freshState: true });
app = s;
const results = [];
const loaded = [];
let hooksOn = true;
const hookLoops = [];
try {
  step('the typed pane: a plain shell in the repository root');
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await startSession(s, { kind: 'shell', cwd: repo });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell in pane 1');
  const layout = await getLayout(s);
  let typedPane = layout.focusedPaneId;
  const typedId = await s.waitFor(`(async () => { const { sessions } = await window.emerald.request('session.list', {}); const t = sessions.find((x) => x.kind === 'shell'); return t && t.shellCwd !== null ? t.id : null; })()`, 'the shell at its prompt', 20000);
  const typedTab = (await getTabs(s)).currentTabId;
  // Focus the terminal: a click on the pane lands on xterm's textarea.
  const focusTyped = async () => {
    const c = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(typedPane)}] .term-host').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.click(c.x, c.y);
    await s.waitFor(`document.activeElement?.classList.contains('xterm-helper-textarea')`, 'the terminal focused');
  };
  await focusTyped();

  // The probe in the page: keydowns on the textarea and the session's
  // output, matched by the letter typed.
  await s.evalJs(`window.__lat = (() => {
    const sid = ${JSON.stringify(typedId)};
    const dec = new TextDecoder();
    const pend = [];
    const trips = [];
    let bytes = 0;
    let unmatched = 0;
    window.emerald.on((m) => {
      if (m.type !== 'pty.output' || m.sessionId !== sid || m.replay) return;
      const t = performance.now();
      bytes += m.data.length;
      const text = dec.decode(m.data);
      while (pend.length > 0 && text.includes(pend[0].ch)) trips.push(t - pend.shift().at);
    });
    document.addEventListener('keydown', (e) => { if (e.key.length === 1 && e.target.classList.contains('xterm-helper-textarea')) pend.push({ ch: e.key, at: performance.now() }); }, true);
    // The renderer's own long tasks (50 ms and up on its main thread),
    // since a keydown waits behind one as it waits behind a loop stall.
    const long = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) long.push(e.duration); }).observe({ type: 'longtask' });
    return { trips, pend, long, reset() { unmatched += pend.length; trips.length = 0; pend.length = 0; long.length = 0; bytes = 0; }, bytes: () => bytes, unmatched: () => unmatched };
  })(); true`);

  const typeKeys = async () => {
    await s.evalJs(`window.__lat.reset()`);
    for (let i = 0; i < KEYS; i++) {
      // Letters cycle so a chunk carrying two echoes still tells them apart.
      const ch = String.fromCharCode(97 + (i % 26));
      const base = { key: ch, code: `Key${ch.toUpperCase()}`, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0), text: ch, unmodifiedText: ch };
      await s.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
      await s.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(KEY_GAP_MS);
    }
    await sleep(1000);
    const r = await s.evalJs(`({ trips: window.__lat.trips.slice(), pending: window.__lat.pend.length, long: window.__lat.long.slice() })`);
    // Escape reverts the line, so the next round starts on an empty prompt.
    await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(500);
    return r;
  };
  const burst = async () => {
    await s.evalJs(`window.__lat.reset()`);
    const t0 = Date.now();
    await s.send('Input.insertText', { text: BURST });
    // PSReadLine echoes at least the letters typed.
    const deadline = Date.now() + 5000;
    let got = 0;
    while (Date.now() < deadline) {
      got = await s.evalJs(`window.__lat.bytes()`);
      if (got >= BURST.length) break;
      await sleep(5);
    }
    const took = Date.now() - t0;
    await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(500);
    return got >= BURST.length ? took : NaN;
  };

  // One loaded shell: a worktree, load-turn in it through a shell started
  // with args (the daemon's shell launcher takes them as PowerShell's), a
  // turn's hooks at a turn's rate until the bench ends.
  const addLoad = async (i, rate) => {
    const wt = worktreeFor(i);
    const { session } = await zreq(s, 'session.spawn', {
      kind: 'shell',
      cwd: wt,
      name: `load ${i}`,
      args: ['-Command', `$env:LOAD_TURN_RATE='${rate}'; & '${process.execPath.replace(/'/g, "''")}' '${loadScript.replace(/'/g, "''")}'`],
      cols: 120,
      rows: 40,
    });
    loaded.push({ id: session.id, pid: session.pid, wt });
    await post(session.id, wt, { hook_event_name: 'SessionStart', source: 'startup' });
    await post(session.id, wt, { hook_event_name: 'UserPromptSubmit', prompt: `load ${i}` });
    let n = 0;
    const loop = (async () => {
      await sleep(300 * i);
      while (hooksOn) {
        n += 1;
        const command = `git commit -q --allow-empty -m load-${i}-${n}`;
        await post(session.id, wt, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
        await commitAsync(wt, `load-${i}-${n}`);
        await post(session.id, wt, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: '' } });
        await sleep(1000 + 500 * (i % 3));
      }
      await post(session.id, wt, { hook_event_name: 'Stop', stop_hook_active: false });
    })();
    hookLoops.push(loop);
    return session.id;
  };
  // The loaded shells sit in panes of a second tab, so the typed pane
  // stays plain and its tab is the one on show; under --shown they share
  // the typed tab as a grid, the typed pane first, every mirror drawing.
  const showLoaded = async () => {
    const tabs = await getTabs(s);
    const kept = tabs.tabs.filter((t) => t.id === typedTab);
    if (SHOWN) {
      const grid = gridTree([typedId, ...loaded.map((l) => l.id)]);
      const tab = { ...kept[0], ...grid };
      await zreq(s, 'layout.set', { layout: { ...tabs, tabs: [tab], currentTabId: typedTab } });
      typedPane = paneShowing(grid, typedId).id;
      await s.waitFor(`document.querySelectorAll('.term-host').length === ${1 + loaded.length}`, `${loaded.length} load panes mounted in the typed tab`, 15000);
      await focusTyped();
      return;
    }
    const withLoad = addGroupTab({ ...tabs, tabs: kept }, 'load', loaded.map((l) => l.id));
    await zreq(s, 'layout.set', { layout: { ...withLoad, currentTabId: typedTab } });
    await s.waitFor(`document.querySelectorAll('.term-host').length === ${1 + loaded.length}`, `${loaded.length} load panes mounted`, 15000);
  };
  const killLoaded = async () => {
    hooksOn = false;
    await Promise.race([Promise.all(hookLoops), sleep(8000)]);
    for (const l of loaded) {
      try {
        await zreq(s, 'session.kill', { sessionId: l.id });
      } catch {
        // Already gone.
      }
    }
  };

  const mainLog = path.join(emeraldHome, 'logs', 'main.log');
  const daemonLog = path.join(emeraldHome, 'logs', 'emmerd.log');
  const dPid = daemonPid();
  const mainPid = s.child.pid;

  const runRound = async (label) => {
    step(`${label}: warm-up ${WARMUP_MS / 1000} s`);
    await sleep(WARMUP_MS);
    const fromIso = new Date().toISOString();
    const a = snapshot();
    const traceEnd = TRACE ? await traceStart(s) : null;
    const t = await typeKeys();
    const b40 = await burst();
    // The loop-delay window closes here, before the trace is collected
    // and the second snapshot's CIM query runs (two to three seconds of
    // PowerShell that once put a 662 ms main-loop stall on a round's row).
    const toIso = new Date().toISOString();
    const traceFile = path.join(os.tmpdir(), 'emerald-verify', `bench-trace-${label.replace(/[^a-z0-9]+/gi, '-')}.json`);
    const events = traceEnd === null ? null : await traceEnd(traceFile);
    const b = snapshot();
    const renderer = b.procs.filter((p) => p.ppid === mainPid && /--type=renderer/.test(p.cmd)).map((p) => p.pid);
    // The priority classes (Win32_Process.Priority: 8 normal, 6 below
    // normal, 4 idle) of the processes a keystroke crosses, and whether
    // the page thinks it is visible: Chromium lowers a backgrounded
    // renderer, which a harness window off the screen may be.
    const prioOf = (pid) => b.procs.find((p) => p.pid === pid)?.prio ?? '?';
    const typedPid = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === typedId)?.pid ?? null;
    const prio = `renderer ${renderer.map(prioOf).join('/')} main ${prioOf(mainPid)} daemon ${prioOf(dPid)} shell ${typedPid === null ? '?' : prioOf(typedPid)} visibility ${await s.evalJs('document.visibilityState')}`;
    const loadPids = descendants(b.procs, loaded.map((l) => l.pid));
    const row = {
      label,
      keys: t.trips.length,
      pending: t.pending,
      p50: q(t.trips, 50),
      p90: q(t.trips, 90),
      max: q(t.trips, 100),
      burst: b40,
      // The renderer's long tasks while the keys went in: how many, the
      // longest, and their sum.
      longN: t.long.length,
      longMax: t.long.length === 0 ? 0 : Math.max(...t.long),
      longSum: t.long.reduce((x, y) => x + y, 0),
      daemon: cores(a, b, descendants(b.procs, [dPid])),
      main: cores(a, b, new Set([mainPid])),
      renderer: cores(a, b, new Set(renderer)),
      load: cores(a, b, loadPids),
      box: boxBusy(a, b),
      dLoop: loopDelay(daemonLog, fromIso, toIso),
      mLoop: loopDelay(mainLog, fromIso, toIso),
      echo: echoes(daemonLog, fromIso, toIso, typedId),
      prio,
      trips: t.trips,
    };
    results.push(row);
    say(`[bench] ${label} window ${fromIso} to ${toIso}`);
    say(`[bench] ${label}: ${row.keys}/${KEYS} keys matched (${row.pending} pending), p50 ${ms1(row.p50)} p90 ${ms1(row.p90)} max ${ms1(row.max)} ms, burst ${ms1(row.burst)} ms, renderer long tasks ${row.longN} (max ${ms1(row.longMax)}, sum ${ms1(row.longSum)} ms); shell echo p50 ${ms1(q(row.echo, 50))} p90 ${ms1(q(row.echo, 90))} max ${ms1(q(row.echo, 100))} ms over ${row.echo.length}; priorities ${row.prio}`);
    say(`[bench] ${label} trips: ${row.trips.map((v) => Math.round(v)).join(' ')}`);
    // Who owned the CPU over the round, one line per process of the trees
    // and the outside processes that matched the filter, largest first.
    const rows = processRows(a, b, mainPid, dPid, loaded.map((l) => l.pid));
    const outside = rows.filter((r) => r.role === 'outside').reduce((sum, r) => sum + r.cores, 0);
    say(`[bench] ${label} processes (cores of ${nCores}, box ${pct(row.box)} busy, outside the bench ${outside.toFixed(2)}): ${rows
      .filter((r) => r.role !== 'outside')
      .slice(0, 16)
      .map((r) => `${r.role} ${r.name.replace(/\.exe$/i, '')} ${r.pid} ${r.cores.toFixed(2)}`)
      .join('; ')}`);
    if (events !== null) {
      for (const [thread, who] of [
        ['CrRendererMain', 'renderer'],
        ['CrBrowserMain', 'main'],
      ]) {
        const tt = traceTasks(events, thread);
        say(`[bench] ${label} trace ${who}: main thread ${pct(tt.busy)} busy, ${tt.n} tasks of 50 ms and up${tt.tasks.map((x) => `; ${ms1(x.ms)} ms (${x.parts || 'no named events'})`).join('')}`);
      }
      say(`[bench] ${label} trace file ${traceFile} (${events.length} events)`);
    }
  };

  if (REAL === 0) {
    let have = 0;
    let currentRate = 1;
    for (const round of ROUNDS) {
      if (round.rate !== currentRate) {
        // A different rate: the loaded shells start over.
        await killLoaded();
        loaded.length = 0;
        hookLoops.length = 0;
        hooksOn = true;
        have = 0;
        currentRate = round.rate;
      }
      while (have < round.shells) await addLoad(have++, round.rate);
      if (round.shells > 0) await showLoaded();
      await runRound(round.rate === 1 ? `${round.shells} loaded` : `${round.shells} loaded x${round.rate}`);
    }
    await killLoaded();
  } else {
    // The real round: N Claudes on their turns in this checkout, the
    // trip measured while all of them work.
    await runRound('0 loaded');
    // The turn: enough git reads and prose that four of them outlast the
    // warm-up and the keys (about half a minute each on 2026-09-16), and
    // nothing that writes.
    const prompt = 'Run these five commands with the Bash tool, one at a time, and read each output before the next: git log --oneline -40, git status --short, git branch --list, git log --stat -5, git shortlog -sn HEAD~50..HEAD. Then write ten sentences on what the history shows, naming the newest commit and the busiest file.';
    const reals = [];
    for (let i = 0; i < REAL; i++) {
      const { session } = await zreq(s, 'session.spawn', { kind: 'claude', cwd: REAL_CWD, name: `real ${i}`, args: ['-p', prompt, '--allowedTools', 'Bash(git:*)'], cols: 120, rows: 40 });
      reals.push(session);
      loaded.push({ id: session.id, pid: session.pid, wt: REAL_CWD });
    }
    await showLoaded();
    const ids = JSON.stringify(reals.map((r) => r.id));
    await s.waitFor(`(async () => { const { sessions } = await window.emerald.request('session.list', {}); return ${ids}.every((id) => sessions.find((x) => x.id === id)?.state === 'working'); })()`, 'every real Claude working', 60000);
    await runRound(`${REAL} real${SHOWN ? ' shown' : ''}`);
    // The load must have held through the keys: a turn that ended early
    // makes the row a lighter round than its label says.
    const states = await s.evalJs(`(async () => { const { sessions } = await window.emerald.request('session.list', {}); return ${ids}.map((id) => sessions.find((x) => x.id === id)?.state ?? 'gone'); })()`);
    say(`[bench] ${REAL} real: states after the round ${states.join(' ')} (${states.filter((x) => x === 'working').length} still working)`);
    hooksOn = false;
    for (const r of reals) {
      try {
        await zreq(s, 'session.kill', { sessionId: r.id });
      } catch {
        // Finished on its own.
      }
    }
  }

  say('');
  say(`box: ${boxLine}`);
  say(`round           keys  p50 ms  p90 ms  max ms  burst40 ms  daemon  main  renderer  load   box(${nCores})  daemon loop p99/max  main loop p99/max  renderer long n/max/sum  shell echo p50/p90/max`);
  for (const r of results) {
    const loop = (l) => (l === null ? '-' : `${ms1(l.p99)}/${ms1(l.max)}`);
    say(`${r.label.padEnd(15)} ${String(r.keys).padStart(4)}  ${ms1(r.p50).padStart(6)}  ${ms1(r.p90).padStart(6)}  ${ms1(r.max).padStart(6)}  ${ms1(r.burst).padStart(10)}  ${pct(r.daemon).padStart(6)}  ${pct(r.main).padStart(4)}  ${pct(r.renderer).padStart(8)}  ${pct(r.load).padStart(5)}  ${pct(r.box).padStart(8)}  ${loop(r.dLoop).padStart(19)}  ${loop(r.mLoop).padStart(17)}  ${`${r.longN}/${ms1(r.longMax)}/${ms1(r.longSum)}`.padStart(23)}  ${`${ms1(q(r.echo, 50))}/${ms1(q(r.echo, 90))}/${ms1(q(r.echo, 100))}`.padStart(22)}`);
  }
  say('');
  say(`[bench] log ${logFile}`);
  if (REAL === 0) {
    const idle = results[0];
    const eight = results.find((r) => r.label === (QUICK ? `${QUICK_SHELLS} loaded` : '8 loaded'));
    const base = Math.max(idle.p90, CEILING_FLOOR_MS);
    const ok = eight !== undefined && eight.keys >= KEYS / 2 && eight.p90 <= base * CEILING_MULTIPLE;
    const busy = eight !== undefined && eight.box > CEILING_BOX_BUSY;
    say(`[bench] ceiling: p90 at ${QUICK ? QUICK_SHELLS : 'eight'} loaded ${ms1(eight?.p90)} ms against ${CEILING_MULTIPLE} x max(idle p90 ${ms1(idle.p90)}, ${CEILING_FLOOR_MS}) = ${ms1(base * CEILING_MULTIPLE)} ms: ${ok ? 'within' : 'OVER'}${busy ? ` (not judged: the box was ${pct(eight.box)} busy over the round)` : ''}`);
    if (!busy) expect(ok, 'the eight-shell p90 within the ceiling');
  }
  say('[bench] DONE');
} catch (err) {
  console.error('[bench] FAIL', err);
  process.exitCode = 1;
} finally {
  hooksOn = false;
  killTree(s.child);
  stopDaemon();
  await sleep(1500);
  for (const wt of worktrees) {
    if (wt !== undefined) fs.rmSync(wt, { recursive: true, force: true });
  }
  fs.rmSync(repo, { recursive: true, force: true });
  setTimeout(() => process.exit(), 300);
}
