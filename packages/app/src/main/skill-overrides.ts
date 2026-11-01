import fs from 'node:fs';
import path from 'node:path';
import { claudeConfigDir } from '@emerald/shared/claude-home';
import { detectEol, requireAbsolute } from './file-write.ts';
import type { SkillListing, SkillOverrideEdit, SkillOverridesRead, SkillOverridesUndoResult, SkillOverridesWriteResult, SkillScope, SkillScopeRead } from '../preload/api.ts';

// Claude Code's `skillOverrides` setting (M9 fix 1041, the Context tab's
// listing switch): what Claude sees of each skill, read over the four
// scopes Claude Code merges (managed, local, project, user; the
// `--settings` flag scope is a session's own and not a file emerald can
// see), and written to the two a person owns, this folder's
// `.claude/settings.local.json` (where `/skills` writes) and the user's
// `settings.json`. Managed settings come from the files alone: a value set
// only by an MDM profile, the HKLM or HKCU registry or server-managed
// settings is not shown. No electron import, so node:test covers it; every
// export but overridePlaces takes the folders as an argument, so a test
// passes temp folders and nothing here reads ~/.claude on its own.

const VALUES: ReadonlySet<string> = new Set(['on', 'name-only', 'user-invocable-only', 'off']);
// The `MAX_ENTRIES` of skills.ts: no menu pick or group button sends more.
const MAX_EDITS = 200;
const MAX_NAME = 200;
const BOM = '\uFEFF';

export function managedSettingsDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  return '/etc/claude-code';
}

export interface OverridePlaces {
  configDir: string;
  managedDir: string;
}

// Read on every call: a harness sets CLAUDE_CONFIG_DIR to its private
// config, and that folder, never the person's, is its user scope.
export function overridePlaces(): OverridePlaces {
  return { configDir: claudeConfigDir(), managedDir: managedSettingsDir() };
}

function scopeFile(scope: SkillScope, folder: string, places: OverridePlaces): string {
  if (scope === 'local') return path.join(folder, '.claude', 'settings.local.json');
  if (scope === 'project') return path.join(folder, '.claude', 'settings.json');
  if (scope === 'user') return path.join(places.configDir, 'settings.json');
  return path.join(places.managedDir, 'managed-settings.json');
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// The file's text, or null when it is not there. Any other failure (a
// folder in the file's place, no permission) throws to the caller, which
// says so; it is never read as an empty file.
function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

type Parsed = { ok: true; obj: Record<string, unknown> } | { ok: false; error: string };

// The settings object of a file's text, with the BOM an editor may put on
// the front skipped and a blank file read as `{}`. The error has no path;
// the caller puts it in front.
function parseSettings(raw: string): Parsed {
  const body = raw.startsWith(BOM) ? raw.slice(1) : raw;
  if (body.trim() === '') return { ok: true, obj: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: 'does not parse as JSON' };
  }
  if (!isObject(parsed)) return { ok: false, error: 'is not a JSON object' };
  const overrides = parsed['skillOverrides'];
  if (overrides !== undefined && !isObject(overrides)) return { ok: false, error: 'has a skillOverrides that is not an object' };
  return { ok: true, obj: parsed };
}

// The entries of one file that hold one of the four values, put over
// `into`. `__proto__` is skipped, as Claude Code's own lookup does.
function takeValues(obj: Record<string, unknown>, into: Record<string, SkillListing>): void {
  const overrides = obj['skillOverrides'];
  if (!isObject(overrides)) return;
  for (const [name, value] of Object.entries(overrides)) {
    if (name === '__proto__') continue;
    if (typeof value === 'string' && VALUES.has(value)) into[name] = value as SkillListing;
  }
}

// One file read into `into`; the error, path first, when it could not be.
function readInto(file: string, into: Record<string, SkillListing>): string | undefined {
  let raw: string | null;
  try {
    raw = readText(file);
  } catch (err) {
    return `could not read ${file}: ${(err as Error).message}`;
  }
  if (raw === null) return undefined;
  const parsed = parseSettings(raw);
  if (!parsed.ok) return `${file} ${parsed.error}`;
  takeValues(parsed.obj, into);
  return undefined;
}

// The drop-ins beside the managed file, in name order (a later file's key
// wins); hidden files and names not ending .json are not Claude Code's.
function managedDropIns(managedDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(path.join(managedDir, 'managed-settings.d'));
  } catch {
    return [];
  }
  return names
    .filter((n) => !n.startsWith('.') && n.endsWith('.json'))
    .sort()
    .map((n) => path.join(managedDir, 'managed-settings.d', n));
}

function readScope(scope: SkillScope, folder: string, places: OverridePlaces): SkillScopeRead {
  const file = scopeFile(scope, folder, places);
  // Built without a prototype, so no name in a file can reach one, then
  // spread into a plain object for the IPC's structured clone.
  const values = Object.create(null) as Record<string, SkillListing>;
  const files = scope === 'managed' ? [file, ...managedDropIns(places.managedDir)] : [file];
  let error: string | undefined;
  for (const f of files) {
    // A managed drop-in that does not parse is skipped and named, and the
    // files that do parse still count; a person's own file that does not
    // parse is an empty scope.
    const e = readInto(f, values);
    if (e !== undefined && error === undefined) error = e;
  }
  const out: SkillScopeRead = { scope, path: file, values: { ...values } };
  if (error !== undefined) {
    if (scope !== 'managed') out.values = {};
    out.error = error;
  }
  return out;
}

export async function readSkillOverrides(folder: string, places: OverridePlaces): Promise<SkillOverridesRead> {
  const scopes: SkillScope[] = ['managed', 'local', 'project', 'user'];
  return { folder, scopes: scopes.map((s) => readScope(s, folder, places)) };
}

// The one rewrite of a settings file's text. The file is the person's, so
// everything else in it stays where it was: the object is edited in place
// (an existing skill keeps its place, a new one goes at the end of
// skillOverrides, skillOverrides itself at the end of the object when it
// was not there), and the indent, the line ends, the final newline and the
// BOM are the file's own. What a parse and a stringify cannot keep is
// lost: a number written `1.0` comes back `1`, and a key's spacing around
// the colon is JSON.stringify's. A JSON-with-comments file does not parse
// and so is refused rather than rewritten without its comments.
export function editSettingsText(raw: string | null, edits: readonly SkillOverrideEdit[]): { ok: true; text: string } | { ok: false; error: string } {
  let obj: Record<string, unknown>;
  let indent = '  ';
  let eol: '\n' | '\r\n' = '\n';
  let bom = '';
  let finalNewline = true;
  if (raw === null) {
    obj = {};
  } else {
    if (raw.startsWith(BOM)) bom = BOM;
    const body = bom ? raw.slice(1) : raw;
    const parsed = parseSettings(raw);
    if (!parsed.ok) return parsed;
    obj = parsed.obj;
    const lead = /^([ \t]+)"/m.exec(body);
    if (lead?.[1] !== undefined) indent = lead[1];
    eol = detectEol(body);
    // A blank file is written as a new one would be; any other keeps
    // whether it ended in a line break.
    if (body.trim() !== '') finalNewline = /\n$/.test(body);
  }
  let overrides = obj['skillOverrides'] as Record<string, unknown> | undefined;
  for (const { name, value } of edits) {
    if (name === '__proto__') continue;
    if (value === null) {
      if (overrides !== undefined) delete overrides[name];
      continue;
    }
    if (overrides === undefined) {
      overrides = {};
      obj['skillOverrides'] = overrides;
    }
    overrides[name] = value;
  }
  if (overrides !== undefined && Object.keys(overrides).length === 0) delete obj['skillOverrides'];
  const json = JSON.stringify(obj, null, indent).replace(/\n/g, eol);
  return { ok: true, text: bom + json + (finalNewline ? eol : '') };
}

// The last change of the whole process, whichever window made it: Undo
// takes back this one and no other.
interface LastChange {
  id: number;
  folder: string;
  file: string;
  before: Buffer | null;
  after: Buffer;
}
let lastChange: LastChange | null = null;
let nextId = 1;

function validEdits(edits: unknown): edits is SkillOverrideEdit[] {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > MAX_EDITS) return false;
  return edits.every((e: unknown) => {
    if (!isObject(e)) return false;
    const { name, value } = e;
    if (typeof name !== 'string' || name === '' || name.length > MAX_NAME || name === '__proto__') return false;
    return value === null || (typeof value === 'string' && VALUES.has(value));
  });
}

function readBytes(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// A tmp file beside the target, then a rename over it, as the hooks
// install's writeSettings does, so Claude Code never reads half a file.
function replaceFile(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.emerald-tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
}

// Writes what it is told: which value "On in every folder" means (a
// removal) is the renderer model's to decide.
export async function writeSkillOverrides(folder: string, scope: 'local' | 'user', edits: SkillOverrideEdit[], places: OverridePlaces): Promise<SkillOverridesWriteResult> {
  const dir = requireAbsolute(folder);
  if (scope !== 'local' && scope !== 'user') throw new Error(`not a writable scope: ${String(scope)}`);
  if (!validEdits(edits)) return { ok: false, error: 'not a skillOverrides edit' };
  const file = scopeFile(scope, dir, places);
  let before: Buffer | null;
  try {
    before = readBytes(file);
  } catch (err) {
    return { ok: false, error: `could not read ${file}: ${(err as Error).message}` };
  }
  const edited = editSettingsText(before === null ? null : before.toString('utf8'), edits);
  if (!edited.ok) return { ok: false, error: `${file} ${edited.error}; emerald does not rewrite it` };
  const after = Buffer.from(edited.text, 'utf8');
  try {
    replaceFile(file, after);
  } catch (err) {
    return { ok: false, error: `could not write ${file}: ${(err as Error).message}` };
  }
  const id = nextId++;
  lastChange = { id, folder: dir, file, before, after };
  return { ok: true, change: { id, folder: dir, scope, edits: edits.map((e) => ({ name: e.name, value: e.value })), read: await readSkillOverrides(dir, places) } };
}

// Puts the file back as it was before the last change, and only when the
// file is still exactly what that change wrote: a `/skills` pick or a hand
// edit made in between is never lost to an Undo.
export async function undoSkillOverrides(id: number, places: OverridePlaces): Promise<SkillOverridesUndoResult> {
  const change = lastChange;
  if (change === null || change.id !== id) return { ok: false, error: 'nothing to undo' };
  let now: Buffer | null;
  try {
    now = readBytes(change.file);
  } catch (err) {
    return { ok: false, error: `could not read ${change.file}: ${(err as Error).message}` };
  }
  if (now === null || !now.equals(change.after)) return { ok: false, error: `${change.file} changed since that change; Undo leaves it as it is` };
  try {
    if (change.before === null) fs.unlinkSync(change.file);
    else replaceFile(change.file, change.before);
  } catch (err) {
    return { ok: false, error: `could not write ${change.file}: ${(err as Error).message}` };
  }
  lastChange = null;
  return { ok: true, read: await readSkillOverrides(change.folder, places) };
}
