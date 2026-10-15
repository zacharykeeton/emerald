import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { BrowserAnswer, Layout } from '@emerald/shared';
import { currentTab, listPanes } from '@emerald/shared';
import { JsonLinesDecoder, encodeJsonLine } from '@emerald/shared/jsonlines';
import { CliError, EXIT } from '../cli-error.ts';
import { captureOutput } from '../command.ts';
import { runBrowser } from './browser.ts';

// A fake emmerd on a private pipe (M9 fix 672), in the shape of
// open.test.ts: hello at a chosen level, the session list, a layout, and
// browser.run answered with a chosen reply, recording what was asked.
const PIPE = `\\\\.\\pipe\\emmerd-test-browser-${process.pid}`;
const OWN = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BROWSER_PANE = 'bbbbbbbb-1111-4111-8111-111111111111';
const OWN_PANE = 'aaaaaaaa-1111-4111-8111-111111111111';

let level = 63;
let runReply: unknown = { apps: 1, drivers: 1, answered: true, answer: { ok: true, text: 'page "x" http://127.0.0.1:9/' } };
let layout: Layout;
const runs: Array<Record<string, unknown>> = [];
const sets: Layout[] = [];
let server: net.Server;
const sockets = new Set<net.Socket>();

function freshLayout(withBrowser: boolean): Layout {
  const own = { kind: 'pane' as const, id: OWN_PANE, sessionId: OWN, view: null };
  const root = withBrowser
    ? { kind: 'split' as const, id: 'split-1', direction: 'row' as const, ratio: 0.5, first: own, second: { kind: 'pane' as const, id: BROWSER_PANE, sessionId: null, view: { kind: 'browser' as const, url: 'http://127.0.0.1:9/' } } }
    : own;
  return { tabs: [{ id: 'tab-1', name: 'main', root, focusedPaneId: OWN_PANE }], currentTabId: 'tab-1', revision: 4 };
}

before(async () => {
  process.env['EMERALD_PIPE'] = PIPE;
  server = net.createServer((sock) => {
    sockets.add(sock);
    const decoder = new JsonLinesDecoder();
    sock.on('data', (chunk: Buffer) => {
      for (const raw of decoder.push(chunk)) {
        const msg = raw as { id?: number; type: string } & Record<string, unknown>;
        const reply = (result: unknown) => sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result }));
        if (msg.type === 'hello') reply({ daemonPid: 1, daemonVersion: 'fake', featureLevel: level });
        else if (msg.type === 'session.list') reply({ sessions: [{ id: OWN, name: 'alpha', state: 'idle' }] });
        else if (msg.type === 'layout.get') reply({ layout });
        else if (msg.type === 'layout.set') {
          sets.push(msg['layout'] as Layout);
          reply({ layout: msg['layout'] });
        } else if (msg.type === 'browser.run') {
          const { id: _id, type: _type, ...rest } = msg;
          runs.push(rest);
          reply(runReply);
        } else sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: false, error: { code: 'bad-request', message: `fake daemon does not do ${msg.type}` } }));
      }
    });
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => sockets.delete(sock));
  });
  await new Promise<void>((resolve) => server.listen(PIPE, resolve));
});

after(() => {
  for (const sock of sockets) sock.destroy();
  server.close();
});

beforeEach(() => {
  level = 63;
  layout = freshLayout(true);
  runs.length = 0;
  sets.length = 0;
  process.env['EMERALD_SESSION_ID'] = OWN;
  runReply = { apps: 1, drivers: 1, answered: true, answer: { ok: true, text: 'page "x" http://127.0.0.1:9/' } };
});

function answered(answer: BrowserAnswer): unknown {
  return { apps: 1, drivers: 1, answered: true, answer };
}

async function capture(run: () => Promise<number>): Promise<{ code: number; out: string }> {
  let out = '';
  const restore = captureOutput((text) => {
    out += text;
  });
  try {
    return { code: await run(), out };
  } finally {
    restore();
  }
}

async function failure(run: Promise<unknown>): Promise<CliError> {
  try {
    await run;
  } catch (err) {
    assert.ok(err instanceof CliError, `a CliError, got ${String(err)}`);
    return err;
  }
  assert.fail('expected the command to fail');
}

test('a snapshot asks for the one browser pane with the caller\'s name and the default budget, and prints the text', async () => {
  const { code, out } = await capture(() => runBrowser(['snapshot']));
  assert.equal(code, EXIT.ok);
  assert.equal(out, 'page "x" http://127.0.0.1:9/\n');
  assert.deepEqual(runs, [{ paneId: BROWSER_PANE, verb: 'snapshot', args: [], by: 'alpha', timeoutMs: 10000 }]);
});

test('--json prints the answer with the pane and the tab, on a refusal too with its exit code', async () => {
  let r = await capture(() => runBrowser(['snapshot', '--json']));
  assert.equal(r.code, EXIT.ok);
  assert.deepEqual(JSON.parse(r.out), { pane: BROWSER_PANE, tab: 'main', verb: 'snapshot', ok: true, text: 'page "x" http://127.0.0.1:9/' });
  runReply = answered({ ok: false, reason: 'timeout', text: 'gave up after 1 s waiting for "x"' });
  r = await capture(() => runBrowser(['wait', 'x', '--timeout', '1', '--json']));
  assert.equal(r.code, EXIT.timeout);
  assert.equal(JSON.parse(r.out).reason, 'timeout');
});

test('no window, an older window, no answer and a timeout each exit with their own code', async () => {
  runReply = { apps: 0 };
  let err = await failure(runBrowser(['snapshot']));
  assert.equal(err.exitCode, EXIT.noWindow);
  assert.equal(err.message, 'no window open; open the Emerald app');
  runReply = { apps: 1, drivers: 0 };
  err = await failure(runBrowser(['snapshot']));
  assert.equal(err.exitCode, EXIT.failure);
  assert.equal(err.message, 'the window is older than emmer browser (it needs level 63); quit Emerald and open it again');
  runReply = { apps: 1, drivers: 1, answered: false };
  err = await failure(runBrowser(['snapshot']));
  assert.equal(err.exitCode, EXIT.noAnswer);
  assert.equal(err.message, 'sent to the window; it did not answer within 15 s');
  runReply = answered({ ok: false, reason: 'timeout', text: 'gave up after 3 s waiting for "x"' });
  err = await failure(runBrowser(['wait', 'x', '--timeout', '3']));
  assert.equal(err.exitCode, EXIT.timeout);
  assert.equal(err.message, 'gave up after 3 s waiting for "x"');
  assert.equal(runs.at(-1)!['timeoutMs'], 3000);
  runReply = answered({ ok: false, reason: 'failed', text: 'the page threw: Error: nope' });
  err = await failure(runBrowser(['eval', 'x']));
  assert.equal(err.exitCode, EXIT.failure);
});

test('the usage errors: --timeout out of range or on another verb, a missing text, a bad URL, an unknown verb', async () => {
  for (const [argv, message] of [
    [['wait', 'x', '--timeout', '0'], '--timeout takes 1 to 120 seconds'],
    [['snapshot', '--timeout', '3'], '--timeout is for wait and navigate'],
    [['fill', 'e1'], 'missing text'],
    [['navigate', 'example.com'], 'example.com is not a URL the browser pane opens: http://, https:// or host:port'],
    [['frob'], 'unknown verb "frob"; emmer help browser lists them'],
    [[], 'missing verb'],
  ] as const) {
    const err = await failure(runBrowser([...argv]));
    assert.equal(err.exitCode, EXIT.usage, argv.join(' '));
    assert.equal(err.message, message);
  }
  assert.deepEqual(runs, []);
});

test('anything after a bare -- is a positional, so eval -- -1 sends -1', async () => {
  await capture(() => runBrowser(['eval', '--', '-1']));
  assert.deepEqual(runs.at(-1)!['args'], ['-1']);
});

test('a daemon older than level 63 is refused for every verb, open included', async () => {
  level = 62;
  for (const argv of [['snapshot'], ['open', 'http://127.0.0.1:9/']]) {
    const err = await failure(runBrowser(argv));
    assert.match(err.message, /^emmerd fake is older than emmer browser \(level 62, needs 63\); restart it from the app's banner$/);
  }
});

// M9 fix 673: the pause, upload's file check, and --profile.
test('a paused answer is exit 77 with the line', async () => {
  runReply = answered({ ok: false, reason: 'paused', text: 'paused by the person; emmer browser resume or the Resume button on the pane' });
  const err = await failure(runBrowser(['snapshot']));
  assert.equal(err.exitCode, 77);
  assert.equal(err.message, 'paused by the person; emmer browser resume or the Resume button on the pane');
});

test('upload refuses a file that is not there before the pipe, and sends the absolute path', async () => {
  const missing = path.join(os.tmpdir(), `emmer-no-such-file-${process.pid}.txt`);
  const err = await failure(runBrowser(['upload', 'e1', missing]));
  assert.equal(err.exitCode, EXIT.failure);
  assert.equal(err.message, `no file ${missing}`);
  assert.deepEqual(runs, []);
  const file = path.join(os.tmpdir(), `emmer-upload-${process.pid}.txt`);
  fs.writeFileSync(file, 'x');
  try {
    await capture(() => runBrowser(['upload', '@e1', file]));
    assert.deepEqual(runs.at(-1)!['args'], ['@e1', file]);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('open --profile b puts the profile on the view and says so; a bad name and another verb are usage errors', async () => {
  layout = freshLayout(false);
  const { out } = await capture(() => runBrowser(['open', 'http://127.0.0.1:9/', '--profile', 'b']));
  const panes = listPanes(currentTab(sets[0]!));
  assert.deepEqual(panes[1]!.view, { kind: 'browser', url: 'http://127.0.0.1:9/', profile: 'b' });
  assert.equal(out, `opened http://127.0.0.1:9/ in pane ${panes[1]!.id.slice(0, 8)} on tab main under profile b\n`);
  let err = await failure(runBrowser(['open', 'http://127.0.0.1:9/', '--profile', 'B']));
  assert.equal(err.exitCode, EXIT.usage);
  assert.equal(err.message, '--profile takes lowercase letters, digits and hyphens, up to 32, such as b or viewer');
  err = await failure(runBrowser(['snapshot', '--profile', 'b']));
  assert.equal(err.message, '--profile is for open');
});

test('open puts a browser pane right of the caller\'s pane and leaves the focus where it was', async () => {
  layout = freshLayout(false);
  const { code, out } = await capture(() => runBrowser(['open', 'http://127.0.0.1:9/']));
  assert.equal(code, EXIT.ok);
  assert.equal(sets.length, 1);
  const tab = currentTab(sets[0]!);
  const panes = listPanes(tab);
  assert.equal(panes.length, 2);
  assert.equal(panes[0]!.id, OWN_PANE);
  assert.deepEqual(panes[1]!.view, { kind: 'browser', url: 'http://127.0.0.1:9/' });
  assert.equal(tab.focusedPaneId, OWN_PANE);
  assert.equal(sets[0]!.revision, 4);
  assert.equal(out, `opened http://127.0.0.1:9/ in pane ${panes[1]!.id.slice(0, 8)} on tab main\n`);
});
