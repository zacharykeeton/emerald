#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Limits, PROTOCOL_VERSION } from '@emerald/shared';
import { pipePathOf } from '@emerald/shared/pipe-name';
import type { UsageEdge } from '@emerald/shared';
import { ActivityLog, ROTATE_AT_BYTES } from './activity.ts';
import { UnhostedSessions } from './unhosted.ts';
import { feedHostSettings, startFeedHost } from './feed-host.ts';
import type { FeedHost } from './feed-host.ts';
import { hideConsoleListAgent } from './hidden-console-agent.ts';
import { HookSink } from './hook-sink.ts';
import { guardSelfKill } from './kill-guard.ts';
import { resolveClaudeModDir } from './launchers/claude.ts';
import { createFileLogger, rotateLogAtStart } from './log.ts';
import type { Logger } from './log.ts';
import { startLoopDelayLog } from './loop-delay.ts';
import { setGitRunnerLog } from './git-runner.ts';
import { LayoutStore } from './layout-store.ts';
import { PromptsStore } from './prompts-store.ts';
import { FoldersStore } from './folders-store.ts';
import { ConflictWatch } from './conflicts.ts';
import { bashrcPath, daemonInfoPath, foldersPath, loadScriptPath, logsDir, promptsPath, sessionsPath, statePath, emeraldHome } from './paths.ts';
import { PipeServer, claimPipe } from './pipe-server.ts';
import type { ClaimedPipe } from './pipe-server.ts';
import { SessionManager } from './session-manager.ts';
import { findShells } from './shells.ts';
import { LOAD_TICK_MS } from './load-sampler.ts';
import { SessionStore } from './session-store.ts';
import { sweepStaleTemps } from './store-file.ts';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

// The start's logger, for the catch below main (M9 fix 453): a daemon runs
// with stdio ignored, so a start that throws said nothing anywhere.
let startLog: Logger | null = null;
// Set once the start is far enough along to stop cleanly; until then an
// uncaught exception ends the process at once.
let shutdownOnThrow: ((signal: string) => void) | null = null;

async function main(): Promise<void> {
  // This process's start time, once (M9 fix 494): daemon.json, the hello
  // and the exit reaper all carry it, so a client that later kills this
  // daemon by pid can first check the pid is still this process. Taken
  // off the uptime rather than Date.now() at the write, which since fix
  // 454 comes seconds after the process started.
  const startedAt = Math.round(Date.now() - process.uptime() * 1000);
  hideConsoleListAgent();
  fs.mkdirSync(logsDir(), { recursive: true });
  // Mirror to stderr when started from a terminal; a detached daemon has no stderr worth writing to.
  const logPath = path.join(logsDir(), 'emmerd.log');
  const log = createFileLogger(logPath, process.stderr.isTTY === true);
  startLog = log;
  // Before the pipe and so before any pty (M9 fix 732): node-pty's console
  // list can name 0 or the daemon, and `process.kill(0)` on Windows ends
  // the process with no line.
  guardSelfKill(process, log);
  // Registered first (M9 fix 453, M75's J8 (a)): a throw between the
  // stores and the pipe is logged too. The shutdown is kept once there is
  // something to shut down.
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', err);
    if (shutdownOnThrow !== null) shutdownOnThrow('uncaughtException');
    else process.exit(1);
  });
  // Named per user and per home (M9 fix 495), so a private EMERALD_HOME
  // alone no longer lands on the user's own daemon.
  const pipePath = pipePathOf();

  // The pipe before anything else (M9 fix 454, M75's M1): a daemon that
  // loses the race exits here, before it has loaded or rotated the live
  // daemon's hook log, bound a sink or written the sweep script. A client
  // that connects while the rest of the start runs waits for its hello.
  let claimed: ClaimedPipe;
  try {
    claimed = await claimPipe(pipePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      log.error(`another emmerd already owns ${pipePath}; exiting`);
      process.exit(2);
    }
    throw err;
  }
  // The log's one generation (M9 fix 499), moved only once the pipe is
  // ours, so a daemon that lost the race never rotates the live one's.
  const rotated = rotateLogAtStart(logPath);
  if (rotated !== null) log.info('emmerd.log rotated', { bytes: rotated, to: path.join(logsDir(), 'emmerd.1.log') });
  // A temp a daemon left when it died between a write and its rename (M9
  // fix 556), cleared once the pipe is ours and before any store loads.
  sweepStaleTemps(emeraldHome(), log);

  // The sink comes first of the rest because sessions are stamped with its
  // port at spawn; a port some other process holds is traded for any free
  // one (hook-sink.ts).
  let manager: SessionManager | null = null;
  const hookLogPath = path.join(logsDir(), 'hooks.jsonl');
  // The rotation's knobs (M9 fix 469), read like the ones below, so
  // verify:hooks can watch a real daemon rotate with the app attached:
  // the threshold for the start load and the live check alike, and the
  // live check's interval.
  const rotateBytes = Number(process.env['EMERALD_HOOK_ROTATE_BYTES']);
  const rotateAtBytes = Number.isInteger(rotateBytes) && rotateBytes > 0 ? rotateBytes : ROTATE_AT_BYTES;
  const rotateMs = Number(process.env['EMERALD_HOOK_ROTATE_MS']);
  const rotateEveryMs = Number.isInteger(rotateMs) && rotateMs > 0 ? rotateMs : 60 * 60 * 1000;
  // The working spans (M54): the log so far, then every line as it lands.
  // Opened, not awaited (M9 fix 517): the rotation and the trim run here,
  // before the sink opens its append stream, and the files are read in
  // the background, so nothing on the way to `listening` waits on them.
  // A hook that lands meanwhile moves its session at once and is held
  // for the log until the load is done; activity.spans waits on it.
  const activity = ActivityLog.open(hookLogPath, log, { rotateAtBytes });
  // A Claude emerald did not start (M9 fix 233) posts under its own
  // conversation id, and its hooks run the state machine on a record of
  // their own so the log's lines carry a transition and the view draws
  // its spans.
  const unhosted = new UnhostedSessions(log);
  const hooks = await HookSink.listen(
    (sessionId, payload, at, isUnhosted) => {
      const result = isUnhosted ? unhosted.apply(sessionId, payload, at) : (manager?.applyHook(sessionId, payload, at) ?? { outcome: 'unknown-session' });
      activity.recordHook(sessionId, payload, at, result, isUnhosted);
      return result;
    },
    { eventLogPath: hookLogPath, log, expectsMod: (id) => manager?.launchedWithMod(id) ?? false },
  );
  // The live rotation (M9 fix 429): the load rotates only at the start,
  // so an hourly stat keeps a daemon left up for weeks under the same
  // threshold. About 5 MB a day lands on a busy box, so an hour is ample.
  // Started once the load is done, so a live rotation never shifts a
  // generation under the load's stream (M9 fix 517). Its handle is kept
  // so finish() stops it (M9 fix 553); a flag of its own rather than
  // `stopping`, which is declared further down and would be read in its
  // dead zone if the load resolved during an await before that line.
  let rotation: NodeJS.Timeout | null = null;
  let rotationStopped = false;
  void activity.loaded.then(() => {
    if (!rotationStopped) rotation = setInterval(() => void hooks.rotateIfPast(rotateAtBytes), rotateEveryMs).unref();
  });
  // Another test knob (M9 fix 196): how long a shell command must run
  // for its end to mark the row, so a script can read the mark off a
  // two-second sleep.
  const doneAfter = Number(process.env['EMERALD_SHELL_DONE_AFTER_MS']);
  // And the stall floor (M9 fix 232): a script sets it to seconds so the
  // alarm can be read, and the check runs often enough to trip it.
  const staleAfter = Number(process.env['EMERALD_STALE_AFTER_MS']);
  const staleKnob = Number.isInteger(staleAfter) && staleAfter > 0 ? { staleAfterMs: staleAfter, staleCheckIntervalMs: Math.min(30_000, Math.max(500, Math.floor(staleAfter / 2))) } : {};
  // The load sampler (M9 fix 300): the tick and a stub file for the
  // verify script, and the sweep method for the bench; off with
  // EMERALD_LOAD_TICK_MS=0.
  const loadTick = Number(process.env['EMERALD_LOAD_TICK_MS']);
  const loadKnob =
    Number.isInteger(loadTick) && loadTick === 0
      ? {}
      : {
          load: {
            tickMs: Number.isInteger(loadTick) && loadTick > 0 ? loadTick : LOAD_TICK_MS,
            method: process.env['EMERALD_LOAD_SWEEP'] === 'cim' ? ('cim' as const) : ('gp' as const),
            stubPath: process.env['EMERALD_LOAD_STUB'] || null,
            scriptPath: loadScriptPath(),
          },
        };
  // Found once (M9 fix 624): the hello reports them for the daemon's life.
  const shells = findShells();
  log.info('shells found', { shells: shells.map((o) => o.id) });
  // The emerald mod (M9 fix 725), read once: EMERALD_CLAUDE_MOD=0 takes a
  // daemon restart, like every other knob here.
  const claudeMod = resolveClaudeModDir(process.env);
  log.info(claudeMod.line);
  manager = new SessionManager(log, {
    hook: { port: hooks.port, token: hooks.token },
    claudeModDir: claudeMod.dir,
    shells,
    bashrcPath: bashrcPath(),
    store: new SessionStore(sessionsPath(), log),
    saveDelayMs: Limits.saveCoalesceMs,
    ...(Number.isInteger(doneAfter) && doneAfter >= 0 ? { shellDoneAfterMs: doneAfter } : {}),
    ...staleKnob,
    ...loadKnob,
  });
  manager.restore();
  const layouts = new LayoutStore(statePath(), log);
  layouts.load();
  // A pane on a session no record holds, listed or removed, is emptied
  // (M9 fix 456): nothing else ever would.
  const unknown = layouts.clearUnknown(new Set(manager.list({ removed: true }).map((s) => s.id)));
  if (unknown.length > 0) log.warn(`panes emptied of sessions no record holds: ${unknown.join(', ')}`);
  const prompts = new PromptsStore(promptsPath(), log);
  prompts.load();
  const folders = new FoldersStore(foldersPath(), log);
  folders.load();
  // The conflict forecast (M9 fix 320): a minute's poll over the live
  // sessions' branches and a poll after every credited commit; started
  // once the pipe is ours below.
  // EMERALD_CONFLICT_POLL_MS is the verify script's knob for the minute.
  const conflictPoll = Number(process.env['EMERALD_CONFLICT_POLL_MS']);
  const conflicts = new ConflictWatch({ list: () => manager?.list() ?? [], log, ...(Number.isInteger(conflictPoll) && conflictPoll > 0 ? { pollMs: conflictPoll } : {}) });
  manager.on('changed', (info) => conflicts.onSessionChanged(info));
  manager.on('removed', (id: string) => conflicts.onSessionRemoved(id));
  // A test knob: the acceptance script sets it to make this daemon report
  // itself as an older build than the app.
  const levelOverride = Number(process.env['EMERALD_DAEMON_FEATURE_LEVEL']);
  // The update feed (M9 fix 240), started once the pipe is ours below so
  // a daemon that loses the pipe race never binds the feed port either.
  let feed: FeedHost | null = null;
  // Presence (M9 fix 245): the app windows' edges and the app's own
  // posts, written to hooks.jsonl as the daemon's own lines when they
  // change anything, so the next start reads them back with the hooks.
  // Both wait on the load (M9 fix 517), so an edge lands after the held
  // hooks, in order; its line carries its own `at`, which is what the
  // log reads presence by.
  const presence = (kind: 'away' | 'back', at: number): void => {
    void activity.loaded.then(() => {
      if (!activity.recordPresence(kind, at)) return;
      hooks.append({ at, presence: kind });
      log.info(kind === 'away' ? 'nobody at the box: waiting stretches from here are not counted' : 'someone is back at the box');
    });
  };
  // Capped (M9 fix 285): the app's usage window edges, written the same
  // way when they open or close a band.
  const usage = (edge: UsageEdge, at: number): void => {
    void activity.loaded.then(() => {
      if (edge.kind === 'capped') {
        if (!activity.recordCapped(edge.window, edge.resetsAt, at)) return;
        hooks.append({ at, capped: { window: edge.window, resetsAt: edge.resetsAt } });
        log.info(`capped: the ${edge.window} usage window is spent until ${new Date(edge.resetsAt).toISOString()}; waiting stretches from here are not counted`);
        return;
      }
      if (!activity.recordFreed(edge.window, at)) return;
      hooks.append({ at, freed: { window: edge.window } });
      log.info(`freed: the ${edge.window} usage window is under its cap again`);
    });
  };
  // The pipe token (M9 fix 612), new at every start: every hello must carry
  // it, read off daemon.json, so a client that cannot read the user's home
  // cannot drive the daemon.
  const pipeToken = randomBytes(32).toString('hex');
  const server = new PipeServer(manager, layouts, {
    pipePath,
    token: pipeToken,
    daemonVersion: pkg.version,
    startedAt,
    home: path.resolve(emeraldHome()),
    feed: () => (feed === null || feed.port === null ? null : { dir: feed.dir, port: feed.port }),
    activity,
    unhosted,
    log,
    prompts,
    folders,
    conflicts,
    onPresence: presence,
    onUsage: usage,
    hookTestArrived: (testId) => hooks.testArrived(testId),
    // daemon.stop has kept the screens already (M9 fix 159).
    onStop: () => shutdown('daemon.stop', true),
    ...(Number.isInteger(levelOverride) && levelOverride > 0 ? { featureLevel: levelOverride } : {}),
  });

  const feedSettings = feedHostSettings();
  if (feedSettings.dir !== null) feed = await startFeedHost({ dir: feedSettings.dir, port: feedSettings.port, log });
  else log.info('feed: off (EMERALD_FEED_DIR=off)');
  const stopLoopDelay = startLoopDelayLog(log);
  setGitRunnerLog((msg) => log.warn(msg));
  conflicts.start();

  let stopping = false;
  // The screens are kept before the PTYs go (M9 fix 159), so a pane shows
  // what each session was doing until it is resumed; a stop that arrived
  // through daemon.stop has kept them already. On Windows no signal ever
  // lands here (a kill is a kill), which is why the request exists.
  const shutdown = (signal: string, kept: boolean = false) => {
    if (stopping) return;
    stopping = true;
    log.info(`shutting down on ${signal}`);
    void (kept || manager === null ? Promise.resolve() : manager.keepScreens()).then(() => finish());
  };
  // The record goes first, so a stale daemon.json never outlives the pipe
  // (M9 fix 164); then the PTYs, the servers and the exit. A stop must end
  // the process whatever a client still holds open: a daemon that took
  // daemon.stop, released the pipe and stayed alive with its PTYs killed
  // was found once under the harness (the closes waiting on a socket), so
  // the exit is forced after a moment if the closes have not come back,
  // each close logged so a slow one says which it was.
  const finish = () => {
    try {
      fs.unlinkSync(daemonInfoPath());
    } catch {
      // Already gone.
    }
    reapSelfLater();
    const forced = setTimeout(() => {
      log.warn('exit forced: a close did not come back');
      process.exit(0);
    }, Limits.stopExitGraceMs);
    forced.unref();
    conflicts.stop();
    unhosted.stop();
    rotationStopped = true;
    if (rotation !== null) clearInterval(rotation);
    stopLoopDelay?.();
    manager?.killAll();
    manager?.close();
    log.info('sessions killed');
    const closed = (what: string) => () => log.info(`${what} closed`);
    void Promise.all([server.close().then(closed('pipe')), hooks.close().then(closed('hook sink')), feed === null ? Promise.resolve() : feed.close().then(closed('feed'))]).then(() => {
      log.info('exiting');
      process.exit(0);
    });
  };
  // process.exit(0) below does not always end the process: one that had
  // logged `exiting` was found alive a minute later with a node-pty helper
  // under it, the pipe released and a new daemon up beside it (M9 fix 258;
  // node-pty's teardown hangs the exit now and then). A detached node
  // kills this process's tree a few seconds after finish() started, which
  // finds nothing when the exit went through and ends the hang when not.
  // It is handed this daemon's own start time beside its pid, since a pid
  // alone is a number Windows reuses and a reaper that is merely slow
  // would otherwise land on whoever took it (M9 fix 416, which also gave
  // it a deadline of its own; reaper.ts has the reading).
  const reapSelfLater = () => {
    const reaper = path.join(import.meta.dirname, 'reaper.js');
    try {
      spawn(process.execPath, [reaper, String(process.pid), String(startedAt)], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch (err) {
      log.warn('could not start the exit reaper', err);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
  shutdownOnThrow = shutdown;

  // The record is written before the held clients are served below, so a
  // client whose hello is answered finds daemon.json naming this daemon;
  // through a temp file as the stores write (M9 fix 455, M75's L4), so a
  // reader never meets it half written. It follows the shutdown (M9 fix
  // 553), so a throw after the write goes through finish(), which unlinks
  // it, and a stale file cannot outlive a failed start.
  const infoTmp = `${daemonInfoPath()}.${process.pid}.tmp`;
  fs.writeFileSync(
    infoTmp,
    JSON.stringify(
      {
        pid: process.pid,
        pipe: pipePath,
        pipeToken,
        protocolVersion: PROTOCOL_VERSION,
        version: pkg.version,
        startedAt,
        hookPort: hooks.port,
        hookToken: hooks.token,
      },
      null,
      2,
    ) + '\n',
  );
  fs.renameSync(infoTmp, daemonInfoPath());

  // Last, once a daemon.stop has a shutdown to call: the clients held
  // since the claim are served, and every one after them.
  server.attach(claimed);
  log.info(`emmerd ${pkg.version} listening`, { pipe: pipePath, pid: process.pid, home: emeraldHome(), hookPort: hooks.port });
}

main().catch((err: unknown) => {
  if (startLog !== null) startLog.error('start failed', err);
  else process.stderr.write(`emmerd: start failed: ${String(err)}\n`);
  process.exit(1);
});
