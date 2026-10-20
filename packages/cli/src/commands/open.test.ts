import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { CliError, EXIT } from '../cli-error.ts';
import { JsonLinesDecoder, encodeJsonLine } from '@emerald/shared/jsonlines';
import { captureOutput } from '../command.ts';
import { runOpen } from './open.ts';

// A fake emmerd on a private pipe (M9 fix 341): answers hello at a
// chosen level and file.open with a chosen window count, recording what
// it was asked, so the command is driven without a window.
const PIPE = `\\\\.\\pipe\\emmerd-test-open-${process.pid}`;

let level = 53;
let apps = 1;
// What the fake window answered about the scheme (M9 fix 375); undefined
// is a window that never answered, the daemon's deadline.
let known: boolean | undefined;
// Whether the fake window answered at all (M9 fix 582); undefined is a
// daemon or a window older than level 58, which never says.
let answered: boolean | undefined;
// Whether the fake window found the session's pane (M9 fix 376).
let besideFound: boolean | undefined;
// Which of the session's panes the fake window picked (M9 fix 404);
// undefined is a window older than the fix, which names neither.
let besidePane: string | undefined;
let besideTab: string | undefined;
// The sessions the fake daemon lists, for --beside's resolve.
const listed = [
  { id: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'alpha', state: 'idle' },
  { id: '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'beta', state: 'working' },
];
const asked: Array<{ path: string; pane: boolean; scheme?: string | null; beside?: string; url?: boolean; browser?: boolean }> = [];
let server: net.Server;
const sockets = new Set<net.Socket>();

before(async () => {
  process.env['EMERALD_PIPE'] = PIPE;
  server = net.createServer((sock) => {
    sockets.add(sock);
    const decoder = new JsonLinesDecoder();
    sock.on('data', (chunk: Buffer) => {
      for (const raw of decoder.push(chunk)) {
        const msg = raw as { id?: number; type: string; path?: string; pane?: boolean; scheme?: string | null; beside?: string; url?: boolean; browser?: boolean };
        const reply = (result: unknown) => sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result }));
        if (msg.type === 'hello') reply({ daemonPid: 1, daemonVersion: 'fake', featureLevel: level });
        else if (msg.type === 'session.list') reply({ sessions: listed });
        else if (msg.type === 'file.open') {
          asked.push({ path: msg.path ?? '', pane: msg.pane === true, ...(msg.scheme === undefined ? {} : { scheme: msg.scheme }), ...(msg.beside === undefined ? {} : { beside: msg.beside }), ...(msg.url === undefined ? {} : { url: msg.url }), ...(msg.browser === undefined ? {} : { browser: msg.browser }) });
          reply({
            apps,
            ...(msg.scheme === undefined || known === undefined ? {} : { known }),
            ...(msg.beside === undefined || besideFound === undefined ? {} : { besideFound }),
            ...(msg.beside === undefined || besidePane === undefined ? {} : { besidePane }),
            ...(msg.beside === undefined || besideTab === undefined ? {} : { besideTab }),
            ...(answered === undefined ? {} : { answered }),
          });
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

// The lines println wrote, for the stdout reads.
function captureStdout(): { out: string[]; restore: () => void } {
  const out: string[] = [];
  const restore = captureOutput((text) => {
    out.push(text.replace(/\n$/, ''));
  });
  return { out, restore };
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

test('emmer open sends the absolute path and the pane flag, and exits 0 with a window', async () => {
  level = 53;
  apps = 2;
  asked.length = 0;
  assert.equal(await runOpen(['notes.md']), EXIT.ok);
  assert.equal(await runOpen(['C:\\a\\b.json', '--pane']), EXIT.ok);
  assert.deepEqual(asked, [
    { path: path.resolve('notes.md'), pane: false },
    { path: 'C:\\a\\b.json', pane: true },
  ]);
});

test('with no window on the app topic the exit is 69 and says so', async () => {
  level = 53;
  apps = 0;
  const err = await failure(runOpen(['notes.md']));
  assert.equal(err.exitCode, EXIT.noWindow);
  assert.equal(err.message, 'no window open; open the Emerald app');
});

// M9 fix 582: a window at level 58 that did not answer within 3 s is one
// line on stderr and exit 75, nothing on stdout; --json carries answered
// always, null when the daemon or the window is older and never says.
test('a window that did not answer is one line and exit 75, and --json says answered (M9 fix 582)', async () => {
  level = 58;
  apps = 1;
  answered = false;
  try {
    let lines = captureStdout();
    let err: CliError;
    try {
      err = await failure(runOpen(['notes.md']));
    } finally {
      lines.restore();
    }
    assert.equal(err.exitCode, EXIT.noAnswer);
    assert.equal(err.message, 'sent to the window; it did not answer within 3 s');
    assert.deepEqual(lines.out, []);

    lines = captureStdout();
    try {
      assert.equal(await runOpen(['notes.md', '--json']), EXIT.noAnswer);
    } finally {
      lines.restore();
    }
    assert.equal(JSON.parse(lines.out.join('\n')).answered, false);

    answered = true;
    lines = captureStdout();
    try {
      assert.equal(await runOpen(['notes.md']), EXIT.ok);
    } finally {
      lines.restore();
    }
    assert.deepEqual(lines.out, [`opened ${path.resolve('notes.md')}`]);
    lines = captureStdout();
    try {
      assert.equal(await runOpen(['notes.md', '--json']), EXIT.ok);
    } finally {
      lines.restore();
    }
    assert.equal(JSON.parse(lines.out.join('\n')).answered, true);

    answered = undefined;
    lines = captureStdout();
    try {
      assert.equal(await runOpen(['notes.md', '--json']), EXIT.ok);
    } finally {
      lines.restore();
    }
    assert.equal(JSON.parse(lines.out.join('\n')).answered, null);
  } finally {
    answered = undefined;
  }
});

test('a daemon before level 53 is refused with the usual word', async () => {
  level = 52;
  apps = 1;
  const err = await failure(runOpen(['notes.md']));
  assert.equal(err.exitCode, EXIT.failure);
  assert.match(err.message, /older than emmer open \(level 52, needs 53\)/);
});

// M9 fix 375: --scheme rides the request as the trimmed name and
// --clear-scheme as null; a daemon before level 55 is refused for those
// two alone, in the same words; the window's `known: false` becomes one
// line on stdout after the opened line, and nothing when it knew the
// name or did not answer.
test('--scheme and --clear-scheme ride file.open, and an unknown name is said (M9 fix 375)', async () => {
  level = 55;
  apps = 1;
  asked.length = 0;
  known = true;
  const lines = captureStdout();
  try {
    assert.equal(await runOpen(['C:\\a\\b.md', '--scheme', ' Dracula ']), EXIT.ok);
    assert.equal(await runOpen(['C:\\a\\b.md', '--pane', '--clear-scheme']), EXIT.ok);
    known = false;
    assert.equal(await runOpen(['C:\\a\\b.md', '--scheme', 'nosuch']), EXIT.ok);
    known = undefined;
    assert.equal(await runOpen(['C:\\a\\b.md', '--scheme', 'quiet']), EXIT.ok);
  } finally {
    lines.restore();
  }
  assert.deepEqual(asked, [
    { path: 'C:\\a\\b.md', pane: false, scheme: 'Dracula' },
    { path: 'C:\\a\\b.md', pane: true, scheme: null },
    { path: 'C:\\a\\b.md', pane: false, scheme: 'nosuch' },
    { path: 'C:\\a\\b.md', pane: false, scheme: 'quiet' },
  ]);
  assert.deepEqual(lines.out, [
    'opened C:\\a\\b.md in Dracula',
    'opened C:\\a\\b.md in a pane, its own scheme cleared',
    'opened C:\\a\\b.md in nosuch',
    "nosuch is not among the window's schemes (see the file menu); the pick is kept and shows no colour",
    'opened C:\\a\\b.md in quiet',
  ]);
});

test('a daemon at level 54 takes a plain open and refuses --scheme with the usual word (M9 fix 375)', async () => {
  level = 54;
  apps = 1;
  asked.length = 0;
  const lines = captureStdout();
  try {
    assert.equal(await runOpen(['notes.md']), EXIT.ok);
  } finally {
    lines.restore();
  }
  assert.equal(asked.length, 1);
  const err = await failure(runOpen(['notes.md', '--scheme', 'Dracula']));
  assert.equal(err.exitCode, EXIT.failure);
  assert.match(err.message, /older than emmer open --scheme \(level 54, needs 55\)/);
  const cleared = await failure(runOpen(['notes.md', '--clear-scheme']));
  assert.match(cleared.message, /needs 55/);
  const both = await failure(runOpen(['notes.md', '--scheme', 'x', '--clear-scheme']));
  assert.equal(both.exitCode, EXIT.usage);
  const empty = await failure(runOpen(['notes.md', '--scheme', ' ']));
  assert.equal(empty.exitCode, EXIT.usage);
});

// M9 fix 376: --beside <session> resolves the name or prefix against the
// daemon's list and rides file.open as the id with pane on; a bare
// --beside is the session the command runs in (EMERALD_SESSION_ID), and
// outside emerald that is a usage error in emmer set's words; the
// window's `besideFound: false` becomes one line after the opened
// line; a daemon before 55 refuses it.
test('--beside rides file.open as the session id with pane implied, and a session on no pane is said (M9 fix 376)', async () => {
  level = 55;
  apps = 1;
  asked.length = 0;
  besideFound = true;
  // A window older than fix 404 names no pane, so these lines are the
  // ones the command printed before it: the fallback, still read here.
  besidePane = undefined;
  besideTab = undefined;
  const lines = captureStdout();
  const own = process.env['EMERALD_SESSION_ID'];
  try {
    assert.equal(await runOpen(['C:\\a\\b.md', '--beside', 'beta']), EXIT.ok);
    assert.equal(await runOpen(['C:\\a\\b.md', '--beside', '1111', '--scheme', 'Dracula']), EXIT.ok);
    process.env['EMERALD_SESSION_ID'] = listed[1]!.id;
    assert.equal(await runOpen(['C:\\a\\b.md', '--beside']), EXIT.ok);
    assert.equal(await runOpen(['C:\\a\\b.md', '--beside', '--json']), EXIT.ok);
    delete process.env['EMERALD_SESSION_ID'];
    besideFound = false;
    assert.equal(await runOpen(['C:\\a\\b.md', '--beside', 'alpha']), EXIT.ok);
    const outside = await failure(runOpen(['C:\\a\\b.md', '--beside']));
    assert.equal(outside.exitCode, EXIT.usage);
    assert.match(outside.message, /not inside emerald/);
    const none = await failure(runOpen(['C:\\a\\b.md', '--beside', 'gamma']));
    assert.match(none.message, /no session matches "gamma"/);
  } finally {
    lines.restore();
    if (own === undefined) delete process.env['EMERALD_SESSION_ID'];
    else process.env['EMERALD_SESSION_ID'] = own;
  }
  assert.deepEqual(asked, [
    { path: 'C:\\a\\b.md', pane: true, beside: listed[1]!.id },
    { path: 'C:\\a\\b.md', pane: true, scheme: 'Dracula', beside: listed[0]!.id },
    { path: 'C:\\a\\b.md', pane: true, beside: listed[1]!.id },
    { path: 'C:\\a\\b.md', pane: true, beside: listed[1]!.id },
    { path: 'C:\\a\\b.md', pane: true, beside: listed[0]!.id },
  ]);
  const json = JSON.parse(lines.out[3]!) as { pane: boolean; beside: string; besideFound: boolean };
  assert.deepEqual([json.pane, json.beside, json.besideFound], [true, listed[1]!.id, true]);
  assert.deepEqual([lines.out[0], lines.out[1], lines.out[2], lines.out[4], lines.out[5]], [
    'opened C:\\a\\b.md beside beta (22222222)',
    'opened C:\\a\\b.md beside alpha (11111111) in Dracula',
    'opened C:\\a\\b.md beside beta (22222222)',
    'opened C:\\a\\b.md in a pane',
    'alpha (11111111) is on no pane; opened beside the focused pane',
  ]);
  level = 54;
  const old = await failure(runOpen(['C:\\a\\b.md', '--beside', 'beta']));
  assert.match(old.message, /older than emmer open --beside \(level 54, needs 55\)/);
});

// M9 fix 404: a session can be on several panes, so the window says
// which one it picked and the reply names it, --json carrying the pane
// id and the tab name. A window that names a pane and no tab (or
// neither) says as much as it can.
test('--beside names the pane and the tab the window picked (M9 fix 404)', async () => {
  level = 55;
  apps = 1;
  asked.length = 0;
  besideFound = true;
  besidePane = 'pane-7';
  besideTab = 'Two';
  const lines = captureStdout();
  try {
    assert.equal(await runOpen(['C:\\a\\b.md', '--beside', 'beta']), EXIT.ok);
    assert.equal(await runOpen(['C:\\a\\b.md', '--beside', 'beta', '--json']), EXIT.ok);
    besideTab = undefined;
    assert.equal(await runOpen(['C:\\a\\b.md', '--beside', 'beta']), EXIT.ok);
    // On no pane the file went beside the focused one, so there is no
    // pick to name however much the window sent.
    besideTab = 'Two';
    besideFound = false;
    assert.equal(await runOpen(['C:\\a\\b.md', '--beside', 'alpha']), EXIT.ok);
  } finally {
    lines.restore();
    besidePane = undefined;
    besideTab = undefined;
  }
  const json = JSON.parse(lines.out[1]!) as { besidePane: string; besideTab: string; besideFound: boolean };
  assert.deepEqual([json.besidePane, json.besideTab, json.besideFound], ['pane-7', 'Two', true]);
  assert.deepEqual([lines.out[0], lines.out[2], lines.out[3], lines.out[4]], [
    'opened C:\\a\\b.md beside beta (22222222) in pane pane-7 on tab Two',
    'opened C:\\a\\b.md beside beta (22222222) in pane pane-7',
    'opened C:\\a\\b.md in a pane',
    'alpha (11111111) is on no pane; opened beside the focused pane',
  ]);
});

test('the path is required', async () => {
  level = 53;
  const err = await failure(runOpen([]));
  assert.equal(err.exitCode, EXIT.usage);
});

// M9 fix 659: a URL is a page for a browser pane, in a pane always, sent
// as browserUrl writes it with url set; a daemon before level 62 is
// refused, and a scheme or a URL the pane cannot take is a usage error.
test('a URL rides file.open as a page in a pane with url set (M9 fix 659)', async () => {
  level = 62;
  apps = 1;
  answered = undefined;
  besideFound = true;
  besidePane = undefined;
  besideTab = undefined;
  asked.length = 0;
  const lines = captureStdout();
  try {
    assert.equal(await runOpen(['localhost:3000']), EXIT.ok);
    assert.equal(await runOpen(['https://example.com/a', '--pane']), EXIT.ok);
    assert.equal(await runOpen(['127.0.0.1:5173', '--beside', 'beta']), EXIT.ok);
    assert.equal(await runOpen(['notes.md']), EXIT.ok);
  } finally {
    lines.restore();
  }
  assert.deepEqual(asked, [
    { path: 'http://localhost:3000/', pane: true, url: true },
    { path: 'https://example.com/a', pane: true, url: true },
    { path: 'http://127.0.0.1:5173/', pane: true, beside: listed[1]!.id, url: true },
    { path: path.resolve('notes.md'), pane: false },
  ]);
  assert.equal(lines.out[0], 'opened http://localhost:3000/ in a pane');
});

test('a URL needs level 62, takes no scheme and must be one the pane opens (M9 fix 659)', async () => {
  level = 61;
  apps = 1;
  asked.length = 0;
  const old = await failure(runOpen(['localhost:3000']));
  assert.match(old.message, /older than emmer open <url> \(level 61, needs 62\); restart it from the app's banner/);
  level = 62;
  const scheme = await failure(runOpen(['localhost:3000', '--scheme', 'x']));
  assert.equal(scheme.exitCode, EXIT.usage);
  assert.equal(scheme.message, '--scheme and --clear-scheme are for a file, not a URL');
  const clear = await failure(runOpen(['http://localhost:3000', '--clear-scheme']));
  assert.equal(clear.exitCode, EXIT.usage);
  const bad = await failure(runOpen(['https://a b']));
  assert.equal(bad.exitCode, EXIT.usage);
  assert.equal(bad.message, 'https://a b is not a URL the browser pane opens: http://, https:// or host:port');
  assert.deepEqual(asked, []);
});

// M9 fix 936: --browser sends an .html path with browser set, in a pane
// always; the window renders it from the rail's folder or the file's own.
test('--browser rides file.open as an .html path in a pane with browser set (M9 fix 936)', async () => {
  level = 75;
  apps = 1;
  answered = undefined;
  besideFound = true;
  besidePane = undefined;
  besideTab = undefined;
  asked.length = 0;
  const lines = captureStdout();
  try {
    assert.equal(await runOpen(['site/page.html', '--browser']), EXIT.ok);
    assert.equal(await runOpen(['C:\\x\\Index.HTM', '--browser', '--beside', 'beta']), EXIT.ok);
  } finally {
    lines.restore();
  }
  assert.deepEqual(asked, [
    { path: path.resolve('site/page.html'), pane: true, browser: true },
    { path: 'C:\\x\\Index.HTM', pane: true, beside: listed[1]!.id, browser: true },
  ]);
  assert.equal(lines.out[0], `opened ${path.resolve('site/page.html')} in a pane`);
});

test('--browser needs level 75 and an .html file, takes no URL or scheme, and an emerald-file: URL is refused (M9 fix 936)', async () => {
  level = 74;
  apps = 1;
  asked.length = 0;
  const old = await failure(runOpen(['page.html', '--browser']));
  assert.match(old.message, /older than emmer open --browser \(level 74, needs 75\); restart it from the app's banner/);
  level = 75;
  for (const [argv, message] of [
    [['notes.md', '--browser'], '--browser opens an .html or .htm file; got "notes.md"'],
    [['localhost:3000', '--browser'], '--browser is for an .html or .htm file; a URL opens in a browser pane without it'],
    [['page.html', '--browser', '--scheme', 'x'], '--scheme and --clear-scheme are for a file tab, not --browser'],
    [['emerald-file://abc/page.html'], "an emerald-file: URL is the window's own; give the page's path with --browser"],
  ] as const) {
    const err = await failure(runOpen([...argv]));
    assert.equal(err.exitCode, EXIT.usage, argv.join(' '));
    assert.equal(err.message, message);
  }
  assert.deepEqual(asked, []);
});
