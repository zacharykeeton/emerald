// Tests for scripts/export-public-lib.mjs (M9 fix 611). Run by hand:
//
//   node --test scripts/export-public.test.mjs
//
// Every fixture that would hit a finding is built by concatenation, so this
// file scans clean under the rules it tests (the last case checks that).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FINDINGS, MAPPED, batchInFlight, decide, isBinary, isExcluded, parsePatterns, scanText } from './export-public-lib.mjs';
import { BUNDLED_DEV, allowedUnder, renderNotices } from './third-party-notices-lib.mjs';
import { buildNotices } from './third-party-notices.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const BS = String.fromCharCode(92);

function names(text) {
  return scanText('f', text).map((h) => h.name);
}

// Scratch folders made by the cases below, removed at the end. git writes
// its objects read-only, which Windows refuses to delete, so they are made
// writable first as export-public.mjs's removeExport does.
const scratch = [];
function tempDir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `export-660-${tag}-`));
  scratch.push(d);
  return d;
}
function removeTree(dir) {
  if (!fs.existsSync(dir)) return;
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
after(() => {
  for (const d of scratch) removeTree(d);
});

const GIT_ID = ['-c', 'user.name=Test', '-c', 'user.email=test@example.test'];
const FIXTURE_NOTES = '# CLAUDE.md\n\nThe contributor notes of a fixture.\n';
const FIXTURE_LOCK =JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'fixture' } } });

function writeFiles(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}

// A committed scratch repository holding `files` over the defaults every
// export needs: an exclude list, a lock and notices that match it.
function fixtureRepo(files = {}) {
  const dir = tempDir('repo');
  writeFiles(dir, {
    'scripts/public-exclude.txt': '# fixture\n/secret-notes.md\n/scripts/public/\n',
    'scripts/public/CLAUDE.md': FIXTURE_NOTES,
    'package-lock.json': FIXTURE_LOCK,
    'THIRD-PARTY-NOTICES.md': renderNotices([]),
    ...files,
  });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  commitAll(dir, 'fixture');
  return dir;
}

function commitAll(dir, message) {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', [...GIT_ID, 'commit', '-q', '-m', message], { cwd: dir });
}

function exportIn(cwd, ...args) {
  const r = spawnSync(process.execPath, [path.join(here, 'export-public.mjs'), ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

test('batchInFlight reads the plan heading of a batch in flight and nothing else', () => {
  const plan = '# Plan\n\n## M9 tasks, fixes 620 to 644, the export and the trash (each is one sitting unless said)\n\n### fix 620: x\n';
  assert.deepEqual(batchInFlight(plan), { first: 620, last: 644 });
  assert.equal(batchInFlight('## Milestones\n\n### fix 620: x\n'), null);
  assert.equal(batchInFlight('the `## M9 tasks, fixes 1 to 2` section\n'), null);
  assert.equal(batchInFlight('  ## M9 tasks, fixes 1 to 2\n'), null);
});

test('parsePatterns skips comments and blanks and keeps line numbers', () => {
  const ps = parsePatterns('# a comment\n\n/docs/design/\n  !/docs/x.md  \n*.log\n');
  assert.deepEqual(
    ps.map((p) => [p.line, p.text, p.negate, p.dirOnly]),
    [
      [3, '/docs/design/', false, true],
      [4, '!/docs/x.md', true, false],
      [5, '*.log', false, false],
    ],
  );
});

test('an anchored folder keeps the same name deeper down; an unanchored one takes both', () => {
  const anchored = parsePatterns('/.claude/');
  assert.equal(isExcluded(anchored, '.claude/agents/emerald-batch-dev.md'), true);
  assert.equal(isExcluded(anchored, 'demo/repo/.claude/settings.json'), false);
  const loose = parsePatterns('.claude/');
  assert.equal(isExcluded(loose, '.claude/agents/emerald-batch-dev.md'), true);
  assert.equal(isExcluded(loose, 'demo/repo/.claude/settings.json'), true);
});

test('a file under an excluded folder cannot be brought back; under a star it can', () => {
  const folder = parsePatterns('docs/\n!docs/WHATS-NEW.md');
  assert.equal(isExcluded(folder, 'docs/WHATS-NEW.md'), true);
  const star = parsePatterns('/docs/*\n!/docs/WHATS-NEW.md');
  assert.equal(isExcluded(star, 'docs/WHATS-NEW.md'), false);
  assert.equal(decide(star, 'docs/WHATS-NEW.md').negate, true);
  assert.equal(isExcluded(star, 'docs/design/x.md'), true);
  assert.equal(isExcluded(star, 'docs/PLAN.md'), true);
  assert.equal(isExcluded(star, 'README.md'), false);
});

test('a star stays in its segment and a double star does not', () => {
  const one = parsePatterns('/packages/*.md');
  assert.equal(isExcluded(one, 'packages/a.md'), true);
  assert.equal(isExcluded(one, 'packages/app/a.md'), false);
  const two = parsePatterns('/packages/**/a.md');
  assert.equal(isExcluded(two, 'packages/a.md'), true);
  assert.equal(isExcluded(two, 'packages/app/src/a.md'), true);
  const q = parsePatterns('/a?.txt');
  assert.equal(isExcluded(q, 'ab.txt'), true);
  assert.equal(isExcluded(q, 'a/.txt'), false);
});

test('the real list over the real tree decides what git decides', () => {
  const opts = { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 };
  const files = execFileSync('git', ['ls-files', '-z'], opts).split('\0').filter((f) => f !== '');
  const gits = execFileSync('git', ['ls-files', '-z', '-c', '-i', '--exclude-from=scripts/public-exclude.txt'], opts)
    .split('\0')
    .filter((f) => f !== '');
  const patterns = parsePatterns(fs.readFileSync(path.join(root, 'scripts', 'public-exclude.txt'), 'utf8'));
  const ours = files.filter((f) => isExcluded(patterns, f));
  assert.deepEqual(new Set(ours), new Set(gits));
  assert.ok(ours.length > 0);
});

test('each stopping finding hits its own fixture alone', () => {
  const fixtures = {
    'work-email': 'mail me at someone' + '@' + 'emergentsoftware' + '.net today',
    'github-token': "const t = '" + 'ghp' + '_' + 'A1b2'.repeat(9) + "';",
    'anthropic-key': 'key: ' + 'sk' + '-ant-' + 'api03' + 'x'.repeat(30),
    'api-key': 'OPENAI=' + 'sk' + '-' + 'Ab3'.repeat(10),
    'aws-key': 'id ' + 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP' + ' end',
    'private-key': '-----BEGIN ' + 'RSA ' + 'PRIVATE KEY' + '-----',
    'secret-assignment': 'https://x.test/?pass' + 'word=' + 'hunter2hunter2',
    'home-path': 'C:' + BS + 'Users' + BS + 'Zachary' + 'Keeton' + BS + 'code',
    'box-worktrees': 'cd ../' + 'zorca' + '-wt/m61',
    'box-address': 'ssh ' + '10.10' + '.10.3',
  };
  for (const f of FINDINGS.filter((x) => x.fails)) {
    assert.ok(fixtures[f.name], `a fixture for ${f.name}`);
    assert.deepEqual(names(fixtures[f.name]), [f.name], f.name);
  }
  assert.deepEqual(names('DESKTOP-' + 'H4S0JKJ'), ['box-address']);
  assert.equal(scanText('f', fixtures['github-token'])[0].fails, true);
});

test('the known harmless lines give no hit', () => {
  const misses = [
    'const token = readToken(log)',
    "const TOKEN = 'verify-token-m15'",
    'set "HOOKTOKEN=%%~b"',
    "const pipe = '" + BS.repeat(4) + '.' + BS.repeat(2) + 'pipe' + BS.repeat(2) + "x';",
    "const p = 'C:" + BS.repeat(2) + 'repo' + BS.repeat(2) + "a';",
    'password=${SECRET_VALUE_HERE}',
    'host 10.10' + '.10.30',
    'C:/Users/me/code',
  ];
  for (const m of misses) assert.deepEqual(names(m), [], m);
});

test('a UNC share is reported only; the three home spellings stop the export', () => {
  const raw = BS + BS + 'server' + BS + 'share' + BS + 'f.txt';
  const escaped = "'" + BS.repeat(4) + 'server' + BS.repeat(2) + "share'";
  assert.deepEqual(names(raw), ['unc-path']);
  assert.deepEqual(names(escaped), ['unc-path']);
  const homes = [
    'C:' + BS + 'Users' + BS + 'Zachary' + 'Keeton' + BS + 'code',
    'c:/Users/' + 'Zachary' + 'Keeton/code',
    '/c' + '/Users/' + 'Zachary' + 'Keeton/code',
    'C:' + BS + 'Users' + BS + 'ZACHAR' + '~1' + BS + 'AppData',
  ];
  for (const h of homes) assert.deepEqual(names(h), ['home-path'], h);
  assert.equal(scanText('f', homes[0])[0].fails, true);
  assert.equal(scanText('f', raw)[0].fails, false);
});

test('the kept tree has no failing finding', () => {
  const opts = { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 };
  const files = execFileSync('git', ['ls-files', '-z'], opts).split('\0').filter((f) => f !== '');
  const patterns = parsePatterns(fs.readFileSync(path.join(root, 'scripts', 'public-exclude.txt'), 'utf8'));
  const failing = [];
  for (const f of files) {
    if (isExcluded(patterns, f)) continue;
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    if (isBinary(buf)) continue;
    for (const h of scanText(f, buf.toString('utf8'))) if (h.fails) failing.push(`${h.file}:${h.line}: ${h.name}`);
  }
  assert.deepEqual(failing, [], failing.join('\n'));
});

test('excluded-ref reports a pointer into a left-out file and stops nothing', () => {
  for (const hit of ['see docs/' + 'PLAN.md, repo layout', 'docs/' + 'design/pace-bars.md', '.claude/' + 'skills/batch/tests.ps1', 'migrate-from-' + 'zorca.ps1']) {
    assert.deepEqual(names(hit), ['excluded-ref'], hit);
    assert.equal(scanText('f', hit)[0].fails, false, hit);
  }
  for (const miss of ['~/.claude/skills/emmer-cli', 'docs/HANDBOOK.md', 'docs/WHATS-NEW.md']) {
    assert.deepEqual(names(miss), [], miss);
  }
});

test('a NUL in the first 8192 bytes is binary', () => {
  assert.equal(isBinary(Buffer.from('plain text')), false);
  assert.equal(isBinary(Buffer.from([65, 0, 66])), true);
  const late = Buffer.alloc(9000, 65);
  late[8500] = 0;
  assert.equal(isBinary(late), false);
});

test('the lib and this file scan clean under their own rules', () => {
  for (const f of ['export-public-lib.mjs', 'export-public.test.mjs', 'export-public.mjs', 'public-exclude.txt']) {
    const text = fs.readFileSync(path.join(here, f), 'utf8');
    // The list names every left-out path by design, and the lib and the
    // tests name a few; that finding stops nothing.
    assert.deepEqual(scanText(f, text).filter((h) => h.name !== 'excluded-ref'), [], f);
  }
});

test('allowedUnder names the licence a package is used under, or null', () => {
  assert.equal(allowedUnder('MIT'), 'MIT');
  assert.equal(allowedUnder('(MPL-2.0 OR Apache-2.0)'), 'Apache-2.0');
  assert.equal(allowedUnder('(BSD-3-Clause AND Apache-2.0)'), '(BSD-3-Clause AND Apache-2.0)');
  assert.equal(allowedUnder('Unlicense'), 'Unlicense');
  assert.equal(allowedUnder('EPL-2.0'), 'EPL-2.0');
  for (const no of [
    'GPL-3.0-only',
    'LGPL-2.1-or-later',
    'MPL-2.0',
    'MIT AND GPL-2.0-only',
    'Apache-2.0 WITH LLVM-exception',
    'UNLICENSED',
    'SEE LICENSE IN LICENSE',
    '',
    undefined,
  ]) {
    assert.equal(allowedUnder(no), null, String(no));
  }
});

// A package folder under node_modules with its package.json and, when
// given, a licence file.
function fakePackage(dir, name, licence, licenceText) {
  const files = { [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: '1.0.0', license: licence }) };
  if (licenceText) files[`node_modules/${name}/LICENSE`] = licenceText;
  writeFiles(dir, files);
}

test('buildNotices counts the runtime tree and the bundled dev closure, and refuses a copyleft package', () => {
  const dir = tempDir('notices');
  const lock = {
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture' },
      'node_modules/a': { version: '1.0.0', license: 'MIT' },
      'node_modules/b': { version: '1.0.0', license: 'ISC' },
      'node_modules/gpl-thing': { version: '1.0.0', license: 'GPL-3.0-only' },
      'node_modules/d': { version: '1.0.0', license: 'GPL-3.0-only', dev: true },
      'node_modules/monaco-editor': { version: '1.0.0', license: 'MIT', dev: true, dependencies: { dompurify: '1.0.0' } },
      'node_modules/dompurify': { version: '1.0.0', license: '(MPL-2.0 OR Apache-2.0)', dev: true },
    },
  };
  writeFiles(dir, { 'package-lock.json': JSON.stringify(lock) });
  fakePackage(dir, 'a', 'MIT', 'the a licence');
  fakePackage(dir, 'b', 'ISC');
  fakePackage(dir, 'gpl-thing', 'GPL-3.0-only', 'copyleft');
  fakePackage(dir, 'd', 'GPL-3.0-only', 'copyleft');
  fakePackage(dir, 'monaco-editor', 'MIT', 'the editor licence');
  fakePackage(dir, 'dompurify', '(MPL-2.0 OR Apache-2.0)', 'the purifier licence');
  const got = buildNotices(dir);
  assert.deepEqual(got.refused, [{ name: 'gpl-thing', version: '1.0.0', licence: 'GPL-3.0-only' }]);
  assert.match(got.text, /^## a 1\.0\.0$/m);
  assert.match(got.text, /^## b 1\.0\.0\n\nLicence: ISC\n\nNo licence file ships in the package; its package\.json names ISC\.$/m);
  assert.match(got.text, /^## dompurify 1\.0\.0\n\nLicence: \(MPL-2\.0 OR Apache-2\.0\), used under Apache-2\.0$/m);
  assert.doesNotMatch(got.text, /^## d /m);
  assert.equal(got.count, 5);
});

test('buildNotices reads an MIT licence off the file when package.json names none, and names an EPL package\'s source', () => {
  const dir = tempDir('notices-file');
  const lock = {
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture' },
      'node_modules/khroma': { version: '1.0.0' },
      'node_modules/elkjs': { version: '1.0.0', license: 'EPL-2.0' },
      'node_modules/nameless': { version: '1.0.0' },
    },
  };
  writeFiles(dir, {
    'package-lock.json': JSON.stringify(lock),
    'node_modules/khroma/package.json': JSON.stringify({ name: 'khroma', version: '1.0.0' }),
    'node_modules/khroma/license': 'The MIT License (MIT)\n\nCopyright (c) someone',
    'node_modules/elkjs/package.json': JSON.stringify({ name: 'elkjs', version: '1.0.0', license: 'EPL-2.0', repository: { type: 'git', url: 'git+https://github.com/kieler/elkjs.git' } }),
    'node_modules/elkjs/LICENSE.md': 'Eclipse Public License - v 2.0',
    'node_modules/nameless/package.json': JSON.stringify({ name: 'nameless', version: '1.0.0' }),
    'node_modules/nameless/LICENSE': 'All rights reserved.',
  });
  const got = buildNotices(dir);
  assert.deepEqual(got.refused, [{ name: 'nameless', version: '1.0.0', licence: '' }]);
  assert.match(got.text, /^## khroma 1\.0\.0\n\nLicence: MIT, read off its licence file \(its package\.json names none\)$/m);
  assert.match(got.text, /^## elkjs 1\.0\.0\n\nLicence: EPL-2\.0\n\nShipped unmodified; its source is at https:\/\/github\.com\/kieler\/elkjs\.$/m);
});

test('the real tree ships nothing off the allow list and its notices are current', () => {
  const got = buildNotices(root);
  assert.deepEqual(got.refused, []);
  const committed = fs.readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(committed, got.text, 'THIRD-PARTY-NOTICES.md is stale; run node scripts/third-party-notices.mjs');
});

// The renderer's bundled dev packages are listed by hand in BUNDLED_DEV; a
// devDependency the app starts importing would be left out of the notices
// with nothing failing, so this reads the app's own specifiers and compares.
function appSpecifiers() {
  const base = path.join(root, 'packages', 'app', 'src');
  const found = new Set();
  const forms = [
    /^\s*(import|export)\s+(type\s+)?[^;'"]*?\sfrom\s+['"]([^'"]+)['"]/gm,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /(typeof\s+)?\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const rel of fs.readdirSync(base, { recursive: true })) {
    const f = String(rel).split(BS).join('/');
    if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f) || f === 'renderer/src/test-support.ts') continue;
    const text = fs.readFileSync(path.join(base, f), 'utf8');
    const add = (spec) => {
      if (/^(\.|\/|node:)/.test(spec)) return;
      const bare = spec.split('?')[0].split('/');
      found.add(bare[0].startsWith('@') ? bare.slice(0, 2).join('/') : bare[0]);
    };
    for (const m of text.matchAll(forms[0])) if (!m[2]) add(m[3]);
    for (const m of text.matchAll(forms[1])) add(m[1]);
    for (const m of text.matchAll(forms[2])) if (!m[1]) add(m[2]);
  }
  return found;
}

test('the dev packages the renderer bundles are BUNDLED_DEV, no more and no fewer', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const derived = [...appSpecifiers()]
    .filter((n) => n !== 'electron' && !n.startsWith('@emerald/'))
    .filter((n) => lock.packages['node_modules/' + n]?.dev === true)
    .sort();
  const listed = [...BUNDLED_DEV].sort();
  const missing = derived.filter((n) => !listed.includes(n));
  const extra = listed.filter((n) => !derived.includes(n));
  assert.deepEqual(missing, [], `a dev package the app imports is missing from BUNDLED_DEV in scripts/third-party-notices-lib.mjs: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `BUNDLED_DEV names a package the app no longer imports: ${extra.join(', ')}`);
});

test('the export refuses a runtime package off the allow list', () => {
  const lock = {
    lockfileVersion: 3,
    packages: { '': { name: 'fixture' }, 'node_modules/gpl-thing': { version: '1.0.0', license: 'GPL-3.0-only' } },
  };
  const repo = fixtureRepo({ 'README.md': 'fixture\n', 'package-lock.json': JSON.stringify(lock) });
  fakePackage(repo, 'gpl-thing', 'GPL-3.0-only', 'copyleft');
  const out = path.join(tempDir('out'), 'x');
  const r = exportIn(repo, '--out', out, '--version', '0.1.1');
  assert.equal(r.status, 1, r.err + r.out);
  assert.match(r.err, /export-public: gpl-thing 1\.0\.0 is under GPL-3\.0-only, which is not on the allow list \(scripts\/third-party-notices-lib\.mjs\); nothing written/);
  assert.equal(fs.existsSync(out), false);
});

test('the export refuses stale notices', () => {
  const repo = fixtureRepo({ 'README.md': 'fixture\n', 'THIRD-PARTY-NOTICES.md': renderNotices([]).replace('Emerald ships', 'Emerald carries') });
  const out = path.join(tempDir('out'), 'x');
  const r = exportIn(repo, '--out', out, '--version', '0.1.1');
  assert.equal(r.status, 1, r.err + r.out);
  assert.match(r.err, /export-public: THIRD-PARTY-NOTICES\.md is stale; run node scripts\/third-party-notices\.mjs and commit it/);
  assert.equal(fs.existsSync(out), false);
});

test('the update mode lands each export as one commit on the public history', () => {
  const repo = fixtureRepo({ 'README.md': 'first\n', 'old.md': 'going\n', 'secret-notes.md': 'left out\n' });
  const bare = path.join(tempDir('bare'), 'public.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const pub = path.join(tempDir('pub'), 'clone');
  // The user's push, done here against the scratch bare repository.
  const push = () => execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: pub, stdio: 'pipe' });
  const bareGit = (...args) => execFileSync('git', ['-C', bare, ...args], { encoding: 'utf8' }).trim();

  const first = exportIn(repo, '--update', '--remote', bare, '--out', pub, '--version', '0.1.1');
  assert.equal(first.status, 0, first.err + first.out);
  assert.match(first.out, /on top of nothing \(the first commit\)/);
  const pushLine = first.out.split(/\r?\n/).find((l) => l.startsWith('  git -C '));
  assert.equal(pushLine, `  git -C ${pub.replace(/\\/g, '/')} -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin HEAD:main`, 'a push line with a forward-slash folder, pasteable after !');
  push();
  const firstShort = bareGit('rev-parse', '--short', 'main');
  assert.equal(fs.readFileSync(path.join(pub, 'CLAUDE.md'), 'utf8'), FIXTURE_NOTES, 'the mapped notes land at the root');
  assert.equal(fs.existsSync(path.join(pub, 'scripts', 'public')), false, 'the mapped source does not go out under its own name');

  fs.writeFileSync(path.join(repo, 'README.md'), 'second\n');
  fs.rmSync(path.join(repo, 'old.md'));
  commitAll(repo, 'change');
  const second = exportIn(repo, '--update', '--force', '--remote', bare, '--out', pub, '--version', '0.1.2');
  assert.equal(second.status, 0, second.err + second.out);
  assert.ok(second.out.includes(`"Emerald 0.1.2" on top of ${firstShort} `), second.out);
  push();
  assert.equal(bareGit('log', '--format=%s', 'main'), 'Emerald 0.1.2\nEmerald 0.1.1');
  assert.equal(bareGit('rev-parse', 'main^'), bareGit('rev-parse', 'main~1'));
  assert.equal(bareGit('rev-parse', '--short', 'main^'), firstShort);
  const tree = bareGit('ls-tree', '-r', '--name-only', 'main').split('\n');
  assert.ok(tree.includes('README.md'));
  assert.ok(!tree.includes('old.md'), 'a file removed in the working tree leaves the public tree');
  assert.ok(!tree.includes('secret-notes.md'), 'an excluded file never goes out');

  const headBefore = bareGit('rev-parse', 'main');
  const third = exportIn(repo, '--update', '--force', '--remote', bare, '--out', pub, '--version', '0.1.2');
  assert.equal(third.status, 0, third.err + third.out);
  assert.match(third.out, /export-public: main already holds this tree; nothing committed/);
  assert.equal(bareGit('rev-parse', 'main'), headBefore);
});

test('--list ends with the mapped notes under their export name', () => {
  const repo = fixtureRepo({ 'README.md': 'x\n' });
  const r = exportIn(repo, '--list');
  assert.equal(r.status, 0, r.err);
  const lines = r.out.trim().split(/\r?\n/);
  assert.equal(lines.at(-1), 'CLAUDE.md');
  assert.ok(!lines.includes('scripts/public/CLAUDE.md'));
});

test("the real list leaves out this box's notes and the source of the public ones, which scan clean", () => {
  const patterns = parsePatterns(fs.readFileSync(path.join(root, 'scripts', 'public-exclude.txt'), 'utf8'));
  assert.equal(isExcluded(patterns, 'CLAUDE.md'), true);
  assert.equal(isExcluded(patterns, 'scripts/public/CLAUDE.md'), true);
  for (const m of MAPPED) {
    const source = path.join(root, m.from);
    assert.ok(fs.existsSync(source), m.from);
    assert.deepEqual(scanText(m.from, fs.readFileSync(source, 'utf8')), [], m.from);
  }
});

test('--remote goes with --update, and neither with --list', () => {
  const repo = fixtureRepo({ 'README.md': 'x\n' });
  assert.equal(exportIn(repo, '--remote', 'x').status, 2);
  assert.equal(exportIn(repo, '--list', '--update').status, 2);
});
