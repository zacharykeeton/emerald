// An install's first-launch record in one go (M9 fix 383). Every install
// session read the same things by hand across several calls, and two of
// the last install's findings (the poster that never wrote its log, the
// pending sweep's EPERM) sat in those reads where an eye could miss them.
// This prints them as `ok:` or `look:` lines with the value, and judges
// nothing by its exit code: the install note quotes the lines.
//
// What it reads, all under EMERALD_HOME (~/.emerald when unset) and the box's
// %LOCALAPPDATA%: main.log's last install sequence (the updater's
// Executing line and its time, any launch in the install's gap, the
// spent installing.json, the first launch's hooks install and its exit,
// the updater cache sweep's line, the install poster's spawn and whether
// install-poster.log was written (with no log read as which build's
// poster it was: the old build's plain spawn wrote none by design, fix
// 385's worker not reaching its log is a look, fix 413), each gap
// launch's own poster line and gap-poster.log (fix 447, both logs read
// against the install's time since they are appended across installs),
// and the seconds from `starting emmerd` to `connected to emmerd`);
// installed.json and daemon.json; the
// Emerald.exe window process under the install and the taskkill line to
// paste to close it (fix 411); the updater cache's root files and its
// pending folder; and the What's New heading the installed build ships.
// Plain node, no CDP, nothing started. Run: npm run install:check -w @emerald/app
//
// The line parser is exported for the unit test (src/main/install-check
// .test.ts) and the reads run only when this file is the main module.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The updater's cache folder name, as packages/shared/src/feed.ts has it;
// spelled here so the script imports nothing that needs a build.
export const UPDATER_CACHE_DIR_NAME = 'emerald-updater';

// A `starting emmerd` to `connected to emmerd` gap past this is a look:
// 0.2 to 0.4 s is a quiet box, and the install of fixes 352 to 371 read
// 5.2 s off a 489 MB hook log.
export const DAEMON_START_LOOK_S = 2;

const finding = (level, text) => ({ level, text });
const ok = (text) => finding('ok', text);
const look = (text) => finding('look', text);

// One main.log line: its ISO stamp and the message after it.
function splitLine(line) {
  const m = /^(\S+) (.*)$/.exec(line);
  return m === null ? { at: null, msg: line } : { at: m[1], msg: m[2] };
}

const secondsBetween = (a, b) => ((Date.parse(b) - Date.parse(a)) / 1000).toFixed(1);

// The main.log lines of the last install sequence: everything from the
// second click's `install poster spawned` or `restart to install` (or
// the updater's Executing line when neither is on record) to the end of
// the file, with the Executing line itself picked out. Null when there
// is no `updater: Executing:` line at all. Shared by parseMainLog and
// posterForm so both read the same sequence.
function lastInstallSequence(lines) {
  let exec = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].msg.startsWith('updater: Executing:')) {
      exec = i;
      break;
    }
  }
  if (exec < 0) return null;
  let start = exec;
  for (let i = exec - 1; i >= Math.max(0, exec - 40); i--) {
    if (lines[i].msg.startsWith('updater: restart to install')) {
      start = i;
      break;
    }
  }
  // The poster is spawned by the second click just before the updater is
  // told to restart (install-poster.ts, then updater.ts), so its line
  // sits a line or two above the restart line. `install poster` is the
  // install poster's own prefix, never `install-gap poster spawned`
  // (fix 408's gap toast), so the two never trade places here.
  for (let i = start - 1; i >= Math.max(0, start - 5); i--) {
    if (lines[i].msg.startsWith('install poster')) {
      start = i;
      break;
    }
  }
  return { execLine: lines[exec], seq: lines.slice(start) };
}

// Which form the second click's poster spawn took, off the same
// sequence parseMainLog reads: `worker` (fix 385's detached node
// worker, its own pid in `(worker pid N)`), `plain` (the 0.1.352
// build's direct spawn, `(pid N)`), or `none` when no `install poster
// spawned` line is on record. Matched by the install poster's own
// prefix, not by `poster spawned` alone, so fix 408's `install-gap
// poster spawned` line is never read as this one.
export function posterForm(text) {
  const lines = text.split(/\r?\n/).filter((l) => l !== '').map(splitLine);
  const found = lastInstallSequence(lines);
  const poster = found === null ? null : (found.seq.find((l) => l.msg.startsWith('install poster spawned')) ?? null);
  if (poster === null) return { form: 'none', pid: null };
  const worker = /\(worker pid (\S+)\)/.exec(poster.msg);
  if (worker !== null) return { form: 'worker', pid: worker[1] };
  const plain = /\(pid (\S+)\)/.exec(poster.msg);
  return { form: 'plain', pid: plain === null ? null : plain[1] };
}

// The findings off main.log's text: the last install sequence, which is
// everything from the second click's `restart to install` (or the
// updater's Executing line when that is missing) to the end of the file.
export function parseMainLog(text) {
  const lines = text.split(/\r?\n/).filter((l) => l !== '').map(splitLine);
  const out = [];
  const found = lastInstallSequence(lines);
  if (found === null) {
    out.push(look('main.log has no `updater: Executing:` line; no install through the updater is on record'));
    return out;
  }
  const { execLine, seq } = found;
  const find = (pred) => seq.find((l) => pred(l.msg)) ?? null;
  const after = (from, pred) => {
    const i = seq.indexOf(from);
    return seq.slice(i + 1).find((l) => pred(l.msg)) ?? null;
  };

  out.push(ok(`installer run at ${execLine.at}: ${execLine.msg.slice('updater: Executing: '.length)}`));

  const gap = seq.filter((l) => l.msg.startsWith('launched while '));
  if (gap.length === 0) out.push(ok('no launch in the install\'s gap'));
  else out.push(look(`${gap.length} launch${gap.length === 1 ? '' : 'es'} in the install's gap: ${gap.map((l) => `${l.at} ${l.msg}`).join('; ')}`));
  // M9 fix 447: each gap launch's own poster (fix 408), the first
  // `install-gap poster` line after it and before the next gap launch.
  // Spawned with a worker pid is the working shape; held, failed or no
  // line at all is a look.
  for (const [n, l] of gap.entries()) {
    const from = seq.indexOf(l);
    const to = n + 1 < gap.length ? seq.indexOf(gap[n + 1]) : seq.length;
    const p = seq.slice(from + 1, to).find((x) => x.msg.startsWith('install-gap poster')) ?? null;
    if (p === null) out.push(look(`no \`install-gap poster\` line after the gap launch at ${l.at}`));
    else if (/^install-gap poster spawned \(worker pid \S+\)$/.test(p.msg)) out.push(ok(`${p.at} ${p.msg}`));
    else out.push(look(`${p.at} ${p.msg}`));
  }

  const spent = find((m) => m.startsWith('installing.json') && m.includes('is spent'));
  if (spent === null) out.push(look('no `installing.json ... is spent` line: the new build\'s first launch did not remove the marker, or is not on record'));
  else out.push(ok(`${spent.at} ${spent.msg}`));

  const first = find((m) => /^first launch of \S+ after \S+: running emmer hooks install$/.test(m));
  if (first === null) {
    out.push(look('no `first launch of <v> after <w>` line: the stamp did not change, or the launch is not on record'));
  } else {
    out.push(ok(`${first.at} ${first.msg}`));
    const exited = after(first, (m) => /^emmer hooks install (exited \d+|failed:)/.test(m));
    if (exited === null) out.push(look('no `emmer hooks install exited N` line after the first launch'));
    else if (/^emmer hooks install exited 0/.test(exited.msg)) out.push(ok(`${exited.at} ${exited.msg}`));
    else out.push(look(`${exited.at} ${exited.msg}`));
  }

  const cache = seq.filter((l) => l.msg.startsWith('updater cache:'));
  if (cache.length === 0) out.push(look('no `updater cache:` line after the install: the pending sweep ran on nothing, or did not run'));
  for (const l of cache) {
    if (/^updater cache: removed pending/.test(l.msg)) out.push(ok(`${l.at} ${l.msg}`));
    else out.push(look(`${l.at} ${l.msg}`));
  }

  const poster = find((m) => m.startsWith('install poster spawned'));
  if (poster === null) out.push(look('no `install poster spawned` line at the second click'));
  else out.push(ok(`${poster.at} ${poster.msg}`));
  const held = find((m) => m === 'install poster held (harness)');
  if (held !== null) out.push(look(`${held.at} ${held.msg}: this home is a harness's`));

  const starting = first === null ? find((m) => m.startsWith('starting emmerd:')) : after(first, (m) => m.startsWith('starting emmerd:'));
  const connected = starting === null ? null : after(starting, (m) => m.startsWith('connected to emmerd '));
  if (starting === null) out.push(look('no `starting emmerd` line after the first launch'));
  else if (connected === null) out.push(look(`${starting.at} ${starting.msg}, and no \`connected to emmerd\` after it`));
  else {
    const s = secondsBetween(starting.at, connected.at);
    const text = `${connected.msg}, ${s} s after starting emmerd (${starting.at})`;
    out.push(Number(s) > DAEMON_START_LOOK_S ? look(text) : ok(text));
  }
  return out;
}

// A poster log's last line, split into its PowerShell `-Format o` stamp
// and the words after it; a BOM or blank tail is dropped first.
function lastLogLine(text) {
  const last = text.replace(/^﻿/, '').trim().split(/\r?\n/).pop() ?? '';
  return { last, at: splitLine(last).at };
}

// The two poster logs against main.log's last install (M9 fix 447). Both
// logs are appended across installs, so a last line stamped before this
// install's sequence began is an older install's answer, a look. The
// reference is the sequence's first line (the second click's poster
// spawn or restart line) rather than the Executing line a fraction of a
// second later, so a poster that wrote its line in that fraction is not
// read as stale. installText and gapText are the logs' contents or null;
// the paths name them in the lines. gap-poster.log is read only when
// the sequence holds a gap launch, since nothing writes it otherwise.
export function posterLogFindings(mainLog, installText, gapText, installPath, gapPath) {
  const out = [];
  const lines = mainLog === null ? [] : mainLog.split(/\r?\n/).filter((l) => l !== '').map(splitLine);
  const found = lastInstallSequence(lines);
  const since = found === null ? null : (found.seq[0]?.at ?? null);
  const stale = (at) => since !== null && at !== null && !Number.isNaN(Date.parse(at)) && Date.parse(at) < Date.parse(since);
  const name = (p) => path.basename(p);

  if (installText !== null) {
    const { last, at } = lastLogLine(installText);
    if (stale(at)) out.push(look(`${name(installPath)}'s last line is from before this install (${since}): ${last}`));
    else out.push(ok(`${name(installPath)}'s last line: ${last}`));
  } else {
    // Fix 413: which build's poster ran says whether no log is expected
    // (the old build's plain spawn never wrote one) or a look (fix 385's
    // worker did not reach its log).
    const pf = mainLog === null ? { form: 'none', pid: null } : posterForm(mainLog);
    if (pf.form === 'plain') out.push(ok("the poster that ran was the old build's (no worker pid), fix 385's first run is the next install"));
    else if (pf.form === 'worker') out.push(look(`fix 385's worker (pid ${pf.pid ?? '?'}) did not reach its log`));
    else out.push(look(`${installPath} does not exist: the poster never ran to its log`));
  }

  const gapLaunch = found === null ? null : (found.seq.find((l) => l.msg.startsWith('launched while ')) ?? null);
  if (gapLaunch === null) return out;
  if (gapText !== null) {
    const { last, at } = lastLogLine(gapText);
    if (stale(at)) out.push(look(`${name(gapPath)}'s last line is from before this install (${since}): ${last}`));
    else out.push(ok(`${name(gapPath)}'s last line: ${last}`));
  } else {
    const spawned = found.seq.find((l) => l.msg.startsWith('install-gap poster spawned')) ?? null;
    const pid = spawned === null ? null : (/\(worker pid (\S+)\)/.exec(spawned.msg)?.[1] ?? null);
    out.push(look(pid === null ? `${gapPath} does not exist and no gap poster was spawned` : `${gapPath} does not exist: the gap poster's worker (pid ${pid}) did not reach its log`));
  }
  return out;
}

// Whether a process read by pid is the daemon daemon.json names (M9 fix
// 534, the ledger's M46): its command line runs the daemon's main.js
// (the installed resources\daemon\dist\main.js or a checkout's
// packages\daemon\dist\main.js), and it was created no later than the
// file's startedAt plus reaper.ts's START_TOLERANCE_MS (2000, spelled here
// since the script imports nothing built). No lower bound: a process that
// took a dead daemon's number was created after the daemon started. A
// daemon.json without startedAt is judged by the command line alone.
export function daemonProcessIs(proc, startedAt) {
  if (proc === null || proc === undefined) return false;
  if (!/[\\/]daemon[\\/]dist[\\/]main\.js/i.test(proc.commandLine ?? '')) return false;
  if (typeof startedAt === 'number') return proc.createdAt <= startedAt + 2000;
  return true;
}

// installed.json and daemon.json under the home. readProcess(pid) answers
// { commandLine, createdAt } or null when the process is gone, since
// Windows recycles a pid within minutes and a bare number proves nothing.
export function parseStamps(installedText, daemonText, readProcess) {
  const out = [];
  if (installedText === null) out.push(look('no installed.json under the home'));
  else {
    try {
      const j = JSON.parse(installedText);
      out.push(ok(`installed.json: ${j.version} at ${j.at}`));
    } catch {
      out.push(look('installed.json is not JSON'));
    }
  }
  if (daemonText === null) out.push(look('no daemon.json under the home: no daemon is up on this home'));
  else {
    try {
      const j = JSON.parse(daemonText);
      const proc = readProcess(j.pid);
      const head = `daemon.json: ${j.version ?? '(no version)'} pid ${j.pid}`;
      if (daemonProcessIs(proc, j.startedAt)) out.push(ok(head));
      else if (proc === null) out.push(look(`${head}, not running`));
      else out.push(look(`${head}, not running (pid ${j.pid} is another process now)`));
    } catch {
      out.push(look('daemon.json is not JSON'));
    }
  }
  return out;
}

// The updater cache's root files and pending folder, as names with
// sizes and mtimes; entries is [{ name, size, mtime, dir }] one level deep.
export function parseCache(entries) {
  const out = [];
  const fmt = (e) => `${e.name} ${e.size} ${e.mtime}`;
  const root = entries.filter((e) => e.dir === '' && !e.isDir);
  const pending = entries.filter((e) => e.dir === 'pending');
  const pendingDir = entries.find((e) => e.dir === '' && e.isDir && e.name === 'pending') ?? null;
  if (root.length === 0) out.push(look('the updater cache root holds no files (the next differential download is built from installer.exe and current.blockmap)'));
  else out.push(ok(`updater cache root: ${root.map(fmt).join(', ')}`));
  if (pendingDir === null) out.push(ok('no pending folder under the updater cache'));
  else if (pending.length === 0) out.push(look('an empty pending folder under the updater cache'));
  else out.push(look(`pending holds ${pending.map(fmt).join(', ')}`));
  return out;
}

// The `Emerald.exe` processes found under the install, filtered to the
// window process(es) alone: a command line carrying `--type=` (a
// renderer, GPU or utility child) is dropped, and so is one with an
// argument ending in `.js` (the CLI, the daemon or a
// claude-statusline.js run as node, each with the script as its first
// argument). A `.json` or `.jsonl` stays (M9 fix 534): the installer
// makes emerald the opener for `.json`, and a cold start keeps the file on
// the window's command line. A window opened on a `.js` through Open
// with is dropped too, since its command line cannot be told from the
// CLI's. `ok:` with the taskkill line to paste when exactly one is
// found; `look:` on none or several, and on none the main.log's last
// window-all-closed (or will-quit, M9 fix 657) after the last lock line
// says when the window closed.
// procs is [{ pid, commandLine }] already filtered to the install
// directory.
export function parseWindowProcesses(procs, mainLog = null) {
  const windows = procs.filter((p) => !p.commandLine.includes('--type=') && !/\.js"?(\s|$)/i.test(p.commandLine));
  if (windows.length === 1) {
    const w = windows[0];
    const updated = w.commandLine.includes('--updated') ? ', --updated' : '';
    return [ok(`the window is pid ${w.pid}${updated}: taskkill /pid ${w.pid}`)];
  }
  if (windows.length === 0) {
    const closedAt = mainLog === null ? null : lastClosedAt(mainLog);
    return [look(`no Emerald.exe window process found under the install${closedAt === null ? '' : `; the window closed at ${closedAt}`}`)];
  }
  const say = (w) => `pid ${w.pid}${w.commandLine.includes('--updated') ? ' (--updated)' : ''}`;
  return [look(`${windows.length} Emerald.exe window processes found: ${windows.map(say).join(', ')}`)];
}

// The stamp of main.log's last window-all-closed or will-quit line (an
// app.quit() close writes the second, M9 fix 657) when it comes
// after the last `single-instance lock held` line (the start of the
// window's life; the prefix does not match `not held`), else null.
function lastClosedAt(mainLog) {
  let lock = -1;
  let closed = -1;
  let at = null;
  mainLog.split(/\r?\n/).forEach((line, i) => {
    const { at: stamp, msg } = splitLine(line);
    if (msg.startsWith('single-instance lock held')) lock = i;
    else if (msg.startsWith('window-all-closed') || msg.startsWith('will-quit')) {
      closed = i;
      at = stamp;
    }
  });
  return closed > lock ? at : null;
}

// The first `##` heading of the shipped WHATS-NEW.md, or null.
export function whatsNewHeading(text) {
  const m = /^## (.+)$/m.exec(text);
  return m === null ? null : m[1];
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function listCache(dir) {
  const out = [];
  let top = [];
  try {
    top = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of top) {
    const st = fs.statSync(path.join(dir, e.name));
    out.push({ name: e.name, size: st.size, mtime: st.mtime.toISOString(), dir: '', isDir: e.isDirectory() });
    if (e.isDirectory() && e.name === 'pending') {
      for (const f of fs.readdirSync(path.join(dir, 'pending'))) {
        const s = fs.statSync(path.join(dir, 'pending', f));
        out.push({ name: f, size: s.size, mtime: s.mtime.toISOString(), dir: 'pending', isDir: s.isDirectory() });
      }
    }
  }
  return out;
}

// The process holding a pid now, its command line and creation time in
// epoch ms (reaper.ts's expression), or null when none does or the read
// fails.
function readProcess(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  const ps =
    `Get-CimInstance Win32_Process -Filter "ProcessId = ${n}" | ` +
    `Select-Object CommandLine, @{ n = 'CreatedAt'; e = { [int64](($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) } } | ` +
    `ConvertTo-Json -Compress`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  const out = (r.stdout ?? '').trim();
  if (out === '') return null;
  try {
    const j = JSON.parse(out);
    return { commandLine: typeof j.CommandLine === 'string' ? j.CommandLine : '', createdAt: Number(j.CreatedAt) };
  } catch {
    return null;
  }
}

// Every Emerald.exe process under installDir, with its command line
// (verify-m7-package.mjs:213's shape). Filtering to the window is
// parseWindowProcesses's, over what this returns.
function listInstalledEmeraldProcesses(installDir) {
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name = 'Emerald.exe'\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"],
    { encoding: 'utf8', windowsHide: true },
  );
  const out = (r.stdout ?? '').trim();
  if (out === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr
    .filter((p) => typeof p.CommandLine === 'string' && p.CommandLine.toLowerCase().includes(installDir.toLowerCase()))
    .map((p) => ({ pid: p.ProcessId, commandLine: p.CommandLine }));
}

function main() {
  const home = process.env['EMERALD_HOME'] ?? path.join(os.homedir(), '.emerald');
  const local = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
  const installDir = path.join(local, 'Programs', 'emerald');
  const cacheDir = path.join(local, UPDATER_CACHE_DIR_NAME);
  const lines = [];
  const say = (f) => lines.push(`${f.level}: ${f.text}`);
  lines.push(`install check: home ${home}, install ${installDir}, cache ${cacheDir}`);

  // The app moves main.log aside to main.1.log past 8 MB at a start (M9
  // fix 559), so the new build's first start can carry the old build's
  // install lines into the older generation; both are read, the older
  // first, since parseMainLog takes the last sequence.
  const current = readText(path.join(home, 'logs', 'main.log'));
  const older = readText(path.join(home, 'logs', 'main.1.log'));
  const mainLog = current === null && older === null ? null : [older, current].filter((t) => t !== null).join('');
  if (mainLog === null) say(look(`no ${path.join(home, 'logs', 'main.log')}`));
  else for (const f of parseMainLog(mainLog)) say(f);

  // The file names are install-poster.ts's posterLogPath and gapLogPath,
  // spelled here so the script imports nothing that needs a build.
  const posterLog = path.join(home, 'install-poster.log');
  const gapLog = path.join(home, 'gap-poster.log');
  for (const f of posterLogFindings(mainLog, readText(posterLog), readText(gapLog), posterLog, gapLog)) say(f);

  for (const f of parseStamps(readText(path.join(home, 'installed.json')), readText(path.join(home, 'daemon.json')), readProcess)) say(f);
  for (const f of parseWindowProcesses(listInstalledEmeraldProcesses(installDir), mainLog)) say(f);
  for (const f of parseCache(listCache(cacheDir))) say(f);

  const wn = readText(path.join(installDir, 'resources', 'WHATS-NEW.md'));
  if (wn === null) say(look(`no ${path.join(installDir, 'resources', 'WHATS-NEW.md')}`));
  else {
    const h = whatsNewHeading(wn);
    say(h === null ? look('the shipped WHATS-NEW.md has no ## heading') : ok(`the shipped What's New heading: ${h}`));
  }
  console.log(lines.join('\n'));
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
