// Builds the public code from the working repository (M9 fixes 611 and
// 660): the tracked tree less what scripts/public-exclude.txt names, scanned
// for secrets before anything is written and committed under the address
// the remote repositories use. Two modes, and neither pushes; the review and
// the push are the user's.
//
// A plain run copies the kept files into an empty folder outside the
// checkout and commits them as one fresh commit, for reading. --update
// clones the public repository, replaces its tree with the same files and
// commits `Emerald <version>` on top of its last commit, so each release is
// one commit on the public history.
//
//   node scripts/export-public.mjs --list                 print the kept paths, nothing else
//   node scripts/export-public.mjs [--out <folder>]       export (default ../emerald-export)
//                                  [--update]             commit on the public history instead (default ../emerald-public)
//                                  [--remote <url>]       with --update: the repository to clone (default the public emerald)
//                                  [--force]              replace an earlier export or clone there
//                                  [--allow <finding>]... export despite a finding's hits
//                                  [--version <v>]        name the version; needed while a batch is in flight
//                                  [--verbose]            list the reported-only findings' lines too
//
// It runs from any folder of the checkout. The copy is taken from the
// working tree, so it refuses a tree with changes to tracked files; only
// `git ls-files` paths are read, so untracked and ignored files never
// matter. The pattern matcher in export-public-lib.mjs is checked against
// git's own reading of the list on every run.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FINDINGS, MAPPED, batchInFlight, decide, isBinary, parsePatterns, scanText } from './export-public-lib.mjs';
import { buildNotices } from './third-party-notices.mjs';

const USAGE =
  'usage: node scripts/export-public.mjs [--update [--remote <url>]] [--out <folder>] [--force] [--allow <finding>]... [--version <v>] [--verbose] | --list';
const AUTHOR_NAME = 'Zachary Keeton';
const AUTHOR_EMAIL = 'zachary.keeton@gmail.com';
const PUBLIC_REMOTE = 'https://github.com/zacharykeeton/emerald.git';
// gh's credential for the one command: the box's git protocol is ssh, and
// the system credential manager would raise a sign-in window.
const CREDENTIAL = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];

function git(args, cwd, opts = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}

function fail(line) {
  console.error(`export-public: ${line}`);
  process.exit(1);
}

function usage() {
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { list: false, update: false, remote: null, out: null, force: false, allow: new Set(), version: null, verbose: false };
  const names = new Set([...FINDINGS.map((f) => f.name), 'gitleaks']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.list = true;
    else if (a === '--update') opts.update = true;
    else if (a === '--remote' && i + 1 < argv.length) opts.remote = argv[++i];
    else if (a === '--force') opts.force = true;
    else if (a === '--out' && i + 1 < argv.length) opts.out = argv[++i];
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--version' && i + 1 < argv.length) {
      opts.version = argv[++i];
      if (!/^\d+\.\d+\.\d+$/.test(opts.version)) usage();
    } else if (a === '--allow' && i + 1 < argv.length) {
      const name = argv[++i];
      if (!names.has(name)) usage();
      opts.allow.add(name);
    } else usage();
  }
  // --list stands alone, and --remote goes with --update only.
  if (
    opts.list &&
    (opts.out !== null || opts.force || opts.allow.size > 0 || opts.version !== null || opts.verbose || opts.update || opts.remote !== null)
  ) {
    usage();
  }
  if (opts.remote !== null && !opts.update) usage();
  return opts;
}

// True when `child` is `parent` or sits under it. path.relative compares
// without case on Windows.
function within(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function removeExport(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // git writes its objects read-only, which Windows refuses to delete.
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else fs.chmodSync(p, 0o666);
      }
    };
    walk(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The kept files at their own paths and each mapped source at its export
// name.
function copyKept(root, kept, out) {
  const pairs = [...kept.map((f) => [f, f]), ...MAPPED.map((m) => [m.from, m.to])];
  for (const [from, to] of pairs) {
    const dest = path.join(out, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, from), dest);
  }
}

function gitleaks(out, opts) {
  if (spawnSync('where', ['gitleaks'], { stdio: 'ignore' }).status === 0) {
    const leaks = spawnSync('gitleaks', ['detect', '--no-git', '-s', out], { encoding: 'utf8' });
    process.stdout.write(leaks.stdout ?? '');
    process.stdout.write(leaks.stderr ?? '');
    if (leaks.status !== 0 && !opts.allow.has('gitleaks')) {
      fail('gitleaks found leaks; nothing committed. Pass --allow gitleaks to commit anyway');
    }
  } else {
    console.log('export-public: gitleaks is not on the PATH; the scan above is the only one');
  }
}

function checkCount(out, kept) {
  const want = [...kept, ...MAPPED.map((m) => m.to)];
  const taken = git(['ls-files', '-z'], out).split('\0').filter((f) => f !== '');
  if (taken.length !== want.length) {
    const have = new Set(taken);
    const missing = want.find((f) => !have.has(f));
    fail(`the new repository took ${taken.length} of ${want.length} files; first missing ${missing}`);
  }
}

function run() {
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(git(['rev-parse', '--show-toplevel'], process.cwd()).trim());

  const files = git(['ls-files', '-z'], root).split('\0').filter((f) => f !== '');
  const listText = fs.readFileSync(path.join(root, 'scripts', 'public-exclude.txt'), 'utf8');
  const patterns = parsePatterns(listText);
  const counts = new Map(patterns.map((p) => [p, 0]));
  const kept = [];
  const ours = new Set();
  for (const f of files) {
    const p = decide(patterns, f);
    if (p) counts.set(p, counts.get(p) + 1);
    if (p && !p.negate) ours.add(f);
    else kept.push(f);
  }

  // git's own reading of the same list; any path where the two differ
  // means the matcher is wrong, and the export would be too.
  const theirs = new Set(
    git(['ls-files', '-z', '-c', '-i', '--exclude-from=scripts/public-exclude.txt'], root)
      .split('\0')
      .filter((f) => f !== ''),
  );
  for (const f of new Set([...ours, ...theirs])) {
    if (ours.has(f) !== theirs.has(f)) {
      fail(`the pattern matcher and git disagree on ${f}; fix export-public-lib.mjs before exporting`);
    }
  }

  // --list prints the export's own paths, so its line count is the file count.
  if (opts.list) {
    for (const f of kept) console.log(f);
    for (const m of MAPPED) console.log(m.to);
    process.exit(0);
  }

  if (git(['status', '--porcelain', '--untracked-files=no'], root).trim() !== '') {
    fail('the tree has changes to tracked files; commit or stash them first');
  }

  // The version in package.json is the last batch's until its docs commit
  // bumps it (fix 642), so an export in between would be mistitled.
  if (opts.version === null) {
    const planPath = path.join(root, 'docs', 'PLAN.md');
    const flight = batchInFlight(fs.existsSync(planPath) ? fs.readFileSync(planPath, 'utf8') : '');
    if (flight !== null) {
      fail(`fixes ${flight.first} to ${flight.last} are in flight; export after their docs commit bumps the version`);
    }
  }

  // The published code ships its dependencies' licences (fix 660): a package
  // off the allow list stops the export first, then a notices file that no
  // longer matches the lock.
  const notices = buildNotices(root);
  if (notices.refused.length > 0) {
    const r = notices.refused[0];
    fail(`${r.name} ${r.version} is under ${r.licence || 'no licence'}, which is not on the allow list (scripts/third-party-notices-lib.mjs); nothing written`);
  }
  const noticesPath = path.join(root, 'THIRD-PARTY-NOTICES.md');
  const noticesNow = fs.existsSync(noticesPath) ? fs.readFileSync(noticesPath, 'utf8').replace(/\r\n/g, '\n') : null;
  if (noticesNow !== notices.text) {
    fail('THIRD-PARTY-NOTICES.md is stale; run node scripts/third-party-notices.mjs and commit it');
  }

  // Never ../emerald-code: that is the clone of the archived private
  // repository, which a --force here would delete.
  const defaultOut = opts.update ? 'emerald-public' : 'emerald-export';
  const out = opts.out !== null ? path.resolve(process.cwd(), opts.out) : path.resolve(root, '..', defaultOut);
  if (within(root, out) || within(out, root)) {
    fail(`${out} is inside the checkout or holds it; pick a folder outside it`);
  }
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
    if (!opts.force) fail(`${out} is not empty; pass --force to replace an earlier export`);
    if (!fs.existsSync(path.join(out, '.git'))) {
      fail(`${out} is not empty and holds no earlier export (.git); pick another --out`);
    }
    removeExport(out);
  }

  for (const m of MAPPED) {
    if (!fs.existsSync(path.join(root, m.from))) fail(`${m.from} is missing; it becomes the export's ${m.to}`);
  }

  // The scan reads the kept files from the checkout before anything is
  // written, so a stop leaves no half-made folder behind. A mapped file's
  // hits carry its source path, the file to edit.
  const hits = [];
  let text = 0;
  let binary = 0;
  for (const f of [...kept, ...MAPPED.map((m) => m.from)]) {
    const buf = fs.readFileSync(path.join(root, f));
    if (isBinary(buf)) {
      binary++;
      continue;
    }
    text++;
    hits.push(...scanText(f, buf.toString('utf8')));
  }
  // Only the lines that stop the export (or that --allow passed) are listed;
  // the reported-only kinds are fixtures the person kept on purpose (fix 643).
  for (const h of hits) if (h.fails || opts.verbose) console.log(`${h.file}:${h.line}: ${h.name}`);
  const summary = [];
  for (const finding of FINDINGS) {
    const mine = hits.filter((h) => h.name === finding.name);
    if (mine.length === 0) continue;
    const inFiles = new Set(mine.map((h) => h.file)).size;
    const tail = finding.fails
      ? '(stops the export)'
      : opts.verbose
        ? '(reported only)'
        : '(reported only; --verbose lists them)';
    summary.push(`export-public: ${finding.name}: ${mine.length} lines in ${inFiles} files ${tail}`);
  }
  summary.push(`export-public: scanned ${text} text files, skipped ${binary} binary`);
  const stopping = hits.filter((h) => h.fails && !opts.allow.has(h.name));
  if (stopping.length > 0) {
    const names = [...new Set(stopping.map((h) => h.name))].join(', ');
    fail(`stopped on ${stopping.length} findings (${names}); nothing written. Pass --allow <name> for each to export anyway`);
  }

  const version = opts.version ?? JSON.parse(fs.readFileSync(path.join(root, 'packages', 'app', 'package.json'), 'utf8')).version;
  const head = git(['rev-parse', 'HEAD'], root).trim().slice(0, 12);
  // The environment wins over every git config, the global address included.
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: AUTHOR_NAME,
    GIT_COMMITTER_NAME: AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
    GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
  };
  const printSummary = () => {
    console.log(`export-public: copied ${kept.length + MAPPED.length} files to ${out}`);
    console.log(`export-public: left out ${ours.size} files by ${patterns.length} patterns`);
    for (const p of patterns) console.log(`  ${String(counts.get(p)).padStart(4)}  ${p.text}`);
    for (const s of summary) console.log(s);
  };

  if (!opts.update) {
    copyKept(root, kept, out);
    gitleaks(out, opts);
    git(['init', '-q', '-b', 'main'], out);
    git(['add', '-A'], out);
    checkCount(out, kept);
    const message =
      `Emerald ${version}\n\n` +
      `The working repository's tree at ${head}, squashed into one commit by\n` +
      `scripts/export-public.mjs, less the files scripts/public-exclude.txt names.\n`;
    git(['commit', '-q', '-F', '-'], out, { input: message, env });
    const short = git(['rev-parse', '--short', 'HEAD'], out).trim();
    printSummary();
    console.log(`export-public: committed ${short} as ${AUTHOR_NAME} <${AUTHOR_EMAIL}>`);
    console.log('export-public: nothing is pushed; this is a fresh repository for reading. --update puts the same tree on the public repository\'s history.');
    process.exit(0);
  }

  const remote = opts.remote ?? PUBLIC_REMOTE;
  const cloneEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const clone = spawnSync('git', [...CREDENTIAL, 'clone', '-q', remote, out], { env: cloneEnv, stdio: ['ignore', 'inherit', 'inherit'] });
  if (clone.status !== 0) fail(`the clone of ${remote} failed; nothing written`);
  const hasHead = spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: out, stdio: 'ignore' }).status === 0;
  // An empty repository: name its first branch main.
  if (!hasHead) git(['symbolic-ref', 'HEAD', 'refs/heads/main'], out);
  const branch = git(['symbolic-ref', '--short', 'HEAD'], out).trim();
  const parent = hasHead ? git(['rev-parse', '--short', 'HEAD'], out).trim() : null;
  for (const name of fs.readdirSync(out)) {
    if (name !== '.git') removeExport(path.join(out, name));
  }
  copyKept(root, kept, out);
  gitleaks(out, opts);
  git(['add', '-A'], out);
  checkCount(out, kept);
  if (git(['status', '--porcelain'], out).trim() === '') {
    console.log(`export-public: ${branch} already holds this tree; nothing committed`);
    process.exit(0);
  }
  const message =
    `Emerald ${version}\n\n` +
    `The working repository's tree at ${head}, less the files scripts/public-exclude.txt names,\n` +
    `copied over the last public commit by scripts/export-public.mjs --update.\n`;
  git(['commit', '-q', '-F', '-'], out, { input: message, env });
  const short = git(['rev-parse', '--short', 'HEAD'], out).trim();
  printSummary();
  console.log(
    `export-public: committed ${short} "Emerald ${version}" on top of ${parent ?? 'nothing (the first commit)'} as ${AUTHOR_NAME} <${AUTHOR_EMAIL}>`,
  );
  console.log(`export-public: nothing is pushed. After the review, from ${out}:`);
  console.log(`  git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin HEAD:${branch}`);
  process.exit(0);
}

run();
