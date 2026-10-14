import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DAEMON_FEATURE_LEVEL, Limits, browserUrl, PROTOCOL_VERSION, SESSION_PHASES, isSessionColor, isSessionPhase, isShellId, isUpdateState, updateText } from '@emerald/shared';
import type { ClientMessage, ConflictReport, FolderLabel, KeptScreen, Layout, Reply, Request, RequestType, Requests, ServerMessage, SessionInfo, SessionPhase, UpdateState } from '@emerald/shared';
import type { ActivityLog } from './activity.ts';
import type { PresenceKind, UsageEdge } from '@emerald/shared';
import type { UnhostedSessions } from './unhosted.ts';
import { RequestError } from './errors.ts';
import { JsonLinesDecoder, encodeJsonLine } from '@emerald/shared/jsonlines';
import type { LayoutStore } from './layout-store.ts';
import type { Logger } from './log.ts';
import type { OutputSink } from './pty-session.ts';
import { PromptsStore } from './prompts-store.ts';
import { FoldersStore } from './folders-store.ts';
import type { ConflictWatch } from './conflicts.ts';
import { SessionError, SessionManager, type SpawnRequest } from './session-manager.ts';
import { emeraldHomeOf } from '@emerald/shared/pipe-name';
import { timingSafeEqual } from 'node:crypto';

export interface PipeServerOptions {
  pipePath: string;
  daemonVersion: string;
  // When this daemon's process started, in epoch ms (M9 fix 494), for the
  // hello's daemonStartedAt; a server without one (the tests) answers the
  // same expression at the time of the hello.
  startedAt?: number;
  // The home this daemon serves, resolved, for the hello's home (M9 fix
  // 495); a server without one (the tests) answers EMERALD_HOME's or the
  // default's.
  home?: string;
  // What hello reports; defaults to the shared constant. Overridden by
  // EMERALD_DAEMON_FEATURE_LEVEL (see main.ts) so a script can stand an
  // "old" daemon up and drive the renderer's banner.
  featureLevel?: number;
  // The update feed the daemon serves (M9 fix 240), read at each hello
  // since it comes up after the pipe; a server without one (tests, a
  // box with no feed folder) answers null.
  feed?: () => { dir: string; port: number } | null;
  // The working spans behind activity.spans (M54); a server without one
  // (tests) answers an empty list.
  activity?: ActivityLog;
  // The conversations emerald did not start (M9 fix 233), whose tracks the
  // activity answer reads beside the records'; a server without one
  // (tests) has none.
  unhosted?: UnhostedSessions;
  log: Logger;
  // The saved prompts (M56). A test that never asks for them gets one
  // that lives in memory only.
  prompts?: PromptsStore;
  // The folder labels (M9 fix 194), the same way.
  folders?: FoldersStore;
  // The conflict forecast (M9 fix 320); a server without one (tests)
  // answers the empty report and pushes nothing.
  conflicts?: ConflictWatch;
  // What daemon.stop does once the screens are kept (M9 fix 159): the
  // daemon's shutdown, scheduled after the reply has gone out. A server
  // without one (tests) keeps the screens and stays up.
  onStop?: () => void;
  // A presence edge (M9 fix 245): `away` when the last connection that
  // said hello as the app closes, `back` when the next one says hello,
  // and whichever the app posts through presence.away and presence.back
  // (the lock screen, sleep, the idle clock). The daemon's own close
  // fires none, since the app is still there and reconnects.
  onPresence?: (kind: PresenceKind, at: number) => void;
  // A usage edge (M9 fix 285): the app posts that a usage window reached
  // 100 percent or dropped under, through usage.capped and usage.freed.
  onUsage?: (edge: UsageEdge, at: number) => void;
  // How long a file.open that waits waits for the window's answer
  // (M9 fix 375); the tests shorten it.
  fileOpenAckMs?: number;
  // The hook sink's memory of Test events (M9 fix 606); a server without
  // one (the tests) answers false.
  hookTestArrived?: (testId: string) => boolean;
  // How much unread a client may hold before it is dropped (M9 fix 497);
  // defaults to Limits.clientDropBytes, the tests shorten it.
  dropUnreadBytes?: number;
  // The pipe token (M9 fix 612), daemon.json's pipeToken: every hello must
  // carry it, and nothing but a hello is served before one that did. A
  // server without one (the tests) takes every hello and every request as
  // before the fix.
  token?: string;
}

type Topic = 'sessions' | 'layout' | 'activity' | 'rate' | 'app';

// What a connection needs from the server beyond its own state: the
// presence edges (M9 fix 245) and the update relay (M9 fix 271).
interface ServerHooks {
  onAppHello: () => void;
  onPresence: (kind: PresenceKind) => void;
  onUsage: (edge: UsageEdge) => void;
  // The last updater state the app reported, and the report itself.
  updateState: () => UpdateState | null;
  onUpdateReport: (state: UpdateState) => void;
  // How many connections are on the app topic; the count a click reaches.
  appTopicCount: () => number;
  // Push update.requested to every connection on the app topic.
  requestUpdate: () => number;
  // Push file.open.requested to every connection on the app topic (M9
  // fix 341); with a scheme (M9 fix 375) the reply waits for the
  // window's file.open.done, or the deadline. M9 fix 582: so does every
  // open when each window on the topic said level 58 at hello.
  requestFileOpen: (req: FileOpenAsk) => Promise<FileOpenAnswer>;
  // The window's answer to a push that carried an openId (M9 fix 375).
  fileOpenDone: (openId: number, answer: Omit<FileOpenAnswer, 'apps'>) => void;
}

type FileOpenAsk = Requests['file.open']['req'];
type FileOpenAnswer = Requests['file.open']['res'];

// How long a file.open that waits waits for the window's answer
// before replying with the count alone (M9 fix 375): a window that
// never answers (an older build, a renderer mid-reload) must not hold
// the CLI. The renderer answers within a frame on a quiet box.
export const FILE_OPEN_ACK_MS = 3000;

// The first app level whose hello says its level (M9 fix 582). Every
// window from level 55 answers an open that carries an id, but only one
// that says its level can be told from one that stays silent.
export const FILE_OPEN_ANSWER_LEVEL = 58;

// Grey, on its own line, like the renderer's own exit note.
const SCROLLBACK_LOST_NOTE = '\x1b[90m[scrollback lost: this session ended before emmerd restarted]\x1b[0m\r\n';

// A kept frame as terminal output (M9 fix 159): the rows from the top of
// a cleared screen, the cursor put back where it was. Plain text, since
// the emulator rendered the attributes away; the pane dims the whole.
function keptReplay(kept: KeptScreen): string {
  const rows = kept.rows.join('\r\n');
  return `\x1b[2J\x1b[H${rows}\x1b[${kept.cursor.y + 1};${kept.cursor.x + 1}H`;
}

// See the pty.input handler.
const echoTiming = process.env['EMERALD_LOOP_DELAY'] !== undefined && process.env['EMERALD_LOOP_DELAY'] !== '';

// The pipe, claimed before the daemon touches anything (M9 fix 454, M75's
// M1): a daemon that lost the race used to run its whole start first,
// rotating the live daemon's hook log and rewriting its sweep script
// before `listen` told it it had lost. A client that connects while the
// start runs is paused and held, in arrival order, until PipeServer.attach
// takes the server. Rejects with EADDRINUSE when another daemon owns the
// pipe, which is the single-instance check.
export interface ClaimedPipe {
  server: net.Server;
  held: net.Socket[];
}

export function claimPipe(pipePath: string): Promise<ClaimedPipe> {
  return new Promise((resolve, reject) => {
    const held: net.Socket[] = [];
    const server = net.createServer((socket) => {
      socket.pause();
      held.push(socket);
      // A client that gives up while it waits must not throw from here.
      socket.on('error', () => {});
      socket.once('close', () => {
        const i = held.indexOf(socket);
        if (i !== -1) held.splice(i, 1);
      });
    });
    server.once('error', reject);
    server.listen(pipePath, () => {
      server.off('error', reject);
      resolve({ server, held });
    });
  });
}

export class PipeServer {
  // Built by listen() (the tests) or handed over by attach() (the daemon,
  // M9 fix 454); null until one of them runs, so a daemon never builds a
  // server it does not listen on (M9 fix 553).
  private server: net.Server | null = null;
  private readonly clients = new Set<ClientConnection>();
  // The connections that said hello as the app (M9 fix 245); the edges
  // of this count are the presence lines.
  private appClients = 0;
  // The updater's state as the app last reported it (M9 fix 271); null
  // until a window has said, and kept once it has so `emmer update` can
  // read the last word after the window closed.
  private updateState: UpdateState | null = null;
  // The file.open replies held for a window's file.open.done (M9 fix
  // 375), by the openId the push carried.
  private openSeq = 0;
  private readonly openWaits = new Map<number, (answer: Omit<FileOpenAnswer, 'apps'>) => void>();
  private closing = false;
  private readonly manager: SessionManager;
  private readonly layouts: LayoutStore;
  private readonly opts: PipeServerOptions;

  constructor(manager: SessionManager, layouts: LayoutStore, opts: PipeServerOptions) {
    this.manager = manager;
    this.layouts = layouts;
    this.opts = { ...opts, prompts: opts.prompts ?? new PromptsStore('', opts.log), folders: opts.folders ?? new FoldersStore('', opts.log) };
    // A label set from one window reaches every other and the CLI (M9
    // fix 194), on the sessions topic since it is the sidebar's list.
    this.opts.folders?.on('changed', (folders: FolderLabel[]) => this.broadcast('sessions', { type: 'folders.changed', folders }));
    // The forecast after a poll moved it (M9 fix 320), on the sessions
    // topic since it is the sidebar's rows and the graph's lanes.
    this.opts.conflicts?.on('changed', (report: ConflictReport) => this.broadcast('sessions', { type: 'conflicts.changed', report }));
    manager.on('changed', (info: SessionInfo) => this.broadcast('sessions', { type: 'session.changed', session: info }));
    // The client that made the change hears it too, so a renderer can treat
    // the push as the single source of truth and ignore the reply body.
    layouts.on('changed', (layout: Layout) => this.broadcast('layout', { type: 'layout.changed', layout }));
    manager.on('exit', (info: SessionInfo) => {
      for (const client of this.clients) client.onSessionExit(info);
    });
    manager.on('activity', ({ id, at }: { id: string; at: number }) => this.broadcast('activity', { type: 'pty.activity', sessionId: id, at }));
    manager.on('rate', ({ id, samples, at }: { id: string; samples: number[]; at: number }) => this.broadcast('rate', { type: 'pty.rate', sessionId: id, samples, at }));
    manager.on('removed', (sessionId: string) => {
      for (const client of this.clients) client.onSessionRemoved(sessionId);
      // Panes are emptied before the session disappears from the list, so
      // no renderer ever draws a pane on a session it cannot look up.
      layouts.clearSession(sessionId);
      this.broadcast('sessions', { type: 'session.removed', sessionId });
    });
  }

  // Rejects with EADDRINUSE when another daemon already owns the pipe, which
  // is the single-instance check.
  listen(): Promise<void> {
    const server = net.createServer((socket) => this.onConnection(socket));
    this.server = server;
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(this.opts.pipePath, () => {
        server.off('error', onError);
        server.on('error', (err) => this.opts.log.error('pipe server error', err));
        resolve();
      });
    });
  }

  // Takes a pipe claimPipe already holds (M9 fix 454) in place of listen:
  // its connections from here on are this server's, and each one held
  // while the start ran is handed over, resumed, in arrival order.
  attach(claimed: ClaimedPipe): void {
    const { server, held } = claimed;
    this.server = server;
    server.removeAllListeners('connection');
    server.on('connection', (socket: net.Socket) => this.onConnection(socket));
    server.on('error', (err) => this.opts.log.error('pipe server error', err));
    for (const socket of held.splice(0)) {
      if (socket.destroyed) continue;
      this.onConnection(socket);
      socket.resume();
    }
  }

  close(): Promise<void> {
    this.closing = true;
    for (const client of this.clients) client.destroy();
    const server = this.server;
    if (server === null) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  // How many app windows are on the pipe, for daemon status and tests.
  get appClientCount(): number {
    return this.appClients;
  }

  // The hello of an app connection and its close (M9 fix 245): the
  // first app in is `back`, the last app out is `away`.
  private onAppHello(): void {
    this.appClients += 1;
    if (this.appClients === 1) this.presence('back');
  }

  private onAppClose(): void {
    this.appClients -= 1;
    if (this.appClients === 0 && !this.closing) this.presence('away');
  }

  private presence(kind: PresenceKind): void {
    if (this.opts.onPresence !== undefined) this.opts.onPresence(kind, Date.now());
  }

  private usage(edge: UsageEdge): void {
    if (this.opts.onUsage !== undefined) this.opts.onUsage(edge, Date.now());
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private onConnection(socket: net.Socket): void {
    const client = new ClientConnection(socket, this.manager, this.layouts, this.opts, {
      onAppHello: () => this.onAppHello(),
      onPresence: (kind) => this.presence(kind),
      onUsage: (edge) => this.usage(edge),
      updateState: () => this.updateState,
      onUpdateReport: (state) => {
        // Logged on the phase's change alone, since a download reports
        // every percent.
        if (this.updateState?.phase !== state.phase) this.opts.log.info(`update: ${updateText(state)}`);
        this.updateState = state;
      },
      appTopicCount: () => this.subscribedCount('app'),
      requestUpdate: () => {
        this.opts.log.info('update: a click relayed to the app');
        this.broadcast('app', { type: 'update.requested' });
        return this.subscribedCount('app');
      },
      requestFileOpen: (req) => this.requestFileOpen(req),
      fileOpenDone: (openId, answer) => {
        const resolve = this.openWaits.get(openId);
        if (resolve === undefined) return;
        this.openWaits.delete(openId);
        resolve(answer);
      },
    });
    this.clients.add(client);
    socket.once('close', () => {
      this.clients.delete(client);
      if (client.isApp) this.onAppClose();
    });
  }

  private subscribedCount(topic: Topic): number {
    let n = 0;
    for (const client of this.clients) if (client.subscribed(topic)) n += 1;
    return n;
  }

  // Whether every window on the app topic answers a plain open (M9 fix
  // 582): at least one is there and each said level 58 or more at hello.
  private appTopicAnswers(): boolean {
    let n = 0;
    for (const client of this.clients) {
      if (!client.subscribed('app')) continue;
      if (client.appLevel < FILE_OPEN_ANSWER_LEVEL) return false;
      n += 1;
    }
    return n > 0;
  }

  // The relay of a file.open (M9 fix 341): the push to every window on
  // the app topic and the count. With a scheme (M9 fix 375) the push
  // carries an openId and the reply waits for one window's
  // file.open.done, so the CLI can say whether the name was known; the
  // deadline answers with the count alone. M9 fix 582: when every window
  // on the topic said level 58 at hello, a plain open waits the same way
  // and the reply says whether the window answered.
  private requestFileOpen(req: FileOpenAsk): Promise<FileOpenAnswer> {
    const { path, pane, scheme, beside, url } = req;
    const apps = this.subscribedCount('app');
    const answering = this.appTopicAnswers();
    const words = [pane ? 'for a pane' : '', scheme === undefined ? '' : scheme === null ? 'clearing its scheme' : `with scheme ${scheme}`, beside === undefined ? '' : `beside ${beside}`, url ? 'as a page' : ''].filter((w) => w !== '');
    this.opts.log.info(`file.open: ${path} relayed to the app${words.length > 0 ? ' ' + words.join(', ') : ''}`);
    const extras = { ...(scheme === undefined ? {} : { scheme }), ...(beside === undefined ? {} : { beside }), ...(url === true ? { url: true } : {}) };
    if (apps === 0 || (scheme === undefined && beside === undefined && !answering)) {
      this.broadcast('app', { type: 'file.open.requested', path, pane, ...extras });
      return Promise.resolve({ apps });
    }
    const openId = ++this.openSeq;
    this.broadcast('app', { type: 'file.open.requested', path, pane, openId, ...extras });
    return new Promise<FileOpenAnswer>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.openWaits.delete(openId)) return;
        this.opts.log.info(`file.open: no answer from the window for ${path} within ${FILE_OPEN_ACK_MS} ms`);
        resolve(answering ? { apps, answered: false } : { apps });
      }, this.opts.fileOpenAckMs ?? FILE_OPEN_ACK_MS);
      this.openWaits.set(openId, (answer) => {
        clearTimeout(timer);
        resolve({ apps, ...answer, ...(answering ? { answered: true } : {}) });
      });
    });
  }

  private broadcast(topic: Topic, msg: ServerMessage): void {
    for (const client of this.clients) {
      if (client.subscribed(topic)) client.send(msg);
    }
  }
}

// A connection's id, for the log's drop line (M9 fix 497).
let nextClientId = 1;

class ClientConnection {
  readonly id = nextClientId++;
  private readonly socket: net.Socket;
  private readonly manager: SessionManager;
  private readonly layouts: LayoutStore;
  private readonly prompts: PromptsStore;
  private readonly folders: FoldersStore;
  private readonly opts: PipeServerOptions;
  private readonly decoder = new JsonLinesDecoder();
  private readonly topics = new Set<Topic>();
  // Sessions this client is attached to, with the sink registered on each.
  private readonly attachments = new Map<string, OutputSink>();
  // Sessions this client paused because its socket buffer filled up.
  private readonly paused = new Set<string>();
  private closed = false;
  // Set once the connection is dropped for not reading, so it is said once.
  private dropping = false;
  // When a pty.input or pty.resize into a session last warned, by session
  // id ('' when the message named none) (M9 fix 499): typing into a pane
  // whose session the daemon no longer holds was one log line, a sync
  // disk write, per keystroke.
  private readonly warnedAt = new Map<string, number>();
  // Said hello as the app (M9 fix 245); one hello counts, however many.
  isApp = false;
  // The level the app said at hello (M9 fix 582), 0 for an app older
  // than the fix or a CLI.
  appLevel = 0;
  private readonly hooks: ServerHooks;
  // Said hello with the pipe token (M9 fix 612); true from the start on a
  // server with no token.
  private authed: boolean;
  // Refused and closing (M9 fix 612): the rest of what it sent is ignored.
  private refused = false;

  constructor(socket: net.Socket, manager: SessionManager, layouts: LayoutStore, opts: PipeServerOptions, hooks: ServerHooks) {
    this.socket = socket;
    this.manager = manager;
    this.layouts = layouts;
    this.hooks = hooks;
    // The server put one on the options for every connection to share.
    this.prompts = opts.prompts ?? new PromptsStore('', opts.log);
    this.folders = opts.folders ?? new FoldersStore('', opts.log);
    this.opts = opts;
    this.authed = opts.token === undefined;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', (err) => opts.log.warn('client socket error', err));
    socket.once('close', () => this.onClose());
    socket.on('drain', () => this.resumePaused());
  }

  subscribed(topic: Topic): boolean {
    return this.topics.has(topic);
  }

  send(msg: ServerMessage): void {
    if (this.closed) return;
    this.write(encodeJsonLine(msg));
  }

  // Every write to the socket goes through here, replies, pushes and a
  // pty's output alike, so a client that has stopped reading is dropped
  // once its unread passes the mark (M9 fix 497) rather than growing the
  // daemon's heap without bound. onClose detaches and forgets it.
  private write(line: string): void {
    this.socket.write(line);
    const unread = this.socket.writableLength;
    if (this.dropping || unread <= (this.opts.dropUnreadBytes ?? Limits.clientDropBytes)) return;
    this.dropping = true;
    this.opts.log.warn(`dropping client ${this.id}: ${Math.round(unread / 1048576)} MB unread`);
    this.socket.destroy();
  }

  destroy(): void {
    this.socket.destroy();
  }

  onSessionExit(info: SessionInfo): void {
    if (!this.attachments.has(info.id)) return;
    this.send({ type: 'pty.exit', sessionId: info.id, exitCode: info.exitCode ?? -1 });
  }

  // The record is already gone, so there is no PTY to detach from; just
  // forget the attachment so a later detach does not look it up.
  onSessionRemoved(sessionId: string): void {
    this.attachments.delete(sessionId);
    this.paused.delete(sessionId);
  }

  private onData(chunk: Buffer): void {
    let messages: unknown[];
    try {
      messages = this.decoder.push(chunk);
    } catch (err) {
      // Malformed framing means we no longer know where messages begin. Drop the client.
      this.opts.log.warn('dropping client: bad framing', err);
      this.socket.destroy();
      return;
    }
    for (const msg of messages) this.dispatch(msg);
  }

  // A hot-path failure, said at most once a minute per session.
  private warnOnce(msg: object, text: string, err: unknown): void {
    const id = (msg as Record<string, unknown>)['sessionId'];
    const key = typeof id === 'string' ? id : '';
    const now = Date.now();
    const last = this.warnedAt.get(key);
    if (last !== undefined && now - last < 60_000) return;
    this.warnedAt.set(key, now);
    this.opts.log.warn(text, err);
  }

  private dispatch(raw: unknown): void {
    if (!isObject(raw) || typeof raw['type'] !== 'string') {
      this.opts.log.warn('ignoring message without a type', raw);
      return;
    }
    const msg = raw as ClientMessage;
    if (this.refused) return;
    if (!this.gate(msg)) return;

    // Hot path, no reply. Errors are logged rather than reported. A restored
    // session has no PTY, and typing into it is as harmless as typing into
    // an exited one, so that is silently dropped too.
    if (msg.type === 'pty.input') {
      try {
        const sessionId = expectString(msg, 'sessionId');
        const pty = this.manager.get(sessionId).pty;
        // Under EMERALD_LOOP_DELAY (M9 fix 226) the time from this write to
        // the session's next byte out is logged too: conpty and the shell's
        // own echo, the one leg of a keystroke's trip the loop delay
        // lines cannot see. The session id is on the line so the bench
        // reads the typed shell's leg alone (M9 fix 238): a keyless input
        // into a pane, the focus report after a layout change, once stood
        // as a 12.7 s echo on a round's row.
        if (pty !== null && pty !== undefined && echoTiming) {
          const t0 = performance.now();
          pty.once('data', () => this.opts.log.info('echo', { ms: Math.round((performance.now() - t0) * 10) / 10, sessionId }));
        }
        pty?.write(expectString(msg, 'data'));
      } catch (err) {
        this.warnOnce(msg, 'pty.input failed', err);
      }
      return;
    }
    if (msg.type === 'pty.resize') {
      try {
        this.manager.get(expectString(msg, 'sessionId')).pty?.resize(expectNumber(msg, 'cols'), expectNumber(msg, 'rows'));
      } catch (err) {
        this.warnOnce(msg, 'pty.resize failed', err);
      }
      return;
    }

    if (typeof msg.id !== 'number') {
      this.opts.log.warn('ignoring request without a numeric id', raw);
      return;
    }
    const fail = (err: unknown): Reply => {
      const code = err instanceof RequestError ? err.code : 'internal';
      const message = err instanceof Error ? err.message : String(err);
      if (code === 'internal') this.opts.log.error(`request ${msg.type} failed`, err);
      return { type: 'reply', id: msg.id, ok: false, error: { code, message } };
    };
    let result: Requests[RequestType]['res'] | Promise<Requests[RequestType]['res']>;
    try {
      result = this.handle(msg);
    } catch (err) {
      this.send(fail(err));
      return;
    }
    // Most requests answer at once; pty.screen waits on the emulator, and
    // its reply goes out when it is ready while other messages keep flowing.
    if (result instanceof Promise) {
      result.then((r) => this.send({ type: 'reply', id: msg.id, ok: true, result: r }), (err) => this.send(fail(err)));
      return;
    }
    this.send({ type: 'reply', id: msg.id, ok: true, result });
  }

  // The pipe token (M9 fix 612). Every hello is checked, a second one on an
  // authed connection included; anything else before a good hello is
  // refused. A refusal sends one error reply when the message has an id and
  // then ends the socket, so the reply is flushed before the pipe goes.
  private gate(msg: ClientMessage): boolean {
    const token = this.opts.token;
    if (token === undefined) return true;
    const id = (msg as { id?: unknown }).id;
    const refuse = (code: string, message: string, logLine: string): boolean => {
      this.opts.log.warn(logLine);
      this.refused = true;
      if (typeof id === 'number') this.send({ type: 'reply', id, ok: false, error: { code, message } });
      this.socket.end();
      return false;
    };
    if (msg.type === 'hello') {
      const given = (msg as { token?: unknown }).token;
      if (typeof given !== 'string' || given === '') {
        return refuse('token-required', 'hello without a token: this client predates the pipe token of M9 fix 612; use the emmer and the Emerald window of the same install as this emmerd', 'hello refused: no token');
      }
      const a = Buffer.from(given, 'utf8');
      const b = Buffer.from(token, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return refuse('bad-token', "hello token does not match this emmerd's (M9 fix 612): the client read another daemon.json, from another home or an older daemon", 'hello refused: wrong token');
      }
      this.authed = true;
      return true;
    }
    if (this.authed) return true;
    return refuse('hello-first', 'say hello with the token from daemon.json first (M9 fix 612)', `dropping client: ${msg.type} before hello`);
  }

  private handle(req: Request): Requests[RequestType]['res'] | Promise<Requests[RequestType]['res']> {
    switch (req.type) {
      case 'hello': {
        const version = expectNumber(req, 'protocolVersion');
        if (version !== PROTOCOL_VERSION) {
          throw new SessionError('protocol-mismatch', `daemon speaks protocol ${PROTOCOL_VERSION}, client sent ${version}`);
        }
        if (req.client === 'app') this.appLevel = req.featureLevel === undefined ? 0 : expectNumber(req, 'featureLevel');
        if (req.client === 'app' && !this.isApp) {
          this.isApp = true;
          this.hooks.onAppHello();
        }
        return {
          daemonPid: process.pid,
          daemonStartedAt: this.opts.startedAt ?? Math.round(Date.now() - process.uptime() * 1000),
          home: this.opts.home ?? path.resolve(emeraldHomeOf(process.env)),
          daemonVersion: this.opts.daemonVersion,
          featureLevel: this.opts.featureLevel ?? DAEMON_FEATURE_LEVEL,
          feed: this.opts.feed?.() ?? null,
          shells: this.manager.installedShells(),
        };
      }
      case 'session.list':
        return { sessions: this.manager.list({ removed: req.removed === undefined ? false : expectBoolean(req, 'removed') }) };
      case 'session.spawn': {
        const kind = expectString(req, 'kind');
        if (kind !== 'claude' && kind !== 'shell') throw new SessionError('bad-request', `unknown session kind ${kind}`);
        // M9 fix 624: one of the hello's shells, for a plain shell alone.
        if (req.shell !== undefined) {
          if (!isShellId(req.shell)) throw new SessionError('bad-request', `unknown shell ${String(req.shell)}; one of pwsh, powershell, gitbash, cmd`);
          if (kind === 'claude') throw new SessionError('bad-request', 'shell is for kind shell, not claude');
        }
        const spawnReq: SpawnRequest = {
          kind,
          cwd: expectString(req, 'cwd'),
          cols: expectNumber(req, 'cols'),
          rows: expectNumber(req, 'rows'),
          ...(req.name !== undefined ? { name: expectName(req) } : {}),
          ...(req.args !== undefined ? { args: expectStringArray(req, 'args') } : {}),
          ...(req.shell !== undefined ? { shell: req.shell } : {}),
        };
        return { session: this.manager.spawn(spawnReq) };
      }
      case 'session.kill':
        this.manager.kill(expectString(req, 'sessionId'), req.remove === undefined ? false : expectBoolean(req, 'remove'));
        return {};
      case 'session.resume':
        return { session: this.manager.resume(expectString(req, 'sessionId'), expectNumber(req, 'cols'), expectNumber(req, 'rows')) };
      case 'session.remove':
        this.manager.remove(expectString(req, 'sessionId'));
        return {};
      case 'session.rename':
        this.manager.rename(expectString(req, 'sessionId'), expectName(req));
        return {};
      case 'session.set': {
        const fields: { comment?: string | null; phase?: SessionPhase | null; color?: string; scheme?: string | null } = {};
        if (req.comment !== undefined) fields.comment = req.comment === null ? null : expectComment(req);
        if (req.color !== undefined) {
          // The shape the store keeps, so a stored colour and a set one agree.
          if (!isSessionColor(req.color)) throw new SessionError('bad-request', 'color must be a lower-case hex colour, #rrggbb');
          fields.color = req.color;
        }
        if (req.scheme !== undefined) {
          // A name, trimmed; the daemon keeps no list of schemes (the
          // renderer reads them off the box), so it checks the shape alone.
          const scheme = req.scheme === null ? '' : expectScheme(req);
          fields.scheme = scheme === '' ? null : scheme;
        }
        if (req.phase !== undefined) {
          if (req.phase !== null && !isSessionPhase(req.phase)) {
            throw new SessionError('bad-request', `phase must be one of ${SESSION_PHASES.join(', ')}`);
          }
          fields.phase = req.phase;
        }
        this.manager.set(expectString(req, 'sessionId'), fields);
        return {};
      }
      case 'session.ack':
        this.manager.ack(expectString(req, 'sessionId'));
        return {};
      case 'session.read': {
        const rec = this.manager.get(expectString(req, 'sessionId'));
        // Restored from sessions.json: no PTY, no scrollback, and a cursor
        // of 0 so a reader that starts here sees everything after a resume.
        if (rec.pty === null) return { data: '', next: 0, lastOutputAt: null };
        const read = req.since === undefined ? rec.pty.readSince(0) : rec.pty.readSince(expectNumber(req, 'since'));
        let data = read.data;
        if (req.maxBytes !== undefined) {
          const max = expectNumber(req, 'maxBytes');
          if (data.length > max) data = data.subarray(data.length - max);
        }
        return {
          data: data.toString('base64'),
          next: read.next,
          ...(read.oldest !== undefined && req.since !== undefined ? { oldest: read.oldest } : {}),
          lastOutputAt: rec.pty.lastOutputAt,
        };
      }
      case 'pty.screen': {
        const rec = this.manager.get(expectString(req, 'sessionId'));
        if (rec.pty === null) {
          // The frame kept at the exit or the stop (M9 fix 159), when there is one.
          if (rec.kept != null) return { rows: [...rec.kept.rows], cursor: { ...rec.kept.cursor }, seq: 0, kept: true };
          return { rows: [], cursor: { x: 0, y: 0 }, seq: 0 };
        }
        return rec.pty.screen();
      }
      case 'presence.away':
        this.hooks.onPresence('away');
        return {};
      case 'presence.back':
        this.hooks.onPresence('back');
        return {};
      case 'usage.capped':
        this.hooks.onUsage({ kind: 'capped', window: expectString(req, 'window'), resetsAt: expectNumber(req, 'resetsAt') });
        return {};
      case 'usage.freed':
        this.hooks.onUsage({ kind: 'freed', window: expectString(req, 'window') });
        return {};
      case 'update.report': {
        const state = (req as { state?: unknown }).state;
        if (!isUpdateState(state)) throw new SessionError('bad-request', 'state must be an updater state');
        this.hooks.onUpdateReport(state);
        return {};
      }
      case 'update.state':
        return { state: this.hooks.updateState(), apps: this.hooks.appTopicCount() };
      case 'update.act':
        return { apps: this.hooks.requestUpdate() };
      case 'file.open': {
        const ask: FileOpenAsk = { path: expectString(req, 'path'), pane: expectBoolean(req, 'pane') };
        if (req.scheme !== undefined) {
          // The shape session.set takes (M9 fix 244): a name, trimmed, or
          // null; the window keeps the list.
          const scheme = req.scheme === null ? '' : expectScheme(req);
          ask.scheme = scheme === '' ? null : scheme;
        }
        // A session id (M9 fix 376); the window finds the pane, so the
        // daemon checks the shape alone.
        if (req.beside !== undefined) ask.beside = expectString(req, 'beside');
        // M9 fix 659: a page for the browser pane, held as browserUrl
        // writes it, so the window's layout validator takes it as sent.
        if (req.url !== undefined && expectBoolean(req, 'url')) {
          if (browserUrl(ask.path) !== ask.path) throw new SessionError('bad-request', 'url needs an http or https URL in path');
          if (ask.scheme !== undefined) throw new SessionError('bad-request', 'a url takes no scheme');
          ask.url = true;
        }
        return this.hooks.requestFileOpen(ask);
      }
      case 'file.open.done': {
        const answer: Omit<FileOpenAnswer, 'apps'> = {};
        if (req.known !== undefined) answer.known = expectBoolean(req, 'known');
        if (req.besideFound !== undefined) answer.besideFound = expectBoolean(req, 'besideFound');
        // Which of the session's panes the window picked (M9 fix 404);
        // the daemon checks the shape alone, as it does for beside.
        if (req.besidePane !== undefined) answer.besidePane = expectString(req, 'besidePane');
        if (req.besideTab !== undefined) answer.besideTab = expectString(req, 'besideTab');
        this.hooks.fileOpenDone(expectNumber(req, 'openId'), answer);
        return {};
      }
      case 'hooks.test': {
        // Checked before the lookup, so a server with no sink still refuses a bad id.
        const testId = expectString(req, 'testId');
        return { arrived: this.opts.hookTestArrived?.(testId) ?? false };
      }
      case 'daemon.stop':
        return this.manager.keepScreens().then((kept) => {
          // The reply first, then the exit: the caller waits on the pipe
          // closing and would otherwise read the drop as a failure.
          if (this.opts.onStop !== undefined) setTimeout(this.opts.onStop, 50);
          return { kept };
        });
      case 'pty.attach':
        this.attach(expectString(req, 'sessionId'));
        return {};
      case 'pty.detach':
        this.detach(expectString(req, 'sessionId'));
        return {};
      case 'subscribe': {
        for (const topic of expectStringArray(req, 'topics')) {
          if (topic !== 'sessions' && topic !== 'layout' && topic !== 'activity' && topic !== 'rate' && topic !== 'app') throw new SessionError('bad-request', `unknown topic ${topic}`);
          this.topics.add(topic);
        }
        return {};
      }
      case 'layout.get':
        return { layout: this.layouts.get() };
      case 'layout.set':
        return { layout: this.layouts.set(req.layout) };
      case 'prompts.list':
        return { prompts: this.prompts.list() };
      case 'prompts.set':
        this.prompts.set(expectString(req, 'name'), req.text === null ? null : expectString(req, 'text'));
        return {};
      case 'folders.list':
        return { folders: this.folders.list() };
      case 'folders.set':
        this.folders.set(expectString(req, 'folder'), req.label === null ? null : expectString(req, 'label'));
        return {};
      case 'conflicts.get':
        return this.opts.conflicts?.current() ?? { conflicts: [], base: {} };
      case 'activity.spans': {
        const from = expectNumber(req, 'from');
        const to = expectNumber(req, 'to');
        if (to < from) throw new SessionError('bad-request', 'to must not be before from');
        const activity = this.opts.activity;
        // M9 fix 217: only the request points opened since the caller's
        // last ask, and each track's open one; absent means every point.
        const since = (req as { requestsSince?: unknown }).requestsSince;
        const requestsSince = typeof since === 'number' && Number.isFinite(since) ? since : null;
        if (activity === undefined) return { sessions: [], capped: [], historyFrom: null };
        // The log loads in the background since M9 fix 517, so the answer
        // waits for it, and its clock is read once it is in.
        return activity.loaded.then(() => {
          const now = Date.now();
          // The capped bands (M9 fix 285) ride beside the rows.
          return { sessions: activity.spans(from, to, now, this.manager.list({ removed: true }), requestsSince, this.opts.unhosted?.list() ?? []), capped: activity.cappedSpans(from, to, now), historyFrom: activity.historyFrom };
        });
      }
      default:
        throw new SessionError('bad-request', `unknown request type ${(req as { type: string }).type}`);
    }
  }

  private attach(sessionId: string): void {
    const rec = this.manager.get(sessionId);
    // Attaching twice means "start over with a fresh replay". The Electron
    // main process keeps one pipe connection across renderer reloads, and a
    // reloaded renderer needs the scrollback again.
    if (this.attachments.has(sessionId)) this.detach(sessionId);
    const pty = rec.pty;
    if (pty === null) {
      // Restored from sessions.json: the scrollback died with the previous
      // daemon. The frame kept at its exit or the stop (M9 fix 159) goes in
      // the replay slot when there is one, so the pane shows what the
      // session was doing; else say so, so the pane is not silently blank.
      // The exit is reported only if the previous daemon recorded one.
      const replay = rec.kept == null ? SCROLLBACK_LOST_NOTE : keptReplay(rec.kept);
      this.send({ type: 'pty.output', sessionId, data: Buffer.from(replay).toString('base64'), replay: true });
      if (rec.info.exitCode !== null) this.send({ type: 'pty.exit', sessionId, exitCode: rec.info.exitCode });
      return;
    }
    const sink: OutputSink = (chunk, replay) => {
      if (this.closed) return;
      const msg: ServerMessage = replay
        ? { type: 'pty.output', sessionId, data: chunk.toString('base64'), replay: true }
        : { type: 'pty.output', sessionId, data: chunk.toString('base64') };
      this.write(encodeJsonLine(msg));
      if (this.dropping) return;
      // A renderer that cannot keep up must slow the PTY down rather than grow
      // our memory without bound. Resumed on 'drain'.
      if (this.socket.writableLength > Limits.backpressureHighWaterBytes && !this.paused.has(sessionId)) {
        this.paused.add(sessionId);
        pty.pause();
      }
    };
    this.attachments.set(sessionId, sink);
    // The replay push goes out inside attach(), before the reply to pty.attach.
    pty.attach(sink);
    // A session that already exited still replays, and the client should learn it is dead.
    if (pty.exited) {
      this.send({ type: 'pty.exit', sessionId, exitCode: pty.exitCode ?? -1 });
    }
  }

  private detach(sessionId: string): void {
    const sink = this.attachments.get(sessionId);
    if (sink === undefined) return;
    this.attachments.delete(sessionId);
    this.manager.get(sessionId).pty?.detach(sink);
    this.resumeOne(sessionId);
  }

  private resumePaused(): void {
    for (const sessionId of [...this.paused]) this.resumeOne(sessionId);
  }

  private resumeOne(sessionId: string): void {
    if (!this.paused.delete(sessionId)) return;
    try {
      this.manager.get(sessionId).pty?.resume();
    } catch {
      // Session is gone; nothing to resume.
    }
  }

  private onClose(): void {
    this.closed = true;
    for (const sessionId of [...this.attachments.keys()]) {
      try {
        this.detach(sessionId);
      } catch {
        // Session may already be gone.
      }
    }
    this.resumePaused();
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function expectString(obj: object, key: string): string {
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v !== 'string') throw new SessionError('bad-request', `${key} must be a string`);
  return v;
}

// Length bounds on the free text a client sets (M9 fix 511), checked
// before the manager's lookup. A name is one line, measured trimmed as
// the manager keeps it; a scheme is trimmed here and handed on so.
function expectName(req: object): string {
  const name = expectString(req, 'name');
  if (/[\r\n]/.test(name) || name.trim().length > Limits.nameMaxChars) throw new SessionError('bad-request', `name must be one line of at most ${Limits.nameMaxChars} characters`);
  return name;
}

function expectComment(req: object): string {
  const comment = expectString(req, 'comment');
  if (comment.trim().length > Limits.commentMaxChars) throw new SessionError('bad-request', `comment must be at most ${Limits.commentMaxChars} characters`);
  return comment;
}

function expectScheme(req: object): string {
  const scheme = expectString(req, 'scheme').trim();
  if (scheme.length > Limits.schemeMaxChars) throw new SessionError('bad-request', `scheme must be at most ${Limits.schemeMaxChars} characters`);
  return scheme;
}

function expectNumber(obj: object, key: string): number {
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SessionError('bad-request', `${key} must be a number`);
  return v;
}

function expectBoolean(obj: object, key: string): boolean {
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v !== 'boolean') throw new SessionError('bad-request', `${key} must be a boolean`);
  return v;
}

function expectStringArray(obj: object, key: string): string[] {
  const v = (obj as Record<string, unknown>)[key];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new SessionError('bad-request', `${key} must be an array of strings`);
  }
  return v as string[];
}
