// The update check and the install the app runs itself (M9 fix 239).
// electron-updater reads latest.yml from the feed (the local feed's URL,
// EMERALD_UPDATE_URL, or the GitHub releases repository, fix 608), and this
// module turns its events into the one state the title row's badge draws
// (update-model.ts). A check that finds a newer build starts its download
// on its own (M9 fix 625), with no badge while it runs; ready once the
// installer sits in the updater's cache with its sha512 checked, and
// available only when that download failed, for a click to try again.
// The one click on `Restart to update` is the handoff: the daemon is
// asked to stop (it keeps every session's screen and exits; the sessions
// resume from their records, M48), and only once it is gone does
// quitAndInstall run the installer silently, since the daemon runs under
// Emerald.exe and an installer over a running exe fails. Nothing installs
// on its own: the download runs by itself, the install waits for the click.
// The click also leaves the install's marker (M9 fix 282, install-gap.ts)
// and has its word posted from outside the install folder (M9 fix 323,
// install-poster.ts), so the minute with no window reads as an install
// and not a crash.
import type { UpdatePhase, UpdateState } from '../renderer/src/update-model.ts';
import { feedUrl, GITHUB_RELEASES, isNewerVersion } from '@emerald/shared';
import { defaultFeedDir } from '@emerald/shared/feed-server';

// Where the updater reads (fix 608): a generic URL (the local feed, or a
// verify script's stub) or the public releases repository on GitHub.
export type FeedSpec = { provider: 'generic'; url: string } | { provider: 'github'; owner: string; repo: string };

// The feed a build checks, in four steps (fix 608): EMERALD_NO_UPDATE=1
// turns the check off; a non-empty EMERALD_UPDATE_URL is the feed, packaged
// or not (the verify scripts' stub feeds, and M9 fix 242's dev-build hint);
// a dev build checks nothing otherwise; a packaged build on a box that has
// a local feed folder takes the local feed, since that box is the
// developer's and takes batches from it; every other install reads the
// GitHub releases.
export function updateFeedSpec(env: NodeJS.ProcessEnv, packaged: boolean, exists: (p: string) => boolean): FeedSpec | null {
  if (env['EMERALD_NO_UPDATE'] === '1') return null;
  const override = env['EMERALD_UPDATE_URL'];
  if (override !== undefined && override !== '') return { provider: 'generic', url: override };
  if (!packaged) return null;
  if (exists(defaultFeedDir(env))) return { provider: 'generic', url: feedUrl() };
  return { provider: 'github', ...GITHUB_RELEASES };
}

export interface UpdaterDeps {
  // The running build's version, off package.json.
  current: string;
  // The feed, a generic URL or the GitHub releases repository, or null
  // when the check is off (a dev build, or EMERALD_NO_UPDATE=1).
  feed: FeedSpec | null;
  // The check's cadence after the first one at launch.
  intervalMs: number;
  // How long after launch the first check runs, so a start is not slowed.
  firstDelayMs: number;
  log: (msg: string) => void;
  push: (state: UpdateState) => void;
  // The clock behind `checked 18:43, up to date`; a test hands in its own.
  now?: () => Date;
  // Stops the daemon and resolves once it has let go of the pipe.
  stopDaemon: () => Promise<void>;
  // Writes installing.json for the version about to be installed (M9 fix
  // 282), before the daemon stops, so a launch in the gap finds it.
  markInstalling: (version: string) => void;
  // Posts the install's word for the version about to be installed from
  // a process outside the install folder (M9 fix 323), before the daemon
  // stops; the app's own notifier is killed by the installer's sweep
  // before its toast shows.
  postPoster: (version: string) => void;
  // electron-updater's autoUpdater, or a stand-in for a test; a factory,
  // called once and only when there is a feed, since the module builds
  // its NsisUpdater on first touch and a dev build never needs it.
  updater: () => UpdaterLike;
}

// The slice of electron-updater's AppUpdater this module uses, so a test
// can hand in an emitter of its own.
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  disableWebInstaller: boolean;
  logger: { info(m: unknown): void; warn(m: unknown): void; error(m: unknown): void; debug?(m: unknown): void } | null;
  setFeedURL(options: FeedSpec): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface Updater {
  state(): UpdateState;
  // The badge's click: install when a build is downloaded (the download
  // itself runs on its own, M9 fix 625), retry the download when it
  // failed and the build reads available, check again after an error.
  act(): Promise<void>;
  start(): void;
  dispose(): void;
}

// Whether a check failed to reach the feed at all (nothing serving the
// port, the machine offline), as against a feed that answered badly.
// Electron's net module and Node's sockets word it differently. On GitHub
// (fix 608) a repository with no published release, or one that is
// missing, private or turning the box away, is the same plain case:
// electron-updater 6.8.9's GitHubProvider says `No published versions on
// GitHub` for an atom feed with no entry, `Unable to find latest version
// on GitHub` when /releases/latest fails, and a bare status line first
// when the atom request itself fails. A release without its latest.yml is
// a broken release and is left to the bad-answer path.
export function isNoFeedError(message: string, provider: FeedSpec['provider'] = 'generic'): boolean {
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|ERR_CONNECTION_TIMED_OUT|ETIMEDOUT|ERR_CONNECTION_RESET|ECONNRESET|ERR_NAME_NOT_RESOLVED|ENOTFOUND|ERR_INTERNET_DISCONNECTED|ERR_ADDRESS_UNREACHABLE|EHOSTUNREACH|ENETUNREACH/.test(message)) return true;
  return provider === 'github' && /No published versions on GitHub|Unable to find latest version on GitHub|^(403|404|429) /.test(message);
}

// The feed's host and port for the `no feed at` line, off its URL, or
// github.com for the releases repository.
function feedHost(feed: FeedSpec): string {
  if (feed.provider === 'github') return 'github.com';
  try {
    return new URL(feed.url).host;
  } catch {
    return feed.url;
  }
}

// What the start line names: the URL as before, or the repository.
function feedName(feed: FeedSpec): string {
  return feed.provider === 'github' ? `github.com/${feed.owner}/${feed.repo}` : feed.url;
}

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const { log, feed } = deps;
  const now = deps.now ?? (() => new Date());
  const updater = feed === null ? null : deps.updater();
  let state: UpdateState = { phase: feed === null ? 'off' : 'idle', current: deps.current, latest: null, percent: null, message: null, checks: 0 };
  let timer: NodeJS.Timeout | null = null;
  let installing = false;
  // Whether the person asked for the last step (a download, a retry), so
  // a failure is shown to them; a check that fails on its own (no feed
  // served, the machine offline) is logged and the badge stays away.
  let asked = false;

  const set = (next: Partial<UpdateState> & { phase: UpdatePhase }) => {
    // A phase that leaves checking is the check's answer, whatever it
    // says (M9 fix 539), counted in the same push as the answer so the CLI
    // sees a check that reads the same as the last one.
    const answered = state.phase === 'checking' && next.phase !== 'checking';
    state = { ...state, ...next };
    if (answered) state.checks = (state.checks ?? 0) + 1;
    deps.push(state);
  };

  if (updater !== null && feed !== null) {
    // Off even though every newer build downloads (M9 fix 625): the
    // download is started from the update-available handler below, so the
    // one state machine knows it is running and a failure has a way back.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    // The installer is the whole download, never a stub that fetches
    // the package; without this the library warns at every download.
    updater.disableWebInstaller = true;
    updater.logger = {
      info: (m) => log(`updater: ${String(m)}`),
      warn: (m) => log(`updater: ${String(m)}`),
      error: (m) => log(`updater: ${String(m)}`),
    };
    updater.setFeedURL(feed);
    updater.on('checking-for-update', () => {
      if (state.phase === 'idle' || state.phase === 'error') set({ phase: 'checking' });
    });
    updater.on('update-available', (info: { version?: string }) => {
      const latest = typeof info.version === 'string' ? info.version : null;
      // electron-updater compares by semver on its own; the feed's number
      // is read once more here so a badge never names the running build.
      if (latest === null || !isNewerVersion(latest, deps.current)) {
        log(`updater: the feed's ${latest ?? '?'} is not newer than ${deps.current}`);
        // A downloaded build is never dropped by a check with nothing newer.
        if (state.phase === 'ready') return;
        set({ phase: 'idle', latest, message: upToDate() });
        return;
      }
      // One download at a time, whatever the version.
      if (state.phase === 'downloading') return;
      if (state.phase === 'ready') {
        // A check from ready (M9 fix 625) replaces the downloaded build only
        // with a newer one; electron-updater replaces the cached installer.
        if (state.latest !== null && !isNewerVersion(latest, state.latest)) return;
        log(`updater: ${latest} replaces the downloaded ${state.latest ?? '?'}`);
      } else {
        log(`updater: ${latest} is available (this is ${deps.current})`);
      }
      // Straight to downloading, never through available, so the badge
      // never names a version that is downloading.
      log(`updater: downloading ${latest} on its own`);
      void download(false, latest);
    });
    updater.on('update-not-available', (info: { version?: string }) => {
      if (state.phase === 'ready') return;
      asked = false;
      set({ phase: 'idle', latest: typeof info.version === 'string' ? info.version : null, message: upToDate() });
    });
    updater.on('download-progress', (p: { percent?: number }) => {
      set({ phase: 'downloading', percent: typeof p.percent === 'number' ? Math.floor(p.percent) : null });
    });
    updater.on('update-downloaded', (info: { version?: string }) => {
      log(`updater: ${info.version ?? state.latest ?? '?'} is downloaded and checked`);
      asked = false;
      set({ phase: 'ready', latest: typeof info.version === 'string' ? info.version : state.latest, percent: 100 });
    });
    updater.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // A check that could not reach the feed at all is the plain case on
      // a box that only ever installed by hand (M9 fix 242): the badge
      // stays away and the menu item's hint says `no feed at <host>`,
      // asked or not, since it is a fact and not a fault. A feed that
      // answered badly (a bad manifest, a sha512 miss) after the person
      // clicked is a failure and shown as one; on its own it is logged
      // and the hint keeps what it had. The no-feed case holds only while
      // nothing is under way (fix 608): a feed lost mid-download is a
      // failure of the download, so the badge does not sit on
      // `downloading` for good.
      const quiet = state.phase === 'checking' || state.phase === 'idle' || state.phase === 'error';
      if (quiet && isNoFeedError(message, feed.provider)) {
        asked = false;
        set({ phase: 'idle', message: `no feed at ${feedHost(feed)}` });
        return;
      }
      // A download that started on its own and failed (M9 fix 625) is
      // logged and the build reads available, so a click tries again.
      if (!asked && state.phase === 'downloading') {
        log(`updater: the download of ${state.latest ?? '?'} failed on its own: ${message}; ${state.latest ?? '?'} stays available`);
        set({ phase: 'available', percent: null, message: null });
        return;
      }
      if (asked) {
        asked = false;
        set({ phase: 'error', message });
      } else if (state.phase === 'checking') {
        set({ phase: 'idle' });
      }
    });
  }

  // The hint for a check that answered and found nothing newer.
  function upToDate(): string {
    return `checked ${clock(now())}, up to date`;
  }

  // The download, started by a check's answer (byClick false, M9 fix 625)
  // or by a click on a build whose download failed (byClick true).
  async function download(byClick: boolean, latest: string | null): Promise<void> {
    if (updater === null) return;
    asked = byClick;
    // M9 fix 296: a differential download can finish before any
    // download-progress event lands, so a frozen 0% would read like a
    // stall; null until a real figure arrives.
    set({ phase: 'downloading', latest, percent: null, message: null });
    try {
      await updater.downloadUpdate();
    } catch (err) {
      // The error event carries the message; a rejection here is the
      // same failure seen twice.
      log(`updater: download failed: ${err instanceof Error ? err.message : String(err)}`);
      // A cancellation rejects with no error event, so a background
      // download still on downloading falls back here.
      if (!byClick && state.phase === 'downloading') set({ phase: 'available', percent: null, message: null });
    }
  }

  const check = () => {
    if (updater === null || installing) return;
    // From ready the check runs (M9 fix 625), so a newer build in the feed
    // replaces the one waiting for the click.
    if (state.phase === 'downloading') return;
    updater.checkForUpdates().catch(() => {
      // Reported through the error event above.
    });
  };

  return {
    state: () => state,
    async act() {
      if (updater === null) return;
      if (state.phase === 'available') {
        await download(true, state.latest);
        return;
      }
      if (state.phase === 'ready') {
        if (installing) return;
        installing = true;
        set({ phase: 'installing' });
        const target = state.latest ?? '?';
        try {
          deps.markInstalling(target);
        } catch (err) {
          log(`updater: could not write the install marker: ${err instanceof Error ? err.message : String(err)}`);
        }
        try {
          deps.postPoster(target);
        } catch (err) {
          log(`updater: could not post the install's word: ${err instanceof Error ? err.message : String(err)}`);
        }
        log('updater: restart to install: stopping the daemon first');
        try {
          await deps.stopDaemon();
        } catch (err) {
          log(`updater: the daemon did not stop cleanly: ${err instanceof Error ? err.message : String(err)}`);
        }
        log('updater: running the installer silently and relaunching');
        updater.quitAndInstall(true, true);
        return;
      }
      if (state.phase === 'error' || state.phase === 'idle') {
        asked = true;
        // The last outcome stays on the record under `checking…` until
        // the answer replaces it.
        set({ phase: 'checking' });
        check();
      }
    },
    start() {
      if (updater === null || feed === null) {
        log('update check off');
        return;
      }
      log(`update check against ${feedName(feed)} in ${Math.round(deps.firstDelayMs / 1000)} s and every ${Math.round(deps.intervalMs / 3600000)} h`);
      timer = setTimeout(() => {
        check();
        timer = setInterval(check, deps.intervalMs);
      }, deps.firstDelayMs);
    },
    dispose() {
      // One handle serves both: clearTimeout and clearInterval are the
      // same call in Node.
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
