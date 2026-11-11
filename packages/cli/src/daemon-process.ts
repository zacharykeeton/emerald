import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killTree } from '@emerald/shared/process-identity';
import { CliError } from './cli-error.ts';
import { daemonInfoPath, pipePath } from './paths.ts';

// What emmerd writes to ~/.emerald/daemon.json at startup.
export interface DaemonInfo {
  pid: number;
  pipe: string;
  // The pipe token (M9 fix 612); a daemon from before the fix writes none.
  pipeToken?: string;
  protocolVersion: number;
  version: string;
  startedAt: number;
  hookPort: number;
  hookToken: string;
}

// This file runs from packages/cli/dist (built) or packages/cli/src (tests),
// and either way the daemon's build is a sibling package away. An installed
// CLI sets EMERALD_DAEMON_MAIN or passes --daemon-path, the same override the
// app honours.
export function resolveDaemonMain(override?: string): string {
  return (
    override ??
    process.env['EMERALD_DAEMON_MAIN'] ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'daemon', 'dist', 'main.js')
  );
}

export function readDaemonInfo(): DaemonInfo | null {
  let raw: string;
  try {
    raw = fs.readFileSync(daemonInfoPath(), 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as DaemonInfo;
  } catch {
    return null;
  }
}

export function removeDaemonInfo(): void {
  try {
    fs.unlinkSync(daemonInfoPath());
  } catch {
    // Already gone.
  }
}

// True when something answers on the pipe. Cheaper than a hello and enough
// for start and stop to poll on.
export function pipeIsUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(pipePath());
    socket.once('error', () => resolve(false));
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
  });
}

export async function waitForPipe(up: boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await pipeIsUp()) === up) return true;
    await sleep(100);
  }
  return (await pipeIsUp()) === up;
}

// Same shape as the app's autostart: detached, no stdio, hidden window, so
// the daemon outlives this command and never writes to its console.
export function spawnDaemon(daemonMain: string): void {
  if (!fs.existsSync(daemonMain)) {
    throw new CliError(`emmerd is not built: ${daemonMain} is missing (run npm run build at the repo root, or set EMERALD_DAEMON_MAIN)`);
  }
  const child = spawn(process.execPath, [daemonMain], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();
}

// The relay's start (M9 fix 1079), used only by `emmer relay`, which runs
// inside an ssh session. On Windows the OpenSSH server ends whatever a
// session started when the session ends, a detached spawn included, but a
// process made through WMI's Win32_Process.Create outlives it (probed on
// wfs-db, 2026-11-05). Create passes no environment, so the home and the
// pipe go on the daemon's command line; ShowWindow 0 keeps its console off
// a desktop host's screen. Off Windows the detached spawn is a setsid,
// which a closing session does not reach. The relay's SSH_CONNECTION rides
// along too (M9 fix 1091), so a host session's Claude copies through OSC 52
// onto the clipboard of the PC it is shown on; a value holding a double
// quote (none that sshd writes) is left off rather than quoted.
export function startDaemonDetachedFromSession(daemonMain: string, home: string, pipe: string, sshConnection: string | undefined): Promise<void> {
  if (!fs.existsSync(daemonMain)) {
    return Promise.reject(new Error(`emmerd is not built: ${daemonMain} is missing`));
  }
  const ssh = sshConnection !== undefined && sshConnection !== '' && !sshConnection.includes('"') ? sshConnection : null;
  if (process.platform !== 'win32') {
    const child = spawn(process.execPath, [daemonMain, '--home', home, '--pipe', pipe, ...(ssh === null ? [] : ['--ssh-connection', ssh])], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
    return Promise.resolve();
  }
  const line = `"${process.execPath}" "${daemonMain}" --home "${home}" --pipe "${pipe}"${ssh === null ? '' : ` --ssh-connection "${ssh}"`}`.replace(/'/g, "''");
  const script =
    `$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }; ` +
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${line}'; ProcessStartupInformation = $si }; ` +
    `exit $r.ReturnValue`;
  return new Promise((resolve, reject) => {
    // -EncodedCommand rather than -Command: the line holds double quotes,
    // which Node's argument quoting and PowerShell's own parse would each
    // have to agree on; base64 of UTF-16LE crosses untouched.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`WMI Create returned ${code}`));
    });
  });
}

// Node's process.kill on Windows is TerminateProcess, which never runs the
// daemon's shutdown handler, and the shells it spawned would linger as
// orphans. taskkill /t takes the whole tree the way the verify scripts do;
// off Windows killTree reads the tree through ps (M9 fix 1016).
export function killProcessTree(pid: number): void {
  const err = killTree(pid);
  if (err !== null) throw new CliError(`${process.platform === 'win32' ? 'taskkill' : 'kill'} failed: ${err}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
