import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { BYTE_NOTE_MIN_AVERAGE } from '../renderer/src/files-drop-model.ts';
import type { FileClash, FileMade, FileRenamed, FileSaved, FilesMoved, FilesProgress, FileStamp, FileTrashed, MoveMode, MoveOutcome, TextFormat } from '../preload/api.ts';

// The file service's one write (M9 fix 248): the editor's text back onto
// the file it came from. Kept apart from files.ts, which imports electron's
// shell, so node:test can cover it. Every handler takes an absolute path
// only: a relative one would resolve against the app's working directory,
// which is never what a tree meant.
export function requireAbsolute(p: string): string {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error(`not an absolute path: ${String(p)}`);
  return path.normalize(p);
}

export type Eol = TextFormat['eol'];

// The line end most of the file uses; a file with no line break at all
// is written with \n, which is what a new file in these folders gets.
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  return crlf > lf ? '\r\n' : '\n';
}

// The bytes a save writes: every line end as the file had them and the
// BOM back on the front when the read found one.
export function encodeText(text: string, format: TextFormat): string {
  const body = text.replace(/\r?\n/g, format.eol);
  return format.bom ? `\uFEFF${body}` : body;
}

// What a save compares against (M9 fix 525): the size and the mtime of
// the file as the editor last read or saved it.
export function fileStamp(st: fs.Stats): FileStamp {
  return { mtimeMs: st.mtimeMs, size: st.size };
}

// Written to a temp file beside the target and renamed over it, so a
// crash or a full disk mid-write leaves the old file whole rather than a
// truncated one; the rename replaces the target on Windows as on the
// rest. A watcher on the folder sees a create and a rename, which the
// debounce folds into one change. A linked file (a symbolic link, or a
// hard link with a second name) is written in place instead (M9 fix
// 526), since a rename would break the link, and gives up the atomic
// replace.
//
// M9 fix 525: the save carries the stamp of the disk the editor last
// agreed with, and a file that has moved since (a Claude's edit the
// window has not re-read yet) is left alone and answered `changed`, so
// the header shows its changed-on-disk line rather than the save
// overwriting it. A file deleted since is made again. The gap between
// this stat and the rename is microseconds against the watcher's 200 ms.
export async function writeFileText(p: string, text: string, format: TextFormat, stamp: FileStamp): Promise<FileSaved> {
  const file = requireAbsolute(p);
  try {
    const st = await fs.promises.stat(file);
    if (st.mtimeMs !== stamp.mtimeMs || st.size !== stamp.size) return { changed: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(describeWrite(err));
  }
  if (await isLinked(file)) {
    await writeInPlace(file, encodeText(text, format));
  } else {
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.emerald-${process.pid}-${Date.now()}.tmp`);
    try {
      await fs.promises.writeFile(tmp, encodeText(text, format), 'utf8');
      await fs.promises.rename(tmp, file);
    } catch (err) {
      await fs.promises.rm(tmp, { force: true }).catch(() => {});
      throw new Error(describeWrite(err));
    }
  }
  try {
    return { saved: fileStamp(await fs.promises.stat(file)) };
  } catch (err) {
    throw new Error(describeWrite(err));
  }
}

// A symbolic link, or a file with more than one name. A file gone since
// the check (ENOENT) takes the rename and is made again.
async function isLinked(file: string): Promise<boolean> {
  try {
    const l = await fs.promises.lstat(file);
    return l.isSymbolicLink() || l.nlink > 1;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error(describeWrite(err));
  }
}

// Over the file's own bytes: r+ follows a symbolic link, so its target is
// what is edited. The write comes before the truncate, so a failure part
// way leaves the old tail rather than an empty file.
async function writeInPlace(file: string, body: string): Promise<void> {
  const buf = Buffer.from(body, 'utf8');
  let h: fs.promises.FileHandle | null = null;
  try {
    h = await fs.promises.open(file, 'r+');
    await h.write(buf, 0, buf.length, 0);
    await h.truncate(buf.length);
  } catch (err) {
    throw new Error(describeWrite(err));
  } finally {
    await h?.close().catch(() => {});
  }
}

// A new file or folder from the rail (M9 fix 309). Neither ever
// replaces what is there: the file is opened with wx and the folder is
// not made recursively, so a name already taken answers `exists` and
// the rail keeps the name box open on it. Anything else that stops the
// write (a parent folder gone, access denied, a relative path) is
// `refused`; the rail has nothing to do about those but say so.
export function createFile(p: string): FileMade {
  return make(p, (file) => fs.writeFileSync(file, '', { flag: 'wx' }));
}

export function makeFolder(p: string): FileMade {
  return make(p, (dir) => fs.mkdirSync(dir));
}

function make(p: string, write: (target: string) => void): FileMade {
  let target: string;
  try {
    target = requireAbsolute(p);
  } catch {
    return { ok: false, reason: 'refused' };
  }
  try {
    write(target);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as NodeJS.ErrnoException).code === 'EEXIST' ? 'exists' : 'refused' };
  }
}

// The rail's rename (M9 fix 574). It never replaces what is there: a
// taken name answers `exists`, since renameSync would replace a file
// silently. A case-only rename goes through, since on Windows the "taken"
// name is the entry itself. A rename is within one folder. Anything else
// that stops it is `refused`, with `busy` set for EBUSY and EPERM so the
// rail can say a session holds the folder. The gap between the check and
// the rename is microseconds, the same race writeFileText's comment
// accepts. M9 fix 1025: off Windows a case-only rename skips the check
// only when both names are one entry (the same dev and ino: APFS by
// default, or any case-blind volume), so a case-sensitive volume with two
// real entries still answers exists and nothing is overwritten.
export function renameEntry(from: string, to: string, platform: NodeJS.Platform = process.platform): FileRenamed {
  let a: string;
  let b: string;
  try {
    a = requireAbsolute(from);
    b = requireAbsolute(to);
  } catch {
    return { ok: false, reason: 'refused', busy: false };
  }
  if (path.dirname(a) !== path.dirname(b)) return { ok: false, reason: 'refused', busy: false };
  if (a === b) return { ok: true };
  const isBusy = (code: string | undefined) => code === 'EBUSY' || code === 'EPERM';
  const caseOnly = a.toLowerCase() === b.toLowerCase();
  if (!(caseOnly && (platform === 'win32' || sameEntry(a, b)))) {
    try {
      fs.lstatSync(b);
      return { ok: false, reason: 'exists' };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') return { ok: false, reason: 'refused', busy: isBusy(code) };
    }
  }
  try {
    fs.renameSync(a, b);
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') return { ok: false, reason: 'exists' };
    return { ok: false, reason: 'refused', busy: isBusy(code) };
  }
}

// The rail's Delete (M9 fix 617): the entry moved to the recycle bin,
// never removed outright, so there is no fs.rm anywhere on this path. The
// trasher is handed in (shell.trashItem in the app, heldTrash under a
// harness) so this file stays free of Electron and node:test can pass a
// fake. A relative path or a
// drive root is refused; an entry already gone answers `gone`, which the
// rail cleans up after as it does a delete; a trash that throws is
// logged and answered `refused`.
export async function trashEntry(p: string, trash: (target: string) => Promise<void>, log?: (msg: string) => void): Promise<FileTrashed> {
  let target: string;
  try {
    target = requireAbsolute(p);
  } catch {
    return { ok: false, reason: 'refused' };
  }
  if (path.parse(target).root === target) return { ok: false, reason: 'refused' };
  try {
    fs.lstatSync(target);
  } catch (err) {
    return { ok: false, reason: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'gone' : 'refused' };
  }
  try {
    await trash(target);
    return { ok: true };
  } catch (err) {
    log?.(`files-trash refused ${target}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, reason: 'refused' };
  }
}

// A drop from Explorer on the Files rail (M9 fix 953): every dropped
// entry into one folder, moved or copied by Explorer's rule. Two passes
// when a name is taken: the first (replace null) finds the clashes and
// touches nothing, the second replaces the ones the person chose and
// skips the rest. Each entry stands alone: one that fails is reported and
// the rest still go, and nothing done is rolled back. A replaced entry
// goes to the trasher first, so fix 617's no fs.rm holds for what was
// there; a move across drives is a copy and then the source removed
// outright, as Explorer's own is. A copy walks its tree itself, folders
// then files, so the window that dropped can be told how far it is (M9
// fix 1008).
export function sameVolume(a: string, b: string): boolean {
  const ra = path.parse(path.resolve(a)).root;
  const rb = path.parse(path.resolve(b)).root;
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

export function entryMode(mode: MoveMode, from: string, dir: string): 'move' | 'copy' {
  if (mode !== 'auto') return mode;
  return sameVolume(from, dir) ? 'move' : 'copy';
}

// At most one progress push per this long, so a copy of thousands of
// small files does not flood the window.
export const COPY_PROGRESS_MS = 100;

// A file over this is copied by stream, its bytes counted as they go (M9 fix 1123); cp's native copy, which is faster but says nothing until it returns, takes the rest.
export const STREAM_COPY_MIN_BYTES = 64 * 1024 * 1024;
// The stream floor when the drop's note counts bytes (M9 fix 1153): a file over 8 MB then moves the note inside itself, where cp's native copy would jump it a whole file at a time.
export const STREAM_COPY_BYTE_NOTE_MIN_BYTES = 8 * 1024 * 1024;

// The size over which a drop's files go by stream: the lower floor when
// the note counts bytes, by the note's own rule (copyingNote in the
// renderer's files-drop-model.ts), so the two read one number.
export function streamFloor(total: number, bytesTotal: number): number {
  return total > 0 && bytesTotal / total > BYTE_NOTE_MIN_AVERAGE ? STREAM_COPY_BYTE_NOTE_MIN_BYTES : STREAM_COPY_MIN_BYTES;
}
// The read stream's highWaterMark, so one pace step and one count per 64 KB.
export const STREAM_COPY_CHUNK_BYTES = 64 * 1024;

export function progressDue(startAt: number, lastAt: number | null, now: number): boolean {
  return now - (lastAt ?? startAt) >= COPY_PROGRESS_MS;
}

// A harness's slowed copy (M9 fix 1008): verify:drop sets
// EMERALD_COPY_PACE_MS so a few hundred files take long enough to read a
// progress note. Unset, nothing waits. Inside a file copied by stream it is slept after each chunk too (M9 fix 1123), so verify:drop can read a byte note move inside one file.
export function copyPaceMs(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw)) return 0;
  return Math.min(Number(raw), 1000);
}

export interface CopyOneOptions {
  size: number;
  onBytes: (n: number) => void;
  signal: AbortSignal | null;
  pace: number;
  streamAt?: number;
  chunk?: number;
}

// One file or one link copied (M9 fix 1123). Small files and links go by
// cp's native copy and count nothing until they return; a big file goes
// through a stream so its bytes are counted and a Cancel can stop it
// between chunks.
export async function copyOneFile(from: string, to: string, o: CopyOneOptions): Promise<void> {
  if (o.size <= (o.streamAt ?? STREAM_COPY_MIN_BYTES)) {
    await fs.promises.cp(from, to, { errorOnExist: true, force: false, preserveTimestamps: true });
    return;
  }
  const st = await fs.promises.stat(from);
  const pace = o.pace;
  const onBytes = o.onBytes;
  const counted = async function* (source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
    for await (const c of source) {
      onBytes(c.length);
      if (pace > 0) await new Promise((r) => setTimeout(r, pace));
      yield c;
    }
  };
  const read = fs.createReadStream(from, { highWaterMark: o.chunk ?? STREAM_COPY_CHUNK_BYTES });
  // wx answers EEXIST for a name that appeared since the check, as
  // errorOnExist did, so copyInto's catch spares it.
  const write = fs.createWriteStream(to, { flags: 'wx' });
  if (o.signal !== null) await pipeline(read, counted, write, { signal: o.signal });
  else await pipeline(read, counted, write);
  // The preserveTimestamps the native copy kept; before the chmod, since
  // Windows refuses times on a read-only file.
  await fs.promises.utimes(to, st.atime, st.mtime);
  if ((st.mode & 0o200) === 0) await fs.promises.chmod(to, st.mode & 0o777);
}

// What a copy of one dropped entry will make: its folders top-down, the
// entry itself first, and every other entry under them with its size. A
// symbolic link is a file here and never followed, as cp copies a link
// as a link.
export interface TreeWalk {
  dirs: string[];
  files: { path: string; size: number }[];
}

export async function walkTree(src: string): Promise<TreeWalk> {
  const st = await fs.promises.lstat(src);
  if (!st.isDirectory()) return { dirs: [], files: [{ path: src, size: st.size }] };
  const dirs = [src];
  const files: TreeWalk['files'] = [];
  // The array's iterator reads its length each step, so the folders
  // pushed below are walked in turn.
  for (const dir of dirs) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of entries) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) dirs.push(p);
      else files.push({ path: p, size: (await fs.promises.lstat(p)).size });
    }
  }
  return { dirs, files };
}

// Whether two paths name one entry on disk (M9 fix 1025).
function sameEntry(a: string, b: string): boolean {
  try {
    const x = fs.lstatSync(a);
    const y = fs.lstatSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}

export interface MoveDeps {
  trash: (target: string) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  log?: (msg: string) => void;
  // One file or one link copied (M9 fix 1008); the tests' fake counts
  // the calls and moves a clock. onBytes counts a streamed file's bytes as
  // they land (M9 fix 1123).
  // streamAt is the drop's stream floor (M9 fix 1153), streamFloor of its counts.
  copyFile?: (from: string, to: string, o: { size: number; onBytes: (n: number) => void; signal: AbortSignal | null; streamAt: number }) => Promise<void>;
  // A copy's figures so far, at most every COPY_PROGRESS_MS and once at
  // the end (M9 fix 1008).
  progress?: (p: Omit<FilesProgress, 'dir'>) => void;
  // The clock the pushes are paced on; Date.now unless a test moves it.
  now?: () => number;
  // Milliseconds slept after each copied file, EMERALD_COPY_PACE_MS's.
  pace?: number;
  // The platform whose path compare applies (M9 fix 1025); a test names it.
  platform?: NodeJS.Platform;
  // The drop's Cancel (M9 fix 1124): checked before each entry and each file, and handed to a streamed file's pipeline.
  signal?: AbortSignal;
}

// The running copies a Cancel can stop (M9 fix 1124), shaped as
// SearchRuns but keyed by window and folder, since one window can copy
// into two folders at once.
export class CopyRuns {
  private readonly running = new Map<string, Set<AbortController>>();

  private static key(owner: number, dir: string): string {
    return `${owner}\n${dir}`;
  }

  begin(owner: number, dir: string): AbortSignal {
    const key = CopyRuns.key(owner, dir);
    let set = this.running.get(key);
    if (set === undefined) {
      set = new Set();
      this.running.set(key, set);
    }
    const c = new AbortController();
    set.add(c);
    return c.signal;
  }

  // Aborts every copy of this window into dir and answers how many.
  cancel(owner: number, dir: string): number {
    const key = CopyRuns.key(owner, dir);
    const set = this.running.get(key);
    if (set === undefined) return 0;
    this.running.delete(key);
    for (const c of set) c.abort();
    return set.size;
  }

  end(owner: number, dir: string, signal: AbortSignal): void {
    const key = CopyRuns.key(owner, dir);
    const set = this.running.get(key);
    if (set === undefined) return;
    for (const c of set) if (c.signal === signal) set.delete(c);
    if (set.size === 0) this.running.delete(key);
  }
}

// An entry the drop can act on, or the outcome that stops it before
// anything is touched.
type Planned = { src: string; to: string; kind: 'dir' | 'file' } | { outcome: MoveOutcome };

const errCode = (err: unknown): string | undefined => (err as NodeJS.ErrnoException).code;

export async function moveEntries(paths: readonly string[], dir: string, mode: MoveMode, replace: readonly string[] | null, deps: MoveDeps): Promise<FilesMoved> {
  // Case-blind on Windows and on a Mac, whose APFS is case-insensitive by
  // default (M9 fix 1025); exact on Linux.
  const blind = (deps.platform ?? process.platform) !== 'linux';
  const same = (a: string, b: string) => (blind ? a.toLowerCase() === b.toLowerCase() : a === b);
  const under = (child: string, parent: string) => {
    const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
    return blind ? child.toLowerCase().startsWith(prefix.toLowerCase()) : child.startsWith(prefix);
  };
  let into: string;
  try {
    into = path.resolve(requireAbsolute(dir));
  } catch {
    return { refused: 'Folder not found' };
  }
  try {
    if (!(await fs.promises.stat(into)).isDirectory()) return { refused: 'Folder not found' };
  } catch (err) {
    return { refused: errCode(err) === 'ENOENT' ? 'Folder not found' : describeWrite(err) };
  }
  const rename = deps.rename ?? ((a: string, b: string) => fs.promises.rename(a, b));

  const plan = async (p: string): Promise<Planned> => {
    const to = path.join(into, path.basename(p));
    if (typeof p !== 'string' || !path.isAbsolute(p)) return { outcome: { from: p, to, result: 'refused', why: 'Not an absolute path' } };
    const src = path.resolve(p);
    const landing = path.join(into, path.basename(src));
    if (path.parse(src).root === src) return { outcome: { from: src, to: landing, result: 'refused', why: 'A whole drive is not moved' } };
    let st: fs.Stats;
    try {
      st = await fs.promises.lstat(src);
    } catch (err) {
      return { outcome: { from: src, to: landing, result: 'refused', why: errCode(err) === 'ENOENT' ? 'Not found' : describeWrite(err) } };
    }
    if (same(path.dirname(src), into)) return { outcome: { from: src, to: landing, result: 'here' } };
    if (same(into, src) || under(into, src)) return { outcome: { from: src, to: landing, result: 'inside', why: 'A folder cannot go into itself' } };
    return { src, to: landing, kind: st.isDirectory() ? 'dir' : 'file' };
  };
  const thereAt = async (to: string): Promise<'dir' | 'file' | null> => {
    try {
      return (await fs.promises.lstat(to)).isDirectory() ? 'dir' : 'file';
    } catch {
      return null;
    }
  };

  const planned: Planned[] = [];
  for (const p of paths) planned.push(await plan(p));

  if (replace === null) {
    const clashes: FileClash[] = [];
    for (const e of planned) {
      if ('outcome' in e) continue;
      const there = await thereAt(e.to);
      if (there !== null) clashes.push({ from: e.src, to: e.to, kind: e.kind, there });
    }
    if (clashes.length > 0) {
      deps.log?.(`files-move into ${into} (${mode}): ${clashes.length} clashes, asking`);
      return { clashes };
    }
  }
  const chosen = replace ?? [];
  const isChosen = (src: string) => chosen.some((c) => path.isAbsolute(c) && same(path.resolve(c), src));

  // The count of every file the drop will copy, so a push can say how
  // far it is. A move on one drive is a rename and copies nothing, so it
  // shows nothing. A walk that throws leaves its entry out, and its copy
  // then fails and is reported as before.
  const now = deps.now ?? Date.now;
  const pace = deps.pace ?? 0;
  const copyFile = deps.copyFile ?? ((a: string, b: string, o: { size: number; onBytes: (n: number) => void; signal: AbortSignal | null; streamAt: number }) => copyOneFile(a, b, { ...o, pace }));
  const walks = new Map<string, TreeWalk>();
  let total = 0;
  let bytesTotal = 0;
  for (const e of planned) {
    if ('outcome' in e || entryMode(mode, e.src, into) !== 'copy') continue;
    if ((await thereAt(e.to)) !== null && !isChosen(e.src)) continue;
    try {
      const w = await walkTree(e.src);
      walks.set(e.src, w);
      total += w.files.length;
      for (const f of w.files) bytesTotal += f.size;
    } catch {
      // Counted as nothing; the copy reports why.
    }
  }
  // Once, from the first count: an EXDEV fallback's tree counted later does not move it (M9 fix 1153).
  const streamAt = streamFloor(total, bytesTotal);
  let filesDone = 0;
  let bytesDone = 0;
  let startAt: number | null = null;
  let lastAt: number | null = null;
  let last: Omit<FilesProgress, 'dir'> | null = null;
  const push = () => {
    last = { done: filesDone, total, bytesDone, bytesTotal };
    deps.progress?.(last);
  };
  // A counted entry that ends without its whole copy takes what it did
  // not copy off the totals, so done meets total at the end.
  const uncount = (src: string, copied: { files: number; bytes: number }) => {
    const w = walks.get(src);
    if (w === undefined) return;
    walks.delete(src);
    total -= w.files.length - copied.files;
    for (const f of w.files) bytesTotal -= f.size;
    bytesTotal += copied.bytes;
  };

  const tick = () => {
    if (startAt !== null && progressDue(startAt, lastAt, now())) {
      lastAt = now();
      push();
    }
  };

  const copyInto = async (src: string, to: string, copied: { files: number; bytes: number }): Promise<unknown> => {
    // The bytes a streamed file has counted so far, taken back if it fails.
    let got = 0;
    try {
      let w = walks.get(src);
      if (w === undefined) {
        // An EXDEV fallback's tree, or one whose count walk threw: walked
        // now and counted from now.
        w = await walkTree(src);
        walks.set(src, w);
        total += w.files.length;
        for (const f of w.files) bytesTotal += f.size;
      }
      const target = (p: string) => path.join(to, path.relative(src, p));
      // Not recursive, so a name that appeared at `to` since the check
      // answers EEXIST, as cp's errorOnExist did, and is spared below.
      for (const d of w.dirs) await fs.promises.mkdir(target(d));
      for (const f of w.files) {
        if (deps.signal?.aborted === true) throw Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' });
        startAt ??= now();
        got = 0;
        await copyFile(f.path, target(f.path), {
          size: f.size,
          signal: deps.signal ?? null,
          streamAt,
          onBytes: (n) => {
            got += n;
            bytesDone += n;
            tick();
          },
        });
        filesDone += 1;
        // A native copy counts whole at its end; a streamed one is not
        // counted twice.
        bytesDone += Math.max(0, f.size - got);
        got = 0;
        copied.files += 1;
        copied.bytes += f.size;
        if (pace > 0) await new Promise((r) => setTimeout(r, pace));
        tick();
      }
      return null;
    } catch (err) {
      bytesDone -= got;
      // The check before found nothing at `to`, so a partial copy is ours
      // to take back; an exists code means someone else's entry is there.
      const code = errCode(err);
      if (code !== 'ERR_FS_CP_EEXIST' && code !== 'EEXIST') {
        try {
          await fs.promises.rm(to, { recursive: true, force: true });
        } catch {
          // Left as it is; the outcome says the copy was refused.
        }
      }
      return err;
    }
  };

  const done: MoveOutcome[] = [];
  for (const e of planned) {
    if ('outcome' in e) {
      done.push(e.outcome);
      continue;
    }
    const { src, to } = e;
    const copied = { files: 0, bytes: 0 };
    // A Cancel leaves every entry not started untouched (M9 fix 1124).
    if (deps.signal?.aborted === true) {
      uncount(src, copied);
      done.push({ from: src, to, result: 'skipped', cancelled: true });
      continue;
    }
    let replaced = false;
    if ((await thereAt(to)) !== null) {
      if (!isChosen(src)) {
        uncount(src, copied);
        done.push({ from: src, to, result: 'skipped' });
        continue;
      }
      try {
        await deps.trash(to);
      } catch {
        uncount(src, copied);
        done.push({ from: src, to, result: 'refused', why: 'What is there could not go to the recycle bin' });
        continue;
      }
      replaced = true;
    }
    const extra = replaced ? { replaced: true as const } : {};
    // The entry being copied when a Cancel landed, taken back by copyInto's
    // catch as a refused copy is (M9 fix 1124).
    const failed = (err: unknown): MoveOutcome =>
      deps.signal?.aborted === true ? { from: src, to, result: 'refused', ...extra, why: 'Cancelled', cancelled: true } : { from: src, to, result: 'refused', ...extra, why: describeWrite(err) };
    if (entryMode(mode, src, into) === 'copy') {
      const err = await copyInto(src, to, copied);
      if (err !== null) uncount(src, copied);
      done.push(err === null ? { from: src, to, result: 'copied', ...extra } : failed(err));
      continue;
    }
    try {
      await rename(src, to);
      done.push({ from: src, to, result: 'moved', ...extra });
    } catch (err) {
      const code = errCode(err);
      if (code === 'EXDEV') {
        const copyErr = await copyInto(src, to, copied);
        if (copyErr !== null) {
          uncount(src, copied);
          done.push(failed(copyErr));
          continue;
        }
        try {
          await fs.promises.rm(src, { recursive: true });
          done.push({ from: src, to, result: 'moved', ...extra });
        } catch (rmErr) {
          done.push({ from: src, to, result: 'copied', ...extra, sourceKept: true, why: describeWrite(rmErr) });
        }
      } else if (code === 'EBUSY' || code === 'EPERM') {
        done.push({ from: src, to, result: 'refused', ...extra, busy: true, why: describeWrite(err) });
      } else {
        done.push({ from: src, to, result: 'refused', ...extra, why: describeWrite(err) });
      }
    }
  }
  // The final figures once more when the window was shown any, unless
  // the last push already carried them.
  const final = last as Omit<FilesProgress, 'dir'> | null;
  if (final !== null && (final.done !== filesDone || final.total !== total || final.bytesDone !== bytesDone || final.bytesTotal !== bytesTotal)) push();
  const words = done.map((o) => `${path.basename(o.from)} ${o.result}${o.cancelled === true ? ' cancelled' : ''}${o.replaced === true ? ' replaced' : ''}${o.sourceKept === true ? ' source kept' : ''}`);
  deps.log?.(`files-move into ${into} (${mode}): ${words.join(', ')}`);
  return { done };
}

// The trasher under a private EMERALD_HOME or EMERALD_OPEN_LOG (M9 fix
// 644): a harness window's Delete must not reach the person's recycle
// bin, so the entry is moved to <home>/trash under a numbered name (two
// del-a.txt become 1-del-a.txt and 2-del-a.txt). Moved, not removed, so
// fix 617's rule of no fs.rm on this path holds. A throw (EXDEV across
// volumes, a file held open) rejects and trashEntry answers refused.
export function heldTrash(home: string, log: (msg: string) => void, openLog?: string): (target: string) => Promise<void> {
  return async (target) => {
    const dir = path.join(home, 'trash');
    fs.mkdirSync(dir, { recursive: true });
    let n = 1;
    while (fs.existsSync(path.join(dir, `${n}-${path.basename(target)}`))) n++;
    fs.renameSync(target, path.join(dir, `${n}-${path.basename(target)}`));
    log(`trash held under a private EMERALD_HOME: ${target}`);
    if (openLog !== undefined) fs.appendFileSync(openLog, `trash ${target}\n`);
  };
}

// Exported for the test of its wording.
export function describeWrite(err: unknown): string {
  const e = err as NodeJS.ErrnoException;
  switch (e.code) {
    case 'ENOENT':
      return 'Folder not found';
    case 'EACCES':
      return 'Access denied';
    // On Windows the rename's EPERM is almost always the file held open
    // by another program without share-delete (Excel, a viewer), not a
    // permission (M9 fix 483), so the words name both.
    case 'EPERM':
    case 'EBUSY':
      return 'Access denied or open in another program';
    case 'ENOSPC':
      return 'Disk full';
    default:
      return e.message ?? String(err);
  }
}
