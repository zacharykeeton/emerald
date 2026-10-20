// Drafts a GitHub release of the batch on the public repository (M9 fix
// 609): builds the x64 and then the arm64 installer, checks each against
// its own latest.yml, merges the two manifests into one that lists both,
// checks that the public repo's default branch is at `Emerald <version>`
// (fix 660: scripts/export-public.mjs --update and a push put the code
// there, and the tag lands on that commit), and runs `gh release create
// v<version> --draft` with the two installers, their blockmaps, the merged
// latest.yml and the batch's section of docs/WHATS-NEW.md as the notes.
// A draft, which no updater sees, unless --publish: then the draft's five
// assets are read back from GitHub, each name and size checked against the
// local file, and only when all match is the draft published, since the user
// handed the Publish click to the session at the install of fixes 888 to 917.
//
//   npm run release -w @emerald/app                 build, check, draft
//   npm run release -w @emerald/app -- --no-build   use release/ and release-x64/ as they are
//   npm run release -w @emerald/app -- --no-build --publish   draft, read back, publish
//   npm run release -w @emerald/app -- --dry-run    build and upload nothing; print the plan
//
// --arm64-dir and --x64-dir point the checks at other folders, with
// --no-build or --dry-run only (verify:release runs on fixtures that way).
// The gh token stays in gh's keyring: this never reads it, never creates a
// repo and never deletes a release.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLatestYml } from '@emerald/shared';
import { appUpdateTarget, installerName, mergeLatestYml, PUBLIC_RELEASES_REPO, releaseCreateArgs, releaseNotes } from '@emerald/shared/release';
import { sha512Base64 } from '../../cli/dist/feed.js';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..', '..');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const noBuild = argv.includes('--no-build');
const publish = argv.includes('--publish');
const want = `github ${PUBLIC_RELEASES_REPO}`;

class Refusal extends Error {}

function refuse(message) {
  throw new Refusal(message);
}

function option(name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) refuse(`${name} needs a folder`);
  return path.resolve(v);
}

// A child with no shell, so gh and git resolve to their .exe on the PATH
// and no argument is ever re-parsed by cmd.
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  if (r.error && r.error.code === 'ENOENT') return { status: null, missing: true, stdout: '', stderr: '' };
  return { status: r.status, missing: false, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// What one arch's build folder holds, checked against its own manifest.
function checkBuild(arch, dir, version) {
  const manifestFile = path.join(dir, 'latest.yml');
  if (!fs.existsSync(manifestFile)) refuse(`${manifestFile} is missing; run without --no-build`);
  let manifest;
  try {
    manifest = parseLatestYml(fs.readFileSync(manifestFile, 'utf8'));
  } catch (err) {
    refuse(`${manifestFile}: ${err.message}`);
  }
  if (manifest.version !== version) refuse(`${manifestFile} names ${manifest.version}, the build is ${version}; run without --no-build`);
  const expected = installerName(version, arch);
  if (manifest.path !== expected) refuse(`${manifestFile} names ${manifest.path}, not ${expected}`);
  const installer = path.join(dir, manifest.path);
  const blockmap = `${installer}.blockmap`;
  for (const f of [installer, blockmap]) if (!fs.existsSync(f)) refuse(`${f} is missing`);
  if (sha512Base64(installer) !== manifest.sha512) refuse(`${manifest.path} does not match the sha512 in ${manifestFile}`);
  const size = fs.statSync(installer).size;
  if (size !== manifest.size) refuse(`${manifest.path} is ${size} bytes, ${manifestFile} says ${manifest.size}`);
  const unpacked = arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked';
  const updateFile = path.join(dir, unpacked, 'resources', 'app-update.yml');
  const target = fs.existsSync(updateFile) ? appUpdateTarget(fs.readFileSync(updateFile, 'utf8')) : 'none';
  if (target !== want) refuse(`${manifestFile} points the updater at ${target}, not ${want} (is fix 608 in this build?)`);
  console.log(`checked ${manifest.path}: sha512 and size match ${manifestFile}`);
  return { manifest, installer, blockmap };
}

function quoteArg(a) {
  return /\s/.test(a) ? `"${a}"` : a;
}

function main() {
  const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
  const arm64Opt = option('--arm64-dir');
  const x64Opt = option('--x64-dir');
  if ((arm64Opt || x64Opt) && !dryRun && !noBuild) refuse('--arm64-dir and --x64-dir go with --no-build or --dry-run');
  const arm64Dir = arm64Opt ?? path.join(appDir, 'release');
  const x64Dir = x64Opt ?? path.join(appDir, 'release-x64');

  let branch = 'main';
  if (!dryRun) {
    const v = run('gh', ['--version']);
    if (v.missing) refuse('gh is not on the PATH; install GitHub CLI and run gh auth login');
    if (run('gh', ['auth', 'status']).status !== 0) refuse('gh is not signed in; run gh auth login');
    const repo = run('gh', ['repo', 'view', PUBLIC_RELEASES_REPO, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'], { stdio: ['ignore', 'pipe', 'inherit'] });
    if (repo.status !== 0) refuse(`the public repo ${PUBLIC_RELEASES_REPO} is not there yet; create it with: gh repo create ${PUBLIC_RELEASES_REPO} --public`);
    const name = repo.stdout.trim();
    if (name !== '' && name !== 'null') branch = name;
    const existing = run('gh', ['release', 'view', `v${version}`, '--repo', PUBLIC_RELEASES_REPO, '--json', 'isDraft', '--jq', '.isDraft']);
    if (existing.status === 0) {
      const kind = existing.stdout.trim() === 'true' ? 'a draft' : 'published';
      refuse(`release v${version} is already on ${PUBLIC_RELEASES_REPO} (${kind}); delete it in GitHub, or with gh release delete v${version} --repo ${PUBLIC_RELEASES_REPO} --yes, and run again`);
    }
    // gh release create without --target tags the default branch's head, so
    // that head must be this version's code before anything is built.
    const head = run('gh', ['api', `repos/${PUBLIC_RELEASES_REPO}/commits/${branch}`, '--jq', '.commit.message']);
    const subject = head.status === 0 ? head.stdout.split(/\r?\n/)[0].trim() : '';
    if (subject !== `Emerald ${version}`) {
      refuse(`${PUBLIC_RELEASES_REPO} ${branch} is not at Emerald ${version} (its head reads "${subject}"); run node scripts/export-public.mjs --update, push, and run again`);
    }
    if (!noBuild) {
      // x64 first, so stage/ is left arm64, as every other script on this box expects.
      for (const [label, args] of [
        ['pack.mjs --x64', ['scripts/pack.mjs', '--x64']],
        ['pack.mjs', ['scripts/pack.mjs']],
      ]) {
        const r = spawnSync(process.execPath, args, { cwd: appDir, stdio: 'inherit' });
        if (r.status !== 0) refuse(`${label} failed`);
      }
    }
  }

  const arm64 = checkBuild('arm64', arm64Dir, version);
  const x64 = checkBuild('x64', x64Dir, version);
  let merged;
  let notes;
  try {
    merged = mergeLatestYml(arm64.manifest, x64.manifest);
    notes = releaseNotes(fs.readFileSync(path.join(repoRoot, 'docs', 'WHATS-NEW.md'), 'utf8'), version);
  } catch (err) {
    refuse(err.message);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-release-'));
  try {
    const latestFile = path.join(tmp, 'latest.yml');
    const notesFile = path.join(tmp, 'notes.md');
    fs.writeFileSync(latestFile, merged);
    fs.writeFileSync(notesFile, notes.text);
    const ghArgs = releaseCreateArgs(version, notesFile, [arm64.installer, arm64.blockmap, x64.installer, x64.blockmap, latestFile]);
    if (dryRun) {
      const lines = notes.text.replace(/\n$/, '').split('\n').length;
      console.log(`release dry run for ${version}: nothing built or uploaded`);
      console.log('--- latest.yml');
      process.stdout.write(merged);
      console.log(`--- notes: ${notes.heading} (${lines} lines)`);
      console.log(`--- the code: v${version} tags ${PUBLIC_RELEASES_REPO}'s default branch, which node scripts/export-public.mjs --update and a push put at Emerald ${version} first`);
      console.log(`--- gh ${ghArgs.map(quoteArg).join(' ')}`);
      if (publish) console.log(`--- then, once the draft's five assets read back with the local names and sizes: gh release edit v${version} --repo ${PUBLIC_RELEASES_REPO} --draft=false --latest`);
      return;
    }
    const r = spawnSync('gh', ghArgs, { stdio: 'inherit', windowsHide: true });
    if (r.status !== 0) refuse('gh release create failed; the release is not drafted');
    if (!publish) {
      console.log(`drafted v${version} on ${PUBLIC_RELEASES_REPO} with 5 files; publish it at https://github.com/${PUBLIC_RELEASES_REPO}/releases when you are ready, and no updater sees it until then`);
      return;
    }
    // Read the draft back before publishing: an upload cut short leaves a
    // draft with a missing or short asset, and a published one would hand
    // every friend's updater a broken installer.
    const view = run('gh', ['release', 'view', `v${version}`, '--repo', PUBLIC_RELEASES_REPO, '--json', 'isDraft,assets']);
    if (view.status !== 0) refuse(`could not read the draft v${version} back; it stays a draft`);
    const got = JSON.parse(view.stdout);
    if (got.isDraft !== true) refuse(`v${version} is not a draft any more; nothing published`);
    const local = [arm64.installer, arm64.blockmap, x64.installer, x64.blockmap, latestFile].map((f) => ({ name: path.basename(f), size: fs.statSync(f).size }));
    const remote = new Map(got.assets.map((a) => [a.name, a.size]));
    for (const f of local) {
      if (remote.get(f.name) !== f.size) refuse(`the draft's ${f.name} reads ${remote.get(f.name) ?? 'missing'}, the local file is ${f.size} bytes; it stays a draft`);
    }
    if (got.assets.length !== local.length) refuse(`the draft holds ${got.assets.length} assets, not ${local.length}; it stays a draft`);
    console.log(`read back v${version}: ${local.length} assets, each name and size as local`);
    const pub = spawnSync('gh', ['release', 'edit', `v${version}`, '--repo', PUBLIC_RELEASES_REPO, '--draft=false', '--latest'], { stdio: 'inherit', windowsHide: true });
    if (pub.status !== 0) refuse(`gh release edit failed; v${version} stays a draft`);
    const latest = run('gh', ['api', `repos/${PUBLIC_RELEASES_REPO}/releases/latest`, '--jq', '.tag_name + " " + .published_at']);
    console.log(`published v${version} on ${PUBLIC_RELEASES_REPO}; releases/latest reads ${latest.stdout.trim()}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  if (err instanceof Refusal) {
    console.error(`release: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
