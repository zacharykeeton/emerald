import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { execFileSync } from 'node:child_process';
import { FOLDER_ICON_SEARCH_TTL_MS, FOLDER_ICON_TTL_MS, fileUrl, findFolderIcon, folderIcon, folderIconCacheSize, folderIconForget, iconLinkHref, rankIconMatches } from './folder-icon.ts';
import type { GitOptions } from './git-runner.ts';

// A fresh tree per test so one case's files cannot answer another's.
function tree(files: Record<string, string>): string {
  const root = mkTemp('emerald-icon-');
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return root;
}

test.after(removeTemps);

test('the usual places in order: the root first, then public and the rest, then build/icon.png', async () => {
  const both = tree({ 'favicon.png': 'x', 'public/favicon.svg': 'y' });
  assert.equal(await findFolderIcon(both), path.join(both, 'favicon.png'));
  const pub = tree({ 'public/favicon.svg': 'y', 'src/favicon.ico': 'z' });
  assert.equal(await findFolderIcon(pub), path.join(pub, 'public', 'favicon.svg'));
  const electron = tree({ 'build/icon.png': 'e' });
  assert.equal(await findFolderIcon(electron), path.join(electron, 'build', 'icon.png'));
  const ico = tree({ 'favicon.ico': 'i', 'favicon.svg': 's' });
  assert.equal(await findFolderIcon(ico), path.join(ico, 'favicon.ico'));
});

test('iconLinkHref reads the first link whose rel is an icon, any quoting, any attribute order', () => {
  assert.equal(iconLinkHref('<link rel="stylesheet" href="a.css"><link href=icons/fav.svg rel="icon" type="image/svg+xml">'), 'icons/fav.svg');
  assert.equal(iconLinkHref("<LINK REL='shortcut icon' HREF='/fav.ico'>"), '/fav.ico');
  assert.equal(iconLinkHref('<link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/fav.png">'), '/fav.png');
  assert.equal(iconLinkHref('<link rel="stylesheet" href="a.css">'), null);
  assert.equal(iconLinkHref(''), null);
});

test('the html link: relative against the html, a site-root href against the html too, http and data left alone', async () => {
  const rel = tree({ 'index.html': '<head><link rel="icon" href="img/fav.svg?v=2"></head>', 'img/fav.svg': 's' });
  assert.equal(await findFolderIcon(rel), path.join(rel, 'img', 'fav.svg'));
  const root = tree({ 'public/index.html': '<link rel="icon" href="/fav.png">', 'public/fav.png': 'p' });
  assert.equal(await findFolderIcon(root), path.join(root, 'public', 'fav.png'));
  const http = tree({ 'index.html': '<link rel="icon" href="https://cdn.example/fav.png">' });
  assert.equal(await findFolderIcon(http), null);
  const data = tree({ 'index.html': '<link rel="icon" href="data:image/png;base64,AAAA">' });
  assert.equal(await findFolderIcon(data), null);
  const missing = tree({ 'index.html': '<link rel="icon" href="gone.png">' });
  assert.equal(await findFolderIcon(missing), null);
});

// M9 fix 482: an href that resolves outside the html's folder is refused
// before anything is statted, so a backslash spelling of a UNC path never
// makes the box connect to that host, and ../ reads nothing above.
test('the html link: a UNC path in any spelling and a ../ href answer nothing', async () => {
  for (const href of ['\\\\evil.example\\share\\x.ico', '/\\\\evil.example\\share\\x.ico', '\\/evil.example/share/x.ico']) {
    const unc = tree({ 'index.html': `<link rel="icon" href="${href}">` });
    assert.equal(await findFolderIcon(unc), null, href);
  }
  const up = tree({ 'public/index.html': '<link rel="icon" href="../secret.ico">', 'secret.ico': 's' });
  assert.equal(await findFolderIcon(up), null, '../ out of the html folder');
  const plain = tree({ 'index.html': '<link rel="icon" href="img/mark.png">', 'img/mark.png': 'f' });
  assert.equal(await findFolderIcon(plain), path.join(plain, 'img', 'mark.png'), 'a plain href beside the html still answers');
});

test('the html link: a site-root href in a root index.html also tries public, the html folder first (M9 fix 1121)', async () => {
  const pub = tree({ 'index.html': '<link rel="icon" href="/icon-192.png">', 'public/icon-192.png': 'p' });
  assert.equal(await findFolderIcon(pub), path.join(pub, 'public', 'icon-192.png'));
  const both = tree({ 'index.html': '<link rel="icon" href="/icon-192.png">', 'public/icon-192.png': 'p', 'icon-192.png': 'r' });
  assert.equal(await findFolderIcon(both), path.join(both, 'icon-192.png'));
  const relative = tree({ 'index.html': '<link rel="icon" href="icon-192.png">', 'public/icon-192.png': 'p' });
  assert.equal(await findFolderIcon(relative), null);
  for (const href of ['/\\\\evil.example\\share\\x.ico', '/\\evil.example/share/x.ico', '/\\/evil.example/share/x.ico']) {
    const unc = tree({ 'index.html': `<link rel="icon" href="${href}">` });
    assert.equal(await findFolderIcon(unc), null, href);
  }
});

test('a folder inside a repository with none of its own takes the root icon; outside one, nothing', async () => {
  const repo = tree({ '.git/HEAD': 'ref: refs/heads/main', 'public/favicon.svg': 'r', 'packages/app/README.md': 'm' });
  assert.equal(await findFolderIcon(path.join(repo, 'packages', 'app')), path.join(repo, 'public', 'favicon.svg'));
  const worktree = tree({ '.git': 'gitdir: elsewhere', 'favicon.ico': 'w', 'src/deep/x.ts': '' });
  assert.equal(await findFolderIcon(path.join(worktree, 'src', 'deep')), path.join(worktree, 'favicon.ico'));
  const own = tree({ '.git/HEAD': 'x', 'favicon.ico': 'root', 'sub/favicon.png': 'sub' });
  assert.equal(await findFolderIcon(path.join(own, 'sub')), path.join(own, 'sub', 'favicon.png'));
  const bare = tree({ 'sub/x.txt': '' });
  // No .git anywhere up to the temp root: null, whatever the drive holds
  // above the temp folder is not walked into (findRepoRoot stops at the
  // first .git, and a temp folder is not in one).
  assert.equal(await findFolderIcon(path.join(bare, 'sub')), null);
});

test('folderIcon gives a file URL, caches per folder, and forget drops a folder and those under it', async () => {
  const repo = tree({ '.git/HEAD': 'x', 'favicon.svg': 'one', 'sub/a.txt': '' });
  const sub = path.join(repo, 'sub');
  const before = folderIconCacheSize();
  const url = await folderIcon(sub);
  assert.equal(url, fileUrl(path.join(repo, 'favicon.svg')));
  assert.match(url!, /^file:\/\/\/[A-Za-z]:\//);
  assert.equal(folderIconCacheSize(), before + 1);
  // The cached answer holds while the disk changes.
  fs.rmSync(path.join(repo, 'favicon.svg'));
  assert.equal(await folderIcon(sub), url);
  assert.equal(await folderIcon(sub.toUpperCase()), url);
  // A change at the root forgets the subfolder's answer read from it.
  folderIconForget(repo);
  assert.equal(folderIconCacheSize(), before);
  assert.equal(await folderIcon(sub), null);
  folderIconForget(sub);
  assert.equal(await folderIcon('relative/path'), null);
});

test('an answer is read again once it is a minute old (M9 fix 521)', async () => {
  const dir = tree({ '.git/HEAD': 'x', 'favicon.svg': 'one' });
  const url = fileUrl(path.join(dir, 'favicon.svg'));
  assert.equal(FOLDER_ICON_TTL_MS, 60_000);
  assert.equal(await folderIcon(dir, 0), url);
  fs.rmSync(path.join(dir, 'favicon.svg'));
  assert.equal(await folderIcon(dir, 59_999), url);
  assert.equal(await folderIcon(dir, 60_000), null);
});

// The repository search (M9 fix 1121, GitHub zacharykeeton/emerald#1). The
// worker's file is not there under node --test, so these hand in a runner
// that spawns git here, as git-count-lines.test.ts does.
type Call = { args: string[] };
function realGit(calls: Call[]) {
  return (args: string[], cwd: string, opts?: GitOptions): Promise<string | null> => {
    calls.push({ args });
    try {
      return Promise.resolve(
        execFileSync('git', args, { cwd, encoding: 'utf8', input: opts?.stdin ?? '', stdio: ['pipe', 'pipe', 'ignore'] }),
      );
    } catch {
      return Promise.resolve(null);
    }
  };
}

// A scratch repository with the files listed by --others (no commit).
function repo(files: Record<string, string>): string {
  const root = fs.realpathSync.native(tree(files));
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  return root;
}

test("the repository search finds the issue's icons: a Next src/app, Expo's assets/icon.png and build/icon.ico (M9 fix 1121)", async () => {
  const git = realGit([]);
  const next = repo({ 'src/app/favicon.ico': 'x' });
  assert.equal(await findFolderIcon(next, git), path.join(next, 'src', 'app', 'favicon.ico'));
  const expo = repo({ 'assets/icon.png': 'x' });
  assert.equal(await findFolderIcon(expo, git), path.join(expo, 'assets', 'icon.png'));
  const build = repo({ 'packages/app/build/icon.ico': 'x', 'packages/app/build/icon.png': 'y' });
  assert.equal(await findFolderIcon(build, git), path.join(build, 'packages', 'app', 'build', 'icon.ico'));
});

test('a monorepo package asking for its own icon gets its own (M9 fix 1121)', async () => {
  const git = realGit([]);
  const r = repo({ 'src/apps/web/src/app/favicon.ico': 'w', 'src/apps/admin/src/app/favicon.ico': 'a' });
  assert.equal(await findFolderIcon(path.join(r, 'src', 'apps', 'web'), git), path.join(r, 'src', 'apps', 'web', 'src', 'app', 'favicon.ico'));
  assert.equal(await findFolderIcon(path.join(r, 'src', 'apps', 'admin'), git), path.join(r, 'src', 'apps', 'admin', 'src', 'app', 'favicon.ico'));
  assert.equal(await findFolderIcon(r, git), path.join(r, 'src', 'apps', 'admin', 'src', 'app', 'favicon.ico'));
});

test('a fixture under test loses to the real icon, and an ignored favicon is not seen (M9 fix 1121)', async () => {
  const git = realGit([]);
  const a = repo({ 'test/favicon.ico': 't', 'assets/icon.png': 'i' });
  assert.equal(await findFolderIcon(a, git), path.join(a, 'assets', 'icon.png'));
  const b = repo({ '.gitignore': 'node_modules\n', 'node_modules/x/favicon.ico': 'n', 'assets/icon.png': 'i' });
  assert.equal(await findFolderIcon(b, git), path.join(b, 'assets', 'icon.png'));
  const c = repo({ 'assets/icon-close.svg': 's' });
  assert.equal(await findFolderIcon(c, git), null);
});

test('rankIconMatches orders by the six keys in turn (M9 fix 1121)', () => {
  assert.deepEqual(rankIconMatches(['docs/favicon.ico', 'a/b/c/icon.svg'], ''), ['a/b/c/icon.svg', 'docs/favicon.ico']);
  assert.deepEqual(rankIconMatches(['favicon.ico', 'pkg/x/icon.png'], 'pkg'), ['pkg/x/icon.png', 'favicon.ico']);
  assert.deepEqual(rankIconMatches(['assets/icon.ico', 'assets/favicon.svg'], ''), ['assets/favicon.svg', 'assets/icon.ico']);
  assert.deepEqual(rankIconMatches(['a/b/favicon.ico', 'a/favicon.png'], ''), ['a/favicon.png', 'a/b/favicon.ico']);
  assert.deepEqual(rankIconMatches(['x/favicon.svg', 'x/favicon.png', 'x/favicon.ico'], ''), ['x/favicon.ico', 'x/favicon.png', 'x/favicon.svg']);
  assert.deepEqual(rankIconMatches(['b/favicon.ico', 'a/favicon.ico'], ''), ['a/favicon.ico', 'b/favicon.ico']);
  assert.deepEqual(rankIconMatches(['Tests/Favicon.ICO', 'z/deep/er/icon.png'], ''), ['z/deep/er/icon.png', 'Tests/Favicon.ICO']);
});

test('a link anywhere on the path is skipped (M9 fix 1121)', async (t) => {
  const git = realGit([]);
  const outside = tree({ 'favicon.ico': 'o' });
  const r = repo({ 'assets/icon.png': 'i' });
  fs.symlinkSync(outside, path.join(r, 'linked'), 'junction');
  assert.equal(await findFolderIcon(r, git), path.join(r, 'assets', 'icon.png'));
  const r2 = repo({ 'assets/icon.png': 'i' });
  try {
    fs.symlinkSync(path.join(outside, 'favicon.ico'), path.join(r2, 'assets', 'favicon.ico'), 'file');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return t.skip('no symlink privilege');
    throw e;
  }
  assert.equal(await findFolderIcon(r2, git), path.join(r2, 'assets', 'icon.png'));
});

test('a folder outside any repository answers null with no git, and a fixed-list hit spawns none (M9 fix 1121)', async () => {
  const calls: Call[] = [];
  const git = realGit(calls);
  const bare = tree({ 'src/app/favicon.ico': 'x' });
  assert.equal(await findFolderIcon(bare, git), null);
  assert.equal(calls.length, 0);
  const r = repo({ 'public/favicon.svg': 's', 'src/app/favicon.ico': 'x' });
  assert.equal(await findFolderIcon(r, git), path.join(r, 'public', 'favicon.svg'));
  assert.equal(calls.length, 0);
});

test('a search answer is kept ten minutes, the fixed places still read every minute, and forget drops it (M9 fix 1121)', async () => {
  assert.equal(FOLDER_ICON_SEARCH_TTL_MS, 600_000);
  const calls: Call[] = [];
  const git = realGit(calls);
  const dir = repo({ 'src/app/favicon.ico': 'ico' });
  const searched = fileUrl(path.join(dir, 'src', 'app', 'favicon.ico'));
  assert.equal(await folderIcon(dir, 0, git), searched);
  assert.equal(calls.length, 1);
  assert.equal(await folderIcon(dir, 60_000, git), searched);
  assert.equal(calls.length, 1);
  fs.writeFileSync(path.join(dir, 'favicon.ico'), 'root');
  assert.equal(await folderIcon(dir, 120_000, git), fileUrl(path.join(dir, 'favicon.ico')));
  assert.equal(calls.length, 1);
  fs.rmSync(path.join(dir, 'favicon.ico'));
  assert.equal(await folderIcon(dir, 600_000, git), searched);
  assert.equal(calls.length, 2);
  folderIconForget(dir);
  assert.equal(await folderIcon(dir, 600_001, git), searched);
  assert.equal(calls.length, 3);
});
