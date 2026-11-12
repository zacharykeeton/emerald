import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { kitDirOf, mkdirCommand, nodeDirOf, relayCommand, remoteHomeOf, removeCommand, untarCommand } from '@emerald/shared';
import type { HostRecord, RemoteHost } from '@emerald/shared';
import { sshCommand, sshTarget } from './host-client.ts';
import type { Runner } from './node-runner.ts';
import type { DaemonInfo } from './pipe-client.ts';
import { KIT_NODE_VERSION } from './remote-kit.ts';
import type { AssembledKit, KitArch, KitOs } from './remote-kit.ts';

// First contact and setup of a remote host (M9 fix 1084): the probe that
// reads the host's shell, OS, arch and home, the copy of the kit's two
// archives over scp, the unpack with the host's tar, the hooks install, and
// the start through the relay (C1), which starts the host's daemon. Each
// phase is a host.setup push the empty pane draws. Nothing here imports
// electron: main passes in its deps, so node --test runs the test.

export type SetupPhase = 'probing' | 'copying' | 'unpacking' | 'starting' | 'done' | 'failed';

// C3's host.setup body without its type.
export interface SetupPush {
  host: string;
  phase: SetupPhase;
  bytes: number;
  startedAt: number;
  line: string | null;
}

export interface RunOutcome {
  code: number | null;
  stdout: string;
  stderrLast: string;
}

// Every ssh and scp the kit spawns, so the test can script them.
export type RemoteRunner = (
  tool: 'ssh' | 'scp',
  args: readonly string[],
  opts?: { cwd?: string },
) => { done: Promise<RunOutcome>; kill: () => void };

// A connect that ends in a refusal rejects with the refusal's line as the
// message and its kind beside it.
export type ConnectRefusal = Error & { kind?: 'hostkey' | 'ssh' | 'nokit' };

export interface SetupDeps {
  run: RemoteRunner;
  kit: (os: KitOs, arch: KitArch) => Promise<AssembledKit>;
  setRecord: (r: HostRecord) => Promise<void>;
  // Contacts the host with the record given, its kit's versions filled in,
  // and resolves with the daemon's hello or rejects with a ConnectRefusal.
  connect: (record: HostRecord) => Promise<DaemonInfo>;
  push: (p: SetupPush) => void;
  // An ssh exit 255 at the probe is the login's or the host key's refusal,
  // which main pushes as host.changed refused rather than a failed setup.
  refused?: (r: { kind: 'hostkey' | 'ssh'; line: string }) => void;
  appVersion: string;
  now: () => number;
  // For the test; a timer otherwise.
  sleep?: (ms: number) => Promise<void>;
  log: (msg: string) => void;
}

export type SetupResult = { ok: true; daemon: DaemonInfo } | { ok: false; line: string };

// The last line of stderr that is not blank: ssh to a Windows host writes
// its post-quantum warnings first, so the last line is the one a refusal
// quotes.
export function lastLine(text: string): string {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '').trim()).filter((l) => l !== '');
  return lines.at(-1) ?? '';
}

// EMERALD_SSH and EMERALD_SCP through the host client's own rule: a .mjs or
// .js runs under this app's node (the verify's stubs), anything else is the
// exe. The env given lies over the one sshCommand copies from process.env,
// keeping its ELECTRON_RUN_AS_NODE for a node run under the app's own exe.
export function spawnRunner(runner: Runner, env: NodeJS.ProcessEnv = process.env): RemoteRunner {
  return (tool, args, opts = {}) => {
    const cmd = tool === 'ssh' ? sshCommand(env['EMERALD_SSH'], runner, 'ssh') : sshCommand(env['EMERALD_SCP'], runner, 'scp');
    const child = spawn(cmd.exe, [...cmd.prefix, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...cmd.env, ...env },
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (stdout += d));
    child.stderr.on('data', (d: string) => {
      // Only the tail matters; a chatty stderr is cut to its last 8 KB.
      stderr = (stderr + d).slice(-8192);
    });
    const done = new Promise<RunOutcome>((resolve) => {
      child.on('error', (err) => resolve({ code: null, stdout, stderrLast: err.message }));
      child.on('close', (code) => resolve({ code, stdout, stderrLast: lastLine(stderr) }));
    });
    return { done, kill: () => void child.kill() };
  };
}

export interface ProbeResult {
  shell: 'sh' | 'powershell';
  os: 'darwin' | 'linux' | 'win32';
  arch: string;
  home: string;
}

function probeLines(stdout: string): string[] {
  return stdout.split('\n').map((l) => l.replace(/\r$/, '').trim()).filter((l) => l !== '');
}

// `uname -sm; echo $HOME`. Under PowerShell 5.1 this too exits 0, with the
// home alone on stdout, so the shape decides and never the exit code.
export function parseShProbe(code: number | null, stdout: string): ProbeResult | null {
  if (code !== 0) return null;
  const lines = probeLines(stdout);
  if (lines.length !== 2) return null;
  const m = /^(Darwin|Linux) (\S+)$/.exec(lines[0]!);
  if (m === null || !lines[1]!.startsWith('/')) return null;
  const raw = m[2]!;
  const arch = raw === 'arm64' || raw === 'aarch64' ? 'arm64' : raw === 'x86_64' ? 'x64' : raw;
  return { shell: 'sh', os: m[1] === 'Darwin' ? 'darwin' : 'linux', arch, home: lines[1]! };
}

// `$env:PROCESSOR_ARCHITECTURE; $HOME`, its lines ending CRLF.
export function parsePowerShellProbe(code: number | null, stdout: string): ProbeResult | null {
  if (code !== 0) return null;
  const lines = probeLines(stdout);
  if (lines.length !== 2 || !/^[A-Za-z]:\\/.test(lines[1]!)) return null;
  const raw = lines[0]!;
  const arch = raw === 'AMD64' ? 'x64' : raw === 'ARM64' ? 'arm64' : raw;
  return { shell: 'powershell', os: 'win32', arch, home: lines[1]! };
}

type KitPlace = { home: string; shell: 'powershell' | 'sh'; nodeVersion: string; kitVersion: string };

function quoteWord(w: string): string {
  if (/^[A-Za-z0-9_.:=-]+$/.test(w)) return w;
  if (w.includes('"')) throw new Error(`a remote word cannot hold a double quote: ${w}`);
  return `"${w}"`;
}

function remoteFile(h: KitPlace, dir: string, name: string): string {
  return `${dir}${h.shell === 'powershell' ? '\\' : '/'}${name}`;
}

// Whether the kit's Node is on the host already: True on stdout when it is.
export function nodeCheckCommand(h: KitPlace, nodeVersion: string): string {
  const dir = nodeDirOf(h, nodeVersion);
  return h.shell === 'powershell'
    ? `Test-Path -LiteralPath "${remoteFile(h, dir, 'node.exe')}"`
    : `if [ -x "${dir}/bin/node" ]; then echo True; else echo False; fi`;
}

// The kit's CLI run with its own node, as relayCommand's first words do.
export function kitCliCommand(h: KitPlace, words: readonly string[]): string {
  const relay = relayCommand(h);
  const [node, cli] = h.shell === 'powershell' ? [relay[1]!, relay[2]!] : [relay[0]!, relay[1]!];
  const line = [node, cli, ...words.map(quoteWord)].join(' ');
  return h.shell === 'powershell' ? `& ${line}` : line;
}

// Every kit and Node folder under the remote home but the ones named.
export function pruneCommand(h: KitPlace, keepKit: string, keepNode: string): string {
  const home = remoteHomeOf(h);
  return h.shell === 'powershell'
    ? `Get-ChildItem -Directory -LiteralPath "${home}" | Where-Object { ($_.Name -match '^\\d+\\.\\d+\\.\\d+$' -and $_.Name -ne '${keepKit}') -or ($_.Name -like 'node-*' -and $_.Name -ne 'node-${keepNode}') } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue`
    : `cd "${home}" && for d in [0-9]*.[0-9]*.[0-9]* node-*; do [ -d "$d" ] && [ "$d" != "${keepKit}" ] && [ "$d" != "node-${keepNode}" ] && rm -rf "$d"; done; true`;
}

const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'] as const;

// What ssh is given is the host client's sshTarget: a config host's name
// (ssh resolves its own config), an added host's destination.
export function sshArgs(host: RemoteHost, command: string): string[] {
  return [...SSH_OPTS, sshTarget(host), command];
}

// A bare file name with the archive's folder as the cwd, so a C:\ path is
// never read as a host named C, and a remote path relative to the login's
// home, where scp and sftp servers on Windows and a Mac start.
export function scpArgs(host: RemoteHost, archive: string): { args: string[]; cwd: string } {
  const name = path.basename(archive);
  return { args: [...SSH_OPTS, name, `${sshTarget(host)}:.emerald-remote/${name}`], cwd: path.dirname(archive) };
}

function recordOf(host: RemoteHost): HostRecord {
  const { source: _source, ...rest } = host;
  return rest;
}

const running = new Map<string, Promise<SetupResult>>();
const cancels = new Map<string, () => void>();

// Kills the setup's running child; the setup ends failed with `cancelled`.
export function cancelSetup(name: string): void {
  cancels.get(name)?.();
}

// One setup per host at a time: a second call while one runs gets the same
// promise.
export function setupHost(host: RemoteHost, deps: SetupDeps): Promise<SetupResult> {
  const going = running.get(host.name);
  if (going !== undefined) return going;
  const p = runSetup(host, deps).finally(() => {
    running.delete(host.name);
    cancels.delete(host.name);
  });
  running.set(host.name, p);
  return p;
}

class SetupFailed extends Error {}

// M9 fix 1166: a same-version setup unpacks over the folder a just-stopped
// daemon ran from, and Windows' tar cannot replace a pty.node or conpty.dll
// a process still has loaded (exit 1, "Can't unlink already-existing
// object: Permission denied", read 2026-11-12) until it has exited, which
// the daemon's reaper ensures within 4 s; so the emerald unpack is tried
// UNPACK_TRIES times, UNPACK_RETRY_MS apart.
export const UNPACK_TRIES = 3;
export const UNPACK_RETRY_MS = 2000;

async function runSetup(host: RemoteHost, deps: SetupDeps): Promise<SetupResult> {
  const name = host.name;
  const startedAt = deps.now();
  let bytes = 0;
  let cancelled = false;
  let killCurrent: (() => void) | null = null;
  cancels.set(name, () => {
    cancelled = true;
    killCurrent?.();
  });
  const push = (phase: SetupPhase, line: string | null = null): void => {
    deps.log(phase === 'failed' ? `host ${name}: setup failed: ${line}` : `host ${name}: setup ${phase}`);
    deps.push({ host: name, phase, bytes, startedAt, line });
  };
  const checkCancel = (): void => {
    if (cancelled) throw new SetupFailed('cancelled');
  };
  const run = async (tool: 'ssh' | 'scp', args: readonly string[], cwd?: string): Promise<RunOutcome> => {
    checkCancel();
    const r = deps.run(tool, args, cwd === undefined ? {} : { cwd });
    killCurrent = r.kill;
    const out = await r.done;
    killCurrent = null;
    checkCancel();
    return out;
  };
  const must = async (tool: 'ssh' | 'scp', args: readonly string[], cwd?: string): Promise<RunOutcome> => {
    const out = await run(tool, args, cwd);
    if (out.code !== 0) throw new SetupFailed(out.stderrLast !== '' ? out.stderrLast : `exit ${out.code}`);
    return out;
  };

  try {
    // 1. The probe.
    push('probing');
    const refuse = (out: RunOutcome): never => {
      const line = out.stderrLast !== '' ? out.stderrLast : `exit ${out.code}`;
      deps.refused?.({ kind: line === 'Host key verification failed.' ? 'hostkey' : 'ssh', line });
      throw new SetupFailed(line);
    };
    const sh = await run('ssh', sshArgs(host, 'uname -sm; echo $HOME'));
    if (sh.code === 255) refuse(sh);
    let probe = parseShProbe(sh.code, sh.stdout);
    let second: RunOutcome | null = null;
    if (probe === null) {
      second = await run('ssh', sshArgs(host, '$env:PROCESSOR_ARCHITECTURE; $HOME'));
      if (second.code === 255) refuse(second);
      probe = parsePowerShellProbe(second.code, second.stdout);
    }
    if (probe === null) {
      const why = (second?.stderrLast ?? '') || sh.stderrLast || 'no output';
      throw new SetupFailed(`${name} answered neither probe: ${why}`);
    }
    const record: HostRecord = { ...recordOf(host), os: probe.os, arch: probe.arch, shell: probe.shell, home: probe.home };
    await deps.setRecord(record);
    if (probe.os === 'linux') throw new SetupFailed(`${name} runs Linux, and a pane there waits for a Linux build of emerald.`);
    if (probe.arch !== 'x64' && probe.arch !== 'arm64') throw new SetupFailed(`${name} runs ${probe.os} on ${probe.arch}, and the kit has no build for it.`);
    const os = probe.os as KitOs;
    const arch = probe.arch as KitArch;
    const h: KitPlace = { home: probe.home, shell: probe.shell, nodeVersion: KIT_NODE_VERSION, kitVersion: deps.appVersion };
    const remoteHome = remoteHomeOf(h);

    // 2. The copy.
    push('copying');
    await must('ssh', sshArgs(host, mkdirCommand(h, remoteHome)));
    const check = await must('ssh', sshArgs(host, nodeCheckCommand(h, KIT_NODE_VERSION)));
    const needNode = !probeLines(check.stdout).includes('True');
    let kit: AssembledKit;
    try {
      kit = await deps.kit(os, arch);
    } catch (err) {
      throw new SetupFailed((err as Error).message);
    }
    checkCancel();
    bytes = fs.statSync(kit.emeraldArchive).size + (needNode ? fs.statSync(kit.nodeArchive).size : 0);
    push('copying');
    const copied = needNode ? [kit.nodeArchive, kit.emeraldArchive] : [kit.emeraldArchive];
    for (const archive of copied) {
      const scp = scpArgs(host, archive);
      await must('scp', scp.args, scp.cwd);
    }

    // 3. The unpack, then the hooks.
    push('unpacking');
    if (needNode) {
      const nodeDir = nodeDirOf(h, KIT_NODE_VERSION);
      await must('ssh', sshArgs(host, mkdirCommand(h, nodeDir)));
      await must('ssh', sshArgs(host, untarCommand(h, remoteFile(h, remoteHome, path.basename(kit.nodeArchive)), nodeDir)));
    }
    const kitDir = kitDirOf(h, deps.appVersion);
    await must('ssh', sshArgs(host, mkdirCommand(h, kitDir)));
    const emeraldUntar = sshArgs(host, untarCommand(h, remoteFile(h, remoteHome, path.basename(kit.emeraldArchive)), kitDir));
    for (let tries = 1; ; tries++) {
      const out = await run('ssh', emeraldUntar);
      if (out.code === 0) break;
      if (tries >= UNPACK_TRIES) throw new SetupFailed(out.stderrLast !== '' ? out.stderrLast : `exit ${out.code}`);
      deps.log(`host ${name}: unpack failed (exit ${out.code}): ${out.stderrLast}; trying again in ${UNPACK_RETRY_MS / 1000} s`);
      await (deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(UNPACK_RETRY_MS);
    }
    for (const archive of copied) await must('ssh', sshArgs(host, removeCommand(h, remoteFile(h, remoteHome, path.basename(archive)))));
    // A shell pane needs no hooks, and the mod the daemon passes with
    // --plugin-dir carries a hosted Claude's, so a failed install is logged
    // and the setup goes on; an ssh that could not run it at all (255) ends it.
    const hooks = await run('ssh', sshArgs(host, kitCliCommand(h, ['hooks', 'install', '--home', remoteHome])));
    if (hooks.code === 255) throw new SetupFailed(hooks.stderrLast !== '' ? hooks.stderrLast : 'exit 255');
    if (hooks.code !== 0) deps.log(`host ${name}: hooks install failed (exit ${hooks.code}): ${hooks.stderrLast}`);

    // 4. The start: the relay starts the host's daemon.
    push('starting');
    const withKit: HostRecord = { ...record, kitVersion: deps.appVersion, nodeVersion: KIT_NODE_VERSION, kitStage: kit.manifest.emerald.stage };
    let daemon: DaemonInfo;
    try {
      daemon = await deps.connect(withKit);
    } catch (err) {
      const r = err as ConnectRefusal;
      throw new SetupFailed(r.kind === 'nokit' ? `${name} still has no kit after the copy: ${r.message}` : r.message);
    }
    checkCancel();
    await deps.setRecord(withKit);
    push('done');
    return { ok: true, daemon };
  } catch (err) {
    const line = err instanceof SetupFailed ? err.message : `${(err as Error).message}`;
    push('failed', line);
    return { ok: false, line };
  }
}

const pruned = new Set<string>();

// The old kit's removal: once per daemon a host runs (its pid and start
// time), at the first connect whose daemon is the record's kit (a Windows
// host holds a running daemon's pty.node open, and an app update leaves the
// old kit's daemon serving the pipe until it restarts, M9 fix 1165's
// Restart). Never changes a phase.
export async function pruneOldKits(host: RemoteHost, daemon: DaemonInfo, deps: { run: RemoteRunner; log: (msg: string) => void }): Promise<boolean> {
  if (host.kitVersion === undefined || host.home === undefined || host.shell === undefined || daemon.version !== host.kitVersion) return false;
  const key = `${host.name}\0${daemon.pid}\0${daemon.startedAt ?? ''}`;
  if (pruned.has(key)) return false;
  pruned.add(key);
  const nodeVersion = host.nodeVersion ?? KIT_NODE_VERSION;
  const h: KitPlace = { home: host.home, shell: host.shell, nodeVersion, kitVersion: host.kitVersion };
  const out = await deps.run('ssh', sshArgs(host, pruneCommand(h, host.kitVersion, nodeVersion))).done;
  if (out.code === 0) deps.log(`host ${host.name}: old kits removed`);
  else deps.log(`host ${host.name}: old kit removal failed (exit ${out.code}): ${out.stderrLast}`);
  return true;
}

// For the test: forget which hosts were pruned this run.
export function resetPruned(): void {
  pruned.clear();
}
