// Creates or resets the emerald demo repository from the template in
// demo/repo: one commit on main, tagged demo-start, no other branches, no
// worktrees, the template's files as they are now. Run it before an
// audience so the graph starts clean, and after a template change so the
// skills in the demo repository are the current ones.
//
//   npm run demo                 ../emerald-demo beside this checkout
//   npm run demo -- C:\x\demo    somewhere else
//   npm run demo -- --force      even with worktrees still registered
//
// A repository with worktrees registered is a batch demo still running,
// or one that died, and a reset then pulls the folders out from under
// its agents; it refuses unless forced, a reset having done just that to
// a live run once.
//
// A reset keeps the folder and its .git and rewrites the history in place
// (checkout, reset, clean, amend) rather than deleting .git, since the app
// watches the gitdir of any repository a session sits in and a session's
// shell may have the folder as its cwd; nothing here removes the folder.
// The sidebar rows of earlier demo sessions are the user's to remove.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const template = path.join(here, 'repo');
const args = process.argv.slice(2);
const force = args.includes('--force');
const target = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(here, '..', '..', 'emerald-demo'));
const worktrees = `${target}-wt`;
const TAG = 'demo-start';

function git(args, opts = {}) {
  return execFileSync('git', ['-C', target, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'inherit'] }).trim();
}
function tryGit(args) {
  try {
    return git(args, { quiet: true });
  } catch {
    return null;
  }
}

// The template's files as git names them in the demo repository: relative,
// forward slashes, so a `git ls-files` line compares whole.
function listTemplate(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listTemplate(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}
const templateFiles = new Set(listTemplate(template));

// rmSync tried `tries` times, `delayMs` apart, saying once that it is
// waiting; null when the folder is gone, the last error otherwise. The
// script is synchronous end to end, so the wait is a blocking one.
function removeWithPatience(folder, tries, delayMs) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      rmSync(folder, { recursive: true, force: true });
      if (i > 0) console.error(`${folder} released after ${i + 1} tries`);
      return null;
    } catch (err) {
      if (i === 0) console.error(`${folder} is held open (${err.code}); waiting up to ${(tries * delayMs) / 1000} s for it`);
      last = err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
  return last;
}

const isRepo = existsSync(path.join(target, '.git'));
if (isRepo) {
  if (tryGit(['rev-parse', '--verify', `refs/tags/${TAG}`]) === null) {
    console.error(`${target} is a git repository without the ${TAG} tag, so it is not the demo repository; not touching it.`);
    process.exit(1);
  }
  const registered = (tryGit(['worktree', 'list', '--porcelain']) ?? '').split(/\r?\n/).filter((l) => l.startsWith('worktree ')).length - 1;
  if (registered > 0 && !force) {
    console.error(`${target} has ${registered} worktree(s) registered, so a batch demo may still be running there; pass --force to reset anyway.`);
    process.exit(1);
  }
  // Worktrees first, while the branches they hold still exist. A folder a
  // shell still holds open cannot be removed: a collide shell's conpty
  // teardown outlives the daemon stop by seconds (M9 fix 350), so the
  // removal is tried every half second for ten seconds (Node's own
  // maxRetries on rmSync does not fire for the EPERM a held folder gives;
  // it failed in 0 ms with twenty asked for), and a folder that still will
  // not go is moved aside under a stale name so the next demo's `git
  // worktree add` on the same names finds its folder free. A folder that is
  // some process's working directory refuses the rename too (EPERM on the
  // parent, EBUSY on the folder itself); then the empty folders are left,
  // which `git worktree add` accepts, and the message says so.
  if (existsSync(worktrees)) {
    for (const name of readdirSync(worktrees)) tryGit(['worktree', 'remove', '--force', path.join(worktrees, name)]);
    const err = removeWithPatience(worktrees, 20, 500);
    if (err !== null) {
      const aside = `${worktrees}-stale-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}`;
      try {
        renameSync(worktrees, aside);
        console.error(`could not remove ${worktrees} (${err.code}); moved it aside to ${aside}, remove that by hand later`);
      } catch (err2) {
        console.error(`could not remove ${worktrees} (${err.code}) or move it aside (${err2.code}); something still holds it open, remove it by hand later (an empty folder left there does not block the next git worktree add)`);
      }
    }
  }
  tryGit(['worktree', 'prune']);
  git(['checkout', '-q', '-f', '-B', 'main', TAG]);
  git(['reset', '-q', '--hard', TAG]);
  git(['clean', '-fdxq']);
  for (const branch of git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).split(/\r?\n/)) {
    if (branch !== '' && branch !== 'main') git(['branch', '-q', '-D', branch]);
  }
  // The copy lays the template over the repository and never removes what
  // the template dropped (a renamed skill folder survived that way, M9 fix
  // 349), so every tracked path the template no longer has goes first.
  const dropped = git(['ls-files']).split(/\r?\n/).filter((p) => p !== '' && !templateFiles.has(p));
  if (dropped.length > 0) git(['rm', '-q', '--', ...dropped]);
  cpSync(template, target, { recursive: true, force: true });
  git(['add', '-A']);
  if (git(['status', '--porcelain']) !== '') {
    git(['commit', '-q', '--amend', '--no-edit', '--allow-empty']);
    git(['tag', '-f', TAG], { quiet: true });
    console.log('template changed; the start commit was rewritten');
  }
} else {
  if (existsSync(target) && readdirSync(target).length > 0) {
    console.error(`${target} exists and is not empty; not touching it.`);
    process.exit(1);
  }
  mkdirSync(target, { recursive: true });
  cpSync(template, target, { recursive: true, force: true });
  git(['init', '-q', '-b', 'main']);
  // The template is LF; without this the global autocrlf warns on every
  // file at each add.
  git(['config', 'core.autocrlf', 'false']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'orchard: the demo repository']);
  git(['tag', TAG]);
}

console.log(`demo repository: ${target}`);
console.log(`start commit:    ${git(['log', '-1', '--format=%h %s'])}`);
console.log(`worktrees go in: ${worktrees}`);
console.log('open a Claude session in that folder from emerald and type /demo-solo, /demo-batch, /demo-supervise, /collide or /burn');
