import type { ClientMessage, DesignPick, RequestType, Requests, ServerMessage, ShellOption, Turn, UsageMessage, UseLineIn } from '@emerald/shared';
import type { GitFile, GitStatusResult } from '../renderer/src/git-status-model.ts';
import type { TerminalScheme } from '../renderer/src/scheme-model.ts';
import type { UpdateState } from '../renderer/src/update-model.ts';

// What the renderer sees on window.emerald. The main process owns the pipe and
// assigns request ids, so the renderer never sees raw replies.

// The window's skin (M9 fix 569): Classic or Emerald (the default since
// M9 fix 628).
export type Skin = 'classic' | 'emerald';

// pty.output arrives in the renderer already decoded from base64.
export type RendererPush =
  | Exclude<ServerMessage, { type: 'reply' } | { type: 'pty.output' }>
  | { type: 'pty.output'; sessionId: string; data: Uint8Array; replay?: true }
  | { type: 'daemon.connected'; daemon: DaemonInfo }
  | { type: 'daemon.disconnected' }
  // The window went into or out of full screen (M43): the page cannot
  // tell on its own (neither the overlay's visible flag nor display-mode
  // moves under Electron), so the main process says.
  | { type: 'window.fullscreen'; on: boolean }
  // The updater's state changed (M9 fix 239): the title row's badge
  // follows it.
  | { type: 'update.state'; state: UpdateState };

// What hello said about the daemon. featureLevel is null for a daemon older
// than M9 fix 11, which the renderer treats as level 1.
export interface DaemonInfo {
  pid: number;
  version: string;
  featureLevel: number | null;
  // Set when the daemon serves another home than this window's (M9 fix
  // 495), which the banner says before anything else.
  otherHome: { theirs: string; mine: string } | null;
  // The shells the daemon found at its start (M9 fix 624), the first the
  // default; absent from a daemon older than level 61.
  shells?: ShellOption[];
}

export type FireAndForget = Extract<ClientMessage, { type: 'pty.input' | 'pty.resize' }>;

// ~/.emerald/config.json as the main process read it. Every field is optional
// and the renderer falls back to defaults, so a bad file never blocks the
// window.
export interface UserConfig {
  // The tmux-style prefix, for example "Ctrl+B" or "Ctrl+Space".
  prefixKey?: string;
  // false silences the banner that offers to install the Claude Code hooks.
  promptHooks?: boolean;
}

// Which chime this window may play (M9 fix 47): the real one on the
// default home; under a private EMERALD_HOME, which is what every verify
// script and click-through runs on, the tones go out silent so a test
// run never sounds like the user's own emerald, unless EMERALD_CHIME is set,
// which asks for a different chime that can be told from the real one.
export type ChimeMode = 'real' | 'muted' | 'test';

// `emmer hooks status --json`, trimmed to what the banner needs.
export interface HooksStatus {
  complete: boolean;
  installed: string[];
  missing: string[];
  scriptPresent: boolean;
  scriptStale: boolean;
  // settings.json runs emerald's status line wrapper, which reports the model
  // and the context fill.
  statusLine: boolean;
  // The emmer-cli skill sits beside the settings file, as shipped.
  skill: boolean;
  // The settings file that was read, for the banner's tooltip.
  settings: string;
  // Three installs in the last minute and the file rewritten since (M9
  // fix 606): another program, or a second emerald, keeps taking the
  // hooks out.
  fighting: boolean;
  // Entries of emerald's own, by their path's shape, in Claude's settings that point at files no longer there (M9 fix 710); Fix takes them out.
  deadOurs: number;
}

export interface HooksInstallResult {
  changed: boolean;
  settings: string;
}

// What `emmer hooks status --test` found (M9 fix 606).
export type HookTestOutcome = 'passed' | 'no-script' | 'no-daemon' | 'old-daemon' | 'not-heard';

export interface HooksTestResult {
  result: HookTestOutcome;
}

// One entry of a folder listing, or one hit of a names search, where
// `name` is the path relative to the searched root.
export interface FileEntry {
  name: string;
  kind: 'dir' | 'file';
}

// One skill the chat box's `/` menu offers (M9 fix 719): the session
// folder's `.claude/skills` or the user's own, by its frontmatter.
export interface SkillEntry {
  name: string;
  description: string;
  scope: 'project' | 'user';
}

// A folder read for the files rail: folders first, then names in case
// insensitive order, capped with `truncated` saying how many were cut; or
// the reason it could not be read, which the rail shows in place of the
// children.
export type FileListing = { entries: FileEntry[]; truncated: number } | { error: string };

export type SearchMode = 'names' | 'contents';

// A names hit is an entry; a contents hit is a file with the line that
// matched, one hit per matching line, where the match sits in the shown
// text (at, len) and in the file's line (col, 1-based) so the rail can
// mark it and the editor land on it.
export interface SearchHit extends FileEntry {
  line?: number;
  text?: string;
  at?: number;
  len?: number;
  col?: number;
}

export interface FileSearch {
  hits: SearchHit[];
  // The walk stopped at a cap, so a missing hit may just be deep.
  truncated: boolean;
}

// The line end a text file uses and whether it opens with a BOM, read
// with its text so a save (M9 fix 248) writes the file back the way it was.
export interface TextFormat {
  eol: '\r\n' | '\n';
  bom: boolean;
}

// The size and mtime of a file as a read or a save found it (M9 fix
// 525). A save carries the stamp of the disk the editor last agreed with
// and is refused when the file has moved since.
export interface FileStamp {
  mtimeMs: number;
  size: number;
}

// What a save did: wrote the file, with its new stamp, or left it alone
// because it changed on disk since the stamp it carried (M9 fix 525).
export type FileSaved = { saved: FileStamp } | { changed: true };

// A file read for a tab: its text with its format and its stamp, or that
// it is binary (with its size, for the message), or why it could not be
// read.
export type FileRead = ({ text: string; stamp: FileStamp } & TextFormat) | { binary: true; size: number } | { error: string };

// What is at a path: a folder or a file, or why it could not be looked at.
// Asked for a drop from Explorer, which hands over a path and nothing else.
export type FileStat = { kind: 'dir' | 'file' } | { error: string };

// A new file or folder from the rail (M9 fix 309): made, or not because
// the name is taken (the rail keeps the name box open) or the write was
// refused (a parent gone, access denied, a relative path).
export type FileMade = { ok: true } | { ok: false; reason: 'exists' | 'refused' };

// The rail's rename (M9 fix 574): done, or the name is taken, or refused,
// `busy` when Windows said the entry is in use (EBUSY or EPERM).
export type FileRenamed = { ok: true } | { ok: false; reason: 'exists' } | { ok: false; reason: 'refused'; busy: boolean };

// The rail's Delete (M9 fix 617): moved to the recycle bin, or already
// gone, or refused (a relative path, a drive root, a trash that failed).
export type FileTrashed = { ok: true } | { ok: false; reason: 'gone' | 'refused' };

// The file service behind the files rail. Paths are absolute; the main
// process refuses relative ones.
export interface FilesApi {
  // `keep` names one entry of `dir` the listing holds past the cap (M9
  // fix 436, the rail's lift).
  list(dir: string, keep?: string): Promise<FileListing>;
  // The whole file, capped at 8 MB.
  read(path: string): Promise<FileRead>;
  // The editor's text back onto the file (M9 fix 248), with the format
  // the read noted; rejects with why when it cannot. Answers `changed`
  // without writing when the file moved since `stamp` (M9 fix 525).
  write(path: string, text: string, format: TextFormat, stamp: FileStamp): Promise<FileSaved>;
  // An empty folder or an empty file at the path (M9 fix 309), never
  // over one that is there.
  mkdir(path: string): Promise<FileMade>;
  create(path: string): Promise<FileMade>;
  // An entry renamed within its folder (M9 fix 574), never over one that
  // is there.
  rename(from: string, to: string): Promise<FileRenamed>;
  // An entry moved to the recycle bin (M9 fix 617), never deleted outright.
  trash(path: string): Promise<FileTrashed>;
  // Case insensitive substring over the names under root, or over the
  // lines of the text files under it, skipping .git and node_modules.
  search(root: string, needle: string, mode: SearchMode): Promise<FileSearch>;
  // Stops this window's running search, if any (M9 fix 519).
  stopSearch(): Promise<void>;
  // The whole set of folders the rail has open; the main process watches
  // these and no others.
  watch(dirs: string[]): Promise<void>;
  // Fires with a folder that changed on disk, debounced; `renamed` false
  // when only contents changed (M9 fix 551); absent from the git pushes.
  onChanged(handler: (dir: string, info?: { renamed: boolean }) => void): () => void;
  // The program Windows has for the file; rejects with the shell's reason.
  open(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  // A folder opened in Explorer (M9 fix 653), held as reveal is.
  openFolder(path: string): Promise<void>;
  // The absolute path of a File the OS dropped on the window. Synchronous
  // and preload-only: the sandboxed renderer sees a File with no path on it.
  pathFor(file: File): string;
  stat(path: string): Promise<FileStat>;
  // A URL in the browser: a link from a rendered markdown file, or one
  // Ctrl+clicked in a terminal (M9 fix 204). http and https only; anything
  // else rejects. Held to the main log under a private EMERALD_HOME.
  openExternal(url: string): Promise<void>;
  // The git status of every changed path in the repo the folder is in,
  // folders rolled up, for the rail's colours. Never rejects: no repo, no
  // git or a slow status is an empty map.
  gitStatus(dir: string): Promise<GitStatusResult>;
  // The Changes tab (M45): the changed files with their line counts,
  // ignored ones left out, sorted by path. Never rejects.
  gitChanges(dir: string): Promise<GitChanges>;
  // The Commits tab (M45): the repo's recent commits, newest first.
  // Never rejects; root is null outside a repo.
  gitLog(dir: string): Promise<GitLog>;
  // The commit graph (M51): every local branch's commits with their
  // parents and refs, the default branch and what is merged into it.
  // Never rejects; root is null outside a repo.
  gitGraph(dir: string, options?: GitGraphOptions): Promise<GitGraph>;
  // The folders the window shows commits for: the rail's and every
  // commits view's (M52); the main process watches the logs of the
  // repository above each (M49) and pushes the root through onChanged
  // when a ref moves, so a commit shows without the poll. Empty for none.
  gitWatch(dirs: string[]): Promise<void>;
  // Initialise a repository in a folder (M9 fix 255): git init, the
  // root it made (or the one already above the folder) and no error, or
  // no root and one line saying why. Never rejects.
  gitInit(dir: string): Promise<GitInit>;
  // The project's favicon for a sidebar folder heading (M9 fix 65): a
  // file: URL, or null when the folder and its repository root have none.
  // Cached in the main process for the app's run; a change the watcher
  // sees at the folder or above it forgets the answer.
  folderIcon(dir: string): Promise<string | null>;
  // The review tab (M64): the files changed since a base, the base being
  // 'HEAD', 'default' (the merge base with main or master) or a hash a
  // tab already holds. Never rejects; root is null outside a repo.
  gitReview(dir: string, base: string): Promise<GitReview>;
  // One file as it was at a base commit, for the diff's left side.
  gitShow(dir: string, hash: string, rel: string): Promise<GitShow>;
  // Revert a file's changes (M9 fix 310): the index and the work tree
  // back to HEAD's version of the repository-relative path. False when
  // git refused, or the path is not a file inside the repository.
  gitRevert(dir: string, rel: string): Promise<boolean>;
  // A file to open from outside the renderer (M9 fix 341): `emmer open`
  // relayed over the daemon, or a launch with a file (fix 342); pinned
  // tab, or with pane a pane beside the focused one. Installing the
  // handler tells the main process the renderer is listening, so a path
  // held from before the load is sent then.
  onOpen(handler: (path: string, pane: boolean, extra: OpenExtra) => void): () => void;
}

// What rides a file open from emmer open beside the path and the pane
// flag (M9 fix 375): the scheme to set first (null clears the pick) and
// the id the renderer answers the daemon with, both absent on a launch
// with a file or a plain open.
export interface OpenExtra {
  // M9 fix 700: the file came from a launch, not emmer open.
  launch?: boolean;
  scheme?: string | null;
  openId?: number;
  // The session whose pane the file goes beside (M9 fix 376).
  beside?: string;
  // M9 fix 659: the path is a URL for a browser pane.
  url?: boolean;
}

// One file of a review (M64): its path relative to the repo root and
// absolute, the status letter of `git diff --name-status` (A for an
// untracked file too), and the line counts, null for a binary.
export interface ReviewFile {
  rel: string;
  path: string;
  letter: string;
  added: number | null;
  removed: number | null;
}

export interface GitReview {
  root: string | null;
  // The branch checked out at the root, as gitLog reports it.
  head: string | null;
  // main when that branch exists, else master, else null.
  defaultBranch: string | null;
  // The commit the files are compared against; null for a repo with no
  // commit yet.
  baseHash: string | null;
  files: ReviewFile[];
}

export type GitShow = { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'missing' };

// One changed file for the Changes list: the status's file with its path
// relative to the repo root (forward slashes, as the search hits show
// theirs) and the counts of `git diff --numstat HEAD`, null when the diff
// has none for it (an untracked or a binary file, or no commit yet).
export interface ChangedFile extends GitFile {
  rel: string;
  added: number | null;
  removed: number | null;
}

export interface GitChanges {
  root: string | null;
  files: ChangedFile[];
}

// One commit of the Commits tab: the full hash, the subject line, the
// author's name and the author time in ms since the epoch.
export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  at: number;
  // The claude.ai session named by the commit's Claude-Session trailer
  // (M58), as the session_<id> token, or null for a commit without one.
  // Optional so a commit built by hand needs no trailer.
  claudeSession?: string | null;
}

export interface GitLog {
  root: string | null;
  // The branch checked out at the root (a short sha when detached), so a
  // commits view with no session behind it (M52) can name the branch.
  head: string | null;
  commits: GitCommit[];
}

// One commit of the graph (M51): the list's fields plus the parents and
// the local branches pointing at it (their short names). remoteRefs (M9
// fix 286): the remote branches pointing at it (`origin/x`), only when
// the graph was asked with remotes and the commit carries no local
// branch of the same name, which folds `origin/x` into `x`'s pill.
// On the graph `at` is the committer time (M9 fix 303), what the log's
// date order sorts by and what the row's age reads, and authoredAt the
// author's, which a cherry-pick or a rebase keeps from the original;
// the two agree on a commit made in place.
// twins (M9 fix 304): the other commits on the graph with the same
// patch id, the original and its cherry-picks; absent when none.
export interface GraphCommit extends GitCommit {
  parents: string[];
  refs: string[];
  remoteRefs?: string[];
  authoredAt: number;
  twins?: string[];
}

// The repository's commits across every local branch (M51), newest first
// in date order so a child is always above its parents. head is the
// checked out branch (null when detached) and headHash its commit;
// defaultBranch is main, else master, else the head; merged lists the
// other local branches whose tips the default branch already holds.
export interface GitGraph {
  root: string | null;
  head: string | null;
  headHash: string | null;
  defaultBranch: string | null;
  merged: string[];
  commits: GraphCommit[];
  // Every checkout of the repository, the main one first (M68): a
  // session whose folder is under one of them is in this repository.
  worktrees: string[];
  // The repository's own author (M9 fix 286), `git config user.name`
  // read in the root so a local config wins, null when none is set: a
  // commit by anyone else is a person's, drawn in a block of their own.
  author: string | null;
  // When the remote refs were last fetched (M9 fix 286), the mtime of
  // FETCH_HEAD in ms since the epoch, null when never; emerald never
  // fetches, so the remote branches are as stale as this.
  fetchedAt: number | null;
}

// What the graph read is asked with (M9 fix 286): remotes adds the
// remote branches to the log, off by default since they double every
// lane a local branch tracks.
export interface GitGraphOptions {
  remotes?: boolean;
}

// What git init answered (M9 fix 255).
export interface GitInit {
  root: string | null;
  error: string | null;
}

// One usage window from the account's Claude usage, as the main process
// parsed it: the five hour and seven day windows every account has, and a
// window per model. percent is 0 to 100; resetsAt is ms since the epoch.
export interface UsageWindow {
  key: string;
  label: string;
  kind: 'time' | 'model';
  percent: number;
  resetsAt: number;
}

// The windows, or why there are none: no credentials file or no token in
// it, a 401 or 403 from the endpoint, or anything else, offline included.
// M9 fix 99: the anything else says which, since "unavailable" alone left
// a person unable to tell a dropped connection from the endpoint's own
// rate limit from a bug. A 429 carries its retry-after in ms when the
// endpoint sent one.
export type UsageReason = { kind: 'rate-limited'; retryAfterMs: number | null } | { kind: 'offline' } | { kind: 'server'; status: number } | { kind: 'bad-reply' };
export type UsageResult = { windows: UsageWindow[] } | { error: 'signed-out' | 'unauthorized' } | { error: 'unavailable'; reason: UsageReason };

// What made the strip ask (M9 fix 348): its mount, its five-minute
// timer, the window's focus, or the refresh button.
export type UsageAsk = 'mount' | 'timer' | 'focus' | 'button';

export interface UsageApi {
  // One fetch of the account's usage. Never rejects; an error is a result.
  // M9 fix 348: `ask` says what made the strip ask, for the main log's
  // read line.
  get(ask: UsageAsk): Promise<UsageResult>;
}

// The terminal's colour schemes (M9 fix 225): the shipped ones first,
// then the person's Windows Terminal ones, read afresh on every call.
export interface SchemesApi {
  list(): Promise<TerminalScheme[]>;
}

// A system notification for a session that wants someone (M14). The main
// process decides whether it goes out: not while the window is focused,
// and at most one per session every few seconds.
export interface NotifyRequest {
  sessionId: string;
  title: string;
  body: string;
}

// The renderer's attention set, sent on every change (M9 fix 104) so the
// main process can flash the taskbar button and badge it with the count:
// `flash` when the renderer chimed for the arrival, so a beep and a flash
// always come together.
export interface AttentionRequest {
  wanting: number;
  flash: boolean;
}

export interface NotifyApi {
  post(req: NotifyRequest): void;
  attention(req: AttentionRequest): void;
  // A click on a notification: the main process has focused the window and
  // the renderer shows the session.
  onClicked(handler: (sessionId: string) => void): () => void;
}

// One Claude Code conversation found on disk, for the History panel in
// the files rail. Times are ms since the epoch; `project` is the root of
// the repository cwd is in, or cwd again outside one; `cwdExists` says
// whether Resume has a folder to start in.
export interface HistorySession {
  id: string;
  title: string;
  cwd: string;
  project: string;
  cwdExists: boolean;
  branch: string | null;
  model: string | null;
  prompts: number;
  startedAt: number | null;
  lastAt: number | null;
  // The last message: a prompt ("You:") or a reply ("Agent:"), first line.
  preview: { who: 'you' | 'agent'; text: string } | null;
  // The transcript file, for Reveal.
  path: string;
  // The claude.ai session ids the transcript names (M70), the first near
  // its head and one more at every resume that was handed a new id; a
  // commit's Claude-Session trailer carries the same token.
  remoteIds: string[];
}

// A conversation the Commits graph can name (M70): the transcript's
// facts a history lane and its card need, for every transcript that
// names a claude.ai session id, not capped like the rows.
export interface HistoryTranscript {
  id: string;
  title: string;
  cwd: string;
  cwdExists: boolean;
  path: string;
  startedAt: number | null;
  lastAt: number | null;
  remoteIds: string[];
}

// The sessions newest first, capped at the recent count; `total` is how
// many there were before the cap; `transcripts` every conversation with
// a remote id, uncapped.
export interface HistoryScan {
  sessions: HistorySession[];
  total: number;
  transcripts: HistoryTranscript[];
}

// A conversation read whole for the transcript view (M53): the row's
// facts off the head and the tail, and every turn in order (the shape is
// shared's Turn). An error for a file that is gone or over READ_CAP.
export interface TranscriptTurns {
  title: string | null;
  cwd: string | null;
  branch: string | null;
  model: string | null;
  startedAt: number | null;
  lastAt: number | null;
  turns: Turn[];
}

// A conversation's requests for the commit card (M9 fix 252): every
// request off its transcript and its subagents' files, oldest first,
// with a stamp of the files' sizes and times; an ask that names the
// stamp it has gets `same` back as a null list, so the renderer keeps
// its copy. Null when no transcript on this machine names the id.
export interface ConversationUsage {
  stamp: string;
  messages: UsageMessage[] | null;
}

// A past conversation's price for its Sessions tab row (M9 fix 256):
// our estimate from the rates table over the whole transcript and its
// subagents' files (M9 fix 273), with the counts the row's tokens
// reading takes and the agents' share apart: how many agents carried a
// request, what theirs came to, and how many agent files were over the
// cap and left out. Null when the transcript is gone, over the cap, or
// holds no request.
export interface TranscriptCost {
  usd: number | null;
  tokens: { up: number; down: number; cached: number };
  agents: { count: number; usd: number | null; skipped: number };
}

// The forked agents' spend the row's figure has not counted yet (M9 fix
// 277): Claude Code posts its cost.total_cost_usd on the status line
// when the main thread moves, and in a batch the main thread sits in
// the Agent tool for an hour while the forks run, so the figure froze.
// This is the sum over the conversation's agent files of the requests
// after the transcript's last own message (since), priced from the
// rates table, with the counts and how many agents made them; the next
// own request moves since past them and the status line that follows
// covers the same requests. Null when no transcript names the id.
// models (M9 fix 288) is agent id to the model of that agent's last
// request over its whole file, for the fold, the shade and the graph to
// read one word from; an agent whose file has no request yet is absent.
// spend (M9 fix 372) is agent id to what the agent's requests have cost
// over its whole file at the rates table, for the lid's box per member;
// an agent whose requests name no model in the table is absent.
export interface AgentsRunning {
  since: number;
  usd: number | null;
  tokens: { up: number; down: number; cached: number };
  requests: number;
  agents: number;
  models: Record<string, string>;
  spend: Record<string, number>;
}

export interface HistoryApi {
  // Reads ~/.claude (or EMERALD_CLAUDE_HOME) once. Never rejects for a home
  // that is missing; that is an empty scan.
  scan(): Promise<HistoryScan>;
  // The whole transcript at the path, as its turns.
  turns(path: string): Promise<TranscriptTurns | { error: string }>;
  // See ConversationUsage (M9 fix 252) and TranscriptCost (M9 fix 256).
  usage(conversation: string, known: string | null): Promise<ConversationUsage | null>;
  cost(path: string): Promise<TranscriptCost | null>;
  // See AgentsRunning (M9 fix 277).
  agentsRunning(conversation: string): Promise<AgentsRunning | null>;
  // The root of the repository the folder is in, or null outside one.
  project(dir: string): Promise<string | null>;
  // Whether the main process watches history.jsonl and pushes changes.
  watch(on: boolean): Promise<void>;
  onChanged(handler: () => void): () => void;
}

// The release notes for the What's New tab (M9 fix 227): docs/WHATS-NEW.md
// in a dev build, resources/WHATS-NEW.md installed, read by the main
// process since the sandboxed renderer has no file access.
export interface WhatsNewRead {
  // The file's text, empty when it cannot be read (the tab then says so).
  text: string;
  // Whether the tab may open on its own at a start whose newest heading
  // the profile has not seen: false under EMERALD_WHATS_NEW=off, which
  // cdp.mjs sets for every verify script so no harness meets a surprise
  // tab; the one step that tests the opening sets it to on.
  autoOpen: boolean;
}

export interface WhatsNewApi {
  read(): Promise<WhatsNewRead>;
}

// The update check (M9 fix 239). The main process checks the feed on
// launch and every four hours and pushes update.state; the badge asks
// once at mount since it may load after the first push, and its click
// is act: a download when a build is available, the restart into it
// once downloaded, a fresh check after a failure.
export interface UpdateApi {
  state(): Promise<UpdateState>;
  act(): Promise<void>;
}

// The system clipboard through the main process (M9 fix 92: Ctrl+V in a
// pane). Electron's clipboard reads without a permission prompt, which
// navigator.clipboard in the renderer does not; image says whether an
// image sits there, for the keystroke Claude Code reads one on.
export interface ClipboardApi {
  read(): Promise<{ text: string | null; image: boolean }>;
  write(text: string): Promise<void>;
  // A data: URL onto the clipboard as an image; the verify scripts' way
  // to put one there.
  writeImage(dataUrl: string): Promise<void>;
  // The clipboard's image for the chat box (M9 fix 721): a 48 px high
  // thumbnail, and the path of the PNG written for Claude Code to read,
  // null when the key route is asked for and the clipboard is the real
  // one; null in all when there is no image.
  image(keyRoute: boolean): Promise<{ thumb: string; path: string | null } | null>;
}

// Design Mode's grab on a browser pane's page (M9 fix 674): the pick and
// its crop's path (null when the capture failed), or a cancel.
export type DesignResult = { kind: 'pick'; pick: DesignPick; shot: string | null } | { kind: 'cancel' };

// The grab runs in main on the pane's guest, found by the pane id as
// emmer browser finds it; a note is a line for the corner (C and S,
// which main answers itself).
export interface DesignApi {
  start(paneId: string): Promise<DesignResult>;
  cancel(paneId: string): void;
  onNote(handler: (text: string) => void): () => void;
}

// A chord as the main process's guest key rule reads it (M9 fix 670),
// the renderer's Chord in keys-model.ts.
export interface GuestChord {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

// A key main heard in a browser pane's page and handed to the window,
// the slice of KeyboardEvent the key map reads.
export interface GuestKey {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

// The app's chords while a page has the keyboard (M9 fix 670): the
// renderer tells main its chords, its prefix and whether the prefix (or
// the cheat sheet) is up; main sends back the keys of a page that are
// the app's, and a press or a key in any page, for presence and for the
// click that focuses the page's pane.
export interface KeysApi {
  configure(chords: GuestChord[], prefix: GuestChord): void;
  armed(on: boolean): void;
  onGuestKey(handler: (key: GuestKey) => void): () => void;
  onGuestInput(handler: (hit: { webContentsId: number; kind: 'mouse' | 'key' }) => void): () => void;
}

// The usage record (M9 fix 676): send-only; main checks every line
// against the shared vocabulary before it writes.
export interface UseRecordApi {
  write(line: UseLineIn): void;
}

// emmer browser's mark on a pane (M9 fixes 672 and 673): who drives it,
// whether a command runs now, and whether the person's click or key
// paused it; null is no mark.
export type BrowserDriveState = { by: string; running: boolean; paused: boolean } | null;

// The browser driver's half in the renderer: the guest a pane's page is
// on, told to main on each attach, the mark's pushes, and the pane's
// Resume button (fix 673).
export interface BrowserApi {
  guest(paneId: string, webContentsId: number): void;
  onDrive(handler: (paneId: string, state: BrowserDriveState) => void): () => void;
  resume(paneId: string): void;
  // A key or a fill needs the page to hold the window's keyboard: main
  // asks, the pane's page takes the focus, and the answer says whether
  // it holds it (the guard hands it back when the command ends).
  onTakeFocus(handler: (paneId: string, token: number) => void): () => void;
  tookFocus(token: number, ok: boolean): void;
}

export interface EmeraldApi {
  files: FilesApi;
  browser: BrowserApi;
  keys: KeysApi;
  usage: UsageApi;
  schemes: SchemesApi;
  notify: NotifyApi;
  useRecord: UseRecordApi;
  history: HistoryApi;
  clipboard: ClipboardApi;
  design: DesignApi;
  whatsNew: WhatsNewApi;
  update: UpdateApi;
  // Facts only the main process knows. The sandboxed preload has no os
  // module and no file access.
  // usageFloorMs: the least time between two usage requests (M9 fix
  // 100), 30 s unless EMERALD_USAGE_FLOOR_MS says otherwise for a verify run.
  // version: the app's own package version (M9 fix 234), 0.1.<first fix
  // id of the batch it was built at>.
  info(): Promise<{ homeDir: string; config: UserConfig; chime: ChimeMode; usageFloorMs: number; version: string }>;
  // Tells main the skin on start and on every flip (M9 fix 569), so it
  // recolours the title bar overlay, the window ground and the taskbar
  // badge, and opens the next window in it.
  setSkin(skin: Skin): void;
  // The skin main holds (M9 fix 628), which the renderer takes when
  // localStorage holds none, so the page and the first frame agree.
  mainSkin(): Skin;
  // Native folder chooser. Resolves null when the user cancels.
  pickFolder(defaultPath: string | null): Promise<string | null>;
  // Native file chooser (M9 fix 341), the same way; EMERALD_PICK_FILE
  // answers it for a harness.
  pickFile(defaultPath: string | null, images?: boolean): Promise<string | null>;
  // The skills Claude Code would take in a session started in `folder`
  // (M9 fix 719): the folder's own first, then the user's.
  skills(folder: string | null): Promise<SkillEntry[]>;
  // Both run the shipped CLI; either rejects when it cannot be run.
  hooksStatus(): Promise<HooksStatus>;
  hooksInstall(): Promise<HooksInstallResult>;
  // One Test event through the installed hook to the daemon (M9 fix 606).
  hooksTest(): Promise<HooksTestResult>;
  // The main process pushes a status whenever Claude Code's settings file
  // changes and the change was not emerald's own write to a complete
  // install (M9 fix 606). Returns the unsubscribe.
  onHooksChanged(handler: (status: HooksStatus) => void): () => void;
  // Asks the daemon to stop (`daemon.stop`, M9 fix 159), which keeps every
  // session's screen, so the main process starts the shipped one and the
  // sessions come back through Resume; a daemon still alive after the
  // grace has its tree killed. Rejects when not connected.
  restartDaemon(): Promise<void>;
  // What hello said about the daemon on the current connection, null while
  // disconnected. The connected push carries the same, but a renderer that
  // loads after the connection is up never saw it.
  daemonInfo(): Promise<DaemonInfo | null>;
  request<K extends RequestType>(type: K, body: Requests[K]['req']): Promise<Requests[K]['res']>;
  send(msg: FireAndForget): void;
  on(handler: (msg: RendererPush) => void): () => void;
}
