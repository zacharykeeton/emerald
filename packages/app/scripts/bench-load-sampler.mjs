// The load sampler's cost (M9 fix 300), a bench and not a verify: what
// the daemon's sweep child costs the box per tick under each of its two
// methods, and what the daemon spends parsing a sweep and walking twenty
// trees, which docs/design/per-agent-load.md holds under 15 ms. Runs the
// real child (load-sampler's sweepScript) on the live box, no daemon
// needed, with the twenty largest process trees standing in for twenty
// sessions.
//
//   node scripts/bench-load-sampler.mjs [--ticks 30] [--tick-ms 1000] [--method gp|cim]
//
// Prints per tick the child's own cpu time spent since the tick before,
// the WMI provider host's (WmiPrvSE, where a Win32_Process enumeration
// does its work, so the cim method's cost is mostly outside its child;
// read off the sweep's own rows, which under gp cannot open it and read
// nothing), the sweep's wall time as the child measured it, and the
// daemon-side parse and walk time, then the medians, p90s and maxima per
// method; exits 1 when the daemon-side p90 is over 15 ms for either
// method. The child's cpu plus the host's per tick is what decides the
// method the daemon runs.

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { performance } from 'node:perf_hooks';
import { indexSweep, parseSweepLine, readTree, sweepScript, treePids } from '../../daemon/dist/load-sampler.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};
const ticks = Number(opt('--ticks', '30'));
const tickMs = Number(opt('--tick-ms', '1000'));
const only = opt('--method', null);
const methods = only === null ? ['gp', 'cim'] : [only];
const TREES = 20;
const LINE_MS = 15;

const pct = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(s.length * q))];
};
const fmt = (n) => n.toFixed(1).padStart(7);

// The twenty roots with the most processes under them, off one sweep,
// skipping the idle and System pids the walk would count everything
// under.
function pickRoots(rows) {
  const sized = rows.filter((r) => r.pid > 4).map((r) => ({ pid: r.pid, size: treePids(r.pid, rows).length }));
  sized.sort((a, b) => b.size - a.size);
  return sized.slice(0, TREES).map((s) => s.pid);
}

function runMethod(method) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(sweepScript(tickMs, method), 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let prev = null;
    let prevIndex = null;
    let roots = null;
    let lastChildCpu = null;
    let lastWmiCpu = null;
    const wmiCpu = (rows) => rows.filter((r) => r.name.toLowerCase().startsWith('wmiprvse') && r.cpuMs >= 0).reduce((n, r) => n + r.cpuMs, 0);
    const perTick = [];
    const startedAt = Date.now();
    console.log(`method ${method}: ${ticks} ticks at ${tickMs} ms`);
    rl.on('line', (line) => {
      const t0 = performance.now();
      const sweep = parseSweepLine(line);
      if (sweep === null) {
        console.log(`  a line the parser refused (${line.length} chars)`);
        return;
      }
      if (roots === null) {
        roots = pickRoots(sweep.rows);
        console.log(`  first sweep: ${sweep.rows.length} processes, ${sweep.wallMs} ms wall, the child at ${sweep.childCpuMs} ms of cpu after ${Date.now() - startedAt} ms up (its start is the Add-Type and the first snapshot); the ${TREES} largest trees: ${roots.map((pid) => `${pid} (${treePids(pid, sweep.rows).length})`).join(', ')}`);
      }
      // One index a sweep and a read per root, as the daemon does since
      // M9 fix 516.
      const index = indexSweep(sweep);
      let readings = 0;
      for (const root of roots) if (readTree(prevIndex, index, root) !== null) readings++;
      const daemonMs = performance.now() - t0;
      const childMs = lastChildCpu === null ? null : sweep.childCpuMs - lastChildCpu;
      lastChildCpu = sweep.childCpuMs;
      const wmiNow = wmiCpu(sweep.rows);
      const wmiMs = lastWmiCpu === null ? null : Math.max(0, wmiNow - lastWmiCpu);
      lastWmiCpu = wmiNow;
      if (prev !== null) {
        perTick.push({ childMs, wmiMs, wallMs: sweep.wallMs, daemonMs, readings, processes: sweep.rows.length });
        console.log(`  tick ${String(perTick.length).padStart(2)}: child cpu ${fmt(childMs)} ms, WMI host ${fmt(wmiMs)} ms, sweep wall ${String(sweep.wallMs).padStart(5)} ms, daemon parse+walk ${fmt(daemonMs)} ms, ${readings} of ${TREES} trees read, ${sweep.rows.length} processes`);
      }
      prev = sweep;
      prevIndex = index;
      if (perTick.length >= ticks) {
        rl.close();
        child.kill();
        resolve({ method, perTick });
      }
    });
    child.on('exit', (code) => {
      if (perTick.length < ticks) reject(new Error(`the ${method} child exited early with ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  });
}

const results = [];
for (const method of methods) results.push(await runMethod(method));

console.log('');
let over = false;
for (const { method, perTick } of results) {
  const childs = perTick.map((t) => t.childMs);
  const wmis = perTick.map((t) => t.wmiMs);
  const walls = perTick.map((t) => t.wallMs);
  const daemons = perTick.map((t) => t.daemonMs);
  const p90 = pct(daemons, 0.9);
  console.log(`${method}: child cpu per tick median ${fmt(pct(childs, 0.5))} ms, p90 ${fmt(pct(childs, 0.9))}, max ${fmt(Math.max(...childs))}; WMI host per tick median ${fmt(pct(wmis, 0.5))} ms, p90 ${fmt(pct(wmis, 0.9))}; sweep wall median ${fmt(pct(walls, 0.5))} ms, p90 ${fmt(pct(walls, 0.9))}; daemon parse+walk median ${fmt(pct(daemons, 0.5))} ms, p90 ${fmt(p90)}, max ${fmt(Math.max(...daemons))}${p90 > LINE_MS ? `  OVER the ${LINE_MS} ms line` : ''}`);
  if (p90 > LINE_MS) over = true;
}
if (results.length === 2) {
  const cost = (r) => pct(r.perTick.map((t) => t.childMs + t.wmiMs), 0.5);
  const [a, b] = results;
  const cheaper = cost(a) <= cost(b) ? a : b;
  console.log(`finding: ${cheaper.method} costs the box least per tick (${fmt(cost(cheaper))} ms of cpu, the child's and the WMI host's, against ${fmt(cost(cheaper === a ? b : a))}); at a 4 s tick that is ${((cost(cheaper) / 4000) * 100).toFixed(2)}% of one core.`);
}
process.exit(over ? 1 : 0);
