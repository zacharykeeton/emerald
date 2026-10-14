import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { CliError } from './cli-error.ts';
import { tryConnect } from './connect.ts';
import { readDaemonInfo } from './daemon-process.ts';
import type { DaemonInfo } from './daemon-process.ts';
import { HOOK_TIMEOUT_SECONDS } from './hooks-install.ts';

// `emmer hooks status --test` (M9 fix 606): one Test event through the
// installed hook script, run the way Claude Code runs it for a session
// emerald started, then the daemon asked whether it heard it. The hook
// sends curl's output to nul and exits 0 whatever happens, so only the
// daemon can say whether the post landed.

// The daemon level that takes a Test event and answers hooks.test. An
// older sink would apply the event to an unknown session and write it to
// hooks.jsonl, so an older daemon is never sent one.
export const HOOK_TEST_LEVEL = 59;

export type HookTestOutcome = 'passed' | 'no-script' | 'no-daemon' | 'old-daemon' | 'not-heard';

export interface HookTestDeps {
  daemon(): DaemonInfo | null;
  connect(): Promise<{ level: number; arrived(testId: string): Promise<boolean>; close(): void } | null>;
}

const realDeps: HookTestDeps = {
  daemon: readDaemonInfo,
  async connect() {
    let connected;
    try {
      connected = await tryConnect();
    } catch (err) {
      if (err instanceof CliError) return null;
      throw err;
    }
    if (connected === null) return null;
    const { client, hello } = connected;
    return {
      level: hello.featureLevel ?? 1,
      arrived: async (testId) => (await client.request('hooks.test', { testId })).arrived,
      close: () => client.close(),
    };
  },
};

export async function runHookTest(scriptDest: string, deps: HookTestDeps = realDeps): Promise<HookTestOutcome> {
  if (!fs.existsSync(scriptDest)) return 'no-script';
  const info = deps.daemon();
  if (info === null || typeof info.hookPort !== 'number' || typeof info.hookToken !== 'string') return 'no-daemon';
  const conn = await deps.connect();
  if (conn === null) return 'no-daemon';
  try {
    if (conn.level < HOOK_TEST_LEVEL) return 'old-daemon';
    const testId = randomBytes(8).toString('hex');
    const payload = JSON.stringify({ hook_event_name: 'Test', session_id: 'emerald-test', test_id: testId });
    // The hosted branch, as every session emerald starts takes it: a
    // pane's three variables as the daemon stamps them, always overriding
    // any inherited ones (a dev build started from a pane carries the
    // user's own daemon's port, which would test the wrong daemon).
    const env = {
      ...process.env,
      EMERALD_SESSION_ID: 'emerald-test',
      EMERALD_HOOK_PORT: String(info.hookPort),
      EMERALD_HOOK_TOKEN: info.hookToken,
    };
    await runScript(scriptDest, payload, env);
    return (await conn.arrived(testId)) ? 'passed' : 'not-heard';
  } finally {
    conn.close();
  }
}

// The doubled quotes survive /s for a path with spaces and parentheses.
// Asynchronous, never spawnSync, so a sink in the same process can answer;
// killed after the timeout Claude Code gives the entry.
function runScript(scriptDest: string, payload: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', `""${scriptDest}""`], {
      windowsVerbatimArguments: true,
      env,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => child.kill(), HOOK_TIMEOUT_SECONDS * 1000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.on('error', done);
    child.on('close', done);
    child.stdin.on('error', () => {});
    child.stdin.end(payload);
  });
}
