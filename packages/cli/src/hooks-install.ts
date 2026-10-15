import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Limits } from '@emerald/shared';

// Merges emerald's command hooks into Claude Code's user settings and takes
// them out again. Our entries are recognised by the hook script path inside
// the command string, so the merge is idempotent and anything else in the
// file (Orca's hooks, permissions) is carried through byte for byte in
// meaning if not in formatting.
//
// The status line is the one slot we take over rather than add to: Claude
// Code runs a single statusLine command, and it is the only place the model
// and the context fill are handed out, so ours goes in and whatever was
// there before is kept in statusline-previous.json beside the wrapper. The
// wrapper runs it after reporting to emmerd, and uninstall puts it back.
//
// The emmer-cli skill rides along: a SKILL.md copied into the skills folder
// beside the settings file (~/.claude/skills/emmer-cli, or CLAUDE_CONFIG_DIR's), so every Claude
// session on the machine knows the CLI without being told. It is shipped
// with the CLI, so an install always lands the version that matches.

// docs/PLAN.md, resolved question 4.
export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'Notification',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'CwdChanged',
] as const;

// Seconds. The script gives up on curl after 2 s itself, so 5 is slack.
export const HOOK_TIMEOUT_SECONDS = 5;

// What emerald's last install or uninstall wrote to each settings file, so
// the app's watcher can tell its own write from another program's, and the
// installs of the last minute, so the banner can say another writer is
// fighting over the file (M9 fix 606). It sits beside the hook script, so
// every emerald on one home shares it, the dev build and the installed one
// included, which is the fight it is for.
export const SETTINGS_WRITTEN = 'settings-written.json';

export interface HooksInstallOptions {
  // ~/.claude/settings.json, or CLAUDE_CONFIG_DIR's
  settingsPath: string;
  // ~/.emerald/hooks/claude-hook.cmd; the unhosted post's script (M9 fix
  // 233, the status line's alone since fix 580), the status line wrapper,
  // its script and the kept previous status line live in the same folder.
  scriptDest: string;
  // The copy shipped in packages/cli/hooks, with the other files beside it.
  scriptSource: string;
  // The Node the hook and status line wrappers run on: the installer's
  // own unless a test says otherwise.
  nodePath?: string;
}

export interface HooksStatus {
  // Events that carry our hook right now.
  installed: string[];
  // Events from HOOK_EVENTS that do not.
  missing: string[];
  scriptPresent: boolean;
  // A script as installed differs from the shipped copy (the hook script,
  // or the status line wrapper and its script).
  scriptStale: boolean;
  // settings.json names our status line wrapper.
  statusLine: boolean;
  // The STATUS_LINE_VERSION the installed claude-statusline.js declares,
  // null when it is missing or has none (an install from before M34), and
  // the one the shipped copy declares.
  statusLineVersion: number | null;
  shippedStatusLineVersion: number;
  // The skill is there and reads the same as the shipped one.
  skill: boolean;
  // Three installs in the last minute and the file rewritten since the
  // last (M9 fix 606): another program, or a second emerald, keeps
  // taking the hooks out.
  fighting: boolean;
  // Hook and status line commands in the settings whose file is gone (M9
  // fix 710), ours by their path's shape or anyone else's.
  dead: DeadEntry[];
}

// A command in Claude's settings that points at a file no longer there
// (M9 fix 710). `event` is the hook event's key, or `statusLine` for that
// slot; `command` the whole command as written; `path` its first token,
// quotes removed; `ours` when the path has the shape of an emerald hook or
// status line wrapper, from an old home or an old install.
export type DeadEntry = { event: string; command: string; path: string; ours: boolean };

export const SKILL_NAME = 'emmer-cli';

interface SkillPaths {
  // ~/.claude/skills/emmer-cli/SKILL.md (or CLAUDE_CONFIG_DIR's), next to the settings file, which
  // is how a test with a private settings file gets a private skill too.
  dest: string;
  // packages/cli/skills/emmer-cli/SKILL.md, beside the hooks folder.
  source: string;
}

export function skillPaths(opts: HooksInstallOptions): SkillPaths {
  return {
    dest: path.join(path.dirname(opts.settingsPath), 'skills', SKILL_NAME, 'SKILL.md'),
    source: path.resolve(path.dirname(opts.scriptSource), '..', 'skills', SKILL_NAME, 'SKILL.md'),
  };
}

export const STATUS_LINE_CMD = 'claude-statusline.cmd';
export const STATUS_LINE_JS = 'claude-statusline.js';
export const STATUS_LINE_PREVIOUS = 'statusline-previous.json';
// Replaced in the shipped wrappers by the path of the Node they run on.
const NODE_PLACEHOLDER = '__EMERALD_NODE__';

interface StatusLinePaths {
  cmdDest: string;
  jsDest: string;
  cmdSource: string;
  jsSource: string;
  previous: string;
}

export function statusLinePaths(opts: HooksInstallOptions): StatusLinePaths {
  const dest = path.dirname(opts.scriptDest);
  const source = path.dirname(opts.scriptSource);
  return {
    cmdDest: path.join(dest, STATUS_LINE_CMD),
    jsDest: path.join(dest, STATUS_LINE_JS),
    cmdSource: path.join(source, STATUS_LINE_CMD),
    jsSource: path.join(source, STATUS_LINE_JS),
    previous: path.join(dest, STATUS_LINE_PREVIOUS),
  };
}

interface HookEntry {
  type?: unknown;
  command?: unknown;
  timeout?: unknown;
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: unknown;
  hooks?: unknown;
  [key: string]: unknown;
}

type Settings = Record<string, unknown>;

// Forward slashes like Orca uses: the command runs through Claude Code's
// shell on Windows and a backslash path would need escaping there.
export function hookCommand(scriptPath: string): string {
  return `"${toForwardSlashes(scriptPath)}"`;
}

export function installHooks(opts: HooksInstallOptions): { changed: boolean; removed: DeadEntry[] } {
  const before = readSettings(opts.settingsPath);
  // Our dead entries from an old home go with our current ones (M9 fix
  // 710); anyone else's dead entries are named by status and left alone.
  const removed = deadEntries(before, opts).filter((d) => d.ours);
  const settings = stripEntries(before, (e) => isOurs(e, opts.scriptDest) || isDeadOurs(e));
  const hooks = asObject(settings['hooks']) ?? {};
  const command = hookCommand(opts.scriptDest);
  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    groups.push({ hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }] });
    hooks[event] = groups;
  }
  settings['hooks'] = hooks;

  const sl = statusLinePaths(opts);
  const current = settings['statusLine'];
  // A status line that is not ours is what the wrapper runs after us and
  // what uninstall restores, so it is kept before it is replaced. Ours is
  // left alone so a second install does not overwrite the kept one. A dead
  // status line of ours from an old home counts as ours (M9 fix 710): kept
  // as the previous one it would fail on every turn.
  if (!isOurStatusLine(current, sl.cmdDest) && !isDeadOurs(current)) {
    writeJson(sl.previous, { statusLine: asObject(current) ?? null });
  } else if (!fs.existsSync(sl.previous)) {
    writeJson(sl.previous, { statusLine: null });
  }
  settings['statusLine'] = { type: 'command', command: hookCommand(sl.cmdDest) };

  const node = opts.nodePath ?? process.execPath;
  fs.mkdirSync(path.dirname(opts.scriptDest), { recursive: true });
  fs.writeFileSync(opts.scriptDest, renderStatusLineCmd(opts.scriptSource, node));
  installScript(sl.jsSource, sl.jsDest);
  fs.writeFileSync(sl.cmdDest, renderStatusLineCmd(sl.cmdSource, node));
  const skill = skillPaths(opts);
  fs.mkdirSync(path.dirname(skill.dest), { recursive: true });
  fs.copyFileSync(skill.source, skill.dest);
  const changed = canonical(settings) !== canonical(before);
  if (changed) recordWrite(opts, writeSettings(opts.settingsPath, settings), true);
  return { changed, removed };
}

export function uninstallHooks(opts: HooksInstallOptions): { changed: boolean; removed: DeadEntry[] } {
  const before = readSettings(opts.settingsPath);
  // Our dead entries from an old home go too, as install takes them (M9
  // fix 733), so removing Emerald leaves none of its own behind; anyone
  // else's stay.
  const removed = deadEntries(before, opts).filter((d) => d.ours);
  const settings = stripEntries(before, (e) => isOurs(e, opts.scriptDest) || isDeadOurs(e));
  const sl = statusLinePaths(opts);
  if (isOurStatusLine(settings['statusLine'], sl.cmdDest) || isDeadOurs(settings['statusLine'])) {
    const previous = readPreviousStatusLine(sl.previous);
    if (previous === null) delete settings['statusLine'];
    else settings['statusLine'] = previous;
  }
  const changed = canonical(settings) !== canonical(before);
  if (changed) recordWrite(opts, writeSettings(opts.settingsPath, settings), false);
  const skill = skillPaths(opts);
  for (const file of [opts.scriptDest, sl.cmdDest, sl.jsDest, sl.previous, skill.dest]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // Already gone.
    }
  }
  // The skill's folder is ours alone, so it goes too; the skills folder
  // above it is shared with other skills and stays.
  try {
    fs.rmdirSync(path.dirname(skill.dest));
  } catch {
    // Not empty, or already gone.
  }
  return { changed, removed };
}

// The shipped skill text, for `emmer skill`: what an install writes, so a
// session can always read the guide that matches the CLI it is running.
export function skillText(opts: HooksInstallOptions): string {
  return fs.readFileSync(skillPaths(opts).source, 'utf8');
}

// A wrapper with the Node path filled in, CRLF like the other script;
// the hook wrapper carries the placeholder too since M9 fix 233.
export function renderStatusLineCmd(source: string, nodePath: string): string {
  return toCrlf(fs.readFileSync(source, 'utf8').replace(NODE_PLACEHOLDER, nodePath));
}

function isOurStatusLine(value: unknown, cmdDest: string): boolean {
  const s = asObject(value);
  if (s === null || typeof s['command'] !== 'string') return false;
  // Both sides forward-slashed (M9 fix 468): an entry spelled with
  // backslashes, by hand or by another tool, is still ours.
  const command = toForwardSlashes(s['command']).toLowerCase();
  return command.includes(toForwardSlashes(cmdDest).toLowerCase());
}

// What was in the statusLine slot before ours; null when nothing, or when
// the kept file is missing or unreadable, which leaves the slot empty.
function readPreviousStatusLine(file: string): Record<string, unknown> | null {
  try {
    const kept = asObject(JSON.parse(fs.readFileSync(file, 'utf8')));
    return kept === null ? null : asObject(kept['statusLine']);
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

// The record of what emerald wrote (M9 fix 606), beside the hook script.
export function writtenPath(opts: HooksInstallOptions): string {
  return path.join(path.dirname(opts.scriptDest), SETTINGS_WRITTEN);
}

// The key a settings file goes by in the record.
export function settingsKey(settingsPath: string): string {
  return path.resolve(settingsPath).toLowerCase();
}

export function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface WrittenEntry {
  sha256: string;
  writes: number[];
}

function readWritten(file: string): Record<string, WrittenEntry> {
  try {
    const parsed = asObject(JSON.parse(fs.readFileSync(file, 'utf8')));
    return (parsed ?? {}) as Record<string, WrittenEntry>;
  } catch {
    return {};
  }
}

// The hash of the file's bytes as written, BOM included, and for an
// install the time, keeping only the writes inside the window; an
// uninstall's write is recorded so the watcher ignores it, but is not
// counted as an install.
function recordWrite(opts: HooksInstallOptions, text: string, install: boolean): void {
  const file = writtenPath(opts);
  const record = readWritten(file);
  const key = settingsKey(opts.settingsPath);
  const now = Date.now();
  const kept = (Array.isArray(record[key]?.writes) ? record[key]!.writes : []).filter((t) => typeof t === 'number' && now - t <= Limits.hookInstallWindowMs);
  if (install) kept.push(now);
  record[key] = { sha256: sha256(Buffer.from(text, 'utf8')), writes: kept };
  writeJson(file, record);
}

// Three installs of ours inside the window and the file's bytes no longer
// the ones we last wrote: somebody else keeps taking the hooks out.
// How many installs of ours the record holds inside the window.
export function recentInstalls(opts: HooksInstallOptions): number {
  const entry = readWritten(writtenPath(opts))[settingsKey(opts.settingsPath)];
  if (entry === undefined || !Array.isArray(entry.writes)) return 0;
  const now = Date.now();
  return entry.writes.filter((t) => typeof t === 'number' && now - t <= Limits.hookInstallWindowMs).length;
}

function isFighting(opts: HooksInstallOptions): boolean {
  const entry = readWritten(writtenPath(opts))[settingsKey(opts.settingsPath)];
  if (entry === undefined || recentInstalls(opts) < Limits.hookInstallsPerWindow) return false;
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(opts.settingsPath);
  } catch {
    bytes = Buffer.alloc(0);
  }
  return sha256(bytes) !== entry.sha256;
}

export function hooksStatus(opts: HooksInstallOptions): HooksStatus {
  const settings = readSettings(opts.settingsPath);
  const hooks = asObject(settings['hooks']) ?? {};
  const installed: string[] = [];
  const missing: string[] = [];
  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    const has = groups.some((g) => {
      const entries = asObject(g)?.['hooks'];
      return Array.isArray(entries) && entries.some((e) => isOurs(e, opts.scriptDest));
    });
    (has ? installed : missing).push(event);
  }
  const sl = statusLinePaths(opts);
  let scriptPresent = false;
  let scriptStale = false;
  try {
    const have = fs.readFileSync(opts.scriptDest, 'utf8');
    scriptPresent = true;
    const node = opts.nodePath ?? process.execPath;
    scriptStale =
      have !== renderStatusLineCmd(opts.scriptSource, node) ||
      fs.readFileSync(sl.jsDest, 'utf8') !== toCrlf(fs.readFileSync(sl.jsSource, 'utf8')) ||
      fs.readFileSync(sl.cmdDest, 'utf8') !== renderStatusLineCmd(sl.cmdSource, node);
  } catch {
    // Not installed, or the status line files are missing: an install
    // before M16 counts as stale, since it has no status line to run.
    scriptStale = scriptPresent;
  }
  const statusLine = isOurStatusLine(settings['statusLine'], sl.cmdDest);
  const sk = skillPaths(opts);
  let skill = false;
  try {
    skill = fs.readFileSync(sk.dest, 'utf8') === fs.readFileSync(sk.source, 'utf8');
  } catch {
    // Not installed.
  }
  return {
    installed,
    missing,
    scriptPresent,
    scriptStale,
    statusLine,
    statusLineVersion: statusLineVersion(sl.jsDest),
    shippedStatusLineVersion: statusLineVersion(sl.jsSource) ?? 0,
    skill,
    fighting: isFighting(opts),
    dead: deadEntries(settings, opts),
  };
}

// The file a command runs, when the command names one by an absolute path
// (M9 fix 710): the text up to the closing quote when it starts with one,
// else up to the first whitespace. A bare word (`node`), a relative path,
// `~/...` or a variable resolves on the PATH or in a shell and is never
// judged, so null.
export function commandFile(command: string, platform: NodeJS.Platform = process.platform): string | null {
  const t = command.trim();
  let token: string;
  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1);
    token = end === -1 ? t.slice(1) : t.slice(1, end);
  } else {
    token = t.split(/\s/, 1)[0] ?? '';
  }
  if (/^[A-Za-z]:[\\/]/.test(token) || /^[\\/]{2}[^\\/]/.test(token)) return token;
  if (platform !== 'win32' && token.startsWith('/')) return token;
  return null;
}

// An emerald hook or status line wrapper by its path's shape, whatever
// home it was installed under. The slash before `hooks` keeps Orca's
// `.../agent-hooks/claude-hook.cmd` out.
function isOursByShape(file: string): boolean {
  const p = toForwardSlashes(file).toLowerCase();
  return p.endsWith('/hooks/claude-hook.cmd') || p.endsWith('/hooks/claude-statusline.cmd');
}

function deadFile(entry: unknown): string | null {
  const e = asObject(entry);
  if (e === null || typeof e['command'] !== 'string') return null;
  const file = commandFile(e['command']);
  return file !== null && !fs.existsSync(file) ? file : null;
}

// A hook entry or status line of ours by shape whose file is gone.
function isDeadOurs(entry: unknown): boolean {
  const file = deadFile(entry);
  return file !== null && isOursByShape(file);
}

// Every hook event in the settings (not only HOOK_EVENTS), every group and
// entry, then the status line, in the file's own order. An entry that is
// ours against the current script, and our current status line, are never
// listed: a missing script there is scriptPresent or scriptStale already.
export function deadEntries(settings: Settings, opts: HooksInstallOptions): DeadEntry[] {
  const out: DeadEntry[] = [];
  const hooks = asObject(settings['hooks']) ?? {};
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const entries = asObject(group)?.['hooks'];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (isOurs(entry, opts.scriptDest)) continue;
        const file = deadFile(entry);
        if (file === null) continue;
        out.push({ event, command: (entry as HookEntry).command as string, path: file, ours: isOursByShape(file) });
      }
    }
  }
  const sl = settings['statusLine'];
  if (!isOurStatusLine(sl, statusLinePaths(opts).cmdDest)) {
    const file = deadFile(sl);
    if (file !== null) out.push({ event: 'statusLine', command: asObject(sl)!['command'] as string, path: file, ours: isOursByShape(file) });
  }
  return out;
}

// The version a status line script declares in its `STATUS_LINE_VERSION`
// line; null when the file is missing or predates the line.
export function statusLineVersion(file: string): number | null {
  try {
    const m = /^const STATUS_LINE_VERSION = (\d+);$/m.exec(fs.readFileSync(file, 'utf8'));
    return m === null ? null : Number(m[1]);
  } catch {
    return null;
  }
}

// Returns a deep copy of the settings with every hook entry `drop` picks
// removed (ours, and for an install our dead ones too), and any group,
// event array or hooks object left empty by that removal dropped, so
// uninstall leaves no trace.
function stripEntries(settings: Settings, drop: (entry: unknown) => boolean): Settings {
  const out = structuredClone(settings);
  const hooks = asObject(out['hooks']);
  if (hooks === null) return out;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept: unknown[] = [];
    for (const group of groups) {
      const g = asObject(group) as HookGroup | null;
      if (g === null || !Array.isArray(g.hooks)) {
        kept.push(group);
        continue;
      }
      const remaining = g.hooks.filter((e) => !drop(e));
      if (remaining.length === g.hooks.length) {
        kept.push(group);
      } else if (remaining.length > 0) {
        kept.push({ ...g, hooks: remaining });
      }
      // A group whose only hooks were ours disappears with them.
    }
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete out['hooks'];
  return out;
}

function isOurs(entry: unknown, scriptPath: string): boolean {
  const e = asObject(entry) as HookEntry | null;
  if (e === null || typeof e.command !== 'string') return false;
  // Case-insensitive because Windows paths are, and a user may have typed
  // the drive letter either way; forward-slashed on both sides, since a
  // backslash-spelled entry of ours read as someone else's and the hooks
  // were doubled (M9 fix 468).
  const command = toForwardSlashes(e.command).toLowerCase();
  return command.includes(toForwardSlashes(scriptPath).toLowerCase());
}

function readSettings(settingsPath: string): Settings {
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  // A leading BOM (an editor's UTF-8 with signature) is not JSON; it is
  // skipped here and put back by writeSettings (M9 fix 468).
  if (raw.startsWith(BOM)) raw = raw.slice(1);
  if (raw.trim() === '') return {};
  // A file we cannot parse is a file we must not rewrite.
  const parsed: unknown = JSON.parse(raw);
  const obj = asObject(parsed);
  if (obj === null) throw new Error(`${settingsPath} is not a JSON object`);
  return obj;
}

const BOM = String.fromCharCode(0xfeff);

// Whether the file on disk starts with a BOM, so the write keeps the
// shape the user's file had. Claude Code reads the file with or without
// one; the BOM is kept because the file is the user's.
function hasBom(settingsPath: string): boolean {
  try {
    const head = Buffer.alloc(3);
    const fd = fs.openSync(settingsPath, 'r');
    try {
      return fs.readSync(fd, head, 0, 3, 0) === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

// Returns the text written, which the record of M9 fix 606 hashes.
function writeSettings(settingsPath: string, settings: Settings): string {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const bom = hasBom(settingsPath) ? BOM : '';
  // One backup of the last version we replaced, for the day a merge goes wrong.
  try {
    fs.copyFileSync(settingsPath, `${settingsPath}.emerald-bak`);
  } catch {
    // No previous file to back up.
  }
  const tmp = `${settingsPath}.emerald-tmp`;
  const text = bom + JSON.stringify(settings, null, 2) + '\n';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, settingsPath);
  return text;
}

function installScript(source: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // cmd.exe is happiest with CRLF, and the repo checkout may have either.
  fs.writeFileSync(dest, toCrlf(fs.readFileSync(source, 'utf8')));
}

function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

// Key order is not meaning: an install that only moves keys (the hooks
// key re-added after statusLine on a file whose only hooks were ours)
// changes nothing and writes nothing (M9 fix 614). Arrays keep their order.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    const o = asObject(v);
    return o === null ? v : Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
