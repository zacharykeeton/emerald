import { app, BrowserWindow, ClipboardItem, Menu, clipboard, dialog, ipcMain, nativeImage, powerMonitor, protocol, screen, session, shell } from 'electron';
import type { WebContents } from 'electron';
import { BROWSER_PARTITION, FIRST_WINDOW_ID, frontWindow, isLocalPageUrl, LOCAL_PAGE_SCHEME, paneShowingIn, windowHolding, windowsOf } from '@emerald/shared';
import { Readable } from 'node:stream';
import { answerLocalPage, LOCAL_PAGE_HEADERS, localRequestAllowed, localRootIn } from './local-page.ts';
import type { Layout } from '@emerald/shared';
import { PtyBroker } from './pty-broker.ts';
import { WindowSets, backgroundSpot, cascadeBounds, planWindows } from './window-plan.ts';
import { attachRefusal, chromeUserAgent, forceGuestPreferences, guestNavigationAllowed, signInBounds, signInPopup } from './browser-guard.ts';
import { GuestKeys } from './guest-keys.ts';
import type { GuestChord, GuestVerdict } from './guest-keys.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ClientMessage, RequestType, Requests, ServerMessage, UsageEdge } from '@emerald/shared';
import type { AttentionRequest, ChimeMode, DaemonCrash, FileStamp, HooksInstallResult, HooksStatus, HooksTestResult, NotifyRequest, RendererPush, SearchMode, TailMark, TextFormat, UsageAsk, UsageWindow, UserConfig, WhatsNewRead } from '../preload/api.ts';
import { runCliJson } from './cli.ts';
import { HooksWatch, isHookTestOutcome, parseHooksStatus } from './hooks-watch.ts';
import { FolderWatchers, LIST_CAP, listFolder, openExternal, openFolder, openPath, readFile, readTail, revealPath, statPath } from './files.ts';
import { realPath } from './real-path.ts';
import { SearchRuns, searchContents, searchNames } from './search-files.ts';
import { createFile, makeFolder, heldTrash, renameEntry, trashEntry, writeFileText } from './file-write.ts';
import { folderIcon, folderIconForget } from './folder-icon.ts';
import { GitLogWatcher, gitChanges, gitGraph, gitInit, gitLog, gitProjectCounts, gitReview, gitRevert, gitShow, gitStatus } from './git-status.ts';
import type { Runner } from './node-runner.ts';
import { createNotifier } from './notify.ts';
import type { NotifyOutcome } from './notify.ts';
import { rendererLogLine } from './renderer-log.ts';
import { awayAfterMs, IDLE_POLL_MS, PresenceTracker } from './presence.ts';
import { createTaskbar } from './taskbar.ts';
import { createUseRecord } from './use-record.ts';
import { applySkin, chromeOf, currentSkin, initSkin, TITLE_BAR_HEIGHT } from './skin.ts';
import { PipeClient } from './pipe-client.ts';
import { listSchemes, windowsTerminalSettingsFiles } from './schemes.ts';
import { HistoryWatcher, readAgentsRunning, readTranscriptCost, readTurns, readUsage, repoRoot, scanHistory } from './history.ts';
import { claudeHome } from './claude-home.ts';
import { readSkills } from './skills.ts';
import { savePastedPng } from './paste-file.ts';
import { startLoopDelayLog } from './loop-delay.ts';
import { rotateLogAtStart } from './log-rotate.ts';
import { setGitRunnerLog } from './git-runner.ts';
import { fetchUsage } from './usage.ts';
import { cappedEdges, cappedNow, usageByKey } from './usage-edges.ts';
import { autoUpdater } from 'electron-updater';
import { createUpdater, updateFeedSpec } from './updater.ts';
import { postGapPoster, postInstallPoster } from './install-poster.ts';
import { gapNotice, gapState, readMarker, writeMarker } from './install-gap.ts';
import { wireUpdateRelay } from './update-relay.ts';
import { openExtraOf, reloadHolding, wireFileOpenRelay } from './file-open-relay.ts';
import type { OpenRequest } from './file-open-relay.ts';
import { launchArgument, launchLabel } from './launch-argument.ts';
import type { LaunchKind } from './launch-argument.ts';
import { wireBrowserDriver } from './browser-driver.ts';
import { wireDesignMode } from './design-wire.ts';
import { sweepGiveUpLine, sweepLine, sweepPending, updaterCacheDir } from './updater-cache.ts';
import { pruneShots } from './shot-prune.ts';
import { inspectPort } from './inspect.ts';
import { pipePathOf, emeraldHomeOf } from '@emerald/shared/pipe-name';
import type { UpdateState } from '../renderer/src/update-model.ts';
import { USAGE_FLOOR_MS } from '../renderer/src/usage-model.ts';
import { WINDOWS_LEVEL } from '../renderer/src/daemon-model.ts';
import type { DaemonInfo } from './pipe-client.ts';

// Where emmerd's main.js lives. In development this file is bundled to
// packages/app/out/main/index.js, so the daemon's build sits three levels up
// (app.getAppPath() is not used because it points at the script directory
// when Electron is launched by file path). Installed, scripts/stage.mjs put
// the daemon under Electron's resources directory next to app.asar.
// EMERALD_DAEMON_MAIN overrides both, the same as for the CLI.
function resolveDaemonMain(): string {
  const override = process.env['EMERALD_DAEMON_MAIN'];
  if (override !== undefined) return override;
  if (app.isPackaged) return path.join(process.resourcesPath, 'daemon', 'dist', 'main.js');
  return path.resolve(__dirname, '..', '..', '..', 'daemon', 'dist', 'main.js');
}

// The CLI sits next to the daemon in both layouts.
function resolveCliMain(): string {
  const override = process.env['EMERALD_CLI_MAIN'];
  if (override !== undefined) return override;
  if (app.isPackaged) return path.join(process.resourcesPath, 'cli', 'dist', 'main.js');
  return path.resolve(__dirname, '..', '..', '..', 'cli', 'dist', 'main.js');
}

// The shipped colour schemes (M9 fix 225) sit beside the daemon and the
// CLI in the installed tree (scripts/stage.mjs copies the folder), and in
// a checkout under packages/app/resources.
function resolveSchemesDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'schemes');
  return path.resolve(__dirname, '..', '..', 'resources', 'schemes');
}

// The release notes the What's New tab shows (M9 fix 227). Installed,
// scripts/stage.mjs put the file under resources/ next to the daemon; in
// development it is the checkout's docs/WHATS-NEW.md, four levels up
// from packages/app/out/main.
function resolveWhatsNew(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'WHATS-NEW.md');
  return path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'WHATS-NEW.md');
}

// The app's own version (M9 fix 234, the app menu's What's new hint;
// M9 fix 239's scheme, 0.1.<first fix id of the batch it came from>):
// app.getVersion() reads the packaged build's package.json, but in
// development Electron is launched by file path and answers its own
// version (44.3.0), so the checkout's packages/app/package.json is read
// instead, two levels up from packages/app/out/main.
function appVersion(): string {
  if (app.isPackaged) return app.getVersion();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as { version?: string };
    if (typeof pkg.version === 'string') return pkg.version;
  } catch {
    // Fall through to Electron's answer.
  }
  return app.getVersion();
}

// The main process's log goes to stdout, which the verify scripts read,
// and since M9 fix 99 to <EMERALD_HOME>/logs/main.log beside the daemon's
// emmerd.log, since the installed exe's stdout goes nowhere and the one
// line that said why the usage strip was unavailable was lost with it.
// Appended per line, moved aside to main.1.log past 8 MB at a start (M9
// fix 559), and a write that fails never takes the app down. The rotation
// runs before the first line, so the whole start lands in the new file.
const mainLogPath = path.join(emeraldHomeOf(process.env), 'logs', 'main.log');
const mainLogRotated = rotateLogAtStart(mainLogPath);
let mainLogDir = false;
const log = (msg: string) => {
  console.log(`[emerald] ${msg}`);
  try {
    if (!mainLogDir) {
      fs.mkdirSync(path.dirname(mainLogPath), { recursive: true });
      mainLogDir = true;
    }
    fs.appendFileSync(mainLogPath, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // A read-only home or a full disk; stdout still has the line.
  }
};
if (mainLogRotated !== null) log(`main.log rotated, ${mainLogRotated} bytes moved to main.1.log`);
const runner: Runner = app.isPackaged ? 'self' : 'node';
startLoopDelayLog(log);
setGitRunnerLog(log);
// The pipe is named as the daemon and the CLI name it (M9 fix 495):
// EMERALD_PIPE when set, else per user and per home, so a window on a
// private home alone starts and meets a daemon of its own.
const client = new PipeClient({
  daemonMain: resolveDaemonMain(),
  runner,
  log,
  pipePath: pipePathOf(),
  home: path.resolve(emeraldHomeOf(process.env)),
});
const cli = { cliMain: resolveCliMain(), runner, log };

// The windows (M9 fix 866). The layout names them (fix 865) and main
// opens and closes them to match: `windows` by layout window id; the
// window made at ready is `startup`, with no id until the first layout
// arrives and binds it to the layout's first window. Every window shares
// the one pipe connection above.
const windows = new Map<string, BrowserWindow>();
let startup: BrowserWindow | null = null;
let startupId: string | null = null;
let startupWaits: ((id: string) => void)[] = [];
let lastLayout: Layout | null = null;
let lastFocused: BrowserWindow | null = null;
// Set at before-quit and a window's session-end: a window closing then
// keeps its record for the next start.
let quitting = false;
// The windows reconcile closed itself, whose close sends no window.close.
const closedByLayout = new WeakSet<BrowserWindow>();
// Each window's background spot index, the startup window's 0.
const spotIndex = new Map<BrowserWindow, number>();
// The pages listening for the file open relay, by webContents id.
const listening = new Set<number>();
const broker = new PtyBroker();
const folderSets = new WindowSets();
const gitSets = new WindowSets();
const historyOn = new Set<number>();

const live = (w: BrowserWindow | null | undefined): w is BrowserWindow => w !== null && w !== undefined && !w.isDestroyed();

function allWindows(): BrowserWindow[] {
  const out = new Set<BrowserWindow>(windows.values());
  if (startup !== null) out.add(startup);
  return [...out].filter(live);
}

function isWindowContents(contents: WebContents): boolean {
  return allWindows().some((w) => w.webContents === contents);
}

function windowIdOf(contents: WebContents): string | null {
  for (const [id, w] of windows) if (live(w) && w.webContents === contents) return id;
  return null;
}

function windowsKept(): boolean {
  return (client.daemonInfo?.featureLevel ?? 0) >= WINDOWS_LEVEL;
}

// The window in front: the one holding the layout's current tab, else
// the one focused last, else the startup window, else any.
function frontBrowserWindow(): BrowserWindow | null {
  if (lastLayout !== null) {
    const w = windows.get(frontWindow(lastLayout).id);
    if (live(w)) return w;
  }
  if (live(lastFocused)) return lastFocused;
  if (live(startup)) return startup;
  return allWindows()[0] ?? null;
}

// The window showing a session, else the one in front.
function windowForSession(sessionId: string): BrowserWindow | null {
  if (lastLayout !== null) {
    const at = paneShowingIn(lastLayout, sessionId);
    const lw = at === null ? null : windowHolding(lastLayout, at.tab.id);
    const w = lw === null ? undefined : windows.get(lw.id);
    if (live(w)) return w;
  }
  return frontBrowserWindow();
}

function pushToRenderer(msg: RendererPush): void {
  for (const w of allWindows()) w.webContents.send('emerald:message', msg);
}

// Every window, for the pushes that are not the daemon's.
function sendAll(channel: string, ...args: unknown[]): void {
  for (const w of allWindows()) w.webContents.send(channel, ...args);
}

// The layout's windows made real: the startup window bound, a window
// opened for each record with none, a window closed whose record went.
// A process without the single-instance lock binds alone (planWindows).
function reconcile(layout: Layout | null): void {
  if (layout === null || quitting || allWindows().length === 0) return;
  const openIds = [...windows.entries()].filter(([, w]) => live(w)).map(([id]) => id);
  const plan = planWindows(windowsOf(layout).map((w) => w.id), openIds, live(startup) && startupId === null, holdsLock);
  if (plan.bind !== null && live(startup)) {
    startupId = plan.bind;
    windows.set(plan.bind, startup);
    log(`window bound to ${plan.bind}, the layout's first window`);
    for (const resolve of startupWaits) resolve(plan.bind);
    startupWaits = [];
  }
  for (const id of plan.open) createWindow(id, freeSpotIndex());
  for (const id of plan.close) {
    const w = windows.get(id);
    if (!live(w)) continue;
    closedByLayout.add(w);
    log(`window ${id} closed by the layout`);
    w.close();
  }
}

function freeSpotIndex(): number {
  const taken = new Set(allWindows().map((w) => spotIndex.get(w)));
  for (let i = 0; ; i++) if (!taken.has(i)) return i;
}

// A new window from New window or a second launch: the daemon opens it
// on the layout and the reply's layout opens it here.
async function openNewWindow(how: string): Promise<void> {
  if (!windowsKept()) {
    log(`new window from ${how}: emmerd is below level ${WINDOWS_LEVEL}; the open window lifted instead`);
    liftWindow(frontBrowserWindow());
    return;
  }
  try {
    const { layout, windowId } = await client.request('window.open', {});
    log(`new window ${windowId} from ${how}`);
    lastLayout = layout;
    reconcile(layout);
  } catch (err) {
    log(`new window from ${how} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// The menu's reloads act on the focused window of ours, else the front one.
function menuWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (live(focused) && allWindows().includes(focused)) return focused;
  return frontBrowserWindow();
}

function liftWindow(w: BrowserWindow | null): void {
  if (!live(w) || process.env['EMERALD_WINDOW'] === 'background') return;
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}

client.on('message', (msg: ServerMessage) => {
  if (msg.type === 'layout.changed') {
    lastLayout = msg.layout;
    reconcile(msg.layout);
  }
  if (msg.type === 'pty.output') {
    // Decode base64 here so the renderer only ever handles bytes.
    const data = new Uint8Array(Buffer.from(msg.data, 'base64'));
    pushToRenderer(msg.replay ? { type: 'pty.output', sessionId: msg.sessionId, data, replay: true } : { type: 'pty.output', sessionId: msg.sessionId, data });
    return;
  }
  if (msg.type === 'reply') return;
  // The relay's own push (M9 fix 271) is handled below; the renderer has
  // no use for it.
  if (msg.type === 'update.requested') return;
  // The browser driver's (M9 fix 672); an eval or a fill can carry a
  // secret the renderer has no need to hold.
  if (msg.type === 'browser.requested') return;
  pushToRenderer(msg);
});
// The last crash the window heard (M9 fix 832), for a renderer that reloads
// before Not now; Not now clears it.
let lastCrash: DaemonCrash | null = null;
client.on('connected', (daemon: DaemonInfo) => pushToRenderer({ type: 'daemon.connected', daemon }));
// Main follows the layout itself (M9 fix 866), since its windows are the
// layout's; topics only add up on a connection, so the renderers' own
// subscribe is untouched.
client.on('connected', () => {
  void client
    .request('subscribe', { topics: ['layout'] })
    .then(() => client.request('layout.get', {}))
    .then(({ layout }) => {
      lastLayout = layout;
      reconcile(layout);
    })
    .catch((err: unknown) => log(`layout read for the windows failed: ${err instanceof Error ? err.message : String(err)}`));
});
ipcMain.handle('emerald:daemon-restart', () => client.restartDaemon());
ipcMain.handle('emerald:daemon-info', () => client.daemonInfo);
client.on('disconnected', () => {
  broker.clear();
  pushToRenderer({ type: 'daemon.disconnected' });
});
// The layout window a page shows (M9 fix 866): a window opened from a
// record knows it at once, the startup window once the first layout has
// bound it. A daemon that never answers leaves the first window's id
// after the requests' own deadline, so a page's sync is never held for good.
ipcMain.handle('emerald:window-id', (event): string | Promise<string> => {
  const id = windowIdOf(event.sender);
  if (id !== null) return id;
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve(windowIdOf(event.sender) ?? FIRST_WINDOW_ID), READY_DEADLINE_MS);
    startupWaits.push((bound) => {
      clearTimeout(timer);
      resolve(bound);
    });
  });
});
client.on('daemon-crashed', (crash: DaemonCrash) => {
  lastCrash = crash;
  pushToRenderer({ type: 'daemon.crashed', crash });
});
ipcMain.handle('emerald:daemon-crash', () => lastCrash);
ipcMain.on('emerald:dismiss-crash', () => {
  lastCrash = null;
});

// Requests made before the first connection wait for it instead of failing;
// after a later disconnect they fail fast and the renderer resyncs on reconnect.
// The wait has a deadline (M9 fix 453, M75's L38): a daemon that never came
// up left every such request pending for good.
const READY_DEADLINE_MS = 10_000;
ipcMain.handle('emerald:request', async (event, type: RequestType, body: Requests[RequestType]['req']) => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('emmerd did not come up')), READY_DEADLINE_MS);
  });
  try {
    await Promise.race([client.ready(), deadline]);
  } finally {
    clearTimeout(timer);
  }
  // The attach broker (M9 fix 866, pty-broker.ts): a detach goes to the
  // daemon only once no window holds the session, since one detach drops
  // the connection's only sink for every window.
  if (type === 'pty.attach' || type === 'pty.detach') {
    const sessionId = (body as { sessionId?: unknown }).sessionId;
    if (typeof sessionId === 'string') {
      if (type === 'pty.attach') broker.attach(sessionId, event.sender.id);
      else if (!broker.detach(sessionId, event.sender.id)) return {};
    }
  }
  const reply = await client.request(type, body);
  // A page's own layout read binds the startup window as soon as main's
  // would (M9 fix 866), so the page's window id is never later than its
  // layout.
  if (type === 'layout.get' || type === 'layout.set') {
    const layout = (reply as { layout?: Layout }).layout;
    if (layout !== undefined && (lastLayout === null || layout.revision >= lastLayout.revision)) {
      lastLayout = layout;
      reconcile(layout);
    }
  }
  return reply;
});
ipcMain.on('emerald:send', (_event, msg: ClientMessage) => client.send(msg));

// version: the app's own, from its package.json (M9 fix 234, the app
// menu's What's new hint), which the docs commit of every batch bumps.
ipcMain.handle('emerald:info', () => ({ homeDir: os.homedir(), config: readUserConfig(), chime: chimeMode(), usageFloorMs: usageFloorMs(), version: appVersion() }));

// The update check (M9 fix 239, updater.ts), its feed chosen in four
// steps by updateFeedSpec (fix 608): off under EMERALD_NO_UPDATE=1; a
// non-empty EMERALD_UPDATE_URL is the feed, which is how a verify script
// points a packed build at a stub feed, and a dev build with it set checks
// too (M9 fix 242, electron-updater's dev config forced) so verify:menus
// can read the hint on a port nothing serves, never downloading; off in a
// dev build otherwise (there is no installer to run); and a packaged build
// takes the local feed at 127.0.0.1:7420 when %LOCALAPPDATA%\emerald-feed
// exists (the developer's box), the GitHub releases repository otherwise.
// The relay (M9 fix 271, update-relay.ts): every state goes to the
// daemon as well, and a click from `emmer update` comes back as act().
const updateRelay = wireUpdateRelay(client, () => updater, log);
const updater = createUpdater({
  current: appVersion(),
  feed: updateFeedSpec(process.env, app.isPackaged, fs.existsSync),
  // Four hours, six checks a day. On the github spec each check is two or three plain github.com requests (the releases' atom feed and /releases/latest, GitHubProvider.js:43 and :158 to :162, which skips api.github.com on purpose), so the REST API's unauthenticated 60 an hour does not bind, and would not at this cadence if it did.
  intervalMs: 4 * 60 * 60 * 1000,
  firstDelayMs: 5000,
  log,
  push: (state: UpdateState) => {
    pushToRenderer({ type: 'update.state', state });
    updateRelay.report(state);
  },
  stopDaemon: () => client.stopDaemon(),
  markInstalling: (version) => {
    fs.mkdirSync(path.dirname(installMarker), { recursive: true });
    writeMarker(installMarker, version, Date.now());
  },
  // The word from outside the install folder (M9 fix 323); held under a
  // harness window so a verify run pops no toast on the person.
  postPoster: (version) => postInstallPoster(emeraldHomeOf(process.env), version, log, { held: process.env['EMERALD_WINDOW'] === 'background' }),
  updater: () => {
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
    return autoUpdater;
  },
});
ipcMain.handle('emerald:update-state', () => updater.state());

// The file open relay (M9 fix 341, file-open-relay.ts): a path from
// `emmer open` over the daemon's app topic, or from a launch with a file
// (fix 342), sent to the renderer once it listens, the window lifted as
// for a notification's click.
const openRelay = wireFileOpenRelay(client, {
  // To the window in front (M9 fix 866), held while its page is not
  // listening yet.
  deliver: (req) => {
    const w = frontBrowserWindow();
    if (!live(w) || !listening.has(w.webContents.id)) return false;
    w.webContents.send('emerald:open-file', req.path, req.pane, openExtraOf(req));
    return true;
  },
  lift: () => liftWindow(frontBrowserWindow()),
}, log);
ipcMain.on('emerald:open-file-ready', (event) => {
  listening.add(event.sender.id);
  openRelay.ready();
});

// emmer browser's driver (M9 fix 672, browser-driver.ts): a command from
// the daemon run on a browser pane's page through its debugger, the
// pane's driven mark pushed to the window as it runs.
const browserDriver = wireBrowserDriver(client, {
  log,
  home: path.resolve(emeraldHomeOf(process.env)),
  push: (paneId, state) => sendAll('emerald:browser-drive', paneId, state),
  isWindow: isWindowContents,
});

// The install's marker (M9 fix 282, install-gap.ts): written at the
// badge's second click, read at the next launch. A packed build started
// while another version's install is young says so and quits with no
// window and no daemon, since the installer is about to replace this
// exe; the new build's own first launch, or a launch past three
// minutes, removes the marker and goes on. The dev build never installs.
// True when this launch is in the gap, having posted the word: the word
// goes through the install poster's worker (M9 fix 408), which outlives
// this process, so the caller quits at once rather than holding six
// seconds on a show event the installer never lets it see.
const installMarker = path.join(emeraldHomeOf(process.env), 'installing.json');
function launchInGap(): boolean {
  if (!app.isPackaged) return false;
  const marker = readMarker(installMarker);
  const now = Date.now();
  const state = gapState(marker, appVersion(), now);
  if (state === 'none') return false;
  if (state === 'fresh' || marker === null) {
    log(`installing.json${marker === null ? '' : ` (${marker.version} at ${marker.at})`} is spent: removed`);
    try {
      fs.rmSync(installMarker, { force: true });
    } catch (err) {
      log(`could not remove ${installMarker}: ${String(err)}`);
    }
    return false;
  }
  const notice = gapNotice(marker, now);
  log(`launched while ${marker.version} is installing (since ${marker.at}): ${notice.title}: ${notice.body}; quitting with no window`);
  postGapPoster(emeraldHomeOf(process.env), marker, now, log, { held: process.env['EMERALD_WINDOW'] === 'background' });
  return true;
}
ipcMain.handle('emerald:update-act', () => updater.act());

// The first launch of a new build (M9 fix 239) runs `emmer hooks install`,
// the step the install session ran by hand, so the hook script and the
// status line the daemon expects are the ones this build shipped.
// installed.json under the emerald home holds the version last launched;
// a home with no stamp yet (the first launch after a hand install, or a
// verify script's private home) gets the stamp and no install, since the
// install writes the person's Claude settings and a harness home must
// never reach those on its own.
function installHooksOnFirstLaunch(): void {
  if (!app.isPackaged) return;
  const stamp = path.join(emeraldHomeOf(process.env), 'installed.json');
  const version = appVersion();
  let last: string | null = null;
  try {
    last = String((JSON.parse(fs.readFileSync(stamp, 'utf8')) as { version?: unknown }).version ?? '');
  } catch {
    last = null;
  }
  const write = () => {
    try {
      fs.mkdirSync(path.dirname(stamp), { recursive: true });
      fs.writeFileSync(stamp, JSON.stringify({ version, at: new Date().toISOString() }) + '\n');
    } catch (err) {
      log(`could not write ${stamp}: ${String(err)}`);
    }
  };
  if (last === null || last === version) {
    if (last === null) write();
    return;
  }
  log(`first launch of ${version} after ${last}: running emmer hooks install`);
  runCliJson(cli, ['hooks', 'install', '--json']).then(
    ({ code, json }) => {
      const r = json as Record<string, unknown>;
      log(`emmer hooks install exited ${code}${r['changed'] === true ? ', settings changed' : ''}`);
      if (code === 0) write();
    },
    (err: unknown) => log(`emmer hooks install failed: ${err instanceof Error ? err.message : String(err)}`),
  );
}

// The updater's pending sweep (M9 fix 371, moved and retried by fix
// 384). The installer this build came in on sits in the updater's
// pending folder until something removes it. It ran on the stamp's
// version change at app ready, where the installer that --force-run
// started the window from was still alive holding its own exe (EPERM at
// the install of fixes 352 to 371, the folder left half swept). Now it
// runs once the daemon has connected (the window idle, the installer
// gone by then) at every launch, since the gate reads the folder and a
// folder with nothing to sweep costs a readdir, and a removal that
// fails is tried once more five minutes on (EMERALD_SWEEP_RETRY_MS for a
// script). Each path logs its own line, so the install note can say
// which acted. Packed builds only: a dev build's LOCALAPPDATA is the
// person's own, and a harness window must never reach their cache.
//
// M9 fix 409: the one retry is the ceiling. A launch whose retry fails
// too gives up and says so, since a failed removal leaves the folder
// whole (updater-cache.ts's gate) and the next launch sweeps it; a third
// attempt would only be a longer timer on a window nobody is watching.
const SWEEP_RETRY_MS = 5 * 60 * 1000;
function sweepRetryMs(): number {
  const raw = process.env['EMERALD_SWEEP_RETRY_MS'];
  const ms = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(ms) && ms >= 0 ? ms : SWEEP_RETRY_MS;
}
let sweepRan = false;
function sweepPendingAfterConnect(): void {
  if (!app.isPackaged || sweepRan) return;
  sweepRan = true;
  const version = appVersion();
  const first = sweepPending(updaterCacheDir(), version);
  if (first === null) return;
  log(sweepLine(first, 'at launch'));
  if (first.removed) return;
  const retryMs = sweepRetryMs();
  log(`updater cache: retrying the sweep in ${Math.round(retryMs / 1000)} s`);
  const timer = setTimeout(() => {
    const second = sweepPending(updaterCacheDir(), version);
    log(second === null ? 'updater cache: nothing left to sweep on the retry' : sweepLine(second, 'on the retry'));
    // M9 fix 409: the retry is the last attempt this launch makes, so a
    // second failure says which launch takes the folder instead.
    if (second !== null && !second.removed) log(sweepGiveUpLine(second.version));
  }, retryMs);
  timer.unref();
}
client.on('connected', sweepPendingAfterConnect);

// M9 fix 696: Design Mode's crops and emmer browser's screenshots older
// than 14 days go, once a launch. Unlike the updater sweep this runs in
// every build: the folders are the home's own and a harness's home is
// private, so the dev build prunes only what it wrote, and verify:design
// reads it. No timer and no retry; a file a failure left is the next
// launch's.
let shotsPruned = false;
function pruneShotsOnce(): void {
  if (shotsPruned) return;
  shotsPruned = true;
  void pruneShots(path.resolve(emeraldHomeOf(process.env)), Date.now(), log).catch((err: unknown) => log(`shots: prune failed: ${err instanceof Error ? err.message : String(err)}`));
}
client.on('connected', pruneShotsOnce);

// The release notes (M9 fix 227), read on every call so a dev build
// shows an edit on the next open. A missing file is empty text, not a
// rejection: the tab says the notes could not be read and the start
// opens nothing, since an empty text has no heading. EMERALD_WHATS_NEW=off
// is the harness's word that the tab must not open on its own.
ipcMain.handle('emerald:whats-new-read', (): WhatsNewRead => {
  const file = resolveWhatsNew();
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    log(`could not read the release notes at ${file}: ${String(err)}`);
  }
  return { text, autoOpen: process.env['EMERALD_WHATS_NEW'] !== 'off' };
});

// The usage strip's floor between requests (M9 fix 100). The verify
// script presses the button seconds apart and sets it to zero; nothing
// else should.
function usageFloorMs(): number {
  const raw = process.env['EMERALD_USAGE_FLOOR_MS'];
  const ms = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(ms) && ms >= 0 ? ms : USAGE_FLOOR_MS;
}

// The real chime belongs to the real home (M9 fix 47). A window on a
// private EMERALD_HOME is a verify script's or a click-through's, and its
// chimes were being taken for the user's own, so it is muted unless the
// run asks to hear one with EMERALD_CHIME, and then it gets the test chime.
function chimeMode(): ChimeMode {
  if (process.env['EMERALD_HOME'] === undefined) return 'real';
  return process.env['EMERALD_CHIME'] === undefined || process.env['EMERALD_CHIME'] === '' ? 'muted' : 'test';
}

// ~/.emerald/config.json, read on every info() call so a change shows up on
// the next renderer reload without restarting the app. Same EMERALD_HOME
// override as the daemon.
function readUserConfig(): UserConfig {
  const file = path.join(emeraldHomeOf(process.env), 'config.json');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`could not read ${file}: ${String(err)}`);
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    const { prefixKey, promptHooks } = parsed as Record<string, unknown>;
    return {
      ...(typeof prefixKey === 'string' ? { prefixKey } : {}),
      ...(typeof promptHooks === 'boolean' ? { promptHooks } : {}),
    };
  } catch (err) {
    log(`${file} is unusable, using defaults: ${String(err)}`);
    return {};
  }
}

// Hooks are read and written by the shipped CLI (see cli.ts). The CLI
// honours EMERALD_HOME and CLAUDE_SETTINGS from our environment, so a check
// against a private home never touches the real settings file.
// Since M9 fix 606 the main process also watches the settings file the
// status read, from the renderer's first ask on (which it makes only when
// promptHooks is not false), and pushes a fresh status on a change.
const hooksWatch = new HooksWatch(
  async () => parseHooksStatus((await runCliJson(cli, ['hooks', 'status', '--json'])).json),
  (status) => {
    sendAll('emerald:hooks-changed', status);
  },
  log,
);

ipcMain.handle('emerald:hooks-status', async (): Promise<HooksStatus> => {
  const reply = parseHooksStatus((await runCliJson(cli, ['hooks', 'status', '--json'])).json);
  hooksWatch.follow(reply);
  return reply.status;
});

// One Test event through the installed hook (M9 fix 606); the CLI's exit
// code says complete-and-passed, so the answer is read off the JSON.
ipcMain.handle('emerald:hooks-test', async (): Promise<HooksTestResult> => {
  const { json } = await runCliJson(cli, ['hooks', 'status', '--test', '--json']);
  const t = (json as Record<string, unknown> | null)?.['test'];
  if (!isHookTestOutcome(t)) throw new Error('emmer hooks status --test gave no test result');
  return { result: t };
});

ipcMain.handle('emerald:hooks-install', async (): Promise<HooksInstallResult> => {
  const { code, json } = await runCliJson(cli, ['hooks', 'install', '--json']);
  if (code !== 0) throw new Error(`emmer hooks install exited ${code}`);
  const r = json as Record<string, unknown>;
  return { changed: r['changed'] === true, settings: String(r['settings'] ?? '') };
});

// The folder chooser is modal to our window so it cannot get lost behind it.
// EMERALD_PICK_FOLDER is a harness flag like EMERALD_PICK_FILE below (M9 fix
// 547): a verify script cannot drive a native dialog, so under it the
// answer is that folder and no dialog is shown.
ipcMain.handle('emerald:pick-folder', async (event, defaultPath: string | null) => {
  const picked = process.env['EMERALD_PICK_FOLDER'];
  if (picked !== undefined && picked !== '') return picked;
  const opts = { properties: ['openDirectory' as const], ...(defaultPath !== null ? { defaultPath } : {}) };
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = owner === null ? await dialog.showOpenDialog(opts) : await dialog.showOpenDialog(owner, opts);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});
// The file chooser behind Open a file (M9 fix 341), modal the same way.
// EMERALD_PICK_FILE is a harness flag, as EMERALD_WHATS_NEW is: a verify
// script cannot drive a native dialog, so under it the answer is that
// path and no dialog is shown.
ipcMain.handle('emerald:pick-file', async (event, defaultPath: string | null) => {
  const picked = process.env['EMERALD_PICK_FILE'];
  if (picked !== undefined && picked !== '') return picked;
  const opts = {
    properties: ['openFile' as const],
    ...(defaultPath !== null ? { defaultPath } : {}),
  };
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = owner === null ? await dialog.showOpenDialog(opts) : await dialog.showOpenDialog(owner, opts);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

// The files rail's file service (files.ts). The watchers push on their
// own channel rather than through the daemon's, since the daemon never
// hears about them.
const watchers = new FolderWatchers((dir, renamed) => {
  // A folder heading's icon read from here or below is read again on its
  // next appearance (folder-icon.ts).
  folderIconForget(dir);
  sendAll('emerald:files-changed', dir, { renamed });
});
// EMERALD_LIST_CAP is read once, at start (M9 fix 436), for the verify step
// that cuts a folder of six; a value that is not a positive whole number
// leaves the default.
const listCap = (() => {
  const raw = process.env['EMERALD_LIST_CAP'];
  return raw !== undefined && /^[1-9]\d*$/.test(raw) ? Number(raw) : LIST_CAP;
})();
ipcMain.handle('emerald:files-list', (_event, dir: string, keep?: string) => listFolder(dir, keep, listCap));
ipcMain.handle('emerald:files-read', (_event, p: string) => readFile(p));
ipcMain.handle('emerald:files-read-tail', (_event, p: string, from: TailMark | null) => readTail(p, from));
ipcMain.handle('emerald:files-write', (_event, p: string, text: string, format: TextFormat, stamp: FileStamp) => writeFileText(p, text, format, stamp));
ipcMain.handle('emerald:files-mkdir', (_event, p: string) => makeFolder(p));
ipcMain.handle('emerald:files-create', (_event, p: string) => createFile(p));
ipcMain.handle('emerald:files-rename', (_event, from: string, to: string) => renameEntry(from, to));
// M9 fix 644: held on revealPath's rule, so a harness window's Delete
// moves the entry into <EMERALD_HOME>/trash and not the recycle bin.
const trashHeld = process.env['EMERALD_OPEN_LOG'] !== undefined || process.env['EMERALD_HOME'] !== undefined;
const trasher = trashHeld
  ? heldTrash(path.resolve(emeraldHomeOf(process.env)), log, process.env['EMERALD_OPEN_LOG'])
  : (target: string) => shell.trashItem(target);
ipcMain.handle('emerald:files-trash', (_event, p: string) => trashEntry(p, trasher, log));
// One running search per window (M9 fix 519): a newer search aborts the
// one before it, and the rail's stop aborts whatever is running, so a
// walk the rail no longer wants ends at its next folder or file.
const searchRuns = new SearchRuns();
ipcMain.handle('emerald:files-search', (event, root: string, needle: string, mode: SearchMode) => {
  const signal = searchRuns.begin(event.sender.id);
  return (mode === 'contents' ? searchContents : searchNames)(root, needle, signal).finally(() => searchRuns.end(event.sender.id, signal));
});
ipcMain.handle('emerald:files-search-stop', (event) => searchRuns.stop(event.sender.id));
// Each window's folders, the watchers following the union (M9 fix 866).
ipcMain.handle('emerald:files-watch', (event, dirs: string[]) => watchers.set(folderSets.set(event.sender.id, Array.isArray(dirs) ? dirs : [])));
ipcMain.handle('emerald:files-open', (_event, p: string) => openPath(p));
ipcMain.handle('emerald:files-reveal', (_event, p: string) => revealPath(p, log));
ipcMain.handle('emerald:files-open-folder', (_event, p: string) => openFolder(p, log));
ipcMain.handle('emerald:files-stat', (_event, p: string) => statPath(p));
ipcMain.handle('emerald:files-real', (_event, p: string) => realPath(p));
ipcMain.handle('emerald:files-open-external', (_event, url: string) => openExternal(url, log));
ipcMain.handle('emerald:files-git-status', (_event, dir: string) => gitStatus(dir));
ipcMain.handle('emerald:files-git-changes', (_event, dir: string) => gitChanges(dir));
ipcMain.handle('emerald:files-git-log', (_event, dir: string) => gitLog(dir));
ipcMain.handle('emerald:files-git-graph', (_event, dir: string, options: unknown) => gitGraph(dir, { remotes: typeof options === 'object' && options !== null && (options as { remotes?: unknown }).remotes === true }));
ipcMain.handle('emerald:files-git-review', (_event, dir: string, base: string) => gitReview(dir, base));
ipcMain.handle('emerald:files-git-show', (_event, dir: string, hash: string, rel: string) => gitShow(dir, hash, rel));
// Revert a file's changes (M9 fix 310), from the rail's row menu.
ipcMain.handle('emerald:files-git-revert', (_event, dir: string, rel: string) => gitRevert(dir, rel));
ipcMain.handle('emerald:files-git-project-counts', (_event, dir: string, since: unknown) => gitProjectCounts(dir, typeof since === 'number' && Number.isFinite(since) ? since : null));
// The Commits tab's watch on the repository's logs (M49): a commit pushes
// the root as a change, which the rail's git poll refetches on. The log
// line is the watch's only trace (M9 fix 531), one per commit per root.
const gitLogWatcher = new GitLogWatcher((root) => {
  log(`files-changed push for ${root}`);
  sendAll('emerald:files-changed', root);
});
ipcMain.handle('emerald:git-watch', (event, dirs: string[]) => gitLogWatcher.set(gitSets.set(event.sender.id, Array.isArray(dirs) ? dirs : [])));
// Initialise a repository (M9 fix 255): git init in the folder, then the
// log watch takes the new repository and the folder is pushed as a
// change so the rail's git poll reads it at once.
ipcMain.handle('emerald:git-init', async (_event, dir: string) => {
  const result = await gitInit(dir);
  if (result.root !== null) {
    log(`git init in ${dir}: repository at ${result.root}`);
    gitLogWatcher.refresh();
    sendAll('emerald:files-changed', result.root);
  } else log(`git init in ${dir} failed: ${result.error}`);
  return result;
});
ipcMain.handle('emerald:folder-icon', (_event, dir: string) => folderIcon(dir));

// The terminal's colour schemes (schemes.ts, M9 fix 225): the shipped
// ones and the person's Windows Terminal ones, read on every call.
ipcMain.handle('emerald:schemes-list', async () => listSchemes({ shippedDir: resolveSchemesDir(), settingsFiles: await windowsTerminalSettingsFiles(process.env['LOCALAPPDATA']) }, log, currentSkin()));

// The account's Claude usage for the sidebar footer (usage.ts). Read on
// every call; the renderer decides how often to ask. Each reading is
// held against the last for the capped edges (M9 fix 285, usage-edges.ts),
// posted to the daemon as usage.capped and usage.freed so the activity
// view can draw the stretches nobody could continue; a daemon before
// level 50 has no such request, so the post is skipped, and a post that
// fails is one log line, since the next crossing posts again. A failed
// reading is not a reading and the last one stands.
const CAPPED_LEVEL = 50;
let lastUsage: Map<string, UsageWindow> | null = null;
function postUsageEdges(edges: readonly UsageEdge[]): void {
  const level = client.daemonInfo?.featureLevel ?? 0;
  if (level < CAPPED_LEVEL) return;
  for (const edge of edges) {
    const req = edge.kind === 'capped' ? client.request('usage.capped', { window: edge.window, resetsAt: edge.resetsAt }) : client.request('usage.freed', { window: edge.window });
    req.catch((err: unknown) => log(`usage.${edge.kind} failed: ${String(err)}`));
  }
}
ipcMain.handle('emerald:usage-get', async (_event, ask: UsageAsk) => {
  const result = await fetchUsage(log, ask);
  if ('windows' in result) {
    postUsageEdges(cappedEdges(lastUsage, result.windows));
    lastUsage = usageByKey(result.windows);
  }
  return result;
});

// A system notification for a session that wants someone (notify.ts). The
// click comes back to the renderer, which shows the session.
// The focus asked of every window, and a click raising the window that
// shows the session (M9 fix 866).
const notifier = createNotifier(
  { focused: () => allWindows().some((w) => w.isFocused()), forSession: windowForSession },
  (sessionId) => windowForSession(sessionId)?.webContents.send('emerald:notify-clicked', sessionId),
  log,
);
ipcMain.on('emerald:notify', (_event, req: NotifyRequest) => notifier.post(req));
// The usage record (M9 fix 676), written only while the renderer's switch is on.
const useRecord = createUseRecord(path.join(emeraldHomeOf(process.env), 'logs', 'usage.jsonl'), log);
ipcMain.on('emerald:use-record', (_event, line: unknown) => useRecord.write(line));

// The taskbar button flashes and wears the count while sessions want
// someone (taskbar.ts, M9 fix 104); the renderer sends its attention set
// on every change.
// One taskbar button per window (M9 fix 866), each set from its own page.
const taskbars = new Map<number, ReturnType<typeof createTaskbar>>();
ipcMain.on('emerald:attention', (event, req: AttentionRequest) => taskbars.get(event.sender.id)?.set(req));

// The skin (M9 fix 569): main keeps the one the renderer last sent, in
// skin.json beside the logs, so the next window opens in it, and repaints
// what the renderer cannot: the window ground, the caption buttons'
// overlay and the taskbar badge.
initSkin(path.join(emeraldHomeOf(process.env), 'skin.json'), log);
// Every window's ground and overlay (M9 fix 866); another window's page
// keeps its skin until its next reload.
ipcMain.on('emerald:skin-set', (_event, skin: unknown) => {
  for (const w of allWindows()) applySkin(w, skin);
});
// M9 fix 628: the renderer asks once, on a profile with no skin stored, so
// the page takes the skin main painted the first frame in.
ipcMain.on('emerald:skin-get', (event) => {
  event.returnValue = currentSkin();
});

// The History panel's scan of Claude Code's transcripts (history.ts). The
// watcher follows history.jsonl only while the panel is showing.
const historyWatcher = new HistoryWatcher(() => {
  sendAll('emerald:history-changed');
}, log);
ipcMain.handle('emerald:history-scan', () => scanHistory(log));
ipcMain.handle('emerald:history-turns', (_event, file: string) => readTurns(file, log));
ipcMain.handle('emerald:history-usage', (_event, conversation: string, known: string | null) => readUsage(conversation, known, log));
ipcMain.handle('emerald:history-cost', (_event, file: string) => readTranscriptCost(file, log));
ipcMain.handle('emerald:history-agents', (_event, conversation: string) => readAgentsRunning(conversation, log));
ipcMain.handle('emerald:history-project', (_event, dir: string) => repoRoot(dir));
// On while any window's History panel shows (M9 fix 866).
ipcMain.handle('emerald:history-watch', (event, on: boolean) => {
  if (on) historyOn.add(event.sender.id);
  else historyOn.delete(event.sender.id);
  historyWatcher.set(historyOn.size > 0);
});
// The chat box's `/` menu (M9 fix 719): the skills Claude Code would
// take in the session's folder, read off disk.
ipcMain.handle('emerald:skills-list', (_event, folder: string | null) => readSkills(claudeHome(), folder));

// The clipboard for Ctrl+V in a pane (M9 fix 92), Electron 44's async
// clipboard. Text wins; an image is reported only when there is no text,
// since a copied image often carries a text form too (a file name, HTML)
// and the pane pastes text. Read here rather than in the renderer:
// navigator.clipboard asks permission, and the sandboxed preload has no
// clipboard module.
//
// Under a private EMERALD_HOME (a verify script's or a click-through's
// window) the clipboard is the window's own, held here, and the box's is
// never read or written (M9 fix 493): since fix 441 a right-click on a
// terminal pastes, and every harness right-click that opened a pane menu
// was pasting the person's real clipboard into a harness PowerShell, which
// ran it and broke the step's own typing after it. The scripts that test
// copy and paste write and read through this same bridge, so they read
// what they wrote.
// The held clipboard keeps an image's bytes too (M9 fix 721), so the chat
// box's paste under a harness reads the image the script wrote.
const heldClipboard: { text: string; image: boolean; png: Buffer | null } | null = process.env['EMERALD_HOME'] === undefined ? null : { text: '', image: false, png: null };
ipcMain.handle('emerald:clipboard-read', async () => {
  if (heldClipboard !== null) return heldClipboard.text !== '' ? { text: heldClipboard.text, image: false } : { text: null, image: heldClipboard.image };
  const text = await clipboard.readText();
  if (text !== '') return { text, image: false };
  return { text: null, image: await clipboard.has('image/png') };
});
// The two writes, factored out so Design Mode's C and S (M9 fix 674),
// which main makes itself, are held under a private home the same way.
function writeClipboardText(text: string): void {
  if (heldClipboard !== null) {
    heldClipboard.text = text;
    heldClipboard.image = false;
    heldClipboard.png = null;
    return;
  }
  clipboard.writeText(text);
}
async function writeClipboardPng(png: Buffer): Promise<void> {
  if (heldClipboard !== null) {
    heldClipboard.text = '';
    heldClipboard.image = true;
    heldClipboard.png = png;
    return;
  }
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
}
ipcMain.handle('emerald:clipboard-write', (_event, text: string) => writeClipboardText(text));
ipcMain.handle('emerald:clipboard-write-image', (_event, dataUrl: string) => writeClipboardPng(nativeImage.createFromDataURL(dataUrl).toPNG()));
// The chat box's image paste (M9 fix 721): the clipboard's PNG (the held
// one under a private home) as a thumbnail, and as a file Claude Code is
// handed by its path; with the key route asked for and the real clipboard
// in play the path is null and the renderer sends the key instead, so
// Claude Code reads the clipboard itself.
ipcMain.handle('emerald:clipboard-image', async (_event, keyRoute: boolean) => {
  let png: Buffer | null = null;
  if (heldClipboard !== null) png = heldClipboard.png;
  else {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const blob = (await item.getType('image/png')) as Blob;
      png = Buffer.from(await blob.arrayBuffer());
      break;
    }
  }
  if (png === null || png.length === 0) return null;
  const thumb = nativeImage.createFromBuffer(png).resize({ height: 48 }).toDataURL();
  if (keyRoute && heldClipboard === null) return { thumb, path: null };
  return { thumb, path: savePastedPng(path.join(os.tmpdir(), 'emerald-paste'), png, Date.now()) };
});

const RENDERER_LOG_LINES_PER_SECOND = 5;

// id: the layout window it shows, null for the startup window (bound to
// one once the first layout arrives); index: its background spot, the
// startup window's 0 (M9 fix 866).
function createWindow(id: string | null, index: number): void {
  // A verify script's window (cdp.mjs sets EMERALD_WINDOW=background) is
  // shown without taking focus and off the right edge of every display,
  // with no taskbar button, so a run beside the user's own emerald neither
  // covers it nor takes the keyboard from it (M9 fixes 48 and 49). The
  // scripts never depend on the window being seen: they drive the state
  // directly and read it back over CDP, and the page is told it has focus
  // by focus emulation.
  const background = process.env['EMERALD_WINDOW'] === 'background';
  // The frame's title bar is the app's own 26px row (M43, TitleBar.tsx);
  // Windows keeps drawing the caption buttons over its right end, in the
  // chrome colours, so Snap Layouts and the system menu still work. The
  // menu bar goes with the frame; the application menu below stays for
  // its accelerators. The minimum keeps the three columns and the buttons
  // from overlapping at a size nobody works at.
  const chrome = chromeOf(currentSkin());
  // A person's later window opens 32 px down and right of the one they
  // were in (M9 fix 866); no window keeps its size or place yet.
  const anchor = id === null || background ? null : (live(lastFocused) ? lastFocused : frontBrowserWindow());
  const cascade = anchor === null ? null : cascadeBounds(anchor.getBounds(), screen.getDisplayMatching(anchor.getBounds()).workArea);
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    ...(cascade === null ? {} : { x: cascade.x, y: cascade.y }),
    minWidth: 640,
    minHeight: 400,
    backgroundColor: chrome.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: chrome.overlay, symbolColor: chrome.symbol, height: TITLE_BAR_HEIGHT },
    autoHideMenuBar: true,
    show: !background,
    skipTaskbar: background,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // M9 fix 659: the browser pane's <webview>, held to one partition
      // and stripped of node and a preload at its attach (browser-guard.ts).
      webviewTag: true,
    },
  });
  const contentsId = win.webContents.id;
  if (id === null) startup = win;
  else windows.set(id, win);
  spotIndex.set(win, index);
  log(id === null ? `window opens in the ${currentSkin()} skin` : `window ${id} opens in the ${currentSkin()} skin`);
  if (background) {
    // Past the primary display alone was in plain view on a machine with
    // a display to its right (fix 48), so the spot is past the union; a
    // later window sits a window's width further on (fix 866).
    const right = Math.max(...screen.getAllDisplays().map((d) => d.bounds.x + d.bounds.width));
    const spot = backgroundSpot(right, index);
    const w = win;
    // Windows moves the windows of a display that goes away back onto one
    // that is there, and a harness window was found over the user's own
    // ten minutes into a run that way; the spot is held for as long as the
    // window lives. The guard on the position is what stops the handler's
    // own setPosition from firing it again.
    w.on('move', () => {
      const [x, y] = w.getPosition();
      if (x !== spot[0] || y !== spot[1]) w.setPosition(spot[0], spot[1]);
    });
    w.setPosition(spot[0], spot[1]);
    w.showInactive();
    log(`background window${id === null ? '' : ` ${id}`} at ${spot[0]},${spot[1]}, past displays ending at ${right}`);
  }
  // The title row hides in full screen (TitleBar.tsx). Windows leaves the
  // caption buttons drawn and the overlay's visible flag true under both
  // the F11 kind and the Fullscreen API kind, so the page is told here;
  // a reload while full screen asks again on load.
  const w = win;
  let htmlFullscreen = false;
  const tellFullscreen = () => {
    if (!w.isDestroyed()) w.webContents.send('emerald:message', { type: 'window.fullscreen', on: w.isFullScreen() || htmlFullscreen } satisfies RendererPush);
  };
  w.on('enter-full-screen', tellFullscreen);
  w.on('leave-full-screen', tellFullscreen);
  w.on('enter-html-full-screen', () => { htmlFullscreen = true; tellFullscreen(); });
  w.on('leave-html-full-screen', () => { htmlFullscreen = false; tellFullscreen(); });
  w.webContents.on('did-finish-load', tellFullscreen);
  // M9 fix 527: a reload (a main-frame commit; never a navigation the
  // will-navigate guard below refused) or a crashed page holds `emerald
  // open` requests until the new page says it listens, rather than
  // sending them to a page whose listener is not installed yet.
  w.webContents.on('did-navigate', () => {
    listening.delete(contentsId);
    openRelay.loading();
  });
  w.webContents.on('render-process-gone', () => {
    listening.delete(contentsId);
    openRelay.loading();
  });
  // The window in front for the layout (M9 fix 866): a focus tells the
  // daemon, whose current tab follows.
  w.on('focus', () => {
    lastFocused = w;
    const wid = windowIdOf(w.webContents);
    if (wid !== null && windowsKept()) client.request('window.front', { windowId: wid }).catch((err: unknown) => log(`window.front for ${wid} failed: ${String(err)}`));
  });
  w.on('session-end', () => {
    quitting = true;
  });
  taskbars.set(contentsId, createTaskbar(() => w, log));
  // M9 fix 355: the renderer's warnings and errors reach main.log, so a
  // fallen-back terminal renderer or a failed IPC in the installed build
  // leaves a line somebody can read (its devtools console is nobody's).
  // Capped, since a page in a loop would otherwise fill the log: five
  // lines a second, then one line saying how many more went.
  let consoleSecond = 0;
  let consoleLines = 0;
  let consoleDropped = 0;
  const sayDropped = () => {
    if (consoleDropped > 0) log(`renderer: ${consoleDropped} more lines dropped this second`);
    consoleDropped = 0;
  };
  w.webContents.on('console-message', (details) => {
    if (details.level !== 'warning' && details.level !== 'error') return;
    const second = Math.floor(Date.now() / 1000);
    if (second !== consoleSecond) {
      sayDropped();
      consoleSecond = second;
      consoleLines = 0;
    }
    if (consoleLines >= RENDERER_LOG_LINES_PER_SECOND) {
      // The count is said a second on even when the burst was the last
      // thing the page wrote.
      if (consoleDropped === 0) setTimeout(sayDropped, 1000);
      consoleDropped++;
      return;
    }
    consoleLines++;
    log(rendererLogLine(details.level, details.message, details.sourceId, details.lineNumber));
  });
  win.on('closed', () => {
    // M9 fix 866: the window's own holds go with it; the layout loses
    // its record (and its tabs) only when the person closed it, another
    // window is still open and the app is not quitting.
    const wid = [...windows.entries()].find(([, x]) => x === w)?.[0] ?? null;
    if (wid !== null) windows.delete(wid);
    if (startup === w) startup = null;
    if (lastFocused === w) lastFocused = null;
    spotIndex.delete(w);
    listening.delete(contentsId);
    taskbars.get(contentsId)?.dispose();
    taskbars.delete(contentsId);
    for (const sessionId of broker.drop(contentsId)) client.request('pty.detach', { sessionId }).catch(() => {});
    if (allWindows().length === 0) {
      watchers.close();
      gitLogWatcher.close();
      historyWatcher.close();
      return;
    }
    watchers.set(folderSets.drop(contentsId));
    gitLogWatcher.set(gitSets.drop(contentsId));
    historyOn.delete(contentsId);
    historyWatcher.set(historyOn.size > 0);
    if (closedByLayout.has(w) || wid === null) return;
    if (quitting) {
      log(`window ${wid} closed with the app quitting: kept for the next start`);
      return;
    }
    if (!windowsKept()) return;
    const tabs = lastLayout === null ? 0 : (windowsOf(lastLayout).find((x) => x.id === wid)?.tabIds.length ?? 0);
    client.request('window.close', { windowId: wid }).then(
      () => log(`window ${wid} closed: its ${tabs} tabs closed, their sessions kept`),
      () => log(`window ${wid} closed while emmerd was away; its record stays`),
    );
  });
  // A file dropped where nothing handles the drop would navigate the window
  // to it, blanking the app. The renderer accepts a folder on a pane and
  // nothing else; every other navigation is refused here.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // No window of emerald's is ever opened for the page (M9 fix 477, the
  // ledger's H7): Monaco's Ctrl+click on a URL runs window.open, and so
  // did a middle-click on a markdown link, which put a remote page in an
  // Electron window. An http or https URL goes to the browser through the
  // same path as a link's (held to the log under a private EMERALD_HOME);
  // everything is denied a window. M9 fix 659: a browser pane's page gets
  // the same handler (denyWindows, below).
  denyWindows(win.webContents);
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  // A window opened from a record carries its id on its URL, which is how
  // its page and the harness tell it apart (M9 fix 866).
  if (devUrl !== undefined) {
    void win.loadURL(id === null ? devUrl : `${devUrl}?window=${encodeURIComponent(id)}`);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), id === null ? {} : { query: { window: id } });
  }
}

// M9 fix 355: EMERALD_INSPECT_PORT puts the devtools server on a port so
// the installed window can be attached and profiled; inspect.ts says
// when the variable yields (the harness names a port on the command
// line). The switch must be appended before the app is ready.
const inspect = inspectPort(process.env, process.argv);
if (inspect.port !== null) {
  app.commandLine.appendSwitch('remote-debugging-port', String(inspect.port));
  log(`inspect port ${inspect.port} on 127.0.0.1`);
} else if (inspect.reason !== 'not asked') {
  log(`inspect port: ${inspect.reason}`);
}
// A launch with a file or a folder on its command line (M9 fixes 342 and
// 853): launch-argument.ts says how it is read and why a launch that does
// not get the lock hands its path over and quits.
const launch = launchArgument(process.argv, app.isPackaged, (p) => {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
});
// M9 fix 866: a launch with no argument hands over as well, and the running process opens a new window for it. A harness window goes on without the lock as before: a relaunch right after a kill meets the killed window's lock for a moment (docs/GOTCHAS.md, fixes 258 to 273) and would otherwise quit with nothing open. `window` tells the holder whether this launch hands over for a new window, so a harness relaunch that meets a dying holder opens nothing in it.
const asksWindow = launch === null && process.env['EMERALD_WINDOW'] !== 'background';
let holdsLock = app.requestSingleInstanceLock({ path: launch?.path ?? null, kind: launch?.kind ?? null, window: asksWindow });
const handedOver = !holdsLock && (launch !== null || asksWindow);
log(`single-instance lock ${holdsLock ? 'held' : 'not held'}${launch === null ? '' : `, launched with ${launchLabel(launch)}`}`);
// The open a launch asks for: a file, or a folder to open a new tab on
// with a Claude or a shell (fix 853).
function launchOpen(p: string, kind: LaunchKind): OpenRequest {
  return { path: p, pane: false, launch: true, ...(kind === 'file' ? {} : { kind }) };
}
if (handedOver) {
  log(launch === null ? 'a new window handed to the running window; quitting' : `${launchLabel(launch)} handed to the running window; quitting`);
  app.quit();
} else {
  if (launch !== null) openRelay.open(launchOpen(launch.path, launch.kind));
  app.on('second-instance', (_event, _argv, _cwd, additionalData) => {
    const data = additionalData as { path?: unknown; kind?: unknown; retry?: unknown; window?: unknown } | undefined;
    // A window that went on without the lock asking again (below) is not
    // a launch, and opens nothing here.
    if (data?.retry === true) return;
    const p = data?.path;
    if (typeof p !== 'string') {
      // Only a launch that handed over asks for a window; a harness
      // window, or an older build's launch, goes on as a process of its own.
      if (data?.window !== true) return;
      log('a new window from a second launch');
      void openNewWindow('a second launch');
      return;
    }
    // A second launch from an older build sends { path } alone, a file.
    const kind: LaunchKind = data?.kind === 'claude' || data?.kind === 'shell' ? data.kind : 'file';
    log(`${launchLabel({ path: p, kind })} from a second launch`);
    openRelay.open(launchOpen(p, kind));
  });
  // A window that went on without the lock (another window holds it, or
  // a killed one's singleton had not gone yet) asks again for a while,
  // so that once the holder is gone this window takes the double-clicks.
  if (!holdsLock) {
    let tries = 0;
    const again = () => {
      if (holdsLock || tries >= 20) return;
      tries++;
      holdsLock = app.requestSingleInstanceLock({ path: null, retry: true });
      if (holdsLock) {
        log(`single-instance lock held on try ${tries + 1}`);
        // Now this process owns the layout's windows (M9 fix 866).
        reconcile(lastLayout);
      }
      // Said once at the last try (M9 fix 480, L40), so a later
      // double-click that opens a second main process has a line to
      // explain it.
      else if (tries >= 20) log(`single-instance lock still not held after ${tries + 1} tries; giving up`);
      else setTimeout(again, 1000);
    };
    setTimeout(again, 1000);
  }
}

// No window of emerald's for a page (M9 fix 477): an http or https URL
// goes to the browser (held to the log under a private EMERALD_HOME),
// anything else is refused, and no window opens either way.
// M9 fix 673: onAttempt hears every URL handed over, sent or refused, so
// emmer browser events can say a page tried to open a window.
// M9 fix 894: with signInParent, a popup to a sign-in host (browser-guard.ts) opens as a child of the window holding the page, in the page's session, with window.opener kept, so the host's hand-back reaches the page.
function denyWindows(contents: WebContents, onAttempt?: (url: string) => void, signInParent?: () => BrowserWindow | null): void {
  contents.setWindowOpenHandler(({ url }) => {
    onAttempt?.(url);
    if (signInParent !== undefined && signInPopup(url, signInTestPrefix)) {
      const parent = signInParent();
      if (live(parent) && allWindows().includes(parent)) {
        const prefs: Record<string, unknown> = {};
        forceGuestPreferences(prefs);
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent,
            ...signInBounds(parent.getBounds()),
            show: process.env['EMERALD_WINDOW'] !== 'background',
            autoHideMenuBar: true,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            webPreferences: { ...prefs, session: contents.session },
          },
        };
      }
    }
    if (/^https?:/i.test(url)) void openExternal(url, log).catch((err: unknown) => log(`open ${url} failed: ${err instanceof Error ? err.message : String(err)}`));
    else log(`window.open refused: ${url}`);
    return { action: 'deny' };
  });
}

// M9 fix 894: a harness flag, as EMERALD_OPEN_LOG is: verify:browser's fixture is not a sign-in host, so under a private EMERALD_HOME this URL prefix counts as one.
const signInTestPrefix = process.env['EMERALD_HOME'] !== undefined ? (process.env['EMERALD_SIGNIN_TEST_PREFIX'] ?? null) : null;
// The sign-in windows' web contents (M9 fix 894), which web-contents-created lets follow links on the web as a guest does.
const signInWindows = new WeakSet<WebContents>();

// A sign-in window just opened from a page (M9 fix 894): a dialog with no
// menu and no key rules (the chords act on the window hosting a pane, and
// a window has no hostWebContents, so under them a key typed into the
// form would be swallowed); its own popups go to the system browser, and
// it closes with the page that opened it.
function wireSignInWindow(win: BrowserWindow, opener: WebContents, url: string): void {
  signInWindows.add(win.webContents);
  win.removeMenu();
  denyWindows(win.webContents);
  // It opened hidden, centred on a parent that is itself off screen, so a
  // harness run never puts it in front of the person.
  if (process.env['EMERALD_WINDOW'] === 'background') win.showInactive();
  log(`browser: sign-in window opened: ${win.webContents.getURL() || url}`);
  win.on('closed', () => log('browser: sign-in window closed'));
  opener.once('destroyed', () => {
    if (!win.isDestroyed()) win.close();
  });
}

// The app's chords while a page has the keyboard (M9 fix 670, guest-keys.ts).
// The renderer sends its chords and prefix at install and on each change
// of the prefix, and whether its prefix or cheat sheet is up.
const guestKeys = new GuestKeys();
ipcMain.on('emerald:keys-configure', (_event, chords: GuestChord[], prefix: GuestChord) => guestKeys.configure(chords, prefix));
ipcMain.on('emerald:keys-armed', (_event, on: boolean) => guestKeys.setArmed(on));

// Design Mode (M9 fix 674, design-wire.ts): the grab on a pane's guest,
// found as emmer browser's driver registered it, and its C, S and
// Escape caught ahead of the chords.
const designMode = wireDesignMode({
  log,
  home: path.resolve(emeraldHomeOf(process.env)),
  isWindow: isWindowContents,
  guestFor: (paneId) => browserDriver.guestFor(paneId),
  // To the window hosting the page (M9 fix 866).
  note: (text, guest) => {
    const host = guest.isDestroyed() ? null : guest.hostWebContents;
    if (host !== null && host !== undefined && !host.isDestroyed()) host.send('emerald:design-note', text);
  },
  writeText: writeClipboardText,
  writePng: writeClipboardPng,
});

// The rules a key pressed in a page goes through, in order, the first
// answer winning: Design Mode's grab keys, then the chords.
type GuestInputRule = (contents: WebContents, input: Electron.Input) => GuestVerdict | null;
const guestInputRules: GuestInputRule[] = [designMode.guestRule, (_contents, input) => guestKeys.decide(input)];

function onGuestInput(contents: WebContents, e: Electron.Event, input: Electron.Input): void {
  let verdict: GuestVerdict = 'page';  for (const rule of guestInputRules) {
    const v = rule(contents, input);
    if (v !== null) {
      verdict = v;
      break;
    }
  }
  if (verdict === 'page') return;
  if (verdict === 'window' || verdict === 'window-and-page') {
    // The window hosting the page (M9 fix 866).
    const host = contents.hostWebContents;
    if (host !== null && host !== undefined && !host.isDestroyed()) {
      host.send('emerald:guest-key', { code: input.code, ctrlKey: input.control, shiftKey: input.shift, altKey: input.alt, metaKey: input.meta });
    }
  }
  if (verdict === 'window-and-page') return;
  e.preventDefault();
  // A reload pressed in a page reloads the page, never the whole window,
  // whether or not the menu's accelerator would have fired.
  if (verdict === 'reload') contents.reload();
  else if (verdict === 'reload-hard') contents.reloadIgnoringCache();
}

// Every web contents, not the main window's alone (M9 fix 477): none may
// navigate away from what the main process loaded into it, and none may
// attach a <webview>. The main window's own handlers are in createWindow.
// M9 fix 659 narrows the attach to the browser pane's: a <webview> on the
// main window under persist:emerald-browser alone, with node, a preload
// and a webview tag of its own stripped (forceGuestPreferences); a webview
// off the main window or on any other partition is still refused. A page
// in that webview follows its own links on the web, never to a file: or
// javascript: URL, and opens no window.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    denyWindows(
      contents,
      (url) => browserDriver.record(contents, { at: Date.now(), kind: 'window', url }),
      () => {
        const host = contents.hostWebContents;
        return host === null || host === undefined || host.isDestroyed() ? null : BrowserWindow.fromWebContents(host);
      },
    );
    // It fires only for an allowed popup, so only for a sign-in window.
    contents.on('did-create-window', (win, details) => wireSignInWindow(win, contents, details.url));
    contents.on('will-navigate', (e, url) => {
      if (guestNavigationAllowed(url, contents.getURL())) return;
      // M9 fix 896: a page's own history.back() raises will-navigate too, from the web page it leaves, so a page from the disk already in this guest's history (exactly that URL) is let back in.
      if (isLocalPageUrl(url) && contents.navigationHistory.getAllEntries().some((entry) => entry.url === url)) return;
      e.preventDefault();
      log(`browser: navigation refused: ${url}`);
    });
    // M9 fix 896: a frame inside a page is held to the same rule for a page from the disk, so a web page cannot frame one into itself (the handler's frame-ancestors says the same). A subframe's web navigation stays the page's own business, as it was.
    contents.on('will-frame-navigate', (e) => {
      if (e.isMainFrame) return;
      const from = e.initiator?.url ?? contents.getURL();
      if (guestNavigationAllowed(e.url, from) || !isLocalPageUrl(e.url)) return;
      e.preventDefault();
      log(`browser: navigation refused: ${e.url}`);
    });
    contents.on('before-input-event', (e, input) => onGuestInput(contents, e, input));
    // A press or a key in the page, for presence (the window's own
    // listeners never hear a page's input) and for the click that
    // focuses the page's pane. Mouse moves are left out.
    contents.on('input-event', (_e, input) => {
      const kind = input.type === 'mouseDown' ? 'mouse' : input.type === 'keyDown' || input.type === 'rawKeyDown' ? 'key' : null;
      const host = contents.hostWebContents;
      if (kind === null || host === null || host === undefined || host.isDestroyed()) return;
      // emmer browser's own click or key (M9 fix 672) is not the person:
      // it must not focus the page's pane or count as presence.
      if (browserDriver.dispatching(contents)) return;
      host.send('emerald:guest-input', { webContentsId: contents.id, kind });
    });
    return;
  }
  // A sign-in window (M9 fix 894) follows links on the web as a guest does; it is added to the set at did-create-window, before any navigation its page makes, and the set is read at each navigation.
  contents.on('will-navigate', (e, url) => {
    // M9 fix 896: from the page navigating, since the sign-in window shares the pane's session and so reaches the emerald-file: handler.
    if (signInWindows.has(contents) && guestNavigationAllowed(url, contents.getURL())) return;
    e.preventDefault();
    if (signInWindows.has(contents)) log(`browser: navigation refused: ${url}`);
  });
  contents.on('will-attach-webview', (e, webPreferences, params) => {
    const refusal = attachRefusal({ partition: params['partition'], src: params['src'], fromMain: isWindowContents(contents) });
    if (refusal !== null) {
      e.preventDefault();
      log(`webview refused: ${refusal}`);
      return;
    }
    forceGuestPreferences(webPreferences as unknown as Record<string, unknown>);
    // A profile's partition (M9 fix 673) is held to the same rules.
    ensureBrowserSession(params['partition']!);
  });
});

// The browser pane's partition (M9 fix 659) grants a page nothing but
// a sanitized clipboard write: no camera, microphone, location or
// notifications from a page beside the shells. M9 fix 673: each
// profile's partition the same, once each, and a download from any of
// them saved to the home's downloads folder with no dialog.
// M9 fix 895: and each sends Chrome's own user agent (browser-guard.ts).
const browserSessions = new Set<string>();
function ensureBrowserSession(partition: string): void {
  if (browserSessions.has(partition)) return;
  browserSessions.add(partition);
  const browserSession = session.fromPartition(partition);
  const agent = chromeUserAgent(browserSession.getUserAgent());
  browserSession.setUserAgent(agent);
  log(`browser: ${partition} sends ${agent}`);
  browserSession.setPermissionRequestHandler((_wc, permission, done) => {
    const ok = permission === 'clipboard-sanitized-write';
    if (!ok) log(`browser: permission ${permission} refused`);
    done(ok);
  });
  browserSession.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write');
  browserSession.on('will-download', (_e, item, wc) => browserDriver.download(item, wc));
  // M9 fix 896: every browser partition serves a page from the disk; the
  // app's own windows' default session never does.
  browserSession.protocol.handle(LOCAL_PAGE_SCHEME, (request) => serveLocalPage(request));
  // Chromium applies no Cross-Origin-Resource-Policy to a scheme handler's
  // answer and sends it no Sec-Fetch-Site (both read in fix 896's probe:
  // a web page's <img> of a local file loaded), so a subresource of a page
  // from the disk is held here to a frame of the same root id. A frame's
  // own navigation is the will-navigate and will-frame-navigate guards'.
  browserSession.webRequest.onBeforeRequest({ urls: [`${LOCAL_PAGE_SCHEME}://*/*`] }, (details, done) => {
    const allowed = localRequestAllowed(details.url, details.resourceType, details.frame?.url ?? '');
    if (!allowed) log(`browser: local page refused (another origin's ${details.resourceType}): ${details.url} from ${details.frame?.url ?? '(no frame)'}`);
    done({ cancel: !allowed });
  });
}

// M9 fix 896: the scheme a page from the disk is served on (local-page.ts). Standard, so a page's relative links and its own origin work and each root id is an origin of its own; secure, so it is a secure context as https is; fetch, so the page can read its own files; stream, for its video and audio. Not corsEnabled: a page of another origin cannot read it.
protocol.registerSchemesAsPrivileged([{ scheme: LOCAL_PAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

// Each root id main has served (M9 fix 896), so a page that linked out to the web comes Back to its folder after its record dropped the root; for the process's life.
const localRoots = new Map<string, string>();
function localRootOf(rootId: string): string | null {
  const root = localRootIn(lastLayout, rootId) ?? localRoots.get(rootId) ?? null;
  if (root !== null) localRoots.set(rootId, root);
  return root;
}

async function serveLocalPage(request: GlobalRequest): Promise<Response> {
  try {
    const a = await answerLocalPage(request.url, request.method, localRootOf);
    if (a.status === 200) {
      const body = request.method === 'HEAD' ? null : (Readable.toWeb(fs.createReadStream(a.file)) as ReadableStream);
      return new Response(body, { status: 200, headers: { ...LOCAL_PAGE_HEADERS, 'Content-Type': a.type } });
    }
    if (a.log) log(`browser: local page refused (${a.status} ${a.reason}): ${request.url}`);
    return new Response(a.body, { status: a.status, headers: { ...LOCAL_PAGE_HEADERS, 'Content-Type': a.type } });
  } catch (err) {
    log(`browser: local page failed: ${request.url}: ${err instanceof Error ? err.message : String(err)}`);
    return new Response('refused: could not read', { status: 500, headers: { ...LOCAL_PAGE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

app.whenReady().then(() => {
  if (handedOver) return;
  ensureBrowserSession(BROWSER_PARTITION);
  // Electron's default menu binds Ctrl+0, Ctrl+= and Ctrl+- to page zoom
  // in the main process, before the renderer ever sees the keys; the
  // renderer uses them for the terminal text size instead. Reload, the
  // devtools and full screen keep their keys. The two reloads are items of
  // their own so the file open relay holds from the click (M9 fix 549).
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'fileMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => { const w = menuWindow(); if (w !== null) reloadHolding(w.webContents, openRelay, false); } },
          { label: 'Force Reload', accelerator: 'Shift+CmdOrCtrl+R', click: () => { const w = menuWindow(); if (w !== null) reloadHolding(w.webContents, openRelay, true); } },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
  if (launchInGap()) {
    // M9 fix 408: the word is with a worker outside this process now, so
    // there is nothing to wait for; the installer is about to take this
    // exe anyway.
    app.quit();
    return;
  }
  client.start();
  // Registered here, after the handed-over and gap launches have quit, so
  // those write no will-quit line (M9 fix 657).
  app.on('will-quit', onWillQuit);
  // M9 fix 866: a window closing while the app quits keeps its record.
  app.on('before-quit', () => {
    quitting = true;
  });
  // M9 fix 671: whether Electron got past the app's last event. A slow
  // exit with this line is Chromium's own shutdown after it; one without
  // it is something in before-quit or will-quit. Here and not beside
  // window-all-closed, so a handed-over or gap launch writes none.
  app.on('quit', (_event, exitCode) => log(`quit, exit code ${exitCode}`));
  createWindow(null, 0);
  // A layout that arrived before the window (it never does, the connect
  // being async) is applied now.
  reconcile(lastLayout);
  installHooksOnFirstLaunch();
  updater.start();
  watchPresence();
});

// Presence (M9 fix 245): the lock screen, sleep and the idle clock, posted
// to the daemon as presence.away and presence.back so the waiting the
// activity view counts is docked by the time nobody could have answered.
// The daemon writes the app window's own coming and going itself; this
// is for the box left on with the app open. A daemon before level 47
// has no such request, so the post is skipped, and a post that fails
// (the pipe dropped mid-edge) is one log line, since the next edge posts
// again on its own.
const PRESENCE_LEVEL = 47;
const presence = new PresenceTracker();
function postPresence(edge: 'away' | 'back' | null): void {
  if (edge === null) return;
  const level = client.daemonInfo?.featureLevel ?? 0;
  if (level < PRESENCE_LEVEL) return;
  client.request(edge === 'away' ? 'presence.away' : 'presence.back', {}).catch((err: unknown) => log(`presence.${edge} failed: ${String(err)}`));
}
function watchPresence(): void {
  const floorMs = awayAfterMs();
  if (floorMs === null) {
    log('presence watching off under a private EMERALD_HOME (set EMERALD_AWAY_AFTER_MS to turn it on)');
    return;
  }
  powerMonitor.on('lock-screen', () => postPresence(presence.set('locked', true)));
  powerMonitor.on('unlock-screen', () => postPresence(presence.set('locked', false)));
  powerMonitor.on('suspend', () => postPresence(presence.set('asleep', true)));
  powerMonitor.on('resume', () => postPresence(presence.set('asleep', false)));
  // Polled, since the idle time is a question and not an event; often
  // enough that a short floor set by a script trips within a few ticks.
  const pollMs = Math.min(IDLE_POLL_MS, Math.max(500, Math.floor(floorMs / 4)));
  const timer = setInterval(() => postPresence(presence.set('idle', powerMonitor.getSystemIdleTime() * 1000 >= floorMs)), pollMs);
  timer.unref();
  // A reconnect (the daemon restarted) meets a daemon that read the
  // window's hello as back; an absence still held is posted again.
  client.on('connected', () => {
    if (presence.away) postPresence('away');
  });
}
// A reconnect (M9 fix 285) posts the windows still capped again. A
// restarted daemon has already replayed its capped lines from the
// activity log at start, so the re-post is normally a no-op
// (`recordCapped` answers false to a band already open); it matters only
// when the log lost the line.
client.on('connected', () => postUsageEdges(cappedNow(lastUsage)));

// M9 fix 657: app.quit() (the updater's restart through quitAndInstall,
// the File menu's Exit) closes the windows and goes to will-quit with no
// window-all-closed, so the line below would never be written on those
// paths, which are where an exit hang costs most (the installer waits on
// the exe). The flag keeps a close through window-all-closed to its one line.
let windowsClosed = false;

app.on('window-all-closed', () => {
  windowsClosed = true;
  client.stop();
  // What is still alive in the main process at the quit, so a build that
  // stays running with no window (M9 fix 243 met one) names its holder
  // in the log rather than leaving it to be guessed.
  log(`window-all-closed; active resources: ${process.getActiveResourcesInfo().join(', ') || 'none'}`);
  app.quit();
});

// client.stop() is a no-op after the updater's stopDaemon (pipe-client.ts
// already set `stopped`; stop() only ends the socket again).
function onWillQuit(): void {
  if (windowsClosed) return;
  client.stop();
  log(`will-quit; active resources: ${process.getActiveResourcesInfo().join(', ') || 'none'}`);
}
