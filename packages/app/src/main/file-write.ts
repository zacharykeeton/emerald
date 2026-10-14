import fs from 'node:fs';
import path from 'node:path';
import type { FileMade, FileRenamed, FileSaved, FileStamp, FileTrashed, TextFormat } from '../preload/api.ts';

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
// accepts.
export function renameEntry(from: string, to: string): FileRenamed {
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
  if (!(process.platform === 'win32' && a.toLowerCase() === b.toLowerCase())) {
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
