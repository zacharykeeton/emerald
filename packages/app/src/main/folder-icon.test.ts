import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { FOLDER_ICON_TTL_MS, fileUrl, findFolderIcon, folderIcon, folderIconCacheSize, folderIconForget, iconLinkHref } from './folder-icon.ts';

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
