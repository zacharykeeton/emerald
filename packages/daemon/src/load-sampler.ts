import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';
import type { LoadSample } from '@emerald/shared';
import type { Logger } from './log.ts';

// Per-session load (M9 fix 300, docs/design/per-agent-load.md section
// 4): one hidden PowerShell child for the daemon's life sweeps the box's
// processes every tick and writes one JSON line per sweep; the daemon
// walks each live session's tree from its pty's pid by parent id and
// turns two sweeps into one LoadSample per session per tick. Never a
// spawn per tick and never a child per session: fifteen forks every
// four seconds would be the load. The child reads nothing, so the pipe
// is one way and a stuck daemon cannot wedge it.
//
// Two sweep methods, measured by scripts/bench-load-sampler.mjs on the
// box the batch was built on (about 500 processes, arm64): `gp` takes
// the .NET process snapshot Get-Process wraps (about 15 ms), reads each
// process's parent id through NtQueryInformationProcess (2 ms for the
// box, one Add-Type at the child's start) and the cpu time and working
// set of every process it could open, 31 ms of the child's cpu a tick at
// the median and nothing outside it; `cim` runs Get-CimInstance
// Win32_Process with a property list, which carries the parent id itself
// but costs WMI's enumeration, about 50 ms in the child and 360 ms in
// the WMI provider host a sweep, 500 ms of wall however it is filtered.
// The daemon runs `gp` and logs the method at its start;
// EMERALD_LOAD_SWEEP=cim is for the bench.
export const LOAD_TICK_MS = 4000;
// Ten minutes at the tick: the row and the title bar read the last five.
export const LOAD_RING = 150;
export const LOAD_NAMES_KEPT = 8;
// A dead child is started again after this long, once a minute at most.
const RESTART_MS = 60_000;
// A child that has written no sweep for this many ticks (from its spawn,
// so one that never writes its first line counts) is taken as hung and
// restarted (M9 fix 515): a wedged WMI provider or an antivirus hold on
// the Add-Type left one alive and silent for the daemon's life before.
const HUNG_AFTER_TICKS = 3;

export type SweepMethod = 'gp' | 'cim';

export interface ProcRow {
  pid: number;
  ppid: number;
  // The process's cpu time so far, kernel and user, in ms.
  cpuMs: number;
  // The working set in bytes.
  rss: number;
  name: string;
  // When the process started, epoch ms, or -1 when the box would not say
  // (M9 fix 514): a child that started before its parent is not its
  // child, the parent id being a recycled number.
  startMs: number;
}

export interface Sweep {
  at: number;
  rows: ProcRow[];
  // What the child spent on the sweep, for the bench and the log: its
  // own cpu time so far in ms, and the sweep's wall time in ms.
  childCpuMs: number;
  wallMs: number;
}

export interface TreeReading {
  sample: LoadSample;
  names: string[];
}

export interface LoadTarget {
  id: string;
  name: string;
  pid: number;
}

export interface LoadSamplerOptions {
  log: Logger;
  tickMs?: number;
  method?: SweepMethod;
  // A JSON file of samples to replay instead of sweeping (the verify
  // script's knob, EMERALD_LOAD_STUB): { "<session name>": [{ cpu, rss,
  // names? }, ...] }. Read fresh at every tick so a script can rewrite
  // it between steps; a rewrite starts every list over.
  stubPath?: string | null;
  // Where the sweep script is written before the child runs it with
  // -File (under the daemon's home). An -EncodedCommand on the command
  // line was the first form, and the box's antivirus held that spawn for
  // 2.5 s under the app (85 to 330 ms from a plain node), which delayed
  // `listening` past the verify scripts' waits; a script file spawns in
  // under 20 ms. Absent, the child gets the encoded form.
  scriptPath?: string | null;
  // The test's knobs (M9 fix 515): a stand-in for the PowerShell spawn
  // (the script is not written when it is given), and the wait before a
  // dead or hung child is started again.
  spawnSweep?: () => ChildProcess;
  restartMs?: number;
  // The live sessions to sample, asked at every tick.
  targets: () => LoadTarget[];
  // One reading per session that got one this tick.
  onTick: (readings: Map<string, TreeReading>) => void;
}

// The PowerShell the child runs. Every tick writes one line
// {"at":<epoch ms>,"c":<child cpu ms>,"w":<sweep wall ms>,"p":[[pid,ppid,cpuMs,wsBytes,"name",startMs],...]}
// with a parent id or a start of -1 where the box would not say. The gp method's
// parent read is a P/Invoke compiled once at the start; a box whose
// Add-Type fails falls back to a Win32_Process sweep of the parents once
// a minute, so the tree is up to a minute stale there and fresh every
// tick otherwise.
export function sweepScript(tickMs: number, method: SweepMethod): string {
  const lines = [
    '$ErrorActionPreference = "SilentlyContinue"',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$tick = ${Math.max(50, Math.floor(tickMs))}`,
    '$me = [Diagnostics.Process]::GetCurrentProcess()',
  ];
  if (method === 'gp') {
    lines.push(
      '$native = $true',
      'try {',
      '  Add-Type -TypeDefinition @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public static class EmeraldProc {',
      '  [StructLayout(LayoutKind.Sequential)]',
      '  public struct PBI { public IntPtr Reserved1; public IntPtr PebBaseAddress; public IntPtr Reserved2a; public IntPtr Reserved2b; public IntPtr UniqueProcessId; public IntPtr InheritedFromUniqueProcessId; }',
      '  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PBI info, int len, out int ret);',
      '  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);',
      '  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);',
      '  public static int ParentOf(int pid) {',
      '    IntPtr h = OpenProcess(0x1000, false, pid);',
      '    if (h == IntPtr.Zero) return -1;',
      '    try {',
      '      PBI info = new PBI(); int ret;',
      '      int st = NtQueryInformationProcess(h, 0, ref info, Marshal.SizeOf(typeof(PBI)), out ret);',
      '      return st == 0 ? (int)info.InheritedFromUniqueProcessId.ToInt64() : -1;',
      '    } finally { CloseHandle(h); }',
      '  }',
      '}',
      '"@',
      '} catch { $native = $false }',
      '$parents = @{}',
      '$parentsAt = 0',
      'while ($true) {',
      '  $sw = [Diagnostics.Stopwatch]::StartNew()',
      '  if (-not $native -and ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $parentsAt) -ge 60000) {',
      '    $parents = @{}',
      '    foreach ($c in (Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId)) { $parents[[int]$c.ProcessId] = [int]$c.ParentProcessId }',
      '    $parentsAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
      '  }',
      // Raw .NET reads and a StringBuilder: Get-Process's CPU script
      // property, a scriptblock call per process and a joined list of
      // interpolated strings cost three times this. A process the parent
      // read could not open throws on its cpu time too, and the exception
      // per protected process was most of a sweep's cost, so its cpu is
      // not asked for; without the native read every process is tried.
      '  $sb = New-Object Text.StringBuilder',
      '  foreach ($p in [Diagnostics.Process]::GetProcesses()) {',
      '    if ($native) { $pp = [EmeraldProc]::ParentOf($p.Id) } else { $pp = $parents[[int]$p.Id]; if ($null -eq $pp) { $pp = -1 } }',
      '    $cpu = -1',
      '    $st = -1',
      // The start time is asked under the cpu read's guard: a process the
      // parent read could not open throws on it the same way (M9 fix 514).
      '    if ($pp -ge 0 -or -not $native) { try { $cpu = [long][math]::Round($p.TotalProcessorTime.TotalMilliseconds) } catch {}; try { $st = [long]([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() } catch {} }',
      "    $name = $p.ProcessName.Replace('\"', '_').Replace('\\', '_')",
      "    [void]$sb.Append('[').Append($p.Id).Append(',').Append($pp).Append(',').Append($cpu).Append(',').Append($p.WorkingSet64).Append(',\"').Append($name).Append('\",').Append($st).Append('],')",
      '  }',
      "  $rows = $sb.ToString().TrimEnd(',')",
      '  $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
      '  $me.Refresh()',
      '  [Console]::Out.WriteLine("{`"at`":$at,`"c`":$([long][math]::Round($me.TotalProcessorTime.TotalMilliseconds)),`"w`":$($sw.ElapsedMilliseconds),`"p`":[$rows]}")',
      '  [Console]::Out.Flush()',
      '  $rest = $tick - $sw.ElapsedMilliseconds',
      '  if ($rest -gt 0) { Start-Sleep -Milliseconds $rest }',
      '}',
    );
  } else {
    lines.push(
      'while ($true) {',
      '  $sw = [Diagnostics.Stopwatch]::StartNew()',
      '  $rows = foreach ($p in (Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,KernelModeTime,UserModeTime,WorkingSetSize,Name,CreationDate)) {',
      '    $st = -1',
      '    if ($null -ne $p.CreationDate) { try { $st = [long]([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } catch {} }',
      "    $name = ([string]$p.Name).Replace('\"', '_').Replace('\\', '_')",
      '    "[$($p.ProcessId),$($p.ParentProcessId),$([long][math]::Round(($p.KernelModeTime + $p.UserModeTime) / 10000)),$($p.WorkingSetSize),`"$name`",$st]"',
      '  }',
      '  $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
      '  $me.Refresh()',
      '  [Console]::Out.WriteLine("{`"at`":$at,`"c`":$([long][math]::Round($me.TotalProcessorTime.TotalMilliseconds)),`"w`":$($sw.ElapsedMilliseconds),`"p`":[$($rows -join \',\')]}")',
      '  [Console]::Out.Flush()',
      '  $rest = $tick - $sw.ElapsedMilliseconds',
      '  if ($rest -gt 0) { Start-Sleep -Milliseconds $rest }',
      '}',
    );
  }
  return lines.join('\n');
}

// One line off the child; null for anything but a well-formed sweep.
export function parseSweepLine(line: string): Sweep | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['at'] !== 'number' || !Array.isArray(r['p'])) return null;
  const rows: ProcRow[] = [];
  for (const entry of r['p']) {
    if (!Array.isArray(entry) || entry.length < 5) continue;
    const [pid, ppid, cpuMs, rss, name, start] = entry;
    if (typeof pid !== 'number' || typeof ppid !== 'number' || typeof cpuMs !== 'number' || typeof rss !== 'number' || typeof name !== 'string') continue;
    // A five-element row (a child from before M9 fix 514) has no start.
    rows.push({ pid, ppid, cpuMs, rss, name, startMs: typeof start === 'number' ? start : -1 });
  }
  return { at: r['at'], rows, childCpuMs: typeof r['c'] === 'number' ? r['c'] : 0, wallMs: typeof r['w'] === 'number' ? r['w'] : 0 };
}

// A sweep indexed once for every tree read off it (M9 fix 516): the rows
// by pid, and the children of each pid by parent id. Before, each
// session's read rebuilt the three maps over every row, 22.5 ms a tick
// at a hundred sessions.
export interface SweepIndex {
  sweep: Sweep;
  byPid: Map<number, ProcRow>;
  children: Map<number, number[]>;
}

// The children are by parent id. Windows keeps a process's parent id
// after the parent exits, so a long-lived stranger whose parent's number
// has since been reused would read as the new process's child; an edge
// whose child started before the parent it names is dropped (M9 fix
// 514). Equal start times keep the edge, and so does an unknown one on
// either side, which is how a row read without start times always
// walked.
export function indexSweep(sweep: Sweep): SweepIndex {
  const byPid = new Map<number, ProcRow>();
  for (const r of sweep.rows) byPid.set(r.pid, r);
  const children = new Map<number, number[]>();
  for (const r of sweep.rows) {
    if (r.ppid < 0) continue;
    const parent = byPid.get(r.ppid);
    if (parent !== undefined && parent.startMs >= 0 && r.startMs >= 0 && r.startMs < parent.startMs) continue;
    const list = children.get(r.ppid);
    if (list === undefined) children.set(r.ppid, [r.pid]);
    else list.push(r.pid);
  }
  return { sweep, byPid, children };
}

// The pids of the tree rooted at `root`, the root first. A visited set
// guards the cycle a reused pid can draw (a process whose parent id
// names a newer process that is its own descendant).
export function walkTree(root: number, index: SweepIndex): number[] {
  if (!index.byPid.has(root)) return [];
  const seen = new Set<number>([root]);
  const out = [root];
  for (let i = 0; i < out.length; i++) {
    for (const c of index.children.get(out[i]!) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

// walkTree on rows not yet indexed, for the tests and the bench.
export function treePids(root: number, rows: readonly ProcRow[]): number[] {
  return walkTree(root, indexSweep({ at: 0, rows: [...rows], childCpuMs: 0, wallMs: 0 }));
}

// The tree's reading off two sweeps: cpu as the sum over the tree's
// processes present in both of their cpu time delta, over the wall time
// between the sweeps, in percent of one core; rss as the working sets
// summed in MB; the names of the tree's processes in tree order, the
// root first, at most LOAD_NAMES_KEPT. Null with no earlier sweep, when
// the root is gone, or when no process of the tree was in the earlier
// sweep (a process's first sweep says nothing about its rate). A
// process whose cpu the box would not read (-1) counts for its memory
// and its name and nothing for the rate.
export function readTree(prev: SweepIndex | null, cur: SweepIndex, root: number): TreeReading | null {
  if (prev === null || cur.sweep.at <= prev.sweep.at) return null;
  const pids = walkTree(root, cur);
  if (pids.length === 0) return null;
  let deltaMs = 0;
  let seen = 0;
  let rssBytes = 0;
  const names: string[] = [];
  for (const pid of pids) {
    const r = cur.byPid.get(pid)!;
    rssBytes += Math.max(0, r.rss);
    if (names.length < LOAD_NAMES_KEPT && !names.includes(r.name)) names.push(r.name);
    const p = prev.byPid.get(pid);
    if (p === undefined || r.cpuMs < 0 || p.cpuMs < 0) continue;
    seen++;
    // A reused pid reads a smaller time than its predecessor's.
    deltaMs += Math.max(0, r.cpuMs - p.cpuMs);
  }
  if (seen === 0) return null;
  const cpu = Math.round((deltaMs / (cur.sweep.at - prev.sweep.at)) * 100 * 10) / 10;
  return { sample: { at: cur.sweep.at, cpu, rss: Math.round(rssBytes / (1024 * 1024)) }, names };
}

// readTree on sweeps not yet indexed, for the tests.
export function treeReading(prev: Sweep | null, cur: Sweep, root: number): TreeReading | null {
  return readTree(prev === null ? null : indexSweep(prev), indexSweep(cur), root);
}

// The ring, oldest first, capped at LOAD_RING; a plain array, since
// RingBuffer is bytes.
export function pushSample(ring: readonly LoadSample[] | null | undefined, sample: LoadSample): LoadSample[] {
  const next = ring == null ? [sample] : [...ring, sample];
  return next.length > LOAD_RING ? next.slice(next.length - LOAD_RING) : next;
}

export interface StubEntry {
  cpu: number;
  rss: number;
  names?: string[];
}

// The stub file's lists by session name; null when the file is missing
// or not the shape.
export function parseStub(text: string): Map<string, StubEntry[]> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const out = new Map<string, StubEntry[]>();
  for (const [name, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const entries: StubEntry[] = [];
    for (const e of list) {
      if (typeof e !== 'object' || e === null) continue;
      const { cpu, rss, names } = e as Record<string, unknown>;
      if (typeof cpu !== 'number' || typeof rss !== 'number') continue;
      entries.push({ cpu, rss, ...(Array.isArray(names) ? { names: names.filter((n): n is string => typeof n === 'string') } : {}) });
    }
    out.set(name, entries);
  }
  return out;
}

// Replays a stub: each tick hands every named session its next entry,
// a list exhausted giving no more; the text changing starts every list
// over.
export class StubReplay {
  private text: string | null = null;
  private lists = new Map<string, StubEntry[]>();
  private readonly cursors = new Map<string, number>();

  // The readings for this tick, by session id, off the file's current
  // text.
  tick(text: string | null, targets: readonly LoadTarget[], at: number): Map<string, TreeReading> {
    if (text !== this.text) {
      this.text = text;
      this.lists = (text === null ? null : parseStub(text)) ?? new Map();
      this.cursors.clear();
    }
    const out = new Map<string, TreeReading>();
    for (const t of targets) {
      const list = this.lists.get(t.name);
      if (list === undefined) continue;
      const i = this.cursors.get(t.name) ?? 0;
      const e = list[i];
      if (e === undefined) continue;
      this.cursors.set(t.name, i + 1);
      out.set(t.id, { sample: { at, cpu: e.cpu, rss: e.rss }, names: e.names ?? [] });
    }
    return out;
  }
}

export class LoadSampler {
  private readonly opts: LoadSamplerOptions;
  private readonly tickMs: number;
  private readonly method: SweepMethod;
  private child: ChildProcess | null = null;
  private restart: NodeJS.Timeout | null = null;
  private stubTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  // When the child was spawned or last wrote a sweep, for the watchdog.
  private lastSweepAt = 0;
  private readonly stub = new StubReplay();
  // The last sweep, indexed once when it came (M9 fix 516), for the
  // next sweep's deltas.
  private prevIndex: SweepIndex | null = null;
  private running = false;

  constructor(opts: LoadSamplerOptions) {
    this.opts = opts;
    this.tickMs = opts.tickMs ?? LOAD_TICK_MS;
    this.method = opts.method ?? 'gp';
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.opts.stubPath != null) {
      const path = this.opts.stubPath;
      this.opts.log.info('load sampler: replaying a stub', { path, tickMs: this.tickMs });
      this.stubTimer = setInterval(() => {
        let text: string | null = null;
        try {
          text = fs.readFileSync(path, 'utf8');
        } catch {
          // Not written yet, or gone: nothing this tick.
        }
        const readings = this.stub.tick(text, this.opts.targets(), Date.now());
        if (readings.size > 0) this.opts.onTick(readings);
      }, this.tickMs);
      this.stubTimer.unref();
      return;
    }
    this.opts.log.info('load sampler: starting the sweep child', { method: this.method, tickMs: this.tickMs });
    this.spawnChild();
  }

  stop(): void {
    this.running = false;
    if (this.restart !== null) clearTimeout(this.restart);
    this.restart = null;
    if (this.stubTimer !== null) clearInterval(this.stubTimer);
    this.stubTimer = null;
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.watchdog = null;
    const child = this.child;
    this.child = null;
    if (child !== null) child.kill();
  }

  private spawnChild(): void {
    let child: ChildProcess;
    try {
      if (this.opts.spawnSweep !== undefined) {
        child = this.opts.spawnSweep();
      } else {
        // The script goes through a file when there is a place for it (see
        // scriptPath), else encoded, since a multi-line script with quotes
        // and a here-string in it does not survive the command line's
        // quoting.
        const script = sweepScript(this.tickMs, this.method);
        const scriptPath = this.opts.scriptPath ?? null;
        let form: string[];
        if (scriptPath !== null) {
          fs.writeFileSync(scriptPath, script, 'utf8');
          form = ['-File', scriptPath];
        } else {
          form = ['-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
        }
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...form], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      }
    } catch (err) {
      this.opts.log.warn('load sampler: could not start the sweep child', err);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    this.prevIndex = null;
    this.lastSweepAt = Date.now();
    if (this.watchdog === null) {
      this.watchdog = setInterval(() => this.checkHung(), this.tickMs);
      this.watchdog.unref();
    }
    const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (this.child !== child) return;
      const sweep = parseSweepLine(line);
      // A line that does not parse is no answer to the watchdog.
      if (sweep === null) return;
      this.lastSweepAt = Date.now();
      this.onSweep(sweep);
    });
    let stderr = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (this.child !== child) return;
      this.opts.log.warn('load sampler: the sweep child failed', err);
    });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.opts.log.warn('load sampler: the sweep child exited', { code, signal, stderr: stderr.trim().slice(0, 500) });
      this.scheduleRestart();
    });
  }

  // The watchdog's tick: a child silent for HUNG_AFTER_TICKS ticks is
  // dropped before it is killed, so its exit handler (which returns on a
  // child that is no longer ours) adds no second line, and the restart
  // comes after the same wait as for an exit.
  private checkHung(): void {
    const child = this.child;
    if (child === null) return;
    const silentMs = Date.now() - this.lastSweepAt;
    if (silentMs < HUNG_AFTER_TICKS * this.tickMs) return;
    this.opts.log.warn(`load sweep hung for ${Math.round(silentMs / 1000)} s; restarting it`);
    this.child = null;
    child.kill();
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (!this.running || this.restart !== null) return;
    this.restart = setTimeout(() => {
      this.restart = null;
      if (!this.running) return;
      this.opts.log.info('load sampler: starting the sweep child again');
      this.spawnChild();
    }, this.opts.restartMs ?? RESTART_MS);
    this.restart.unref();
  }

  private onSweep(sweep: Sweep): void {
    const prev = this.prevIndex;
    const cur = indexSweep(sweep);
    this.prevIndex = cur;
    // The first sweep's cost, once per child, so the log says what the
    // box paid for it.
    if (prev === null) this.opts.log.info('load sampler: first sweep', { processes: sweep.rows.length, wallMs: sweep.wallMs, childCpuMs: sweep.childCpuMs });
    const readings = new Map<string, TreeReading>();
    for (const t of this.opts.targets()) {
      const reading = readTree(prev, cur, t.pid);
      if (reading !== null) readings.set(t.id, reading);
    }
    if (readings.size > 0) this.opts.onTick(readings);
  }
}
