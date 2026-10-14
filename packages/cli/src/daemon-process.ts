import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Node's process.kill on Windows is TerminateProcess, which never runs the
// daemon's shutdown handler, and the shells it spawned would linger as
// orphans. taskkill /t takes the whole tree the way the verify scripts do.
export function killProcessTree(pid: number): void {
  const result = spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  if (result.error !== undefined) throw new CliError(`taskkill failed: ${result.error.message}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
