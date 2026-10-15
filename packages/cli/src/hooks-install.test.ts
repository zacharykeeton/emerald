import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { fileURLToPath } from 'node:url';
import {
  HOOK_EVENTS,
  HOOK_TIMEOUT_SECONDS,
  hookCommand,
  hooksStatus,
  installHooks,
  skillPaths,
  skillText,
  statusLinePaths,
  statusLineVersion,
  uninstallHooks,
} from './hooks-install.ts';

const scriptSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'claude-hook.cmd');

// A settings file shaped like the real one on this machine: Orca's hooks on
// some of the same events, a matcher on the tool events, and unrelated keys.
const ORCA = 'C:/Users/Someone/.orca/agent-hooks/claude-hook.cmd || echo {}';
function orcaSettings(): Record<string, unknown> {
  const plain = () => [{ hooks: [{ type: 'command', command: ORCA, timeout: 10 }] }];
  const matched = () => [{ matcher: '*', hooks: [{ type: 'command', command: ORCA, timeout: 10 }] }];
  return {
    permissions: { allow: ['mcp__pencil'] },
    model: 'claude-fable-5-1[1m]',
    hooks: {
      SessionStart: plain(),
      UserPromptSubmit: plain(),
      Stop: plain(),
      TeammateIdle: plain(),
      PreToolUse: matched(),
      PostToolUse: matched(),
      PermissionRequest: matched(),
    },
    statusLine: { type: 'command', command: 'something long' },
    voiceEnabled: true,
  };
}

function setup(initial: Record<string, unknown> | string | null, prefix = 'emerald-hooks-install-') {
  const dir = mkTemp(prefix);
  const settingsPath = path.join(dir, 'claude', 'settings.json');
  if (initial !== null) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, typeof initial === 'string' ? initial : JSON.stringify(initial, null, 2) + '\n');
  }
  const scriptDest = path.join(dir, 'emerald', 'hooks', 'claude-hook.cmd');
  return { opts: { settingsPath, scriptDest, scriptSource, nodePath: process.execPath }, settingsPath, scriptDest, dir };
}

test.after(removeTemps);

const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
const hooksOf = (s: Record<string, unknown>) => s['hooks'] as Record<string, Array<{ matcher?: string; hooks: Array<{ command: string; timeout: number; type: string }> }>>;

test('install adds one command hook per event and leaves everything else alone', () => {
  const { opts, settingsPath, scriptDest } = setup(orcaSettings());
  const { changed } = installHooks(opts);
  assert.equal(changed, true);
  const after = read(settingsPath);
  const hooks = hooksOf(after);
  const ours = hookCommand(scriptDest);
  for (const event of HOOK_EVENTS) {
    const mine = hooks[event]!.flatMap((g) => g.hooks).filter((h) => h.command === ours);
    assert.equal(mine.length, 1, `${event} has exactly one emerald hook`);
    assert.deepEqual(mine[0], { type: 'command', command: ours, timeout: HOOK_TIMEOUT_SECONDS });
  }
  // Orca's entries are untouched, including the ones on events we also use.
  const original = hooksOf(orcaSettings());
  for (const event of Object.keys(original)) {
    const orcaEntries = hooks[event]!.filter((g) => g.hooks.some((h) => h.command === ORCA));
    assert.deepEqual(orcaEntries, original[event], `${event} keeps Orca's group as it was`);
  }
  assert.deepEqual(hooks['TeammateIdle'], original['TeammateIdle'], 'an event we do not use is untouched');
  // Unrelated keys survive; the status line is ours now, with Orca's kept
  // beside the wrapper for it to run and for uninstall to put back.
  const { hooks: _h, statusLine, ...rest } = after;
  const { hooks: _o, statusLine: orcaStatusLine, ...restOriginal } = orcaSettings();
  assert.deepEqual(rest, restOriginal);
  const sl = statusLinePaths(opts);
  assert.deepEqual(statusLine, { type: 'command', command: hookCommand(sl.cmdDest) });
  assert.deepEqual(read(sl.previous), { statusLine: orcaStatusLine });
  assert.ok(fs.existsSync(sl.jsDest), 'the status line script is beside the wrapper');
  const wrapper = fs.readFileSync(sl.cmdDest, 'utf8');
  assert.ok(wrapper.includes(`"${process.execPath}" "%~dp0claude-statusline.js"`), 'the wrapper runs the script on the Node given');
  assert.ok(!wrapper.includes('__EMERALD_NODE__'));
  // The script is in place with CRLF endings and nothing on stdout.
  const script = fs.readFileSync(scriptDest, 'utf8');
  assert.ok(script.startsWith('@echo off\r\n'));
  assert.ok(!script.includes('\n\n'), 'no stray blank lines');
  assert.ok(!/\becho\b(?! off)/.test(script), 'the script never writes to stdout');
  assert.ok(script.includes('X-Emerald-Token: %EMERALD_HOOK_TOKEN%'));
  assert.ok(fs.existsSync(`${settingsPath}.emerald-bak`), 'a backup of the previous settings was kept');
  assert.deepEqual(read(`${settingsPath}.emerald-bak`), orcaSettings());
});

test('install is idempotent', () => {
  const { opts, settingsPath } = setup(orcaSettings());
  installHooks(opts);
  const once = fs.readFileSync(settingsPath, 'utf8');
  const { changed } = installHooks(opts);
  assert.equal(changed, false);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), once);
});

test('a second install that only reorders keys writes nothing (M9 fix 614)', () => {
  const { opts, settingsPath, scriptDest } = setup({});
  const recordPath = path.join(path.dirname(scriptDest), 'settings-written.json');
  const key = path.resolve(settingsPath).toLowerCase();
  const writes = () => (read(recordPath) as Record<string, { writes: number[] }>)[key]!.writes.length;
  assert.equal(installHooks(opts).changed, true);
  const bytes = fs.readFileSync(settingsPath, 'utf8');
  const backup = fs.readFileSync(`${settingsPath}.emerald-bak`, 'utf8');
  for (let i = 0; i < 2; i++) {
    assert.equal(installHooks(opts).changed, false, `install ${i + 2} changes nothing`);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), bytes, 'the settings bytes are kept');
    assert.equal(fs.readFileSync(`${settingsPath}.emerald-bak`, 'utf8'), backup, 'and so is the backup');
  }
  assert.equal(writes(), 1, 'the record holds one write');
});

test('install repairs a hand-edited or older emerald entry instead of adding a second one', () => {
  const { opts, settingsPath, scriptDest } = setup(orcaSettings());
  installHooks(opts);
  const edited = read(settingsPath);
  const hooks = hooksOf(edited);
  // An older version used a different timeout and an event we dropped.
  hooks['Stop']!.find((g) => g.hooks[0]!.command === hookCommand(scriptDest))!.hooks[0]!.timeout = 60;
  hooks['SomeOldEvent'] = [{ hooks: [{ type: 'command', command: hookCommand(scriptDest), timeout: 5 }] }];
  fs.writeFileSync(settingsPath, JSON.stringify(edited, null, 2));
  const { changed } = installHooks(opts);
  assert.equal(changed, true);
  const repaired = hooksOf(read(settingsPath));
  assert.equal(repaired['Stop']!.filter((g) => g.hooks[0]!.command === hookCommand(scriptDest)).length, 1);
  assert.equal(repaired['Stop']!.find((g) => g.hooks[0]!.command === hookCommand(scriptDest))!.hooks[0]!.timeout, HOOK_TIMEOUT_SECONDS);
  assert.equal(repaired['SomeOldEvent'], undefined);
});

test('uninstall restores the original file, the previous status line included, and removes the scripts', () => {
  const { opts, settingsPath, scriptDest } = setup(orcaSettings());
  installHooks(opts);
  assert.ok(fs.existsSync(scriptDest));
  const sl = statusLinePaths(opts);
  const { changed } = uninstallHooks(opts);
  assert.equal(changed, true);
  assert.deepEqual(read(settingsPath), orcaSettings());
  for (const f of [scriptDest, sl.cmdDest, sl.jsDest, sl.previous]) assert.ok(!fs.existsSync(f), `${path.basename(f)} removed`);
  assert.equal(uninstallHooks(opts).changed, false, 'a second uninstall is a no-op');
});

test('install lands the emmer-cli skill beside the settings file, status watches it, uninstall takes it away', () => {
  const { opts, settingsPath } = setup(orcaSettings());
  const { dest, source } = skillPaths(opts);
  assert.equal(dest, path.join(path.dirname(settingsPath), 'skills', 'emmer-cli', 'SKILL.md'), 'the skill sits in the skills folder next to settings.json');
  assert.match(fs.readFileSync(source, 'utf8'), /^---\nname: emmer-cli\n/, 'the shipped skill has the frontmatter Claude Code expects');
  assert.equal(skillText(opts), fs.readFileSync(source, 'utf8'), 'emmer skill prints the shipped text');
  installHooks(opts);
  assert.equal(fs.readFileSync(dest, 'utf8'), fs.readFileSync(source, 'utf8'), 'installed as shipped');
  assert.equal(hooksStatus(opts).skill, true);
  // Another skill in the same folder is none of our business.
  fs.mkdirSync(path.join(path.dirname(dest), '..', 'other-skill'));
  fs.appendFileSync(dest, '\nedited by hand\n');
  assert.equal(hooksStatus(opts).skill, false, 'an edited or older copy counts as missing, so the banner offers a reinstall');
  installHooks(opts);
  assert.equal(hooksStatus(opts).skill, true, 'a reinstall brings the shipped text back');
  uninstallHooks(opts);
  assert.ok(!fs.existsSync(dest), 'skill file removed');
  assert.ok(!fs.existsSync(path.dirname(dest)), 'its folder removed');
  assert.ok(fs.existsSync(path.join(path.dirname(dest), '..', 'other-skill')), 'the skills folder and the other skill stay');
  assert.equal(hooksStatus(opts).skill, false);
});

test('a second install keeps the status line that was there first; a changed one is kept anew', () => {
  const { opts, settingsPath } = setup(orcaSettings());
  installHooks(opts);
  const sl = statusLinePaths(opts);
  installHooks(opts);
  assert.deepEqual(read(sl.previous), { statusLine: orcaSettings()['statusLine'] }, 'ours in the slot does not replace the kept one');
  // The user set their own again after ours: that is the one to run and restore now.
  const edited = read(settingsPath);
  edited['statusLine'] = { type: 'command', command: 'newer thing', padding: 0 };
  fs.writeFileSync(settingsPath, JSON.stringify(edited));
  installHooks(opts);
  assert.deepEqual(read(sl.previous), { statusLine: { type: 'command', command: 'newer thing', padding: 0 } });
  uninstallHooks(opts);
  assert.deepEqual(read(settingsPath)['statusLine'], { type: 'command', command: 'newer thing', padding: 0 });
});

test('install on a missing or empty settings file creates it; uninstall then removes the hooks key', () => {
  for (const initial of [null, '', '{}']) {
    const { opts, settingsPath } = setup(initial);
    installHooks(opts);
    const after = read(settingsPath);
    assert.deepEqual(Object.keys(after), ['hooks', 'statusLine']);
    assert.deepEqual(Object.keys(hooksOf(after)).sort(), [...HOOK_EVENTS].sort());
    assert.deepEqual(read(statusLinePaths(opts).previous), { statusLine: null }, 'nothing was there before');
    uninstallHooks(opts);
    assert.deepEqual(read(settingsPath), {});
  }
});

test('a settings file that is not valid JSON is never rewritten', () => {
  const { opts, settingsPath } = setup('{ "hooks": ');
  assert.throws(() => installHooks(opts), SyntaxError);
  assert.throws(() => uninstallHooks(opts), SyntaxError);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ "hooks": ');
  const arr = setup('[1, 2]');
  assert.throws(() => installHooks(arr.opts), /not a JSON object/);
});

test('a group mixing our hook with someone else\'s keeps theirs', () => {
  const { opts, settingsPath, scriptDest } = setup({});
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'theirs.cmd' }, { type: 'command', command: hookCommand(scriptDest), timeout: 5 }] }],
      },
    }),
  );
  uninstallHooks(opts);
  assert.deepEqual(read(settingsPath), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'theirs.cmd' }] }] } });
});

test('status reports installed and missing events and the script state', () => {
  const { opts, settingsPath, scriptDest } = setup(orcaSettings());
  const shipped = statusLineVersion(statusLinePaths(opts).jsSource);
  assert.equal(shipped, 4, 'the shipped status line script declares its version');
  // Orca's command names an absolute path that is on no box, so each of
  // its seven events reads as a stranger's dead entry (M9 fix 710); the
  // status line `something long` is a bare word and is never judged.
  const orcaDead = ['SessionStart', 'UserPromptSubmit', 'Stop', 'TeammateIdle', 'PreToolUse', 'PostToolUse', 'PermissionRequest'].map((event) => ({
    event,
    command: ORCA,
    path: 'C:/Users/Someone/.orca/agent-hooks/claude-hook.cmd',
    ours: false,
  }));
  let status = hooksStatus(opts);
  assert.deepEqual(status, {
    installed: [],
    missing: [...HOOK_EVENTS],
    scriptPresent: false,
    scriptStale: false,
    statusLine: false,
    statusLineVersion: null,
    shippedStatusLineVersion: 4,
    skill: false,
    fighting: false,
    dead: orcaDead,
  });
  installHooks(opts);
  status = hooksStatus(opts);
  assert.deepEqual(status, {
    installed: [...HOOK_EVENTS],
    missing: [],
    scriptPresent: true,
    scriptStale: false,
    statusLine: true,
    statusLineVersion: 4,
    shippedStatusLineVersion: 4,
    skill: true,
    fighting: false,
    dead: orcaDead,
  });
  // M9 fix 233: the hook wrapper is rendered for the installer's Node like
  // the status line's, and since fix 580 posts with curl and runs no node.
  const sl = statusLinePaths(opts);
  const hookCmd = fs.readFileSync(scriptDest, 'utf8');
  assert.ok(!hookCmd.includes('claude-hook.js') && hookCmd.includes('X-Emerald-Unhosted: 1'), 'the hook wrapper posts unhosted with curl and runs no node');
  assert.ok(!hookCmd.includes('__EMERALD_NODE__'));
  // An install from before M16 has the hook script but no status line files.
  fs.unlinkSync(sl.cmdDest);
  assert.equal(hooksStatus(opts).scriptStale, true, 'missing status line files count as stale');
  installHooks(opts);
  assert.equal(hooksStatus(opts).scriptStale, false);
  // An install from before M34 has a status line script with no version
  // line; it reads as none and counts as stale.
  fs.writeFileSync(sl.jsDest, fs.readFileSync(sl.jsDest, 'utf8').replace(/^const STATUS_LINE_VERSION = \d+;\r?\n/m, ''));
  status = hooksStatus(opts);
  assert.equal(status.statusLineVersion, null);
  assert.equal(status.scriptStale, true);
  installHooks(opts);
  assert.equal(hooksStatus(opts).statusLineVersion, 4);
  // A wrapper rendered for another Node is stale too, and a status line
  // pointing elsewhere is not ours.
  assert.equal(hooksStatus({ ...opts, nodePath: 'C:\\elsewhere\\node.exe' }).scriptStale, true);
  const other = read(settingsPath);
  other['statusLine'] = { type: 'command', command: 'theirs' };
  fs.writeFileSync(settingsPath, JSON.stringify(other));
  assert.equal(hooksStatus(opts).statusLine, false);
  // Someone removed one event by hand and edited the script.
  const edited = read(settingsPath);
  delete hooksOf(edited)['CwdChanged'];
  fs.writeFileSync(settingsPath, JSON.stringify(edited));
  fs.appendFileSync(scriptDest, 'rem edited\r\n');
  status = hooksStatus(opts);
  assert.deepEqual(status.missing, ['CwdChanged']);
  assert.equal(status.scriptStale, true);
  // Paths are matched case-insensitively, Windows style.
  const upper = { ...opts, scriptDest: opts.scriptDest.toUpperCase() };
  assert.equal(hooksStatus(upper).missing.length, 1);
});

test('hookCommand quotes a forward-slash path', () => {
  assert.equal(hookCommand('C:\\Users\\Some One\\.emerald\\hooks\\claude-hook.cmd'), '"C:/Users/Some One/.emerald/hooks/claude-hook.cmd"');
});

// Runs the installed wrapper the way Claude Code would, with the status
// line JSON on stdin and the PTY's emerald variables in the environment.
// Asynchronous, since the fake sink lives in this process and a spawnSync
// would keep it from answering. The home is setup's emerald folder, which
// holds no daemon.json, so a run with no session never posts to the daemon
// of the person running the suite (M9 fix 597: the status line runs at
// :350 and :504 posted the claude-9 fixture to the live daemon twice a
// run); a caller's env still names its own. The path goes in doubled
// quotes: /s strips the outer pair and leaves the quoted path, so a folder
// with a space runs (M9 fix 598).
function runWrapper(cmdDest: string, input: string, env: Record<string, string>): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', `""${cmdDest}""`], {
      env: { ...process.env, EMERALD_SESSION_ID: '', EMERALD_HOOK_PORT: '', EMERALD_HOOK_TOKEN: '', EMERALD_HOME: path.dirname(path.dirname(cmdDest)), ...env },
      windowsVerbatimArguments: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (status) => resolve({ stdout, stderr, status }));
    child.stdin.end(input);
  });
}

test('the installed wrapper posts a StatusLine event to the sink and passes the previous status line through', async () => {
  const { opts, dir } = setup({});
  // The previous status line: a script that reads the JSON and answers with
  // the model, and exits 7, so both the output and the code can be seen to
  // pass through.
  const prev = path.join(dir, 'prev.cmd');
  fs.writeFileSync(
    prev,
    `@echo off\r\n"${process.execPath}" -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write('prev saw '+JSON.parse(d).model.display_name))"\r\nexit /b 7\r\n`,
  );
  const settings = read(opts.settingsPath);
  settings['statusLine'] = { type: 'command', command: `"${prev.replace(/\\/g, '/')}"` };
  fs.writeFileSync(opts.settingsPath, JSON.stringify(settings));
  installHooks(opts);
  const sl = statusLinePaths(opts);

  const posts: Array<{ headers: http.IncomingHttpHeaders; body: unknown }> = [];
  const sink = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      posts.push({ headers: req.headers, body: JSON.parse(body) });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve));
  const port = (sink.address() as { port: number }).port;
  try {
    const json = JSON.stringify({ session_id: 'claude-9', model: { id: 'claude-fable-5-1', display_name: 'Fable' }, context_window: { used_percentage: 41.6 } });
    const run = await runWrapper(sl.cmdDest, json, { EMERALD_SESSION_ID: 'emerald-1', EMERALD_HOOK_PORT: String(port), EMERALD_HOOK_TOKEN: 'tok' });
    assert.equal(run.stdout, 'prev saw Fable', `the previous status line's output passed through (stderr: ${run.stderr})`);
    assert.equal(run.status, 7, 'and so did its exit code');
    assert.equal(posts.length, 1, 'one post to the sink');
    assert.equal(posts[0]!.headers['x-emerald-session'], 'emerald-1');
    assert.equal(posts[0]!.headers['x-emerald-token'], 'tok');
    assert.deepEqual(posts[0]!.body, { ...JSON.parse(json), hook_event_name: 'StatusLine' });

    // Outside an emerald session nothing is posted and the previous line still runs.
    const plain = await runWrapper(sl.cmdDest, json, {});
    assert.equal(plain.stdout, 'prev saw Fable');
    assert.equal(posts.length, 1);

    // A sink that is not there costs nothing but the timeout, and without a
    // previous status line the wrapper prints nothing and exits 0.
    fs.writeFileSync(sl.previous, JSON.stringify({ statusLine: null }));
    const alone = await runWrapper(sl.cmdDest, json, { EMERALD_SESSION_ID: 'emerald-1', EMERALD_HOOK_PORT: '1', EMERALD_HOOK_TOKEN: 'tok' });
    assert.equal(alone.stdout, '');
    assert.equal(alone.status, 0);
  } finally {
    sink.close();
  }
});

// A sink that records every post, for the wrapper runs below; requests
// keeps each one's headers and raw body beside the parsed one.
async function fakeSink(): Promise<{ port: number; posts: unknown[]; requests: Array<{ headers: http.IncomingHttpHeaders; body: string }>; close: () => void }> {
  const posts: unknown[] = [];
  const requests: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  const sink = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ headers: req.headers, body });
      posts.push(JSON.parse(body));
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve));
  return { port: (sink.address() as { port: number }).port, posts, requests, close: () => sink.close() };
}

// Orca's status line is a bash one-liner. Under cmd.exe it cannot parse
// (`-z was unexpected at this time`), so the wrapper runs it under the Git
// Bash Claude Code would have used, and the output and exit code come back.
const BASH_PREVIOUS = 'if [ -z "${NOPE-}" ]; then read -r line; printf "bash saw %s" "${line:0:1}"; exit 5; fi';
const STATUS_JSON = JSON.stringify({ session_id: 'claude-9', model: { id: 'claude-fable-5-1', display_name: 'Fable' }, context_window: { used_percentage: 41.6 } });

test('the wrapper runs a bash one-liner as the previous status line under bash, after the post', async () => {
  const { opts } = setup({ statusLine: { type: 'command', command: BASH_PREVIOUS } });
  installHooks(opts);
  const sl = statusLinePaths(opts);
  const sink = await fakeSink();
  try {
    const run = await runWrapper(sl.cmdDest, STATUS_JSON, { EMERALD_SESSION_ID: 'emerald-1', EMERALD_HOOK_PORT: String(sink.port), EMERALD_HOOK_TOKEN: 'tok' });
    assert.equal(run.stdout, 'bash saw {', `the one-liner ran under bash and read the JSON (stderr: ${run.stderr})`);
    assert.equal(run.status, 5, 'and its exit code came back');
    assert.equal(sink.posts.length, 1, 'the post landed');
    // CLAUDE_CODE_GIT_BASH_PATH names the bash to use, as it does for Claude Code.
    const named = await runWrapper(sl.cmdDest, STATUS_JSON, { CLAUDE_CODE_GIT_BASH_PATH: 'C:\\nowhere\\bash.exe', EMERALD_SESSION_ID: 'emerald-1', EMERALD_HOOK_PORT: String(sink.port), EMERALD_HOOK_TOKEN: 'tok' });
    assert.equal(named.stdout, 'bash saw {', 'a named bash that is not there falls back to the one beside git');
    assert.equal(sink.posts.length, 2);
  } finally {
    sink.close();
  }
});

// The installed app runs the wrapper under its own Emerald.exe as node, and
// that is where the post used to starve while a broken previous command
// ran beside it. EMERALD_EXE names the exe, else the install on this box;
// skipped when neither is there.
test('the wrapper posts under the packaged Emerald.exe as node with a bash previous command', async (t) => {
  const exe = process.env['EMERALD_EXE'] ?? path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'emerald', 'Emerald.exe');
  if (!fs.existsSync(exe)) {
    t.skip(`no Emerald.exe at ${exe}`);
    return;
  }
  const { opts } = setup({ statusLine: { type: 'command', command: BASH_PREVIOUS } });
  installHooks({ ...opts, nodePath: exe });
  const sl = statusLinePaths(opts);
  assert.ok(fs.readFileSync(sl.cmdDest, 'utf8').includes(`"${exe}"`), 'the wrapper runs on the exe');
  const sink = await fakeSink();
  try {
    const run = await runWrapper(sl.cmdDest, STATUS_JSON, { EMERALD_SESSION_ID: 'emerald-1', EMERALD_HOOK_PORT: String(sink.port), EMERALD_HOOK_TOKEN: 'tok' });
    assert.equal(sink.posts.length, 1, `the post landed under ${path.basename(exe)} (stderr: ${run.stderr})`);
    assert.equal(run.stdout, 'bash saw {');
    assert.equal(run.status, 5);
  } finally {
    sink.close();
  }
});

// A Claude outside emerald runs the hook for every event. With no
// daemon.json under its home there is nothing to post to (M9 fix 467, the
// ledger's M17); with one, the .cmd reads the port and token off it and
// posts with curl itself (M9 fix 580). The Node the installer names here
// is a stand-in that leaves a mark, so the test reads whether node ran
// rather than a time. The install and the home both sit in folders with a
// space and parentheses (M9 fix 598), as under a profile whose name has a
// space.
test('the hook of a Claude outside emerald posts with curl and never runs node (M9 fixes 467, 580)', async () => {
  const { opts, dir } = setup({}, 'emerald hooks (580) ');
  const mark = path.join(dir, 'node-ran');
  const standIn = path.join(dir, 'stand-in-node.cmd');
  fs.writeFileSync(standIn, `@echo off\r\necho ran> "${mark}"\r\nexit /b 0\r\n`);
  installHooks({ ...opts, nodePath: standIn });
  const home = path.join(dir, 'home (x) y');
  fs.mkdirSync(home);
  const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'conv-580', prompt: 'a "quoted" & spaced prompt' });
  const sink = await fakeSink();
  try {
    const none = await runWrapper(opts.scriptDest, payload, { EMERALD_HOME: home });
    assert.equal(none.status, 0);
    assert.equal(sink.requests.length, 0, 'no daemon.json, no post');
    // The daemon's own shape (packages/daemon/src/main.ts writes daemon.json
    // so): two-space indent, one key per line, LF endings.
    const record = { pid: 1, pipe: '\\\\.\\pipe\\x', protocolVersion: 1, version: '0', startedAt: 1, hookPort: sink.port, hookToken: 'ab'.repeat(24) };
    const daemonJson = path.join(home, 'daemon.json');
    fs.writeFileSync(daemonJson, JSON.stringify(record, null, 2) + '\n');
    const some = await runWrapper(opts.scriptDest, payload, { EMERALD_HOME: home });
    assert.equal(some.status, 0);
    assert.equal(sink.requests.length, 1, `one post with a daemon.json (stderr: ${some.stderr})`);
    const got = sink.requests[0]!;
    assert.equal(got.headers['x-emerald-unhosted'], '1');
    assert.equal(got.headers['x-emerald-session'], undefined, 'no session header: the daemon reads the body');
    assert.equal(got.headers['x-emerald-token'], 'ab'.repeat(24));
    assert.equal(got.headers['x-emerald-hook'], opts.scriptDest);
    assert.equal(got.body, payload);
    // A record missing either key, or written on one line, posts nothing.
    const { hookToken: _t, ...noToken } = record;
    const { hookPort: _p, ...noPort } = record;
    for (const text of [JSON.stringify(noToken, null, 2) + '\n', JSON.stringify(noPort, null, 2) + '\n', JSON.stringify(record)]) {
      fs.writeFileSync(daemonJson, text);
      const run = await runWrapper(opts.scriptDest, payload, { EMERALD_HOME: home });
      assert.equal(run.status, 0);
    }
    assert.equal(sink.requests.length, 1, 'no further post from a record the .cmd cannot read');
    assert.equal(fs.existsSync(mark), false, 'node never ran');
  } finally {
    sink.close();
  }
});

// The status line runs that name no session and no home must not find a
// daemon.json under the profile of whoever runs the suite.
test('a status line run with no session and no home posts nowhere, whatever the profile holds (M9 fix 597)', async () => {
  const { opts, dir } = setup({});
  installHooks(opts);
  const sl = statusLinePaths(opts);
  const sink = await fakeSink();
  try {
    const profile = path.join(dir, 'profile');
    fs.mkdirSync(path.join(profile, '.emerald'), { recursive: true });
    const record = { pid: 1, pipe: '\\\\.\\pipe\\x', protocolVersion: 1, version: '0', startedAt: 1, hookPort: sink.port, hookToken: 'ab'.repeat(24) };
    fs.writeFileSync(path.join(profile, '.emerald', 'daemon.json'), JSON.stringify(record, null, 2) + '\n');
    const run = await runWrapper(sl.cmdDest, STATUS_JSON, { USERPROFILE: profile });
    assert.equal(run.status, 0, `the wrapper exits 0 (stderr: ${run.stderr})`);
    assert.equal(sink.requests.length, 0, 'no post reached the daemon the profile names');
  } finally {
    sink.close();
  }
});

// The status line takes the unhosted post itself since M9 fix 599: the headers name the status line script.
test('the status line of a Claude outside emerald posts StatusLine off daemon.json (M9 fix 599)', async () => {
  const { opts, dir } = setup({}, 'emerald hooks (599) ');
  installHooks(opts);
  const sl = statusLinePaths(opts);
  const home = path.join(dir, 'home (599)');
  fs.mkdirSync(home);
  const sink = await fakeSink();
  try {
    const record = { pid: 1, pipe: '\\\\.\\pipe\\x', protocolVersion: 1, version: '0', startedAt: 1, hookPort: sink.port, hookToken: 'cd'.repeat(24) };
    fs.writeFileSync(path.join(home, 'daemon.json'), JSON.stringify(record, null, 2) + '\n');
    const run = await runWrapper(sl.cmdDest, STATUS_JSON, { EMERALD_HOME: home });
    assert.equal(run.status, 0, `the wrapper exits 0 (stderr: ${run.stderr})`);
    assert.equal(run.stdout, '', 'no previous status line, so nothing printed');
    assert.equal(sink.requests.length, 1, 'one post');
    const got = sink.requests[0]!;
    assert.equal(got.headers['x-emerald-unhosted'], '1');
    assert.equal(got.headers['x-emerald-session'], 'claude-9');
    assert.equal(got.headers['x-emerald-token'], 'cd'.repeat(24));
    assert.equal(got.headers['x-emerald-hook'], sl.jsDest);
    assert.deepEqual(JSON.parse(got.body), { ...JSON.parse(STATUS_JSON), hook_event_name: 'StatusLine' });
  } finally {
    sink.close();
  }
});

// emerald's own entries spelled with backslashes, as a hand edit or another
// tool may write them, are emerald's (M9 fix 468, the ledger's M19).
test('a backslash-spelled entry of the same install is replaced, and a backslash status line of ours is not kept as previous (M9 fix 468)', async () => {
  const { opts, settingsPath, scriptDest } = setup(orcaSettings());
  installHooks(opts);
  const sl = statusLinePaths(opts);
  const edited = read(settingsPath);
  const backslashed = (p: string) => `"${p.replace(/\//g, '\\')}"`;
  hooksOf(edited)['Stop']!.find((g) => g.hooks[0]!.command === hookCommand(scriptDest))!.hooks[0]!.command = backslashed(scriptDest);
  edited['statusLine'] = { type: 'command', command: backslashed(sl.cmdDest) };
  fs.writeFileSync(settingsPath, JSON.stringify(edited, null, 2));
  installHooks(opts);
  const after = read(settingsPath);
  const stops = hooksOf(after)['Stop']!.filter((g) => g.hooks.some((h) => h.command.toLowerCase().replace(/\\/g, '/').includes(scriptDest.toLowerCase().replace(/\\/g, '/'))));
  assert.equal(stops.length, 1, 'the Stop hook is not doubled');
  assert.equal(stops[0]!.hooks[0]!.command, hookCommand(scriptDest), 'and it is back in the installed spelling');
  assert.deepEqual(read(sl.previous), { statusLine: orcaSettings()['statusLine'] }, 'the kept previous is still the user\'s');
  // A previous status line that is the wrapper itself runs nothing: the
  // wrapper answers at once rather than starting itself again.
  fs.writeFileSync(sl.previous, JSON.stringify({ statusLine: { type: 'command', command: backslashed(sl.cmdDest) } }));
  const run = await runWrapper(sl.cmdDest, STATUS_JSON, {});
  assert.equal(run.status, 0);
  assert.equal(run.stdout, '');
});

// An editor's UTF-8 with signature (L23): the install used to refuse the
// file at JSON.parse.
test('a settings file with a BOM installs and keeps its BOM (M9 fix 468)', () => {
  const bom = String.fromCharCode(0xfeff);
  const { opts, settingsPath } = setup(bom + JSON.stringify(orcaSettings(), null, 2) + '\n');
  installHooks(opts);
  const raw = fs.readFileSync(settingsPath, 'utf8');
  assert.ok(raw.startsWith(bom), 'the BOM is kept');
  const after = JSON.parse(raw.slice(1)) as Record<string, unknown>;
  for (const event of HOOK_EVENTS) assert.ok(hooksOf(after)[event], `${event} installed`);
  assert.equal(installHooks(opts).changed, false, 'a second install reads it as installed');
  uninstallHooks(opts);
  const back = fs.readFileSync(settingsPath, 'utf8');
  assert.ok(back.startsWith(bom));
  assert.deepEqual(JSON.parse(back.slice(1)), orcaSettings());
});

test('install records what it wrote, and status says fighting past three installs a minute with the file rewritten since (M9 fix 606)', () => {
  const { opts, settingsPath, scriptDest } = setup({});
  const recordPath = path.join(path.dirname(scriptDest), 'settings-written.json');
  const key = path.resolve(settingsPath).toLowerCase();
  const hashOf = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const record = () => read(recordPath) as Record<string, { sha256: string; writes: number[] }>;
  installHooks(opts);
  assert.deepEqual(Object.keys(record()), [key], 'the record is keyed by the settings path resolved and lowercased');
  assert.equal(record()[key]!.sha256, hashOf(settingsPath), 'the hash is of the bytes written');
  assert.equal(record()[key]!.writes.length, 1);
  assert.equal(hooksStatus(opts).fighting, false);
  // Two more rounds of the hooks taken out and put back: three installs,
  // but the file is still the bytes we wrote.
  for (let i = 0; i < 2; i++) {
    fs.writeFileSync(settingsPath, '{}\n');
    installHooks(opts);
  }
  assert.equal(record()[key]!.writes.length, 3);
  assert.equal(hooksStatus(opts).fighting, false, 'three installs and the file is ours');
  const ours = fs.readFileSync(settingsPath, 'utf8');
  fs.writeFileSync(settingsPath, '{"x":1}\n');
  assert.equal(hooksStatus(opts).fighting, true, 'three installs and the file rewritten since');
  // Writes older than the window no longer count.
  const old = record();
  old[key]!.writes = old[key]!.writes.map(() => Date.now() - 61_000);
  fs.writeFileSync(recordPath, JSON.stringify(old));
  assert.equal(hooksStatus(opts).fighting, false, 'the installs aged out of the window');
  // An uninstall is recorded as a write but not counted as an install.
  fs.writeFileSync(settingsPath, ours);
  const writesBefore = record()[key]!.writes;
  uninstallHooks(opts);
  assert.equal(record()[key]!.sha256, hashOf(settingsPath), 'the uninstall records its bytes');
  assert.deepEqual(record()[key]!.writes, writesBefore.filter((t) => Date.now() - t <= 60_000), 'and adds no install');
  // An install that changes nothing writes nothing and records nothing;
  // fix 614's test does the same from a bare {}.
  const orca = setup(orcaSettings());
  const orcaRecord = path.join(path.dirname(orca.scriptDest), 'settings-written.json');
  const orcaKey = path.resolve(orca.settingsPath).toLowerCase();
  installHooks(orca.opts);
  const count = (read(orcaRecord) as Record<string, { writes: number[] }>)[orcaKey]!.writes.length;
  assert.equal(installHooks(orca.opts).changed, false);
  assert.equal((read(orcaRecord) as Record<string, { writes: number[] }>)[orcaKey]!.writes.length, count, 'an install that changes nothing adds no write');
});

test('status names dead entries and install takes out ours alone (M9 fix 710)', () => {
  const { opts, settingsPath, dir } = setup(null);
  installHooks(opts);
  const fwd = dir.split(path.sep).join('/');
  const oldHook = hookCommand(path.join(dir, 'old-home', 'hooks', 'claude-hook.cmd'));
  const stranger = `"${fwd}/Some Tool/hook.cmd" --flag`;
  const liveFile = path.join(dir, 'live-tool', 'hook.cmd');
  fs.mkdirSync(path.dirname(liveFile), { recursive: true });
  fs.writeFileSync(liveFile, 'exit 0');
  const live = hookCommand(liveFile);
  const s = read(settingsPath);
  const hooks = hooksOf(s);
  hooks['Stop']!.push({ hooks: [{ type: 'command', command: oldHook, timeout: 5 }] });
  hooks['SessionStart']!.push({ hooks: [{ type: 'command', command: oldHook, timeout: 5 }] });
  hooks['Stop']!.push({ hooks: [{ type: 'command', command: stranger, timeout: 5 }] });
  hooks['Notification']!.push({ hooks: [{ type: 'command', command: 'node -e 1', timeout: 5 }] });
  hooks['Notification']!.push({ hooks: [{ type: 'command', command: 'hooks/claude-hook.cmd', timeout: 5 }] });
  hooks['PreCompact']!.push({ hooks: [{ type: 'command', command: live, timeout: 5 }] });
  s['statusLine'] = { type: 'command', command: hookCommand(path.join(dir, 'old-home', 'hooks', 'claude-statusline.cmd')) };
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));

  const dead = hooksStatus(opts).dead;
  assert.equal(dead.length, 4, JSON.stringify(dead));
  assert.deepEqual(
    dead.map((d) => `${d.event} ${d.ours}`).sort(),
    ['SessionStart true', 'Stop false', 'Stop true', 'statusLine true'].sort(),
  );
  const theirs = dead.find((d) => !d.ours)!;
  assert.ok(theirs.path.endsWith('/Some Tool/hook.cmd'), theirs.path);
  assert.equal(theirs.command, stranger);

  const { removed } = installHooks(opts);
  assert.equal(removed.length, 3, 'the two hooks and the status line of the old home');
  assert.ok(!fs.readFileSync(settingsPath, 'utf8').includes('old-home'), 'no command of the old home is left');
  const after = hooksOf(read(settingsPath));
  const commands = (event: string) => after[event]!.flatMap((g) => g.hooks).map((h) => h.command);
  assert.ok(commands('Stop').includes(stranger), "the stranger's dead entry stays");
  assert.ok(commands('Notification').includes('node -e 1') && commands('Notification').includes('hooks/claude-hook.cmd'), 'bare and relative commands are never judged');
  assert.ok(commands('PreCompact').includes(live), 'a live absolute command stays');
  assert.deepEqual(read(statusLinePaths(opts).previous), { statusLine: null }, 'a dead status line of ours is not kept as previous');
  assert.deepEqual(hooksStatus(opts).dead, [{ event: 'Stop', command: stranger, path: `${fwd}/Some Tool/hook.cmd`, ours: false }]);
});

test('an install over a dead status line of ours keeps the previous one an earlier install kept (M9 fix 710)', () => {
  const { opts, settingsPath, dir } = setup(null);
  installHooks(opts);
  const previous = statusLinePaths(opts).previous;
  fs.writeFileSync(previous, JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }));
  const s = read(settingsPath);
  s['statusLine'] = { type: 'command', command: hookCommand(path.join(dir, 'old-home', 'hooks', 'claude-statusline.cmd')) };
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
  installHooks(opts);
  assert.deepEqual(read(previous), { statusLine: { type: 'command', command: 'mine' } });
  assert.equal(hooksStatus(opts).statusLine, true);
});
