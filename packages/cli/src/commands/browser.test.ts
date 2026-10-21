import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { BrowserAnswer, Layout } from '@emerald/shared';
import { currentTab, listPanes } from '@emerald/shared';
import { JsonLinesDecoder, encodeJsonLine } from '@emerald/shared/jsonlines';
import { stdinText } from '../args.ts';
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

// openedBy (M9 fix 969) puts an opener on the browser pane's view.
function freshLayout(withBrowser: boolean, openedBy?: string): Layout {
  const own = { kind: 'pane' as const, id: OWN_PANE, sessionId: OWN, view: null };
  const view = { kind: 'browser' as const, url: 'http://127.0.0.1:9/', ...(openedBy === undefined ? {} : { openedBy }) };
  const root = withBrowser
    ? { kind: 'split' as const, id: 'split-1', direction: 'row' as const, ratio: 0.5, first: own, second: { kind: 'pane' as const, id: BROWSER_PANE, sessionId: null, view } }
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
    [['snapshot', '--stdin'], '--stdin is for fill and eval'],
    [['click', 'e1', '--file', 'x'], '--file is for fill and eval'],
    [['eval', '--clear'], '--clear is for fill'],
    [['fill', 'e1', '--clear', '--stdin'], '--clear and --stdin together'],
    [['fill', 'e1', '--stdin', '--file', 'x'], '--stdin and --file together'],
    [['fill', 'e1', 'hello', '--stdin'], 'unexpected argument "hello"'],
    [['click', 'e1', '--name', 'x'], '--name is for snapshot'],
    [['click', 'e1', '--within', '@r1'], '--within is for snapshot'],
    [['snapshot', '--within', 'x'], '--within takes a ref such as @r1 or @e3'],
    [['snapshot', '--name', ''], '--name takes 1 to 200 characters'],
    [['snapshot', '--name', 'n'.repeat(201)], '--name takes 1 to 200 characters'],
  ] as const) {
    const err = await failure(runBrowser([...argv]));
    assert.equal(err.exitCode, EXIT.usage, argv.join(' '));
    assert.equal(err.message, message);
  }
  assert.deepEqual(runs, []);
});

// M9 fix 854: fill and eval take their text verbatim from --stdin or --file.
test('fill and eval read --stdin and --file verbatim, fill drops one trailing newline and eval keeps it, and an empty fill clears', async () => {
  const fed = async (input: string, argv: string[]): Promise<void> => {
    const restore = stdinText(input);
    try {
      await capture(() => runBrowser(argv));
    } finally {
      restore();
    }
  };
  await fed('a\nb "c" 100%PATH%\r\n', ['fill', 'e1', '--stdin']);
  assert.deepEqual(runs.at(-1)!['args'], ['e1', 'a\nb "c" 100%PATH%']);
  await fed('1 +\n2\n', ['eval', '--stdin']);
  assert.deepEqual(runs.at(-1)!['args'], ['1 +\n2\n']);
  await fed('', ['fill', 'e1', '--stdin']);
  assert.deepEqual(runs.at(-1)!['args'], ['e1', '']);
  await capture(() => runBrowser(['fill', 'e1', '--clear']));
  assert.deepEqual(runs.at(-1)!['args'], ['e1', '']);
  const before = runs.length;
  const restore = stdinText('');
  try {
    const err = await failure(runBrowser(['eval', '--stdin']));
    assert.equal(err.exitCode, EXIT.usage);
    assert.equal(err.message, 'the expression from --stdin is empty');
  } finally {
    restore();
  }
  assert.equal(runs.length, before);
  const file = path.join(os.tmpdir(), `emmer-eval-${process.pid}.js`);
  fs.writeFileSync(file, '﻿document.title');
  try {
    await capture(() => runBrowser(['eval', '--file', file]));
    assert.deepEqual(runs.at(-1)!['args'], ['document.title']);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('anything after a bare -- is a positional, so eval -- -1 sends -1', async () => {
  await capture(() => runBrowser(['eval', '--', '-1']));
  assert.deepEqual(runs.at(-1)!['args'], ['-1']);
});

test('drag sends a ref and a ref or dx,dy at level 72, and refuses a target of neither form (M9 fix 874)', async () => {
  level = 72;
  await capture(() => runBrowser(['drag', 'e1', 'e2']));
  assert.deepEqual(runs.at(-1)!['args'], ['e1', 'e2']);
  await capture(() => runBrowser(['drag', '@e1', '0,-60']));
  assert.deepEqual(runs.at(-1)!['args'], ['@e1', '0,-60']);
  await capture(() => runBrowser(['drag', 'e1', '--', '-20,0']));
  assert.deepEqual(runs.at(-1)!['args'], ['e1', '-20,0']);
  const sent = runs.length;
  let err = await failure(runBrowser(['drag', 'e1']));
  assert.equal(err.exitCode, EXIT.usage);
  assert.equal(err.message, 'missing target');
  err = await failure(runBrowser(['drag', 'e1', 'nowhere']));
  assert.equal(err.exitCode, EXIT.usage);
  assert.equal(err.message, 'drag goes to a ref or to dx,dy in CSS pixels, such as @e7 or 0,-40; got "nowhere"');
  assert.equal(runs.length, sent);
  level = 71;
  err = await failure(runBrowser(['drag', 'e1', 'e2']));
  assert.match(err.message, /^emmerd fake is older than emmer browser drag \(level 71, needs 72\); restart it from the app's banner$/);
  assert.equal((await capture(() => runBrowser(['snapshot']))).code, EXIT.ok);
  level = 72;
  runReply = { apps: 1, drivers: 0 };
  err = await failure(runBrowser(['drag', 'e1', 'e2']));
  assert.equal(err.message, 'the window is older than emmer browser drag (it needs level 72); quit Emerald and open it again');
});

test('drag starts at a ref or at x,y, a point needing level 74, and refuses a start of neither form (M9 fix 915)', async () => {
  level = 74;
  await capture(() => runBrowser(['drag', '120,300', '0,-60']));
  assert.deepEqual(runs.at(-1)!['args'], ['120,300', '0,-60']);
  await capture(() => runBrowser(['drag', '120.5,300', 'e2']));
  assert.deepEqual(runs.at(-1)!['args'], ['120.5,300', 'e2']);
  const sent = runs.length;
  let err = await failure(runBrowser(['drag', 'nowhere', 'e2']));
  assert.equal(err.exitCode, EXIT.usage);
  assert.equal(err.message, 'drag starts at a ref or at x,y in the page\'s CSS pixels, such as @e7 or 120,300; got "nowhere"');
  assert.equal(runs.length, sent);
  level = 73;
  err = await failure(runBrowser(['drag', '120,300', '0,-60']));
  assert.match(err.message, /^emmerd fake is older than emmer browser drag from a point \(level 73, needs 74\); restart it from the app's banner$/);
  assert.equal((await capture(() => runBrowser(['drag', 'e1', 'e2']))).code, EXIT.ok);
  level = 74;
  runReply = { apps: 1, drivers: 0 };
  err = await failure(runBrowser(['drag', '120,300', '0,-60']));
  assert.equal(err.message, 'the window is older than emmer browser drag from a point (it needs level 74); quit Emerald and open it again');
});

test('click and hover take a ref or x,y, a point needing level 75, and refuse an argument of neither form (M9 fix 935)', async () => {
  level = 75;
  await capture(() => runBrowser(['click', '120,300']));
  assert.deepEqual(runs.at(-1)!['args'], ['120,300']);
  await capture(() => runBrowser(['hover', '0.5,2']));
  assert.deepEqual(runs.at(-1)!['args'], ['0.5,2']);
  const sent = runs.length;
  let err = await failure(runBrowser(['click', 'nowhere']));
  assert.equal(err.exitCode, EXIT.usage);
  assert.equal(err.message, 'click takes a ref or x,y in the page\'s CSS pixels, such as @e7 or 120,300; got "nowhere"');
  err = await failure(runBrowser(['hover', '@r1']));
  assert.equal(err.exitCode, EXIT.usage);
  assert.equal(err.message, 'hover takes a ref or x,y in the page\'s CSS pixels, such as @e7 or 120,300; got "@r1"');
  assert.equal(runs.length, sent);
  level = 74;
  err = await failure(runBrowser(['click', '120,300']));
  assert.match(err.message, /^emmerd fake is older than emmer browser click from a point \(level 74, needs 75\); restart it from the app's banner$/);
  assert.equal((await capture(() => runBrowser(['click', 'e1']))).code, EXIT.ok);
  assert.equal((await capture(() => runBrowser(['drag', '120,300', '0,-60']))).code, EXIT.ok);
  level = 75;
  runReply = { apps: 1, drivers: 0 };
  err = await failure(runBrowser(['hover', '120,300']));
  assert.equal(err.message, 'the window is older than emmer browser hover from a point (it needs level 75); quit Emerald and open it again');
});

test('snapshot --name and --within send a filter at level 72, and a bare snapshot none (M9 fix 875)', async () => {
  level = 72;
  await capture(() => runBrowser(['snapshot', '--name', 'Save', '--within', '@r2']));
  assert.deepEqual(runs.at(-1)!['filter'], { name: 'Save', within: '@r2' });
  await capture(() => runBrowser(['snapshot']));
  assert.equal(Object.hasOwn(runs.at(-1)!, 'filter'), false);
  level = 71;
  const err = await failure(runBrowser(['snapshot', '--name', 'x']));
  assert.match(err.message, /^emmerd fake is older than emmer browser snapshot --name and --within \(level 71, needs 72\); restart it from the app's banner$/);
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

// M9 fix 970: upload --selector for a hidden file input.
test('upload --selector sends the selector in the ref\'s place at level 76, and is refused by an older daemon or window', async () => {
  const file = path.join(os.tmpdir(), `emmer-upload-sel-${process.pid}.txt`);
  fs.writeFileSync(file, 'x');
  try {
    level = 76;
    await capture(() => runBrowser(['upload', '--selector', '#hidden-up', file]));
    assert.deepEqual(runs.at(-1)!['args'], ['#hidden-up', file]);
    runs.length = 0;
    runReply = { apps: 1, drivers: 0 };
    let err = await failure(runBrowser(['upload', '--selector', '#hidden-up', file]));
    assert.equal(err.message, 'the window is older than emmer browser upload --selector (it needs level 76); quit Emerald and open it again');
    runs.length = 0;
    level = 75;
    err = await failure(runBrowser(['upload', '--selector', '#hidden-up', file]));
    assert.equal(err.message, "emmerd fake is older than emmer browser upload --selector (level 75, needs 76); restart it from the app's banner");
    assert.deepEqual(runs, []);
    level = 63;
    runReply = answered({ ok: true, text: 'set @e1 to x' });
    await capture(() => runBrowser(['upload', 'e1', file]));
    assert.deepEqual(runs.at(-1)!['args'], ['e1', file]);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('--selector on another verb, an empty or ref-shaped one, and upload with neither a ref nor --selector are usage errors', async () => {
  level = 76;
  const cases: Array<[string[], string]> = [
    [['click', 'e1', '--selector', 'x'], '--selector is for upload'],
    [['upload', '--selector', '', 'f'], '--selector takes a CSS selector, such as #file or input[type=file]'],
    [['upload', '--selector', '@e3', 'f'], '--selector takes a CSS selector, not a ref; upload @e3 <path> takes the ref'],
    [['upload', 'nowhere', 'f'], 'upload takes a ref such as @e7, or --selector <css> for a file input the snapshot does not list; got "nowhere"'],
  ];
  for (const [argv, message] of cases) {
    const err = await failure(runBrowser(argv));
    assert.equal(err.exitCode, EXIT.usage, argv.join(' '));
    assert.equal(err.message, message);
  }
  assert.deepEqual(runs, []);
});

test('open --profile b puts the profile on the view and says so; a bad name and another verb are usage errors', async () => {
  layout = freshLayout(false);
  const { out } = await capture(() => runBrowser(['open', 'http://127.0.0.1:9/', '--profile', 'b']));
  const panes = listPanes(currentTab(sets[0]!));
  assert.deepEqual(panes[1]!.view, { kind: 'browser', url: 'http://127.0.0.1:9/', profile: 'b', openedBy: OWN });
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
  assert.deepEqual(panes[1]!.view, { kind: 'browser', url: 'http://127.0.0.1:9/', openedBy: OWN });
  assert.equal(tab.focusedPaneId, OWN_PANE);
  assert.equal(sets[0]!.revision, 4);
  assert.equal(out, `opened http://127.0.0.1:9/ in pane ${panes[1]!.id.slice(0, 8)} on tab main\n`);
});

// M9 fix 969: the opener on the view, and close.
test('open from outside emerald writes a view with no opener', async () => {
  layout = freshLayout(false);
  delete process.env['EMERALD_SESSION_ID'];
  await capture(() => runBrowser(['open', 'http://127.0.0.1:9/']));
  const view = listPanes(currentTab(sets[0]!))[1]!.view;
  assert.deepEqual(view, { kind: 'browser', url: 'http://127.0.0.1:9/' });
  assert.ok(view !== null && !Object.hasOwn(view, 'openedBy'));
});

test('close puts away the browser pane this session opened, with no window and no browser.run', async () => {
  level = 76;
  layout = freshLayout(true, OWN);
  const { code, out } = await capture(() => runBrowser(['close']));
  assert.equal(code, EXIT.ok);
  assert.equal(out, 'closed pane bbbbbbbb on tab main\n');
  assert.equal(sets.length, 1);
  const tab = currentTab(sets[0]!);
  assert.deepEqual(listPanes(tab).map((p) => p.id), [OWN_PANE]);
  assert.equal(tab.focusedPaneId, OWN_PANE);
  assert.equal(sets[0]!.revision, 4);
  assert.deepEqual(runs, []);
  sets.length = 0;
  const r = await capture(() => runBrowser(['close', '--json']));
  assert.equal(r.code, EXIT.ok);
  assert.deepEqual(JSON.parse(r.out), { pane: BROWSER_PANE, tab: 'main' });
});

test('close refuses a pane the person or another session opened', async () => {
  level = 76;
  for (const opener of [undefined, '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb']) {
    layout = freshLayout(true, opener);
    const err = await failure(runBrowser(['close']));
    assert.equal(err.exitCode, EXIT.failure);
    assert.equal(err.message, 'pane bbbbbbbb was not opened by this session; the person closes it');
  }
  assert.deepEqual(sets, []);
});

test('close outside emerald, and close on a daemon older than 76, are refused', async () => {
  level = 76;
  layout = freshLayout(true, OWN);
  delete process.env['EMERALD_SESSION_ID'];
  let err = await failure(runBrowser(['close']));
  assert.equal(err.exitCode, EXIT.failure);
  assert.equal(err.message, 'close is for the session that opened the pane');
  assert.deepEqual(sets, []);
  process.env['EMERALD_SESSION_ID'] = OWN;
  level = 75;
  err = await failure(runBrowser(['close']));
  assert.equal(err.message, "emmerd fake is older than emmer browser close (level 75, needs 76); restart it from the app's banner");
  assert.deepEqual(sets, []);
});
