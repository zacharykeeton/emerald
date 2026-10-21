import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createFile, describeWrite, detectEol, encodeText, entryMode, fileStamp, heldTrash, makeFolder, moveEntries, renameEntry, requireAbsolute, sameVolume, trashEntry, writeFileText } from './file-write.ts';

const BOM = String.fromCharCode(0xfeff);
// Any stamp, for a save refused before the stat.
const ANY = { mtimeMs: 0, size: 0 };

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-write-'));
}

test('detectEol takes the line end most of the file uses, \\n when there is none', () => {
  assert.equal(detectEol('a\r\nb\r\nc'), '\r\n');
  assert.equal(detectEol('a\nb\nc'), '\n');
  assert.equal(detectEol('a\r\nb\nc\n'), '\n');
  assert.equal(detectEol('a\r\nb\r\nc\n'), '\r\n');
  assert.equal(detectEol('one line'), '\n');
  assert.equal(detectEol(''), '\n');
});

test('encodeText writes every line end the file way and the BOM back on', () => {
  assert.equal(encodeText('a\nb\r\nc', { eol: '\r\n', bom: false }), 'a\r\nb\r\nc');
  assert.equal(encodeText('a\r\nb\nc', { eol: '\n', bom: false }), 'a\nb\nc');
  assert.equal(encodeText('a\nb', { eol: '\n', bom: true }), `${BOM}a\nb`);
});

test('writeFileText replaces the file with the text, keeping CRLF and the BOM', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'notes.txt');
  fs.writeFileSync(file, `${BOM}one\r\ntwo\r\n`);
  const answer = await writeFileText(file, 'one\ntwo\nthree\n', { eol: '\r\n', bom: true }, fileStamp(fs.statSync(file)));
  assert.equal(fs.readFileSync(file, 'utf8'), `${BOM}one\r\ntwo\r\nthree\r\n`);
  assert.deepEqual(answer, { saved: fileStamp(fs.statSync(file)) });
  // No temp file left beside it.
  assert.deepEqual(fs.readdirSync(dir), ['notes.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeFileText refuses a relative path and says why a folder is missing', async () => {
  await assert.rejects(writeFileText('notes.txt', 'x', { eol: '\n', bom: false }, ANY), /not an absolute path/);
  assert.throws(() => requireAbsolute('a/b'), /not an absolute path/);
  const dir = tempDir();
  await assert.rejects(writeFileText(path.join(dir, 'gone', 'notes.txt'), 'x', { eol: '\n', bom: false }, ANY), /Folder not found/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// M9 fix 525: a save whose stamp is older than the file (a Claude wrote
// it since the editor's read) writes nothing and answers changed; a save
// on the fresh stamp writes and answers the file's new stamp. The outside
// text has another length, since an equal size inside one mtime tick is
// not a case a test can make.
test('writeFileText refuses a save over a change on disk and takes the fresh stamp', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'notes.txt');
  fs.writeFileSync(file, 'mine as read\n');
  const read = fileStamp(fs.statSync(file));
  fs.writeFileSync(file, 'theirs, written since the read\n');
  assert.deepEqual(await writeFileText(file, 'mine\n', { eol: '\n', bom: false }, read), { changed: true });
  assert.equal(fs.readFileSync(file, 'utf8'), 'theirs, written since the read\n');
  const fresh = fileStamp(fs.statSync(file));
  const answer = await writeFileText(file, 'mine\n', { eol: '\n', bom: false }, fresh);
  assert.equal(fs.readFileSync(file, 'utf8'), 'mine\n');
  assert.deepEqual(answer, { saved: fileStamp(fs.statSync(file)) });
  // A file deleted since the read is made again whatever the stamp.
  fs.rmSync(file);
  assert.ok('saved' in (await writeFileText(file, 'again\n', { eol: '\n', bom: false }, fresh)));
  assert.equal(fs.readFileSync(file, 'utf8'), 'again\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

// M9 fix 526: a file with a second name is written in place, so both
// names read the new text and the link survives; no temp file is left.
test('writeFileText keeps a hard link', async () => {
  const dir = tempDir();
  const a = path.join(dir, 'a.txt');
  const b = path.join(dir, 'b.txt');
  fs.writeFileSync(a, 'old, and longer than the new\n');
  fs.linkSync(a, b);
  const answer = await writeFileText(a, 'new\n', { eol: '\n', bom: false }, fileStamp(fs.statSync(a)));
  assert.equal(fs.readFileSync(b, 'utf8'), 'new\n');
  assert.equal(fs.readFileSync(a, 'utf8'), 'new\n');
  assert.equal(fs.statSync(a).nlink, 2);
  assert.deepEqual(answer, { saved: fileStamp(fs.statSync(a)) });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a.txt', 'b.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeFileText keeps a symbolic link and edits its target', async (t) => {
  const dir = tempDir();
  const target = path.join(dir, 'target.txt');
  const link = path.join(dir, 'link.txt');
  fs.writeFileSync(target, 'old\n');
  try {
    fs.symlinkSync(target, link, 'file');
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return t.skip('symbolic links need Developer Mode or elevation');
    throw err;
  }
  await writeFileText(link, 'new text\n', { eol: '\n', bom: false }, fileStamp(fs.statSync(link)));
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readFileSync(target, 'utf8'), 'new text\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('createFile makes an empty file once and refuses a taken or a relative path', () => {
  const dir = tempDir();
  const file = path.join(dir, 'note.txt');
  assert.deepEqual(createFile(file), { ok: true });
  assert.equal(fs.readFileSync(file, 'utf8'), '');
  fs.writeFileSync(file, 'kept');
  assert.deepEqual(createFile(file), { ok: false, reason: 'exists' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'kept');
  assert.deepEqual(createFile('note.txt'), { ok: false, reason: 'refused' });
  assert.deepEqual(createFile(path.join(dir, 'gone', 'note.txt')), { ok: false, reason: 'refused' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('makeFolder makes one folder and refuses a taken or a relative path', () => {
  const dir = tempDir();
  const made = path.join(dir, 'made');
  assert.deepEqual(makeFolder(made), { ok: true });
  assert.ok(fs.statSync(made).isDirectory());
  assert.deepEqual(makeFolder(made), { ok: false, reason: 'exists' });
  // A file of that name is taken too.
  fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
  assert.deepEqual(makeFolder(path.join(dir, 'note.txt')), { ok: false, reason: 'exists' });
  assert.deepEqual(makeFolder('made'), { ok: false, reason: 'refused' });
  // Not recursive: a missing parent is refused rather than made.
  assert.deepEqual(makeFolder(path.join(dir, 'gone', 'deep')), { ok: false, reason: 'refused' });
  fs.rmSync(dir, { recursive: true, force: true });
});

// M9 fix 574: the rail's rename never replaces what is there, where a bare
// renameSync replaces a file silently.
test('renameEntry renames within a folder and never over a taken file or folder', () => {
  const dir = tempDir();
  try {
    const a = path.join(dir, 'a.txt');
    const b = path.join(dir, 'b.txt');
    const c = path.join(dir, 'c.txt');
    fs.writeFileSync(a, 'alpha');
    fs.writeFileSync(c, 'gamma');
    assert.deepEqual(renameEntry(a, b), { ok: true });
    assert.equal(fs.readFileSync(b, 'utf8'), 'alpha');
    assert.equal(fs.existsSync(a), false);
    assert.deepEqual(renameEntry(b, c), { ok: false, reason: 'exists' });
    assert.equal(fs.readFileSync(b, 'utf8'), 'alpha');
    assert.equal(fs.readFileSync(c, 'utf8'), 'gamma');
    const one = path.join(dir, 'one');
    const two = path.join(dir, 'two');
    fs.mkdirSync(one);
    fs.mkdirSync(two);
    assert.deepEqual(renameEntry(one, two), { ok: false, reason: 'exists' });
    assert.deepEqual(renameEntry(b, two), { ok: false, reason: 'exists' });
    assert.ok(fs.statSync(one).isDirectory());
    const refused = { ok: false, reason: 'refused', busy: false };
    assert.deepEqual(renameEntry('b.txt', c), refused);
    assert.deepEqual(renameEntry(b, 'd.txt'), refused);
    assert.deepEqual(renameEntry(b, path.join(one, 'b.txt')), refused);
    assert.deepEqual(renameEntry(path.join(dir, 'gone.txt'), path.join(dir, 'here.txt')), refused);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// On Windows a case-only rename's "taken" name is the entry itself, so a
// plain exists check would refuse it.
test('renameEntry lets a case-only rename through on Windows', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    fs.mkdirSync(path.join(dir, 'Sub'));
    assert.ok(fs.existsSync(path.join(dir, 'A.txt')));
    assert.deepEqual(renameEntry(path.join(dir, 'a.txt'), path.join(dir, 'A.txt')), { ok: true });
    assert.deepEqual(renameEntry(path.join(dir, 'Sub'), path.join(dir, 'sub')), { ok: true });
    assert.deepEqual(fs.readdirSync(dir).sort(), ['A.txt', 'sub']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A folder a process stands in is held by Windows; the rail says a
// session holds it.
test('renameEntry answers busy for a folder a process stands in', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }
  const dir = tempDir();
  const folder = path.join(dir, 'held');
  fs.mkdirSync(folder);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { cwd: folder, stdio: 'ignore' });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(renameEntry(folder, path.join(dir, 'moved')), { ok: false, reason: 'refused', busy: true });
  } finally {
    child.kill();
    await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M9 fix 483: a rename refused because another program holds the file
// open is EPERM on Windows, so the words name that as well as access.
test('a refused save names a file open in another program beside access', () => {
  const err = (code: string) => Object.assign(new Error(code), { code });
  assert.equal(describeWrite(err('EPERM')), 'Access denied or open in another program');
  assert.equal(describeWrite(err('EBUSY')), 'Access denied or open in another program');
  assert.equal(describeWrite(err('EACCES')), 'Access denied');
  assert.equal(describeWrite(err('ENOENT')), 'Folder not found');
});

test('trashEntry hands a path that is there to the trash, answers gone for one that is not, and refused for a relative path, a drive root or a trash that throws', async () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'doomed.txt');
    fs.writeFileSync(file, 'x');
    const handed: string[] = [];
    const fake = async (target: string) => {
      handed.push(target);
      fs.rmSync(target, { force: true });
    };
    assert.deepEqual(await trashEntry(file, fake), { ok: true });
    assert.deepEqual(handed, [path.normalize(file)]);
    assert.equal(fs.existsSync(file), false);
    handed.length = 0;
    assert.deepEqual(await trashEntry(path.join(dir, 'missing.txt'), fake), { ok: false, reason: 'gone' });
    assert.deepEqual(await trashEntry('rel.txt', fake), { ok: false, reason: 'refused' });
    assert.deepEqual(await trashEntry(path.parse(dir).root, fake), { ok: false, reason: 'refused' });
    assert.deepEqual(handed, []);
    const kept = path.join(dir, 'kept.txt');
    fs.writeFileSync(kept, 'y');
    const lines: string[] = [];
    const answer = await trashEntry(kept, async () => {
      throw new Error('no recycle bin');
    }, (msg) => lines.push(msg));
    assert.deepEqual(answer, { ok: false, reason: 'refused' });
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.startsWith('files-trash refused '), lines[0]);
    assert.equal(fs.existsSync(kept), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("heldTrash moves an entry into the home's trash under a numbered name and logs it", async () => {
  const dir = tempDir();
  try {
    const home = path.join(dir, 'home');
    const openLog = path.join(dir, 'open.log');
    fs.mkdirSync(path.join(dir, 'x'));
    fs.mkdirSync(path.join(dir, 'y'));
    fs.mkdirSync(path.join(dir, 'd'));
    const xa = path.join(dir, 'x', 'a.txt');
    const ya = path.join(dir, 'y', 'a.txt');
    const d = path.join(dir, 'd');
    fs.writeFileSync(xa, 'from x');
    fs.writeFileSync(ya, 'from y');
    fs.writeFileSync(path.join(d, 'inner.txt'), 'inner');
    const lines: string[] = [];
    const trasher = heldTrash(home, (m) => lines.push(m), openLog);
    for (const p of [xa, ya, d]) assert.deepEqual(await trashEntry(p, trasher), { ok: true });
    for (const p of [xa, ya, d]) assert.equal(fs.existsSync(p), false);
    assert.deepEqual(fs.readdirSync(path.join(home, 'trash')).sort(), ['1-a.txt', '1-d', '2-a.txt']);
    assert.equal(fs.readFileSync(path.join(home, 'trash', '1-a.txt'), 'utf8'), 'from x');
    assert.ok(fs.existsSync(path.join(home, 'trash', '1-d', 'inner.txt')));
    assert.deepEqual(lines, [xa, ya, d].map((p) => `trash held under a private EMERALD_HOME: ${path.normalize(p)}`));
    const want = [xa, ya, d].map((p) => `trash ${path.normalize(p)}\n`).join('');
    assert.equal(fs.readFileSync(openLog, 'utf8'), want);
    const more = path.join(dir, 'more.txt');
    fs.writeFileSync(more, 'm');
    assert.deepEqual(await trashEntry(more, heldTrash(home, () => {})), { ok: true });
    assert.equal(fs.readFileSync(openLog, 'utf8'), want);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M9 fix 953: a drop from Explorer on the Files rail. The fake trasher
// records what it was handed and moves it aside, as heldTrash does.
function fakeTrash(dir: string): { handed: string[]; trash: (target: string) => Promise<void> } {
  const handed: string[] = [];
  return {
    handed,
    trash: async (target) => {
      handed.push(target);
      fs.renameSync(target, path.join(dir, `trashed-${path.basename(target)}`));
    },
  };
}

test('moveEntries moves two files and a folder into a sibling folder on the same drive', async () => {
  const dir = tempDir();
  try {
    const src = path.join(dir, 'src');
    const into = path.join(dir, 'into');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.mkdirSync(into);
    fs.writeFileSync(path.join(src, 'a.txt'), 'a');
    fs.writeFileSync(path.join(src, 'b.txt'), 'b');
    fs.writeFileSync(path.join(src, 'sub', 'inner.txt'), 'inner');
    const t = fakeTrash(dir);
    const froms = ['a.txt', 'b.txt', 'sub'].map((n) => path.join(src, n));
    const answer = await moveEntries(froms, into, 'auto', null, { trash: t.trash });
    assert.deepEqual(answer, { done: froms.map((from) => ({ from, to: path.join(into, path.basename(from)), result: 'moved' })) });
    assert.equal(fs.readFileSync(path.join(into, 'a.txt'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(into, 'b.txt'), 'utf8'), 'b');
    assert.equal(fs.readFileSync(path.join(into, 'sub', 'inner.txt'), 'utf8'), 'inner');
    for (const f of froms) assert.equal(fs.existsSync(f), false);
    assert.deepEqual(t.handed, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('moveEntries asks about a taken name first, then replaces it through the trash or skips it', async () => {
  const dir = tempDir();
  try {
    const src = path.join(dir, 'src');
    const into = path.join(dir, 'into');
    fs.mkdirSync(src);
    fs.mkdirSync(into);
    const a = path.join(src, 'a.txt');
    const b = path.join(src, 'b.txt');
    const seed = () => {
      fs.writeFileSync(a, 'new a');
      fs.writeFileSync(b, 'b');
      fs.rmSync(path.join(into, 'b.txt'), { force: true });
      fs.writeFileSync(path.join(into, 'a.txt'), 'old a');
    };
    seed();
    const lines: string[] = [];
    const t = fakeTrash(dir);
    const first = await moveEntries([a, b], into, 'auto', null, { trash: t.trash, log: (m) => lines.push(m) });
    assert.deepEqual(first, { clashes: [{ from: a, to: path.join(into, 'a.txt'), kind: 'file', there: 'file' }] });
    assert.equal(fs.existsSync(a), true);
    assert.equal(fs.existsSync(b), true);
    assert.equal(fs.existsSync(path.join(into, 'b.txt')), false);
    assert.deepEqual(lines, [`files-move into ${into} (auto): 1 clashes, asking`]);

    const replaced = await moveEntries([a, b], into, 'auto', [a], { trash: t.trash });
    assert.deepEqual(replaced, {
      done: [
        { from: a, to: path.join(into, 'a.txt'), result: 'moved', replaced: true },
        { from: b, to: path.join(into, 'b.txt'), result: 'moved' },
      ],
    });
    assert.deepEqual(t.handed, [path.join(into, 'a.txt')]);
    assert.equal(fs.readFileSync(path.join(dir, 'trashed-a.txt'), 'utf8'), 'old a');
    assert.equal(fs.readFileSync(path.join(into, 'a.txt'), 'utf8'), 'new a');

    seed();
    lines.length = 0;
    const skipped = await moveEntries([a, b], into, 'auto', [], { trash: t.trash, log: (m) => lines.push(m) });
    assert.deepEqual(skipped, {
      done: [
        { from: a, to: path.join(into, 'a.txt'), result: 'skipped' },
        { from: b, to: path.join(into, 'b.txt'), result: 'moved' },
      ],
    });
    assert.equal(fs.readFileSync(path.join(into, 'a.txt'), 'utf8'), 'old a');
    assert.equal(fs.existsSync(a), true);
    assert.deepEqual(lines, [`files-move into ${into} (auto): a.txt skipped, b.txt moved`]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('moveEntries leaves a file already in the folder and refuses a folder into itself or its child', async () => {
  const dir = tempDir();
  try {
    const into = path.join(dir, 'into');
    const child = path.join(into, 'child');
    fs.mkdirSync(child, { recursive: true });
    const f = path.join(into, 'here.txt');
    fs.writeFileSync(f, 'h');
    const t = fakeTrash(dir);
    assert.deepEqual(await moveEntries([f], into, 'auto', null, { trash: t.trash }), { done: [{ from: f, to: f, result: 'here' }] });
    if (process.platform === 'win32') {
      assert.deepEqual(await moveEntries([f], into.toUpperCase(), 'auto', null, { trash: t.trash }), {
        done: [{ from: f, to: path.join(into.toUpperCase(), 'here.txt'), result: 'here' }],
      });
    }
    const why = 'A folder cannot go into itself';
    assert.deepEqual(await moveEntries([into], into, 'auto', null, { trash: t.trash }), { done: [{ from: into, to: path.join(into, 'into'), result: 'inside', why }] });
    assert.deepEqual(await moveEntries([into], child, 'auto', null, { trash: t.trash }), { done: [{ from: into, to: path.join(child, 'into'), result: 'inside', why }] });
    assert.equal(fs.readFileSync(f, 'utf8'), 'h');
    assert.ok(fs.existsSync(child));
    assert.deepEqual(t.handed, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('moveEntries copies with copy, keeping the source, a folder whole', async () => {
  const dir = tempDir();
  try {
    const src = path.join(dir, 'src');
    const into = path.join(dir, 'into');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.mkdirSync(into);
    const a = path.join(src, 'a.txt');
    const sub = path.join(src, 'sub');
    fs.writeFileSync(a, 'bytes');
    fs.writeFileSync(path.join(sub, 'inner.txt'), 'inner');
    const t = fakeTrash(dir);
    assert.deepEqual(await moveEntries([a, sub], into, 'copy', null, { trash: t.trash }), {
      done: [
        { from: a, to: path.join(into, 'a.txt'), result: 'copied' },
        { from: sub, to: path.join(into, 'sub'), result: 'copied' },
      ],
    });
    assert.equal(fs.readFileSync(a, 'utf8'), 'bytes');
    assert.equal(fs.readFileSync(path.join(into, 'a.txt'), 'utf8'), 'bytes');
    assert.equal(fs.readFileSync(path.join(sub, 'inner.txt'), 'utf8'), 'inner');
    assert.equal(fs.readFileSync(path.join(into, 'sub', 'inner.txt'), 'utf8'), 'inner');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('moveEntries moves across drives by a copy and then the source removed', async () => {
  const dir = tempDir();
  try {
    const src = path.join(dir, 'src');
    const into = path.join(dir, 'into');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.mkdirSync(into);
    const sub = path.join(src, 'sub');
    fs.writeFileSync(path.join(sub, 'inner.txt'), 'inner');
    const t = fakeTrash(dir);
    const rename = async () => {
      throw Object.assign(new Error('cross'), { code: 'EXDEV' });
    };
    assert.deepEqual(await moveEntries([sub], into, 'move', null, { trash: t.trash, rename }), { done: [{ from: sub, to: path.join(into, 'sub'), result: 'moved' }] });
    assert.equal(fs.existsSync(sub), false);
    assert.equal(fs.readFileSync(path.join(into, 'sub', 'inner.txt'), 'utf8'), 'inner');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('moveEntries refuses an entry whose clash cannot go to the recycle bin, leaving both', async () => {
  const dir = tempDir();
  try {
    const src = path.join(dir, 'src');
    const into = path.join(dir, 'into');
    fs.mkdirSync(src);
    fs.mkdirSync(into);
    const a = path.join(src, 'a.txt');
    fs.writeFileSync(a, 'new');
    fs.writeFileSync(path.join(into, 'a.txt'), 'old');
    const trash = async () => {
      throw new Error('no recycle bin');
    };
    assert.deepEqual(await moveEntries([a], into, 'auto', [a], { trash }), {
      done: [{ from: a, to: path.join(into, 'a.txt'), result: 'refused', why: 'What is there could not go to the recycle bin' }],
    });
    assert.equal(fs.readFileSync(a, 'utf8'), 'new');
    assert.equal(fs.readFileSync(path.join(into, 'a.txt'), 'utf8'), 'old');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('moveEntries refuses a missing folder, a relative source and a missing source', async () => {
  const dir = tempDir();
  try {
    const t = fakeTrash(dir);
    assert.deepEqual(await moveEntries([path.join(dir, 'x.txt')], path.join(dir, 'nowhere'), 'auto', null, { trash: t.trash }), { refused: 'Folder not found' });
    const gone = path.join(dir, 'gone.txt');
    assert.deepEqual(await moveEntries(['rel.txt', gone], dir, 'auto', null, { trash: t.trash }), {
      done: [
        { from: 'rel.txt', to: path.join(dir, 'rel.txt'), result: 'refused', why: 'Not an absolute path' },
        { from: gone, to: path.join(dir, 'gone.txt'), result: 'refused', why: 'Not found' },
      ],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('moveEntries answers busy for a folder a process stands in', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }
  const dir = tempDir();
  const folder = path.join(dir, 'held');
  const into = path.join(dir, 'into');
  fs.mkdirSync(folder);
  fs.mkdirSync(into);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { cwd: folder, stdio: 'ignore' });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const answer = await moveEntries([folder], into, 'move', null, { trash: fakeTrash(dir).trash });
    assert.ok('done' in answer);
    const [o] = answer.done;
    assert.equal(o?.result, 'refused');
    assert.equal(o?.busy, true);
    assert.equal(fs.existsSync(folder), true);
  } finally {
    child.kill();
    await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sameVolume and entryMode read the drive as Explorer does', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }
  assert.equal(sameVolume('C:\\a', 'c:\\b'), true);
  assert.equal(sameVolume('C:\\a', 'D:\\a'), false);
  assert.equal(sameVolume('\\\\srv\\share\\a', '\\\\srv\\share\\b'), true);
  assert.equal(sameVolume('\\\\srv\\share\\a', '\\\\srv\\other\\b'), false);
  assert.equal(entryMode('auto', 'D:\\x.txt', 'C:\\y'), 'copy');
  assert.equal(entryMode('auto', 'C:\\x.txt', 'C:\\y'), 'move');
  assert.equal(entryMode('move', 'D:\\x.txt', 'C:\\y'), 'move');
  assert.equal(entryMode('copy', 'C:\\x.txt', 'C:\\y'), 'copy');
});
