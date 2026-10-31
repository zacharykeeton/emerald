import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { HOOK_TEST_LEVEL, runHookTest } from './hook-test.ts';
import type { HookTestDeps } from './hook-test.ts';
import type { DaemonInfo } from './daemon-process.ts';
import { installHooks } from './hooks-install.ts';

// M9 fix 606: the Test runs the installed claude-hook.cmd for real against
// a sink of this process's own, and asks a fake pipe whether it heard it.

const scriptSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'claude-hook.cmd');

test.after(() => removeTemps());

// The .sh hook is the Mac's (M9 fix 1021); runScript runs it under sh.
function installed(ext: '.cmd' | '.sh' = '.cmd'): string {
  const dir = mkTemp('emerald-hook-test-');
  const scriptDest = path.join(dir, 'emerald', 'hooks', `claude-hook${ext}`);
  const source = path.join(path.dirname(scriptSource), `claude-hook${ext}`);
  installHooks({ settingsPath: path.join(dir, 'claude', 'settings.json'), scriptDest, scriptSource: source, nodePath: process.execPath });
  return scriptDest;
}

interface Sink {
  port: number;
  requests: Array<{ headers: http.IncomingHttpHeaders; body: string }>;
  close: () => void;
}

async function fakeSink(): Promise<Sink> {
  const requests: Sink['requests'] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ headers: req.headers, body });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as { port: number }).port, requests, close: () => server.close() };
}

function info(port: number): DaemonInfo {
  return { pid: 1, pipe: 'x', protocolVersion: 1, version: '0', startedAt: 1, hookPort: port, hookToken: 'tok606' };
}

function deps(sink: Sink | null, level: number, opts: { heard?: boolean; onConnect?: () => void } = {}): HookTestDeps {
  return {
    daemon: () => (sink === null ? null : info(sink.port)),
    connect: async () => {
      opts.onConnect?.();
      return {
        level,
        arrived: async (testId) => opts.heard ?? (sink?.requests.some((r) => (JSON.parse(r.body) as { test_id?: string }).test_id === testId) ?? false),
        close: () => {},
      };
    },
  };
}

test('a missing script is no-script and the pipe is never asked', async () => {
  let connected = false;
  const outcome = await runHookTest(path.join(mkTemp('emerald-hook-test-'), 'none.cmd'), deps(null, HOOK_TEST_LEVEL, { onConnect: () => (connected = true) }));
  assert.equal(outcome, 'no-script');
  assert.equal(connected, false);
});

test('no daemon.json, or no pipe, is no-daemon', async () => {
  const script = installed();
  assert.equal(await runHookTest(script, deps(null, HOOK_TEST_LEVEL)), 'no-daemon');
  const sink = await fakeSink();
  try {
    assert.equal(await runHookTest(script, { daemon: () => info(sink.port), connect: async () => null }), 'no-daemon');
  } finally {
    sink.close();
  }
});

test('a daemon older than the level is old-daemon and gets no post', async () => {
  const script = installed();
  const sink = await fakeSink();
  try {
    assert.equal(await runHookTest(script, deps(sink, HOOK_TEST_LEVEL - 1)), 'old-daemon');
    assert.equal(sink.requests.length, 0);
  } finally {
    sink.close();
  }
});

// It runs the .cmd under cmd.exe; the .sh test below is its mirror off Windows.
test('the Test goes through the hosted branch with the daemon.json values, overriding the environment', { skip: process.platform !== 'win32' }, async () => {
  const script = installed();
  const sink = await fakeSink();
  const saved = { id: process.env['EMERALD_SESSION_ID'], port: process.env['EMERALD_HOOK_PORT'] };
  process.env['EMERALD_SESSION_ID'] = 'leak';
  process.env['EMERALD_HOOK_PORT'] = '1';
  try {
    assert.equal(await runHookTest(script, deps(sink, HOOK_TEST_LEVEL)), 'passed');
    assert.equal(sink.requests.length, 1);
    const got = sink.requests[0]!;
    assert.equal(got.headers['x-emerald-session'], 'emerald-test');
    assert.equal(got.headers['x-emerald-token'], 'tok606');
    assert.equal(got.headers['x-emerald-unhosted'], undefined);
    assert.equal((JSON.parse(got.body) as { hook_event_name: string }).hook_event_name, 'Test');
  } finally {
    if (saved.id === undefined) delete process.env['EMERALD_SESSION_ID'];
    else process.env['EMERALD_SESSION_ID'] = saved.id;
    if (saved.port === undefined) delete process.env['EMERALD_HOOK_PORT'];
    else process.env['EMERALD_HOOK_PORT'] = saved.port;
    sink.close();
  }
});

test('the Test runs the .sh hook under sh through the hosted branch (M9 fix 1021)', { skip: process.platform === 'win32' }, async () => {
  const script = installed('.sh');
  const sink = await fakeSink();
  try {
    assert.equal(await runHookTest(script, deps(sink, HOOK_TEST_LEVEL)), 'passed');
    assert.equal(sink.requests.length, 1);
    const got = sink.requests[0]!;
    assert.equal(got.headers['x-emerald-session'], 'emerald-test');
    assert.equal(got.headers['x-emerald-token'], 'tok606');
    assert.equal(got.headers['x-emerald-hook'], script);
    assert.equal((JSON.parse(got.body) as { hook_event_name: string }).hook_event_name, 'Test');
  } finally {
    sink.close();
  }
});

test('a daemon that never heard it is not-heard', async () => {
  const script = installed();
  const sink = await fakeSink();
  try {
    assert.equal(await runHookTest(script, deps(sink, HOOK_TEST_LEVEL, { heard: false })), 'not-heard');
  } finally {
    sink.close();
  }
});
