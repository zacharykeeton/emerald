// M76 acceptance, the remote panes (M9 fixes 1079 to 1090): a pane whose
// session runs on another machine's daemon, reached over ssh. The host is
// a stub on this box: a second daemon on a private pair under the harness
// home (its $HOME is <home>\stub-host, its emerald home that folder's
// .emerald-remote), reached through stub-ssh.mjs and stub-scp.mjs in place
// of ssh.exe and scp.exe (EMERALD_SSH and EMERALD_SCP). No run touches the
// network or a real host. The stub's mode per destination is the JSON file
// <stub home>\stub-ssh-modes.json, rewritten by a step, since main's
// environment is fixed at launch.
//
// Block `relay` (fixes 1079 to 1081): ~/.ssh/config's host listed, a
// connect through the stub's relay with the argv's quotes intact, a shell
// started on the host routed by its id both ways, a dropped line lost and
// back with the screen replayed, the host daemon started again through
// WMI (its parent WmiPrvSE.exe), and an unknown host key refused, a host
// session's SSH_CONNECTION (fix 1091).
// Block `store` (fixes 1085 and 1086, needs relay): a reload's one list
// holds the remote row and replays its screen; a lost line reads
// unreachable on the row. Block `row` (fixes 1087 and 1088, needs relay):
// the empty pane's on row, its keys, the Start label's host, a split
// keeping the host, Add a host… and two refusals, the palette's row.
// Block `marks` (fixes 1089 and 1090, needs relay): the sidebar's host
// sections, the host chip, the Files tab's note, the lost band and Try now.
// Block `kit` (fixes 1083 and 1084, needs relay; last, since it replaces
// the stub's daemon): a first contact that copies the kit from local
// fixtures (a stage, a Node zip, a node-pty tarball) and starts the kit's
// own daemon, then a file restaged at the same version reaching the host
// through a re-setup that stops the host's daemon first (fix 1166), then
// the Linux refusal. Block restart (fix 1165, needs relay and kit, after
// kit): an older kit's daemon started through its own relay under a record
// naming this kit, read as a row of the daemon banner, its Restart bringing
// the new kit's daemon up with no lost band and the old kit removed.
// Block clip (fix 1091, needs nothing):
// a local shell's OSC 52 write on the window's held clipboard with
// its note, an OSC 8 link wrapped over two rows opened by a Ctrl+click on its
// second, and a reload's replay copying nothing. The store, row, marks and kit
// blocks read what the other branches of the batch build; they were
// written from the plan's contracts (C4 to C7) and run first at the
// batch's close-out on the merged tree.
// Block cli (fixes 1167 and 1168, needs nothing; last): emmer shell --host stub and emmer ls --host stub from the harness's CLI, carried by its daemon to this window and run on the stub, then the refusals that need the window.
// Run: npm run verify:remote -w @emerald/app [-- --only relay]
import { createHash } from 'node:crypto';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm76-remote-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m76-remote';
const { blockRunner, daemonRecord, emeraldHome, expect, freshPort, getTabs, killDaemonIfSame, killTree, launch, leaves, repoRoot, sleep, splitWithShell, startSession, step, stopDaemon, zreq } = await import('./cdp.mjs');

const { block, blocksRun } = blockRunner([
  { name: 'relay', fixes: ['1079', '1080', '1081', '1082'], needs: [] },
  { name: 'store', fixes: ['1085', '1086'], needs: ['relay'] },
  { name: 'row', fixes: ['1087', '1088', '1094', '1095'], needs: ['relay'] },
  { name: 'marks', fixes: ['1089', '1090', '1096', '1097'], needs: ['relay'] },
  // Replaces the stub's daemon with the kit's, so it stays last.
  { name: 'kit', fixes: ['1083', '1084', '1166'], needs: ['relay'] },
  // Starts where kit ends (the kit's own daemon on R), so it follows it.
  { name: 'restart', fixes: ['1165'], needs: ['relay', 'kit'] },
  { name: 'clip', fixes: ['1091'], needs: [] },
  { name: 'cli', fixes: ['1167', '1168'], needs: [] },
]);

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 600 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 600000);

const scriptsDir = path.join(repoRoot, 'packages', 'app', 'scripts');
const cliMain = path.join(repoRoot, 'packages', 'cli', 'dist', 'main.js');
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'app', 'package.json'), 'utf8')).version;
// The kit's Node, read off its one pin with docs-commit-check.py's regex, so a move of the pin is one line (M9 fix 1118).
const kitNode = /KIT_NODE_VERSION = '([\d.]+)'/.exec(fs.readFileSync(path.join(repoRoot, 'packages', 'app', 'src', 'main', 'remote-kit.ts'), 'utf8'))?.[1];
if (kitNode === undefined) throw new Error('no KIT_NODE_VERSION in remote-kit.ts');
const H = path.join(emeraldHome, 'stub-host');
const R = path.join(H, '.emerald-remote');
const stubPipe = `${process.env['EMERALD_PIPE']}-stub`;
const modesFile = path.join(H, 'stub-ssh-modes.json');
const sshLog = path.join(H, 'stub-ssh.log');
const pidFile = path.join(H, 'stub-ssh.pid');
const stubEnv = { ...process.env, EMERALD_HOME: R, EMERALD_PIPE: stubPipe, CLAUDE_CONFIG_DIR: path.join(H, '.claude'), CLAUDE_SETTINGS: path.join(H, '.claude', 'settings.json') };
const cli = (env, ...args) => {
  const r = spawnSync(process.execPath, [cliMain, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const setModes = (modes) => fs.writeFileSync(modesFile, JSON.stringify(modes));
const powershell = (command) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim();
// The stub ssh's pid as it wrote it at its start, read and killed at once
// (never a number kept: Windows recycles them within minutes).
const killStubSsh = () => {
  const pid = fs.readFileSync(pidFile, 'utf8').trim();
  spawnSync('taskkill', ['/pid', pid, '/t', '/f'], { stdio: 'ignore', windowsHide: true });
};
const stubArch = process.arch === 'arm64' ? 'arm64' : 'x64';
const stubRecord = (extra = {}) => ({ name: 'stub', destination: 'stub', os: 'win32', arch: stubArch, shell: 'powershell', home: H, nodeVersion: kitNode, kitVersion: appVersion, addedAt: Date.now(), ...extra });

// Every process run from under the stub host's home, matched on its command
// line (never a remembered pid): the kit's daemon, started through WMI from
// R\<version>\daemon on a pipe of its own, outlived a run's daemon.json
// kill at the close-out of fixes 1079 to 1090, held the folder, and the
// next run's rmSync of H failed EPERM.
const killUnderStubHome = () => {
  const pattern = H.replace(/'/g, "''");
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { "$($_.CommandLine)".Contains('${pattern}') } | ForEach-Object { taskkill /pid $_.ProcessId /t /f | Out-Null }`], { stdio: 'ignore', windowsHide: true });
};
// A run that died left the stub's daemon on R; it goes before R does.
killDaemonIfSame(daemonRecord(R));
killUnderStubHome();
fs.rmSync(H, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
fs.mkdirSync(H, { recursive: true });
// The stub home carries AppData\Local, so a PowerShell run under it as USERPROFILE (stub-ssh.mjs, fix 1094's daemon) keeps its cache there and goes with the home (M9 fix 1120).
fs.mkdirSync(path.join(H, 'AppData', 'Local'), { recursive: true });
fs.writeFileSync(path.join(emeraldHome, 'ssh-config'), 'Host stub\n  HostName stub.invalid\n  User verify\n');
setModes({});
{
  const r = cli(stubEnv, 'daemon', 'start');
  expect(r.code === 0, `the stub host's daemon started (${r.code}: ${r.out}${r.err})`);
}

const launchEnv = {
  EMERALD_SSH: path.join(scriptsDir, 'stub-ssh.mjs'),
  EMERALD_SCP: path.join(scriptsDir, 'stub-scp.mjs'),
  EMERALD_STUB_SSH_MODES: modesFile,
  EMERALD_STUB_HOME: H,
  EMERALD_STUB_PIPE: stubPipe,
};
let s = await launch(freshPort(), { freshState: true, env: launchEnv });
app = s;

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const paneSel = (id) => `.pane[data-pane-id=${JSON.stringify(id)}]`;
const typeRaw = (sessionId, text) => s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(sessionId)}, data: ${JSON.stringify(text)} })`);
const screenHas = async (sessionId, line, what, ms = 10_000) => {
  const until = Date.now() + ms;
  let rows = [];
  while (Date.now() < until) {
    rows = (await zreq(s, 'pty.screen', { sessionId })).rows.map((r) => r.trimEnd());
    if (rows.includes(line)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}: no row ${JSON.stringify(line)} in ${JSON.stringify(rows.filter((r) => r !== '').slice(-6))}`);
};
// A pane split a few columns wide wraps what it prints, so this reads the rows joined: trimmed at their ends and joined bare by default (a wrapped row has no space at its seam once trimmed), or with collapse untrimmed and every run of whitespace one space, for a needle that holds a real space a wrap may fall on (M9 fix 1119).
const screenJoinedHas = async (sessionId, text, what, ms = 10_000, { collapse = false } = {}) => {
  const until = Date.now() + ms;
  let joined = '';
  while (Date.now() < until) {
    const rows = (await zreq(s, 'pty.screen', { sessionId })).rows;
    joined = collapse ? rows.join('').replace(/\s+/g, ' ') : rows.map((r) => r.trimEnd()).join('');
    if (joined.includes(text)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}: the screen joined ${JSON.stringify(joined.slice(-120))}`);
};
const listed = async (id) => (await zreq(s, 'session.list', { removed: true })).sessions.find((x) => x.id === id);
const listenPushes = () => s.evalJs(`(() => { window.__hostPushes = []; window.emerald.on((m) => { if (m.type === 'host.changed') window.__hostPushes.push(m); }); return true; })()`);
const pushCount = () => s.evalJs(`window.__hostPushes.length`);
// The first push for stub at or after index from that pred holds.
const waitPush = async (from, pred, what, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const pushes = await s.evalJs(`window.__hostPushes.slice(${from}).filter((m) => m.host === 'stub')`);
    const hit = pushes.find(pred);
    if (hit !== undefined) return hit;
    await sleep(150);
  }
  const seen = await s.evalJs(`window.__hostPushes.slice(${from}).map((m) => m.state + (m.refusal ? ':' + m.refusal.kind : ''))`);
  throw new Error(`timed out waiting for ${what} (pushes since: ${JSON.stringify(seen)})`);
};
const lastSshArgv = () => {
  const lines = fs.readFileSync(sshLog, 'utf8').trim().split('\n');
  const last = lines[lines.length - 1];
  return JSON.parse(last.slice(last.indexOf(' ') + 1));
};
const layoutPane = async (sessionId) => {
  const layout = await getTabs(s);
  for (const tab of layout.tabs) for (const p of leaves(tab)) if (p.sessionId === sessionId) return p;
  return null;
};
const termText = (paneId) =>
  s.evalJs(
    `(() => { const t = document.querySelector(${JSON.stringify(paneSel(paneId) + ' .term-host')})?.emeraldTerm; if (!t) return []; const b = t.buffer.active; const lines = []; for (let i = 0; i < b.length; i++) lines.push((b.getLine(i)?.translateToString(true) ?? '').trimEnd()); return lines; })()`,
  );
// The empty pane split to the right of a pane: a plain click on its split
// button gives an empty pane (the harness's default).
const splitEmpty = async (paneId) => {
  const before = (await getTabs(s)).revision;
  await s.evalJs(`${q(paneSel(paneId) + ' .pane-split-right')}.click()`);
  await s.waitFor(`(async () => (await window.emerald.request('layout.get', {})).layout.revision > ${before})()`, 'the split landed');
  const layout = await getTabs(s);
  const tab = layout.tabs.find((t) => t.id === layout.currentTabId);
  const empty = leaves(tab).find((p) => p.sessionId === null && p.view === null);
  expect(empty !== undefined, 'the split made an empty pane');
  await s.waitFor(`!!${q(paneSel(empty.id) + ' .empty-pane')}`, 'the empty pane drawn');
  return empty.id;
};

let stubId = null;
let stubPane = null;
let firstPid = null;
let storeStubId = null;
let storeStubPane = null;
let localPane = null;
let rowStubPane = null;
let rowLocalPane = null;

try {
  // The record facts first contact would have written, with the app's own
  // version as the kit's, so the cut connects with no setup and the kit,
  // once merged, finds this version already there.
  await zreq(s, 'hosts.set', { host: stubRecord() });
  await listenPushes();

  await block('relay', async () => {
    // 1. The config's one host, its record's facts merged in.
    const hosts = await s.evalJs(`window.emerald.remoteHosts()`);
    expect(Array.isArray(hosts) && hosts.length === 1, `one remote host listed, got ${JSON.stringify(hosts)}`);
    const h = hosts[0];
    expect(h.name === 'stub' && h.destination === 'verify@stub.invalid' && h.source === 'config' && h.shell === 'powershell' && h.home === H, `the stub host from ~/.ssh/config with its record's facts, got ${JSON.stringify(h)}`);
    step('fix 1081 (1): remoteHosts lists the config host stub, destination verify@stub.invalid, with the record facts');

    // 2. The connect through the stub's relay.
    let from = await pushCount();
    await s.evalJs(`window.emerald.hostConnect('stub')`);
    const up = await waitPush(from, (m) => m.state === 'up', 'stub up', 20_000);
    firstPid = up.daemon?.pid ?? null;
    expect(firstPid === daemonRecord(R)?.pid, `the host's daemon is the stub's (${firstPid} against ${daemonRecord(R)?.pid})`);
    const argv = lastSshArgv();
    const head = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', 'stub', '&'];
    expect(JSON.stringify(argv.slice(0, head.length)) === JSON.stringify(head), `ssh's argv starts with the options, stub and &, got ${JSON.stringify(argv)}`);
    const [nodeWord, cliWord, relay, homeFlag, homeWord] = argv.slice(head.length);
    expect(nodeWord.startsWith('"') && nodeWord.endsWith(`node-${kitNode}\\node.exe"`), `the node path in its quotes, one word: ${nodeWord}`);
    expect(cliWord.startsWith('"') && cliWord.endsWith('\\cli\\dist\\main.js"'), `the CLI path in its quotes, one word: ${cliWord}`);
    expect(relay === 'relay' && homeFlag === '--home' && homeWord === `"${R}"`, `relay --home "<R>", got ${JSON.stringify([relay, homeFlag, homeWord])}`);
    step(`fix 1081 (2): up on the stub's daemon pid ${firstPid}; ssh got the -o words, stub and the relay's quoted words intact`);

    // 3. A shell on the host.
    stubId = await startSession(s, { kind: 'shell', cwd: H, host: 'stub' });
    const pane = await layoutPane(stubId);
    stubPane = pane?.id ?? null;
    expect(pane?.host === 'stub', `the pane holding the stub shell carries host stub, got ${JSON.stringify(pane)}`);
    expect((await listed(stubId))?.host === 'stub', 'session.list holds the stub shell stamped host stub');
    const onStub = cli(stubEnv, 'ls', '--json');
    expect(onStub.code === 0 && onStub.out.includes(stubId), `emmer ls on the stub pair lists it (${onStub.code})`);
    const onHarness = cli(process.env, 'ls', '--json');
    expect(onHarness.code === 0 && !onHarness.out.includes(stubId), `emmer ls on the harness pair does not (${onHarness.code})`);
    step('fix 1081 (3): the shell lives on the stub daemon, stamped host stub by main, its pane carrying host stub');

    // 4. The routing by session id, both ways.
    await typeRaw(stubId, 'echo relay-1082\r');
    await screenHas(stubId, 'relay-1082', 'relay-1082 on the stub shell');
    step('fix 1081 (4): typed into the stub shell and read back off its screen');

    // 5. The drop.
    from = await pushCount();
    killStubSsh();
    const lost = await waitPush(from, (m) => m.state === 'lost', 'lost after the drop', 5000);
    expect(lost.retryIn === 2, `the first retry in 2 s, got ${lost.retryIn}`);
    const back = await waitPush(from, (m) => m.state === 'up', 'up again', 15_000);
    expect(back.daemon?.pid === firstPid, `the same daemon (${back.daemon?.pid})`);
    const after = await listed(stubId);
    expect(after?.host === 'stub' && after.state !== 'exited', `the shell still listed live on stub, got ${JSON.stringify(after?.state)}`);
    await screenHas(stubId, 'relay-1082', 'relay-1082 still on the screen');
    await s.waitFor(`(() => { const t = ${q(paneSel(stubPane) + ' .term-host')}?.emeraldTerm; if (!t) return false; const b = t.buffer.active; for (let i = 0; i < b.length; i++) if ((b.getLine(i)?.translateToString(true) ?? '').trimEnd() === 'relay-1082') return true; return false; })()`, 'the pane replayed relay-1082 after the reattach', 10_000);
    await typeRaw(stubId, 'echo relay-again\r');
    await screenHas(stubId, 'relay-again', 'relay-again after the reconnect');
    step('fix 1081 (5): the dropped line read lost in 2 s, came back on the same daemon, the screen replayed and typing reached it');

    // 6. The WMI start, fix 1079's route on this box.
    from = await pushCount();
    const stopped = cli(stubEnv, 'daemon', 'stop');
    expect(stopped.code === 0, `daemon stop on the stub pair (${stopped.code}: ${stopped.out}${stopped.err})`);
    await waitPush(from, (m) => m.state === 'lost', 'lost after the stub daemon stopped', 10_000);
    const again = await waitPush(from, (m) => m.state === 'up', 'up on a daemon the relay started', 30_000);
    const newPid = again.daemon?.pid;
    expect(typeof newPid === 'number' && newPid !== firstPid, `a new daemon (${newPid} against ${firstPid})`);
    const line = powershell(`(Get-CimInstance Win32_Process -Filter "ProcessId = ${newPid}").CommandLine`);
    expect(line.includes(`--home "${R}"`) && line.includes(`--pipe "${stubPipe}"`) && line.includes('--ssh-connection "127.0.0.1 50022 127.0.0.1 22"'), `the WMI-started daemon carries --home, --pipe and --ssh-connection: ${line}`);
    const parent = powershell(`$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${newPid}"; (Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)").Name`);
    expect(parent.toLowerCase() === 'wmiprvse.exe', `its parent is WmiPrvSE.exe, got ${parent}`);
    await s.waitFor(`(async () => (await window.emerald.request('session.list', { removed: true })).sessions.find((x) => x.id === ${JSON.stringify(stubId)})?.state === 'exited')()`, 'the stub shell listed exited after the stop', 10_000);
    step(`fix 1079 (6): the relay started the stub daemon again through WMI, pid ${newPid} under WmiPrvSE.exe with --home, --pipe and --ssh-connection`);

    // 7. An unknown host key.
    setModes({ stub: 'hostkey' });
    await s.evalJs(`window.emerald.hostForget('stub')`);
    from = await pushCount();
    await s.evalJs(`window.emerald.hostConnect('stub')`);
    const refused = await waitPush(from, (m) => m.state === 'refused', 'refused on the host key', 15_000);
    expect(refused.refusal?.kind === 'hostkey' && refused.refusal.line === 'Host key verification failed.', `refused hostkey with ssh's last line, got ${JSON.stringify(refused.refusal)}`);
    step('fix 1081 (7): an unknown host key is refused hostkey with the last stderr line');

    // 8. Back.
    setModes({});
    from = await pushCount();
    await s.evalJs(`window.emerald.hostConnect('stub')`);
    await waitPush(from, (m) => m.state === 'up', 'up after the refusal', 20_000);
    step('fix 1081 (8): connected again once the stub answers');

    // 9. The relay's SSH_CONNECTION on a host session (M9 fix 1091). A shell,
    // never kind Claude: the WMI-started stub daemon runs on the person's
    // registry PATH, so a Claude there would be their own claude.exe. No
    // pane; it exits at the end, so the later blocks meet no extra live
    // stub session.
    const { session: sshShell } = await s.evalJs(`window.emerald.request('session.spawn', ${JSON.stringify({ kind: 'shell', shell: 'powershell', cwd: H, cols: 80, rows: 24 })}, 'stub')`);
    await sleep(1500);
    await typeRaw(sshShell.id, 'echo "ssh=$env:SSH_CONNECTION"\r');
    await screenHas(sshShell.id, 'ssh=127.0.0.1 50022 127.0.0.1 22', 'SSH_CONNECTION in a shell on the stub');
    await typeRaw(sshShell.id, 'exit\r');
    await s.waitFor(`(async () => (await window.emerald.request('session.list', { removed: true })).sessions.find((x) => x.id === ${JSON.stringify(sshShell.id)})?.state === 'exited')()`, 'the SSH_CONNECTION shell listed exited', 10_000);
    step('fix 1091 (9): a shell on the relay-started daemon carries the relay\'s SSH_CONNECTION');
  });

  await block('store', async () => {
    // 1. A local shell beside the exited stub pane, then a live stub
    // shell in its place.
    // A split from the stub pane starts on stub (fix 1086: the source
    // pane's host), and a spawn there lands later than a local one, so the
    // step waits for the split's pane to hold its session.
    await splitWithShell(s, `${paneSel(stubPane)} .pane-split-right`);
    await s.waitFor(
      `(async () => { const l = (await window.emerald.request('layout.get', {})).layout; const walk = (n) => (n.kind === 'pane' ? [n] : [...walk(n.first), ...walk(n.second)]); const t = l.tabs.find((x) => x.id === l.currentTabId); return walk(t.root).some((p) => p.id !== ${JSON.stringify(stubPane)} && p.sessionId !== null); })()`,
      'a shell beside the stub pane',
      15_000,
    );
    let layout = await getTabs(s);
    let tab = layout.tabs.find((t) => t.id === layout.currentTabId);
    localPane = leaves(tab).find((p) => p.id !== stubPane && p.sessionId !== null)?.id ?? null;
    expect(localPane !== null, 'a shell beside the stub pane');
    const empty = (n) => (n.kind === 'pane' ? (n.id === stubPane ? (({ host: _h, ...rest }) => ({ ...rest, sessionId: null, view: null }))(n) : n) : { ...n, first: empty(n.first), second: empty(n.second) });
    layout = await getTabs(s);
    await zreq(s, 'layout.set', { layout: { ...layout, tabs: layout.tabs.map((t) => (t.id === layout.currentTabId ? { ...t, root: empty(t.root) } : t)) } });
    await s.waitFor(`!!${q(paneSel(stubPane) + ' .empty-pane')}`, 'the stub pane emptied');
    storeStubId = await startSession(s, { kind: 'shell', cwd: H, host: 'stub' });
    storeStubPane = (await layoutPane(storeStubId))?.id ?? null;
    step(`fix 1086 (1): a shell split off the stub pane beside a live stub shell ${storeStubId}`);
    await typeRaw(storeStubId, 'echo relay-store\r');
    await screenHas(storeStubId, 'relay-store', 'relay-store on the stub shell');

    // 2. A reload: the one list carries the remote row, the pane replays.
    await s.send('Page.reload');
    await s.waitFor(`!!${q(`.sidebar-row[data-session-id=${JSON.stringify(storeStubId)}]`)}`, 'the stub row after the reload, from the merged session.list', 15_000);
    await listenPushes();
    await s.waitFor(`(() => { const t = ${q(paneSel(storeStubPane) + ' .term-host')}?.emeraldTerm; if (!t) return false; const b = t.buffer.active; for (let i = 0; i < b.length; i++) if ((b.getLine(i)?.translateToString(true) ?? '').trimEnd() === 'relay-store') return true; return false; })()`, 'the stub pane replayed relay-store after the reload', 15_000);
    step('fix 1085 (2): after a reload the stub row is listed and its pane replays relay-store');

    // 3. A lost line reads unreachable on the row.
    setModes({ stub: 'down' });
    killStubSsh();
    const rowState = `${q(`.sidebar-row[data-session-id=${JSON.stringify(storeStubId)}] .sidebar-row-state`)}?.textContent`;
    await s.waitFor(`${rowState} === 'unreachable'`, 'the stub row reads unreachable', 5000);
    step('fix 1086 (3): the dropped line reads unreachable on the stub row');

    // 4. Back.
    setModes({});
    const from = await pushCount();
    await s.evalJs(`window.emerald.hostTryNow('stub')`);
    await waitPush(from, (m) => m.state === 'up', 'up after Try now', 20_000);
    await s.waitFor(`${rowState} !== 'unreachable'`, 'the stub row reads its live state again', 5000);
    step('fix 1086 (4): Try now brought the line back and the row reads its own state');
  });

  await block('row', async () => {
    // M9 fix 1094 (1): the stub daemon started again on stub-bin's claude.
    // The WMI-started stub daemon runs on the person's registry PATH and
    // would find their own claude.exe, so before anything picks kind
    // Claude on stub the daemon is restarted from here on an environment
    // of its own: stub-bin first on its PATH with every folder holding a
    // claude.exe dropped, the stub home as its home, and
    // EMERALD_SPAWN_PATH=inherit so no app hello brings the registry's
    // PATH back.
    const stubBin = path.join(H, 'stub-bin');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.copyFileSync(path.join(scriptsDir, 'stub-claude.mjs'), path.join(stubBin, 'stub-claude.mjs'));
    // npm's shim shape, which the daemon's resolveNpmShim reads as node on the script.
    fs.writeFileSync(path.join(stubBin, 'claude.cmd'), '@node "%~dp0\\stub-claude.mjs" %*\r\n');
    const authFile = path.join(stubBin, 'auth.json');
    const claudeLog = path.join(stubBin, 'stub-claude.log');
    const authReads = () => (fs.existsSync(claudeLog) ? fs.readFileSync(claudeLog, 'utf8').split('\n').filter((l) => l.trim() === '["auth","status","--json"]').length : 0);
    const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    const dirs = (process.env[pathKey] ?? '').split(';').filter((d) => d !== '' && !fs.existsSync(path.join(d, 'claude.exe')));
    const claudeEnv = { ...stubEnv, USERPROFILE: H, HOME: H, HOMEPATH: H, EMERALD_SPAWN_PATH: 'inherit', [pathKey]: [stubBin, ...dirs].join(';') };
    let from1094 = await pushCount();
    setModes({ stub: 'down' });
    killStubSsh();
    await waitPush(from1094, (m) => m.state === 'lost', 'lost before the stub daemon restart', 5000);
    const before1094 = daemonRecord(R);
    cli(stubEnv, 'daemon', 'stop');
    killDaemonIfSame(before1094);
    {
      const r = cli(claudeEnv, 'daemon', 'start');
      expect(r.code === 0, `the stub daemon started on stub-bin (${r.code}: ${r.out}${r.err})`);
    }
    setModes({});
    from1094 = await pushCount();
    await s.evalJs(`window.emerald.hostTryNow('stub')`);
    const up1094 = await waitPush(from1094, (m) => m.state === 'up', 'up on the stub daemon started on stub-bin', 20_000);
    const restarted1094 = daemonRecord(R);
    expect(up1094.daemon?.claude === true && up1094.daemon.pid === restarted1094?.pid, `the hello finds a claude on the restarted daemon, got ${JSON.stringify(up1094.daemon)} against ${restarted1094?.pid}`);
    step("fix 1094 (1): the stub daemon started again on stub-bin's claude, the hello finding it");

    // A new tab in front with a local shell, an empty pane split off it.
    const tabsBefore = (await getTabs(s)).tabs.length;
    await s.evalJs(`${q('.tab-add')}.click()`);
    await s.waitFor(`(async () => (await window.emerald.request('layout.get', {})).layout.tabs.length === ${tabsBefore + 1})()`, 'a new tab');
    let layout = await getTabs(s);
    const first = leaves(layout.tabs.find((t) => t.id === layout.currentTabId))[0];
    const { session: localShell } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: os.homedir(), cols: 80, rows: 24 });
    layout = await getTabs(s);
    await zreq(s, 'layout.set', { layout: { ...layout, tabs: layout.tabs.map((t) => (t.id === layout.currentTabId ? { ...t, root: { ...first, sessionId: localShell.id } } : t)) } });
    rowLocalPane = first.id;
    await s.waitFor(`!!${q(paneSel(rowLocalPane) + ' .term-host')}`, 'the local shell in the new tab');
    const emptyPane = await splitEmpty(rowLocalPane);
    const E = paneSel(emptyPane);

    // 1. The on row's place and its parts.
    const order = await s.evalJs(`(() => { const p = ${q(E)}; const kinds = p.querySelector('.empty-kinds'), on = p.querySelector('.empty-on-block'), inb = p.querySelector('.empty-in-block'); if (!kinds || !on || !inb) return null; return { afterKinds: !!(kinds.compareDocumentPosition(on) & 4), beforeIn: !!(on.compareDocumentPosition(inb) & 4) }; })()`);
    expect(order?.afterKinds === true && order.beforeIn === true, `the on block between the kinds and the in block, got ${JSON.stringify(order)}`);
    const head = await s.evalJs(`({ label: ${q(E + ' .empty-on-head .empty-on-label')}?.textContent, keys: ${q(E + ' .empty-on-head .empty-on-keys')}?.textContent })`);
    expect(head.label === 'on' && head.keys === '← → switch', `the on head, got ${JSON.stringify(head)}`);
    const buttons = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(E + ' .empty-on-row > button')})].map((b) => ({ cls: b.className, host: b.dataset.host ?? null, text: b.querySelector('.empty-host-name')?.textContent ?? b.textContent, pressed: b.getAttribute('aria-pressed') }))`);
    expect(buttons.length === 3 && buttons[0].cls.includes('secondary') && buttons[0].cls.includes('empty-host') && buttons[0].host === '' && buttons[0].text === 'This PC' && buttons[0].pressed === 'true', `This PC first and pressed, got ${JSON.stringify(buttons)}`);
    expect(buttons[1].host === 'stub' && buttons[1].pressed !== 'true', `stub second, got ${JSON.stringify(buttons[1])}`);
    expect(buttons[2].cls.includes('empty-host-add') && buttons[2].text === 'Add a host…', `Add a host… last, got ${JSON.stringify(buttons[2])}`);
    // The label alone: the button's own text ends in its ⏎ key glyph.
    const startText = () => s.evalJs(`${q(E + ' .empty-start-label')}?.textContent ?? ''`);
    expect(!/ on \S+$/.test(await startText()), `no host tail on This PC's Start, got ${await startText()}`);
    step('fix 1087 (1): the on row sits between the kinds and the in block: on, ← → switch, This PC pressed, stub, Add a host…');

    // 2. The keys.
    await s.evalJs(`${q(E + ' .palette-input')}.focus()`);
    await s.key('ArrowRight', 'ArrowRight', 39);
    await s.waitFor(`${q(E + ' .empty-host[data-host="stub"]')}?.getAttribute('aria-pressed') === 'true'`, 'ArrowRight pressed stub');
    await s.waitFor(`(${q(E + ' .empty-start-label')}?.textContent ?? '').endsWith(' on stub')`, 'the Start label ends on stub', 5000);
    await s.waitFor(`${q(E + ' .empty-in-block .empty-folder')}?.dataset.folder === ${JSON.stringify(H)}`, "the in block's first row is the stub's home", 15_000);
    await s.key('ArrowLeft', 'ArrowLeft', 37);
    await s.waitFor(`${q(E + ' .empty-host[data-host=""]')}?.getAttribute('aria-pressed') === 'true'`, 'ArrowLeft back to This PC');
    step("fix 1087 (2): ArrowRight picked stub (Start ends on stub, the stub's home first), ArrowLeft This PC");

    // M9 fix 1094 (2): kind Claude on stub reads the stub claude's sign-in.
    // In brackets: a bare `a ?? null === 'x'` reads as `a ?? (null === 'x')`, true on any text.
    const stubSub = `(${q(E + ' .empty-host[data-host="stub"] .empty-host-sub')}?.textContent ?? null)`;
    fs.writeFileSync(authFile, JSON.stringify({ loggedIn: false, loginExpiresAt: null }));
    await s.evalJs(`${q(E + ' .empty-host[data-host="stub"]')}.click()`);
    await s.evalJs(`${q(E + ' .empty-kind[data-kind="claude"]')}.click()`);
    await s.waitFor(`${stubSub} === 'not signed in on stub'`, 'kind Claude on stub reads not signed in on stub', 15_000);
    await s.waitFor(
      `${q(E + ' .empty-start')}?.disabled === false && (() => { const t = ${q(E + ' .empty-start-label')}?.textContent ?? ''; return t.startsWith('Start Claude') && t.endsWith(' on stub'); })()`,
      'Start Claude ready on stub while signed out',
      15_000,
    );
    expect(authReads() >= 1, `the stub claude was asked auth status --json, its log ${fs.existsSync(claudeLog) ? JSON.stringify(fs.readFileSync(claudeLog, 'utf8')) : 'missing'}`);
    await s.evalJs(`${q(E + ' .empty-kind[data-kind="shell"]')}.click()`);
    await s.waitFor(`${stubSub} === null`, 'no sign-in line under Shell', 5000);
    step('fix 1094 (2): kind Claude on stub reads not signed in on stub, Start still ready, the line gone under Shell');

    // M9 fix 1094 (3): an expired login, then a signed-in re-pick.
    fs.writeFileSync(authFile, JSON.stringify({ loggedIn: true, loginExpiresAt: new Date(Date.now() - 86_400_000).toISOString() }));
    await s.evalJs(`${q(E + ' .empty-kind[data-kind="claude"]')}.click()`);
    await s.waitFor(`${stubSub} === 'login expired on stub'`, 'an expired login reads login expired on stub', 15_000);
    fs.writeFileSync(authFile, JSON.stringify({ loggedIn: true, loginExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }));
    await s.evalJs(`${q(E + ' .empty-host[data-host=""]')}.click()`);
    await s.waitFor(`${q(E + ' .empty-host[data-host=""]')}?.getAttribute('aria-pressed') === 'true'`, 'This PC pressed');
    await s.evalJs(`${q(E + ' .empty-host[data-host="stub"]')}.click()`);
    await s.waitFor(`${stubSub} === null`, 'a signed-in re-pick clears the line', 15_000);
    expect(authReads() >= 3, `three auth status reads at least, got ${authReads()}`);
    step('fix 1094 (3): an expired login reads login expired on stub, and a signed-in re-pick clears the line');

    // M9 fix 1095 (1): a lost stub holds Start and the folders wait.
    await s.evalJs(`${q(E + ' .empty-kind[data-kind="shell"]')}.click()`);
    let from1095 = await pushCount();
    setModes({ stub: 'down' });
    killStubSsh();
    await waitPush(from1095, (m) => m.state === 'lost', 'lost before the held Start', 5000);
    await s.waitFor(
      `${stubSub} === 'unreachable' && ${q(E + ' .empty-start')}?.disabled === true && ${q(E + ' .empty-start')}?.dataset.dim === 'true' && ${q(E + ' .empty-in-wait')}?.textContent === 'The folders on stub show once it answers.'`,
      'a lost stub reads unreachable, holds and dims Start, and the folders wait',
      5000,
    );
    step('fix 1095 (1): a lost stub holds Start, dims it and the folders wait');

    // M9 fix 1095 (2): a request naming the lost stub fails at the next try.
    const lost1095 = await s.evalJs(
      `(async () => { const t = Date.now(); try { await window.emerald.request('session.list', {}, 'stub'); return { ok: true, ms: Date.now() - t }; } catch (e) { return { ok: false, ms: Date.now() - t, message: String(e?.message ?? e) }; } })()`,
    );
    expect(lost1095.ok === false && lost1095.message.includes('stub is unreachable') && lost1095.ms < 5000, `a request on the lost stub failed unreachable within 5 s, got ${JSON.stringify(lost1095)}`);
    setModes({});
    from1095 = await pushCount();
    await s.evalJs(`window.emerald.hostTryNow('stub')`);
    await waitPush(from1095, (m) => m.state === 'up', 'up after the held Start', 20_000);
    await s.waitFor(`${q(E + ' .empty-start')}?.disabled === false`, 'Start ready again on stub', 15_000);
    step(`fix 1095 (2): a request naming the lost stub failed unreachable in ${lost1095.ms} ms and the line came back`);

    // 3. Start on the host.
    await s.evalJs(`${q(E + ' .empty-host[data-host="stub"]')}.click()`);
    await s.evalJs(`${q(E + ' .empty-kind[data-kind="shell"]')}.click()`);
    await s.waitFor(`${q(E + ' .empty-start')}?.disabled === false && (${q(E + ' .empty-start-label')}?.textContent ?? '').endsWith(' on stub')`, 'Start ready on stub', 15_000);
    const terms = await s.evalJs(`document.querySelectorAll('.term-host').length`);
    await s.evalJs(`${q(E + ' .empty-start')}.click()`);
    await s.waitFor(`document.querySelectorAll('.term-host').length === ${terms + 1}`, 'a shell started on stub', 15_000);
    layout = await getTabs(s);
    const startedNode = leaves(layout.tabs.find((t) => t.id === layout.currentTabId)).find((p) => p.id === emptyPane);
    expect(startedNode?.host === 'stub', `the started pane's node carries host stub, got ${JSON.stringify(startedNode)}`);
    rowStubPane = emptyPane;
    step('fix 1087 (3): Start on stub opened a shell whose pane node carries host stub');

    // 4. A split from the stub pane starts on stub.
    const fromStub = await splitEmpty(rowStubPane);
    await s.waitFor(`${q(paneSel(fromStub) + ' .empty-host[data-host="stub"]')}?.getAttribute('aria-pressed') === 'true'`, 'the split from the stub pane starts with stub pressed');
    step('fix 1087 (4): an empty pane split from the stub pane has stub pressed');

    // 5. Add a host… and an unknown key.
    const F = paneSel(fromStub);
    await s.evalJs(`${q(F + ' .empty-host-add')}.click()`);
    await s.waitFor(`!!${q(F + ' input.empty-host-box')} && document.activeElement === ${q(F + ' input.empty-host-box')}`, 'the host box open and focused');
    const note = await s.evalJs(`${q(F + ' .empty-host-note')}?.textContent`);
    expect(note === 'An ssh destination, or a Host from ~/.ssh/config. Enter adds it, Esc leaves it.', `the box's note, got ${JSON.stringify(note)}`);
    setModes({ 'verify@stub2.invalid': 'hostkey' });
    await s.type('verify@stub2.invalid');
    await s.key('Enter', 'Enter', 13);
    await s.waitFor(`${q(F + ' .empty-host[data-host="stub2.invalid"]')}?.getAttribute('aria-pressed') === 'true'`, 'stub2.invalid added and pressed', 15_000);
    const hostkeyLine = 'stub2.invalid has not been reached from this PC before, so its key is unchecked. Run ssh stub2.invalid once in a shell here, check the fingerprint it shows, then pick it again.';
    await s.waitFor(`${q(F + ' .empty-error[data-reason="hostkey"]')}?.textContent === ${JSON.stringify(hostkeyLine)}`, "A4's line for stub2.invalid", 15_000);
    expect((await s.evalJs(`${q(F + ' .empty-error-act')}?.textContent`)) === 'Open a shell here to run it', 'its button reads Open a shell here to run it');
    step("fix 1088 (5): Add a host… took verify@stub2.invalid, picked it and refused it with A4's line and button");

    // 6. The button runs ssh in a local shell.
    const shellsBefore = new Set((await zreq(s, 'session.list', {})).sessions.map((x) => x.id));
    await s.evalJs(`${q(F + ' .empty-error-act')}.click()`);
    let sshShell = null;
    const until6 = Date.now() + 10_000;
    while (sshShell === null && Date.now() < until6) {
      sshShell = (await zreq(s, 'session.list', {})).sessions.find((x) => !shellsBefore.has(x.id) && x.host === undefined) ?? null;
      if (sshShell === null) await sleep(200);
    }
    expect(sshShell !== null, 'a local shell opened for the key');
    // The pane is narrow by now (sixteen columns after the block's
    // splits), so the command wraps: read the rows joined.
    await screenJoinedHas(sshShell.id, 'ssh stub2.invalid', 'the local shell running ssh stub2.invalid', 10_000, { collapse: true });
    step('fix 1088 (6): Open a shell here ran ssh stub2.invalid in a local shell');

    // 7. A refused login.
    setModes({ 'verify@stub2.invalid': 'down' });
    const emptyAgain = await splitEmpty(rowStubPane);
    const G = paneSel(emptyAgain);
    await s.evalJs(`${q(G + ' .empty-host[data-host="stub2.invalid"]')}.click()`);
    const sshLine = 'stub2.invalid refused the login: ssh: connect to host verify@stub2.invalid port 22: Connection refused';
    await s.waitFor(`${q(G + ' .empty-error[data-reason="ssh"]')}?.textContent === ${JSON.stringify(sshLine)}`, 'the refused login line', 15_000);
    expect((await s.evalJs(`${q(G + ' .empty-error-act')}?.textContent`)) === 'Try again', 'its button reads Try again');
    step('fix 1088 (7): a refused login reads its line with Try again');

    // 8. Forgotten.
    await s.evalJs(`window.emerald.hostForget('stub2.invalid')`);
    await s.waitFor(`!${q(G + ' .empty-host[data-host="stub2.invalid"]')}`, 'stub2.invalid gone from the row', 10_000);
    setModes({});
    step('fix 1088 (8): hostForget took stub2.invalid off the row');

    // 9. The palette's row.
    await s.evalJs(`${q(G + ' .empty-host[data-host=""]')}.click()`);
    const box = `${G} .palette-input`;
    await s.evalJs(`${q(box)}.focus()`);
    await s.type('>');
    await s.waitFor(`${q(box)}?.dataset.mode === 'actions'`, 'the box in action mode');
    expect((await s.evalJs(`document.querySelectorAll(${JSON.stringify(G + ' .action-row[data-kind="host"]')}).length`)) === 0, 'a bare > lists no host row');
    // `>host` alone also matches three key rows by their letters (Jump to
    // waiting first), so the step types enough to rank the host row first.
    await s.type('remote host');
    await s.waitFor(`!!${q(G + ' .action-row[data-kind="host"][data-action="add-host"]')}`, '>remote host lists Add a remote host…');
    const group = await s.evalJs(`(() => { const row = ${q(G + ' .action-row[data-kind="host"][data-action="add-host"]')}; let el = row.previousElementSibling; while (el && !el.classList.contains('palette-group')) el = el.previousElementSibling; return el?.textContent ?? null; })()`);
    expect(group === 'Remote', `in the Remote group, got ${JSON.stringify(group)}`);
    const listedRows = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(G + ' .action-row')})].map((r) => (r.dataset.kind ?? '') + ':' + (r.dataset.action ?? '') + (r.classList.contains('highlighted') || r.getAttribute('aria-selected') === 'true' ? '*' : ''))`);
    expect(listedRows[0] === 'host:add-host*', `Add a remote host… listed first and highlighted, got ${JSON.stringify(listedRows)}`);
    await s.key('Enter', 'Enter', 13);
    try {
      await s.waitFor(`!!${q(G + ' .empty-on-block')} && document.activeElement === ${q(G + ' input.empty-host-box')}`, 'Enter showed the on row with the host box focused');
    } catch (err) {
      const focus = await s.evalJs(`document.activeElement?.className ?? null`);
      const boxThere = await s.evalJs(`!!${q(G + ' input.empty-host-box')}`);
      throw new Error(`${err.message}; rows before Enter ${JSON.stringify(listedRows)}, focus ${JSON.stringify(focus)}, box drawn ${boxThere}`);
    }
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!${q(G + ' input.empty-host-box')}`, 'Escape left the host box');
    step('fix 1087 (9): >remote host lists Add a remote host… first under Remote; Enter opens the host box, Escape leaves it');
  });

  await block('marks', async () => {
    // 1. The sections.
    const sections = await s.evalJs(`[...document.querySelectorAll('.sidebar-list > section.sidebar-host')].map((sec) => ({ host: sec.dataset.host, head: sec.querySelector(':scope > div.sidebar-host-title > span.sidebar-host-head')?.textContent ?? null, dest: sec.querySelector(':scope > div.sidebar-host-title > span.sidebar-host-dest')?.textContent ?? null }))`);
    expect(sections.length === 2 && sections[0].host === '' && sections[0].head === 'this pc' && sections[0].dest === null, `this pc first with no destination, got ${JSON.stringify(sections)}`);
    expect(sections[1].host === 'stub' && sections[1].head === 'stub' && sections[1].dest === 'verify@stub.invalid', `stub second with its destination, got ${JSON.stringify(sections[1])}`);
    const live = (await zreq(s, 'session.list', {})).sessions.filter((x) => x.host === 'stub' && x.state !== 'exited');
    for (const x of live) {
      expect(await s.evalJs(`!!document.querySelector('section.sidebar-host[data-host="stub"] .sidebar-row[data-session-id=${JSON.stringify(x.id).replace(/'/g, "\\'")}]')`), `stub row ${x.id} inside the stub section`);
    }
    const groups = await s.evalJs(`[...document.querySelectorAll('.sidebar-group')].map((g) => ({ key: g.dataset.group, remote: !!g.closest('section.sidebar-host[data-host="stub"]') }))`);
    const remoteKeys = groups.filter((g) => g.remote).map((g) => g.key);
    expect(remoteKeys.length > 0 && remoteKeys.every((k) => k.startsWith('stub\u0000')), `a remote group's key is stub NUL folder, got ${JSON.stringify(remoteKeys)}`);
    const stubCwd = live[0]?.groupCwd ?? H;
    expect(remoteKeys.includes(`stub\u0000${stubCwd}`), `the stub shells' group is stub NUL ${stubCwd}, got ${JSON.stringify(remoteKeys)}`);
    expect(groups.filter((g) => !g.remote && g.key !== 'exited').every((g) => !g.key.includes('\u0000')), 'every local group key is the bare folder');
    const lastIsExited = await s.evalJs(`(() => { const list = document.querySelector('.sidebar-list'); const last = list.lastElementChild; return last !== null && last.tagName !== 'SECTION'; })()`);
    expect(lastIsExited, 'the Exited group comes after the last section');
    step('fix 1089 (1): two sections, this pc then stub with its destination, the stub rows inside, the remote group keyed stub NUL folder, Exited last');

    // 2. The chip on the stub pane's title.
    const chip = await s.evalJs(`(() => { const c = ${q(paneSel(rowStubPane) + ' .pane-title .host-chip')}; return c ? { text: c.textContent, title: c.title } : null; })()`);
    expect(chip?.text === 'stub' && chip.title === 'Runs on stub, reached by ssh as verify@stub.invalid', `the host chip, got ${JSON.stringify(chip)}`);
    step('fix 1089 (2): the stub pane title carries the host chip with its tooltip');

    // 3. The Files tab's note.
    // Focus the stub pane by the layout itself: a synthetic click on its
    // terminal does not move the pane focus.
    {
      const l = await getTabs(s);
      await zreq(s, 'layout.set', { layout: { ...l, tabs: l.tabs.map((t) => (t.id === l.currentTabId ? { ...t, focusedPaneId: rowStubPane } : t)) } });
    }
    await s.evalJs(`${q('.rail-tab[data-tab="files"]')}?.click()`);
    try {
      await s.waitFor(`!!${q('.files-remote-note .host-chip')}`, 'the Files tab note with the chip', 10_000);
    } catch (err) {
      const why = await s.evalJs(`(async () => { const l = (await window.emerald.request('layout.get', {})).layout; const t = l.tabs.find((x) => x.id === l.currentTabId); return { rail: !!document.querySelector('.files-rail'), tab: document.querySelector('.files-rail')?.dataset.tab ?? null, focusedPane: t?.focusedPaneId ?? null, stubPane: ${JSON.stringify(rowStubPane)}, tabs: [...document.querySelectorAll('.rail-tab')].map((b) => b.dataset.tab) }; })()`);
      throw new Error(`${err.message}: ${JSON.stringify(why)}`);
    }
    const noteText = await s.evalJs(`${q('.files-remote-note')}.textContent`);
    expect(noteText.includes("This folder is on stub. The files, the commit graph and the review tab read this PC's disk, so they are not drawn for it yet.") && noteText.includes('The terminal, the chat view, the state on the row and the hooks all come from stub as they do from here.'), `the note's two lines, got ${JSON.stringify(noteText)}`);
    expect((await s.evalJs(`${q('button.secondary.files-remote-shell')}?.textContent`)) === 'Shell on stub in stub-host', 'its button reads Shell on stub in stub-host');
    step("fix 1089 (3): the Files tab says the folder is on stub, with the chip and Shell on stub in stub-host");

    // 4. The lost band.
    setModes({ stub: 'down' });
    killStubSsh();
    const P = paneSel(rowStubPane);
    await s.waitFor(`!!${q(P + ' div.host-lost-note')}`, 'the lost band on the stub pane', 10_000);
    const band = await s.evalJs(`(() => { const n = ${q(P + ' div.host-lost-note')}; const prev = n.previousElementSibling; return { text: n.querySelector('.host-lost-note-text')?.textContent ?? n.textContent, btn: n.querySelector('button.host-lost-try')?.textContent ?? null, prev: prev?.className ?? null }; })()`);
    expect(/^Lost the line to stub at \d\d:\d\d\. The session runs on there; trying again in \d+s\.$/.test(band.text), `the band's line, got ${JSON.stringify(band.text)}`);
    expect(band.btn === 'Try now', `Try now, got ${band.btn}`);
    expect(/pane-title|claude-theme-note/.test(band.prev ?? ''), `the band after the title or the theme note, got ${band.prev}`);
    const dim = await s.evalJs(`(() => { const root = ${q(P)}; return { lost: root?.hasAttribute('data-host-lost') ?? false, opacity: getComputedStyle(root.querySelector('.term-wrap')).opacity }; })()`);
    expect(dim.lost && dim.opacity === '0.45', `the pane marked lost and its body at 45 percent, got ${JSON.stringify(dim)}`);
    const liveNow = (await zreq(s, 'session.list', {})).sessions.filter((x) => x.host === 'stub' && x.state !== 'exited');
    for (const x of liveNow) {
      await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(x.id).replace(/'/g, "\\'")}] .sidebar-row-state')?.textContent === 'unreachable'`, `row ${x.id} unreachable`, 5000);
    }
    const count = await s.evalJs(`(() => { const c = document.querySelector('.sidebar-header span.sidebar-unreachable'); return c ? { text: c.textContent, afterSessions: c.previousElementSibling?.textContent === 'Sessions' } : null; })()`);
    expect(count?.text === `${liveNow.length} unreachable` && count.afterSessions, `the header's count, got ${JSON.stringify(count)}`);
    step(`fix 1090 (4): the lost band with Try now, the body at 45 percent, ${liveNow.length} rows and the header reading unreachable`);

    // 5. Try now.
    setModes({});
    await s.evalJs(`${q(P + ' button.host-lost-try')}.click()`);
    await s.waitFor(`!${q(P + ' div.host-lost-note')} && !document.querySelector('.sidebar-unreachable')`, 'the band and the count gone after Try now', 5000);
    step('fix 1090 (5): Try now brought the line back and the band and the count went');

    // M9 fix 1096 (6): the stub group's menus offer only what works on the
    // host. The group's key holds a NUL, so it is matched in script, never
    // put in a selector.
    const stubKey = `stub\u0000${stubCwd}`;
    const groupPoint = (part) =>
      s.evalJs(
        `(() => { const g = [...document.querySelectorAll('section.sidebar-host[data-host="stub"] .sidebar-group')].find((x) => x.dataset.group === ${JSON.stringify(stubKey)}); const el = g?.querySelector(${JSON.stringify(part)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
      );
    const plus = await groupPoint('.sidebar-group-add');
    expect(plus !== null, `the stub group's + button, the key ${JSON.stringify(stubKey)}`);
    await s.rightClick(plus.x, plus.y);
    await s.waitFor(`document.querySelector('.group-menu')?.dataset.folder === ${JSON.stringify(stubCwd)}`, "the stub group's add menu");
    const addItems = await s.evalJs(`[...document.querySelectorAll('.group-menu .menu-item .menu-label')].map((l) => l.textContent)`);
    expect(JSON.stringify(addItems) === JSON.stringify(['New Claude session here']), `the stub group's add menu offers New Claude session here alone, got ${JSON.stringify(addItems)}`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.group-menu')`, 'the add menu closed');
    const name = await groupPoint('.sidebar-group-name');
    expect(name !== null, "the stub group's name");
    await s.rightClick(name.x, name.y);
    await s.waitFor(`document.querySelector('.group-heading-menu')?.dataset.group === ${JSON.stringify(stubKey)}`, "the stub group's heading menu");
    const headItems = await s.evalJs(`[...document.querySelectorAll('.group-heading-menu .menu-item')].map((b) => ({ label: b.querySelector('.menu-label')?.textContent ?? '', title: b.title }))`);
    expect(
      headItems.length === 4 && headItems[0].label === 'Copy path' && headItems[0].title === stubCwd && headItems[1].label.startsWith('Close all ') && headItems[2].label.startsWith('Kill all ') && headItems[3].label.endsWith(' and remove') && !headItems.some((i) => i.label === 'Reveal in Explorer'),
      `the stub heading menu is Copy path on the bare folder and the three sweeps, no Reveal in Explorer, got ${JSON.stringify(headItems)}`,
    );
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.group-heading-menu')`, 'the heading menu closed');
    step("fix 1096 (6): the stub group's + offers New Claude session here alone, and its heading copies the bare folder with no Reveal in Explorer");

    // M9 fix 1097 (7): forgetting stub takes its sessions off the window.
    const shellId = (await getTabs(s)).tabs.flatMap((t) => leaves(t)).find((p) => p.id === rowStubPane)?.sessionId ?? null;
    expect(shellId !== null, 'the row block\'s stub pane holds its shell');
    const stubIds = (await zreq(s, 'session.list', {})).sessions.filter((x) => x.host === 'stub').map((x) => x.id);
    expect(stubIds.includes(shellId), `the stub shell is listed before the forget, got ${JSON.stringify(stubIds)}`);
    await s.evalJs(`window.emerald.hostForget('stub')`);
    await s.waitFor(`${JSON.stringify(stubIds)}.every((id) => !document.querySelector('.sidebar-row[data-session-id=' + JSON.stringify(id) + ']'))`, 'every stub row off the sidebar after the forget', 5000);
    const afterForget = (await zreq(s, 'session.list', {})).sessions.filter((x) => x.host === 'stub');
    expect(afterForget.length === 0, `main lists no stub session after the forget, got ${JSON.stringify(afterForget.map((x) => x.id))}`);
    await s.waitFor(`!!${q(paneSel(rowStubPane) + ' .pane-state[data-state="unknown"]')}`, 'the stub pane reads unknown', 5000);
    step('fix 1097 (7): hostForget took every stub row off the sidebar, main lists none, and the stub pane reads unknown');

    // M9 fix 1097 (8): a later contact lists the shell again and its pane
    // is attached again.
    const from1097 = await pushCount();
    await s.evalJs(`window.emerald.hostConnect('stub')`);
    await waitPush(from1097, (m) => m.state === 'up', 'up after the forget', 20_000);
    await s.waitFor(`!!document.querySelector('section.sidebar-host[data-host="stub"] .sidebar-row[data-session-id=' + ${JSON.stringify(JSON.stringify(shellId))} + ']')`, 'the stub shell listed again in the stub section', 10_000);
    // The pane is a few columns wide by now, so the output wraps: the rows
    // are read joined, and the typed command spells the word in two
    // quoted halves so only the output holds it whole.
    await typeRaw(shellId, "echo ('marks-'+'1097')\r");
    await screenJoinedHas(shellId, 'marks-1097', 'marks-1097 on the stub shell');
    await s.waitFor(`(() => { const t = ${q(paneSel(rowStubPane) + ' .term-host')}?.emeraldTerm; if (!t) return false; const b = t.buffer.active; let all = ''; for (let i = 0; i < b.length; i++) all += (b.getLine(i)?.translateToString(true) ?? ''); return all.includes('marks-1097'); })()`, 'the stub pane printed marks-1097', 10_000);
    step('fix 1097 (8): a later contact listed the stub shell again and its pane, attached again, printed marks-1097');
  });

  await block('kit', async () => {
    // 1. The stub host as it was before any kit: no daemon, no folder.
    await s.evalJs(`window.emerald.hostForget('stub')`);
    // The record read before the stop (M9 fix 1093): a stop on the stub pipe
    // used to delete the kit daemon's record, so the kill read null.
    const kitRec = daemonRecord(R);
    cli(stubEnv, 'daemon', 'stop');
    killDaemonIfSame(kitRec);
    await sleep(500);
    fs.rmSync(R, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    // 2. The record with no kit.
    const { nodeVersion: _n, kitVersion: _k, ...bare } = stubRecord();
    await zreq(s, 'hosts.set', { host: bare });

    // 3. The fixtures: a stage, a Node zip and a node-pty tarball, all local.
    const { stage, stageDir } = await import('./stage.mjs');
    stage({ arch: stubArch });
    const kitStage = path.join(emeraldHome, 'kit-stage');
    fs.rmSync(kitStage, { recursive: true, force: true });
    fs.cpSync(stageDir, kitStage, { recursive: true });
    const nodeBase = path.join(emeraldHome, 'kit-node');
    const zipName = `node-v${kitNode}-win-${stubArch}.zip`;
    const zipDir = path.join(nodeBase, `v${kitNode}`);
    const zipTop = path.join(emeraldHome, 'kit-zip', `node-v${kitNode}-win-${stubArch}`);
    fs.rmSync(path.dirname(zipTop), { recursive: true, force: true });
    fs.mkdirSync(zipTop, { recursive: true });
    fs.mkdirSync(zipDir, { recursive: true });
    fs.copyFileSync(process.execPath, path.join(zipTop, 'node.exe'));
    // bsdtar's zip writes / in its entry names; Windows PowerShell 5.1's
    // Compress-Archive writes \, which no zip reader takes as a folder.
    fs.rmSync(path.join(zipDir, zipName), { force: true });
    execFileSync('tar.exe', ['-a', '-cf', path.join(zipDir, zipName), '-C', path.dirname(zipTop), path.basename(zipTop)], { windowsHide: true });
    const zipSha = createHash('sha256').update(fs.readFileSync(path.join(zipDir, zipName))).digest('hex');
    fs.writeFileSync(path.join(zipDir, 'SHASUMS256.txt'), `${zipSha}  ${zipName}\n`);
    const ptyPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'node_modules', 'node-pty', 'package.json'), 'utf8'));
    const npmBase = path.join(emeraldHome, 'kit-npm');
    const ptyDir = path.join(npmBase, 'node-pty', '-');
    fs.rmSync(npmBase, { recursive: true, force: true });
    fs.mkdirSync(ptyDir, { recursive: true });
    // --ignore-scripts: npm pack of a folder runs node-pty's prepare, a tsc
    // build of its sources that fails here, before it packs.
    execSync(`npm pack "${path.join(repoRoot, 'node_modules', 'node-pty')}" --ignore-scripts --pack-destination "${ptyDir}"`, { stdio: 'ignore', windowsHide: true });
    const tgz = path.join(ptyDir, `node-pty-${ptyPkg.version}.tgz`);
    expect(fs.existsSync(tgz), `npm pack wrote ${tgz}`);
    const integrity = `sha512-${createHash('sha512').update(fs.readFileSync(tgz)).digest('base64')}`;
    const pinsFile = path.join(kitStage, 'kit-pins.json');
    const pins = fs.existsSync(pinsFile) ? JSON.parse(fs.readFileSync(pinsFile, 'utf8')) : {};
    fs.writeFileSync(pinsFile, JSON.stringify({ ...pins, nodePty: { version: ptyPkg.version, integrity } }, null, 2));
    step(`fix 1083 (3): the fixtures: a stage, ${zipName} with its SHASUMS256.txt, node-pty-${ptyPkg.version}.tgz with its integrity pinned`);

    // Main's environment is fixed at launch, so the window starts again on
    // the same home and daemon with the kit's three knobs.
    s.close();
    killTree(s.child);
    await sleep(1500);
    s = await launch(freshPort(), {
      env: { ...launchEnv, EMERALD_KIT_STAGE: kitStage, EMERALD_KIT_NODE_URL: pathToFileURL(nodeBase).href, EMERALD_KIT_NPM_URL: pathToFileURL(npmBase).href },
    });
    app = s;
    await listenPushes();

    // 4. First contact.
    const layout = await getTabs(s);
    const tab = layout.tabs.find((t) => t.id === layout.currentTabId);
    const holder = leaves(tab).find((p) => p.sessionId !== null) ?? leaves(tab)[0];
    // Run with --only (relay then kit), the tab is one empty pane, which
    // draws no title row and so no split button: that pane is the kit's
    // (M9 fix 1166, which first ran the block that way).
    await s.waitFor(`!!${q(paneSel(holder.id))}`, 'the holder pane drawn');
    const holderEmpty = await s.evalJs(`!!${q(paneSel(holder.id) + ' .empty-pane')} && !${q(paneSel(holder.id) + ' .pane-split-right')}`);
    const kitPane = holderEmpty ? holder.id : await splitEmpty(holder.id);
    const K = paneSel(kitPane);
    await s.evalJs(`${q(K + ' .empty-kind[data-kind="shell"]')}.click()`);
    await s.evalJs(`${q(K + ' .empty-host[data-host="stub"]')}.click()`);
    await s.waitFor(`${q(K + ' .empty-in-wait')}?.textContent === 'The folders on stub show once it answers.' && ${q(K + ' .empty-start')}?.hasAttribute('data-dim')`, 'the folders wait and Start dims', 15_000);
    await s.waitFor(`${q(K + ' .empty-setup-line')}?.textContent === ${JSON.stringify(`Setting up stub: copying emerald's daemon ${appVersion} there, the first time only`)}`, 'the setup line', 30_000);
    await s.waitFor(`/^\\d+(\\.\\d+)? MB, \\d+ s$/.test(${q(K + ' .empty-setup-figure')}?.textContent ?? '') && !!${q(K + ' .empty-setup-bar')} && ${q(K + ' .empty-host[data-host="stub"] .empty-host-sub')}?.textContent === 'setting up'`, 'the figure, the bar and the sub-line', 30_000);
    step('fix 1084 (4): first contact: the folders wait, Start dims, the setup line, its figure, its bar and setting up under stub');

    // 5. Done.
    await s.waitFor(`!${q(K + ' .empty-in-wait')}`, 'the folders once the kit answers', 120_000);
    const rec = (await zreq(s, 'hosts.list', {})).hosts.find((x) => x.name === 'stub');
    expect(rec?.kitVersion === appVersion && rec.nodeVersion === kitNode, `the record carries the kit, got ${JSON.stringify(rec)}`);
    expect(fs.existsSync(path.join(R, appVersion, 'cli', 'dist', 'main.js')) && fs.existsSync(path.join(R, `node-${kitNode}`, 'node.exe')), 'the kit and its Node unpacked under R');
    const tgzLeft = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name));
        else if (e.name.endsWith('.tgz')) tgzLeft.push(path.join(d, e.name));
      }
    };
    walk(R);
    expect(tgzLeft.length === 0, `no archive left under R, got ${JSON.stringify(tgzLeft)}`);
    const scpLines = fs.readFileSync(path.join(H, 'stub-scp.log'), 'utf8').trim().split('\n');
    expect(scpLines.length === 2, `two copies, got ${scpLines.length}`);
    step('fix 1084 (5): the kit copied in two archives, unpacked with none left, the record pinned to it');

    // 6. A shell through the kit's own relay, CLI and daemon.
    const terms = await s.evalJs(`document.querySelectorAll('.term-host').length`);
    await s.waitFor(`${q(K + ' .empty-start')}?.disabled === false`, 'Start ready on stub', 15_000);
    await s.evalJs(`${q(K + ' .empty-start')}.click()`);
    await s.waitFor(`document.querySelectorAll('.term-host').length === ${terms + 1}`, 'a shell on the kit', 15_000);
    const kitShell = (await zreq(s, 'session.list', {})).sessions.filter((x) => x.host === 'stub' && x.state !== 'exited').sort((a, b) => b.createdAt - a.createdAt)[0];
    await typeRaw(kitShell.id, 'echo kit-1083\r');
    await screenHas(kitShell.id, 'kit-1083', 'kit-1083 through the kit');
    // The last relay line: the kit's prune of old kits runs over ssh right
    // after the connect, so the log's very last line may be that.
    const kitArgv = fs
      .readFileSync(sshLog, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l.slice(l.indexOf(' ') + 1)))
      .filter((a) => a.includes('relay'))
      .pop() ?? [];
    const kitNodePath = (kitArgv.find((w) => w.endsWith('node.exe"')) ?? '').replace(/"/g, '');
    expect(kitNodePath !== '' && fs.existsSync(kitNodePath), `the relay ran the kit's own node, ${kitNodePath}`);
    step("fix 1083 (6): a shell through the kit's own node, relay and daemon read back kit-1083");

    // 7. M9 fix 1166: a file restaged at the same version reaches the host.
    // The setup wrote the stage's id on the record; a file added to the
    // stage moves it, so the next contact stops the kit's daemon (started
    // through WMI by step 5's relay) and sets the host up again.
    const rec1166 = (await zreq(s, 'hosts.list', {})).hosts.find((x) => x.name === 'stub');
    expect(/^[0-9a-f]{64}$/.test(rec1166?.kitStage ?? ''), `the record carries the stage's id, got ${JSON.stringify(rec1166)}`);
    const pid1166 = daemonRecord(R)?.pid;
    const assembled = () => (s.logs.join('').match(/remote kit win32-\S+ \S+: .* assembled in /g) ?? []).length;
    const before1166 = assembled();
    fs.writeFileSync(path.join(kitStage, 'daemon', 'dist', 'stage-1166.txt'), 'restaged-1166\n');
    await s.evalJs(`window.emerald.hostForget('stub')`);
    const from1166 = await pushCount();
    await s.evalJs(`void window.emerald.hostConnect('stub')`);
    const restagedFile = path.join(R, appVersion, 'daemon', 'dist', 'stage-1166.txt');
    const fileBy = Date.now() + 120_000;
    while (!fs.existsSync(restagedFile) && Date.now() < fileBy) await sleep(300);
    expect(fs.existsSync(restagedFile), `the restaged file reached the host at ${restagedFile}`);
    const up1166 = await waitPush(from1166, (m) => m.state === 'up' && m.daemon?.pid !== pid1166, 'stub up on the restaged kit', 120_000);
    const mainLog = s.logs.join('');
    expect(assembled() === before1166 + 1, `the kit assembled once more (${assembled()} against ${before1166})`);
    expect(mainLog.includes('host stub: the stage moved since its kit was copied, setting it up again'), 'main logged the moved stage');
    expect(mainLog.includes(`host stub: emmerd pid ${pid1166} kept`), `main logged the kit daemon pid ${pid1166} stopped first`);
    expect(daemonRecord(R)?.pid === up1166.daemon.pid, `the host's daemon.json names the new daemon (${daemonRecord(R)?.pid} against ${up1166.daemon.pid})`);
    const rec1166b = (await zreq(s, 'hosts.list', {})).hosts.find((x) => x.name === 'stub');
    expect(/^[0-9a-f]{64}$/.test(rec1166b?.kitStage ?? '') && rec1166b.kitStage !== rec1166.kitStage, `the record's stage id moved, got ${rec1166b?.kitStage} after ${rec1166.kitStage}`);
    const scp1166 = fs.readFileSync(path.join(H, 'stub-scp.log'), 'utf8').trim().split('\n');
    expect(scp1166.length === 3 && scp1166[2].includes(`emerald-${appVersion}.tgz`), `a third copy, the emerald archive alone, got ${JSON.stringify(scp1166)}`);
    step('fix 1166 (7): a file restaged at the same version reached the host: assembled again, the host daemon stopped first, the emerald archive copied alone and unpacked, a new daemon on it');

    // 8. A Linux host.
    setModes({ stub: 'linux' });
    await s.evalJs(`window.emerald.hostForget('stub')`);
    await zreq(s, 'hosts.set', { host: { name: 'stub', destination: 'stub', home: H, addedAt: Date.now() } });
    const kitShellPane = (await layoutPane(kitShell.id))?.id ?? kitPane;
    const linuxPane = await splitEmpty(kitShellPane);
    const L = paneSel(linuxPane);
    await s.evalJs(`${q(L + ' .empty-host[data-host="stub"]')}.click()`);
    try {
      await s.waitFor(`${q(L + ' .empty-error[data-reason="linux"]')}?.textContent === 'stub runs Linux, and a pane there waits for a Linux build of emerald.'`, 'the Linux refusal', 30_000);
    } catch (err) {
      const shown = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(L + ' .empty-error')})].map((e) => (e.dataset.reason ?? '') + ': ' + e.textContent)`);
      const sub = await s.evalJs(`${q(L + ' .empty-host[data-host="stub"] .empty-host-sub')}?.textContent ?? null`);
      const rec = (await zreq(s, 'hosts.list', {})).hosts.find((x) => x.name === 'stub');
      const tail = fs.readFileSync(sshLog, 'utf8').trim().split('\n').slice(-3);
      throw new Error(`${err.message}: errors ${JSON.stringify(shown)}, sub ${JSON.stringify(sub)}, record ${JSON.stringify(rec)}, ssh log ${JSON.stringify(tail)}`);
    }
    expect(!(await s.evalJs(`!!${q(L + ' .empty-error-act')}`)), 'the Linux refusal has no button');
    step('fix 1084 (8): a Linux host is refused with no button');
  });

  await block('restart', async () => {
    // M9 fix 1165: an older kit's daemon on the host, read as a row of the
    // daemon banner, and its Restart. The window as kit leaves it: stub
    // forgotten and written back bare, modes { stub: 'linux' }, the kit's
    // daemon (fix 1166's re-setup started it through WMI) on R's pipe.
    // 1. The old kit beside this one, its daemon started through its own
    // relay, as an older app's first contact would.
    await s.evalJs(`window.emerald.hostForget('stub')`);
    setModes({});
    const kitRec = daemonRecord(R);
    killDaemonIfSame(kitRec);
    await sleep(500);
    const oldV = appVersion.replace(/\d+$/, (n) => String(Number(n) - 1));
    fs.rmSync(path.join(R, oldV), { recursive: true, force: true });
    fs.cpSync(path.join(R, appVersion), path.join(R, oldV), { recursive: true });
    const oldPkgFile = path.join(R, oldV, 'daemon', 'package.json');
    fs.writeFileSync(oldPkgFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(oldPkgFile, 'utf8')), version: oldV }, null, 2));
    // stub-ssh.mjs's own env, so the pipe is the one R gives.
    const relayEnv = { ...process.env, USERPROFILE: H, HOME: H, HOMEPATH: H, SSH_CONNECTION: '127.0.0.1 50022 127.0.0.1 22', CLAUDE_CONFIG_DIR: path.join(H, '.claude'), CLAUDE_SETTINGS: path.join(H, '.claude', 'settings.json') };
    delete relayEnv.EMERALD_HOME;
    delete relayEnv.EMERALD_PIPE;
    // The empty stdin ends the relay once it has started the daemon through WMI.
    const oldRelay = spawnSync(path.join(R, `node-${kitNode}`, 'node.exe'), [path.join(R, oldV, 'cli', 'dist', 'main.js'), 'relay', '--home', R], { env: relayEnv, input: '', encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    expect(oldRelay.status === 0 && daemonRecord(R) !== null, `the old kit's relay started its daemon (${oldRelay.status}: ${oldRelay.stdout}${oldRelay.stderr})`);
    step(`fix 1165 (1): the old kit ${oldV} beside ${appVersion} under R, its daemon started through its own relay`);

    // 2. A record naming this kit, with no kitStage so fix 1166's compare is
    // skipped; the connect meets the old daemon.
    await zreq(s, 'hosts.set', { host: stubRecord() });
    let from = await pushCount();
    await s.evalJs(`window.emerald.hostConnect('stub')`);
    const old = await waitPush(from, (m) => m.state === 'up', 'stub up on the old kit', 30_000);
    expect(old.daemon.version === oldV && old.daemon.pid === daemonRecord(R)?.pid, `up on the old kit's daemon, got ${JSON.stringify(old.daemon)} against ${JSON.stringify(daemonRecord(R))}`);
    const shell1165 = await startSession(s, { kind: 'shell', cwd: H, host: 'stub' });
    const row = '.daemon-banner[data-host="stub"]';
    const text1165 = `emmerd on stub runs the ${oldV} kit, and this app ships ${appVersion}. Restart it to get the new features; running sessions on stub come back as exited and can be resumed.`;
    try {
      await s.waitFor(
        `(() => { const r = ${q(row)}; return !!r && r.dataset.reason === 'host' && r.dataset.daemonPid === ${JSON.stringify(String(old.daemon.pid))} && r.querySelector('.daemon-banner-text')?.textContent === ${JSON.stringify(text1165)} && r.querySelector('.daemon-restart')?.textContent === 'Restart emmerd' && r.querySelector('.daemon-dismiss')?.textContent === 'Not now'; })()`,
        "stub's row of the daemon banner",
        10_000,
      );
    } catch (err) {
      const seen = await s.evalJs(`[...document.querySelectorAll('.daemon-banner')].map((b) => ({ ...b.dataset, text: b.textContent }))`);
      throw new Error(`${err.message}: banners ${JSON.stringify(seen)}`);
    }
    expect(fs.existsSync(path.join(R, oldV)), 'the old kit still there before the Restart');
    step(`fix 1165 (2): stub up on the ${oldV} kit's daemon under a record naming ${appVersion}, its banner row with Restart, the old kit still there`);

    // 3. The Restart, watched for a lost band.
    await s.evalJs(`(() => { window.__band1165 = false; new MutationObserver(() => { if (document.querySelector('.host-lost-note')) window.__band1165 = true; }).observe(document.body, { subtree: true, childList: true }); return true; })()`);
    const prunedBefore = s.logs.join('').split('host stub: old kits removed').length;
    from = await pushCount();
    await s.evalJs(`${q(row + ' .daemon-restart')}.click()`);
    const back = await waitPush(from, (m) => m.state === 'up' && m.daemon?.pid !== old.daemon.pid, 'stub up on a new daemon', 30_000);
    expect(back.daemon.version === appVersion && back.daemon.pid === daemonRecord(R)?.pid, `up on the new kit's daemon, got ${JSON.stringify(back.daemon)} against ${JSON.stringify(daemonRecord(R))}`);
    const since = await s.evalJs(`window.__hostPushes.slice(${from}).filter((m) => m.host === 'stub').map((m) => m.state)`);
    expect(!since.includes('lost') && !since.includes('connecting'), `no lost or connecting push through the Restart, got ${JSON.stringify(since)}`);
    expect((await s.evalJs(`window.__band1165`)) === false, 'no lost band drawn through the Restart');
    await s.waitFor(`!${q(row)}`, "stub's row gone", 5000);
    const prunedBy = Date.now() + 15_000;
    while ((s.logs.join('').split('host stub: old kits removed').length <= prunedBefore || fs.existsSync(path.join(R, oldV))) && Date.now() < prunedBy) await sleep(300);
    const prunedLogged = s.logs.join('').split('host stub: old kits removed').length > prunedBefore;
    expect(prunedLogged && !fs.existsSync(path.join(R, oldV)), `the old kit removed at the new daemon's connect (logged ${prunedLogged}, folder there ${fs.existsSync(path.join(R, oldV))})`);
    expect((await listed(shell1165))?.state === 'exited', `the shell came back exited, got ${(await listed(shell1165))?.state}`);
    step("fix 1165 (3): Restart brought stub up on the new kit's daemon with no lost push or band, the row went, the old kit was removed and the shell came back exited");
  });

  await block('clip', async () => {
    // M9 fix 1091: OSC 52 and OSC 8 in a pane's terminal. A local shell in a
    // tab of its own (never kind Claude on stub: the kit's WMI-started daemon
    // runs on the person's registry environment), so nothing remote is read.
    const tabsBefore = (await getTabs(s)).tabs.length;
    await s.evalJs(`${q('.tab-add')}.click()`);
    await s.waitFor(`(async () => (await window.emerald.request('layout.get', {})).layout.tabs.length === ${tabsBefore + 1})()`, 'a new tab for the clip block');
    let layout = await getTabs(s);
    const first = leaves(layout.tabs.find((t) => t.id === layout.currentTabId))[0];
    const { session: clipShell } = await zreq(s, 'session.spawn', { kind: 'shell', shell: 'powershell', cwd: os.homedir(), cols: 80, rows: 24 });
    layout = await getTabs(s);
    await zreq(s, 'layout.set', { layout: { ...layout, tabs: layout.tabs.map((t) => (t.id === layout.currentTabId ? { ...t, root: { ...first, sessionId: clipShell.id } } : t)) } });
    const clipPane = first.id;
    const clipHost = paneSel(clipPane) + ' .term-host';
    await s.waitFor(`!!${q(clipHost)}?.emeraldTerm`, 'the clip shell in its tab');
    const keptClipboard = await s.evalJs(`window.emerald.clipboard.read().then((r) => r.text)`);
    await s.evalJs(`window.emerald.clipboard.write('before-1091')`);

    // 2. The fixture: an OSC 8 link wrapped over two rows by the program's
    // own line break, then an OSC 52 write. ASCII only, since PowerShell 5.1
    // reads a BOM-less file as ANSI; the discard port refuses at once.
    const url = 'http://127.0.0.1:9/login-1091?state=' + 'x'.repeat(60);
    const fixture = path.join(emeraldHome, 'osc-1091.ps1');
    fs.writeFileSync(
      fixture,
      [
        '$e = [char]27; $b = [char]7',
        "$u = 'http://127.0.0.1:9/login-1091?state=' + ('x' * 60)",
        '[Console]::Write("$e]8;;$u$e\\" + $u.Substring(0, 40) + "`r`n" + $u.Substring(40) + "$e]8;;$e\\`r`n")',
        "[Console]::Write(\"$e]52;c;\" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('clip-1091 ' + [char]0xE9)) + \"$b\")",
        "Write-Output 'osc-1091 done'",
      ].join('\r\n') + '\r\n',
      'ascii',
    );
    await sleep(1500);
    await typeRaw(clipShell.id, `& '${fixture}'\r`);
    const printed = async () => (await termText(clipPane)).includes('osc-1091 done');
    const until = Date.now() + 15_000;
    while (!(await printed()) && Date.now() < until) await sleep(250);
    expect(await printed(), `the fixture ran in the clip shell: ${JSON.stringify((await termText(clipPane)).filter((l) => l !== '').slice(-6))}`);

    // 3. The copy.
    await s.waitFor(`window.emerald.clipboard.read().then((r) => r.text === 'clip-1091 é')`, 'the OSC 52 write on the held clipboard', 5000);
    await s.waitFor(`document.querySelector('.corner-note')?.textContent === 'Copied 11 characters'`, 'the copied note', 5000);
    step('fix 1091 (1): a shell\'s OSC 52 write landed on the window\'s clipboard with the copied note');

    // 4. The link: the middle of the second row, which holds only the
    // URL's tail, so no web-links regex finds a URL there and only the OSC 8
    // link (the whole URI) can answer the hover.
    const tail = url.slice(40);
    const tailCell = await s.evalJs(
      `(() => { const host = document.querySelector(${JSON.stringify(clipHost)}); const t = host?.emeraldTerm; if (!t) return null; const b = t.buffer.active; for (let i = 0; i < b.length; i++) { const text = b.getLine(i)?.translateToString(true) ?? ''; if (text.trim() === ${JSON.stringify(tail)}) { const at = text.indexOf(${JSON.stringify(tail)}); const cell = t._core._renderService.dimensions.css.cell; const r = host.querySelector('.xterm-screen').getBoundingClientRect(); return { x: r.left + (at + ${Math.floor(tail.length / 2)}) * cell.width, y: r.top + (i - b.viewportY) * cell.height + cell.height / 2 }; } } return null; })()`,
    );
    expect(tailCell !== null, `the URL's second row on the clip pane: ${JSON.stringify((await termText(clipPane)).filter((l) => l !== '').slice(-6))}`);
    const screenEvent = (type, at, extra = '') =>
      s.evalJs(`document.querySelector(${JSON.stringify(clipHost + ' .xterm-screen')}).dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { clientX: ${at.x}, clientY: ${at.y}, bubbles: true, cancelable: true, button: 0 ${extra} }))`);
    await screenEvent('mousemove', tailCell);
    await s.waitFor(`${q(clipHost)}?.dataset.link === ${JSON.stringify(url)} && ${q(clipHost)}?.title === ${JSON.stringify(`Ctrl+click opens ${url} in a pane beside`)}`, 'the whole URL and its tooltip on the host from the second row', 5000);
    await screenEvent('mousedown', tailCell, ', ctrlKey: true');
    await screenEvent('mouseup', tailCell, ', ctrlKey: true');
    const browserLeaf = async () => {
      const l = await getTabs(s);
      return leaves(l.tabs.find((t) => t.id === l.currentTabId)).find((p) => p.view?.kind === 'browser' && p.view.url === url) ?? null;
    };
    const opened = Date.now() + 5000;
    while ((await browserLeaf()) === null && Date.now() < opened) await sleep(150);
    const leaf = await browserLeaf();
    expect(leaf !== null && JSON.stringify(leaf.view) === JSON.stringify({ kind: 'browser', url }), `the Ctrl+click opened a browser pane on the whole URL, got ${JSON.stringify(leaf?.view ?? null)}`);
    await s.evalJs(`${q(paneSel(leaf.id) + ' .pane-hide')}.click()`);
    await s.waitFor(`!${q(paneSel(leaf.id))}`, 'the browser pane closed');
    step('fix 1091 (2): an OSC 8 link wrapped over two rows opened whole by a Ctrl+click on its second row, in a browser pane beside');

    // 5. The replay: a reload replays the ring's raw bytes, OSC 52 and all,
    // which must copy nothing.
    await s.evalJs(`window.emerald.clipboard.write('after-1091')`);
    await s.send('Page.reload');
    await s.waitFor(`(() => { const t = ${q(clipHost)}?.emeraldTerm; if (!t) return false; const b = t.buffer.active; for (let i = 0; i < b.length; i++) if ((b.getLine(i)?.translateToString(true) ?? '').trimEnd() === 'osc-1091 done') return true; return false; })()`, 'the clip pane replayed osc-1091 done after the reload', 15_000);
    await sleep(1500);
    const afterReload = await s.evalJs(`window.emerald.clipboard.read().then((r) => r.text)`);
    expect(afterReload === 'after-1091', `a reload's replay copied nothing, the clipboard holds ${JSON.stringify(afterReload)}`);
    step('fix 1091 (3): a reload\'s replay of the OSC 52 copied nothing');

    // 6. The kept clipboard text back.
    await s.evalJs(`window.emerald.clipboard.write(${JSON.stringify(keptClipboard ?? '')})`);
  });

  await block('cli', async () => {
    // M9 fixes 1167 and 1168: the CLI on the harness pair names the stub;
    // its daemon carries the ask to this window, whose main holds the line
    // to the host. A shell, never kind Claude: the stub's daemon runs on
    // the person's registry PATH, so a Claude there would be their own.
    // Run whole, the stub is up on the kit's own daemon (or the Linux mode
    // and a bare record the kit block left); run alone, idle on the
    // prelude's record. These two lines put either right and change
    // nothing on an up stub.
    setModes({});
    await zreq(s, 'hosts.set', { host: stubRecord() });

    // 1. emmer shell --host stub ~.
    let r = cli(process.env, 'shell', '--host', 'stub', '~', '--shell', 'powershell', '--name', 'cli-1167', '--json');
    expect(r.code === 0, `emmer shell --host stub exit 0, got ${r.code}: ${r.out}${r.err}`);
    const cliShell = JSON.parse(r.out).session;
    expect(cliShell.host === 'stub' && cliShell.kind === 'shell' && cliShell.name === 'cli-1167' && cliShell.shell === 'powershell', `the CLI-started session is a powershell named cli-1167 on stub, got ${JSON.stringify(cliShell)}`);
    expect(fs.realpathSync.native(cliShell.spawnCwd).toLowerCase() === fs.realpathSync.native(H).toLowerCase(), `~ is the stub's home, got ${cliShell.spawnCwd}`);
    expect((await layoutPane(cliShell.id)) === null, 'a CLI start has no pane');
    await s.waitFor(`!!${q(`section.sidebar-host[data-host="stub"] .sidebar-row[data-session-id=${JSON.stringify(cliShell.id)}]`)}`, 'the CLI-started row in the stub section', 10_000);
    expect(!cli(process.env, 'ls', '--json').out.includes(cliShell.id), 'plain emmer ls on the harness pair does not list it');
    step('fix 1167 (1): emmer shell --host stub ~ started a powershell in the stub home, no pane, its row in the stub section');

    // 2. Typed into through the window, by its id.
    await sleep(1500);
    await typeRaw(cliShell.id, 'echo cli-1167\r');
    await screenHas(cliShell.id, 'cli-1167', 'cli-1167 on the CLI-started stub shell');
    step('fix 1167 (2): typed into the CLI-started shell through the window and read back');

    // 3. The refusals that need the window.
    r = cli(process.env, 'shell', '--host', 'nosuch', '~');
    expect(r.code === 1 && r.err.trim() === 'emmer: no host named nosuch; the window lists stub', `an unknown host: exit 1 and one line, got ${r.code} ${JSON.stringify(r.err)}`);
    const missing = path.join(H, 'no-such-1167');
    r = cli(process.env, 'shell', '--host', 'stub', missing);
    expect(r.code === 1 && r.err.trim() === `emmer: stub: cwd does not exist: ${missing}`, `a missing folder on stub: exit 1 and one line, got ${r.code} ${JSON.stringify(r.err)}`);
    step('fix 1167 (3): an unknown host and a missing folder on stub are one line each, exit 1');

    // 4. M9 fix 1168: emmer ls --host stub, the JSON and the text.
    r = cli(process.env, 'ls', '--host', 'stub', '--json');
    expect(r.code === 0, `emmer ls --host stub --json exit 0, got ${r.code}: ${r.err}`);
    const rows = JSON.parse(r.out).sessions;
    const row = rows.find((x) => x.id === cliShell.id);
    expect(row?.host === 'stub' && row.name === 'cli-1167', `ls --host stub lists cli-1167 stamped stub, got ${JSON.stringify(row)}`);
    expect(rows.every((x) => x.host === 'stub'), `every row of ls --host stub is the stub's, got ${JSON.stringify(rows.map((x) => x.host))}`);
    r = cli(process.env, 'ls', '--host', 'stub');
    expect(r.code === 0 && !r.out.includes('\u0000'), `emmer ls --host stub exit 0 with no NUL, got ${r.code} ${JSON.stringify(r.out)}`);
    const textLines = r.out.split(/\r?\n/);
    expect(textLines.some((l) => l === row.groupCwd || l.startsWith(`${row.groupCwd}  `)), `a heading of the folder ${row.groupCwd}, got ${JSON.stringify(textLines)}`);
    expect(textLines.some((l) => l.startsWith(`  ${cliShell.id.slice(0, 8)}  `) && / shell +cli-1167$/.test(l)), `the cli-1167 row, got ${JSON.stringify(textLines)}`);
    step('fix 1168 (1): emmer ls --host stub lists the stub\'s sessions, the CLI-started shell among them, headed by its folder with no NUL');

    // 5. An unknown host.
    r = cli(process.env, 'ls', '--host', 'nosuch');
    expect(r.code === 1 && r.err.trim() === 'emmer: no host named nosuch; the window lists stub', `ls --host nosuch: exit 1 and one line, got ${r.code} ${JSON.stringify(r.err)}`);
    step('fix 1168 (2): ls --host on an unknown host is the one line, exit 1');

    // The clean-up: the shell exits, so the block leaves the stub as it found it.
    await typeRaw(cliShell.id, 'exit\r');
    await s.waitFor(`(async () => (await window.emerald.request('session.list', { removed: true })).sessions.find((x) => x.id === ${JSON.stringify(cliShell.id)})?.state === 'exited')()`, 'the cli-1167 shell listed exited', 10_000);
  });

  step(`PASS (${blocksRun()})`);
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m76-remote-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  // The stub host's daemon: the CLI's stop, then whichever daemon last
  // wrote R's daemon.json (the WMI-started one, the kit's), by its start
  // time as well as its pid, read before the stop, which on the stub pipe
  // used to delete the kit daemon's record (M9 fix 1093).
  const lastRec = daemonRecord(R);
  cli(stubEnv, 'daemon', 'stop');
  killDaemonIfSame(lastRec);
  killUnderStubHome();
  setTimeout(() => process.exit(), 500);
}
