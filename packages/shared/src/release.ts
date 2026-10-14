// The pure half of the release script (M9 fix 609): the names, the merged
// manifest, the notes and the gh command, kept here so the script, its
// acceptance and the unit tests agree on one spelling. A subpath of its
// own rather than the barrel, since only the app's scripts read it; it
// uses no node module, so it would be safe in the barrel all the same.
import { GITHUB_RELEASES, type LatestManifest } from './feed.ts';

// M9 fix 609: the public repository that holds the releases, the README
// and the issues, as gh spells it; fix 608's GITHUB_RELEASES is the one
// place it is named. The code lives in a private one, so this is the only
// GitHub name the release path ever needs.
export const PUBLIC_RELEASES_REPO = `${GITHUB_RELEASES.owner}/${GITHUB_RELEASES.repo}`;

export type ReleaseArch = 'arm64' | 'x64';

// M9 fix 609: electron-builder.yml's artifactName for the NSIS target,
// spelled here so the script can say which file it expected when a
// manifest names another.
export function installerName(version: string, arch: ReleaseArch): string {
  return `Emerald-setup-${version}-${arch}.exe`;
}

// M9 fix 609: one release carries both arches, and electron-updater reads
// one latest.yml per release, so the two builds' manifests become one
// whose files list names both installers. electron-updater picks the
// entry whose name carries the running arch and falls back to the first,
// so arm64 goes first: an updater that ignores the arch is offered the
// build this box runs. The top-level path and sha512 are the legacy
// fields, read by `emmer feed publish` and by nothing that picks an arch,
// and name arm64 for the same reason.
export function mergeLatestYml(arm64: LatestManifest, x64: LatestManifest): string {
  if (arm64.version !== x64.version) throw new Error(`the two builds differ in version: arm64 ${arm64.version}, x64 ${x64.version}`);
  const pairs: Array<[ReleaseArch, LatestManifest]> = [
    ['arm64', arm64],
    ['x64', x64],
  ];
  for (const [arch, m] of pairs) {
    if (m.size === null) throw new Error(`latest.yml for ${m.path} has no size`);
    if (m.path !== installerName(m.version, arch)) throw new Error(`${m.path} is not the ${arch} installer`);
  }
  const lines = [`version: ${arm64.version}`, 'files:'];
  for (const [, m] of pairs) {
    lines.push(`  - url: ${m.path}`, `    sha512: ${m.sha512}`, `    size: ${m.size}`);
  }
  lines.push(`path: ${arm64.path}`, `sha512: ${arm64.sha512}`);
  if (arm64.releaseDate !== null) lines.push(`releaseDate: '${arm64.releaseDate}'`);
  return lines.join('\n') + '\n';
}

// M9 fix 609: the release's notes are the batch's own section of
// docs/WHATS-NEW.md. The newest section's first fix id is the version's
// last part at every docs commit, so a mismatch means the docs commit
// has not been made yet and the release would carry the last batch's
// notes; that is refused rather than guessed around. The heading rule is
// whatsNewStamp's, so the app's tab and the release name the same text.
export function releaseNotes(whatsNew: string, version: string): { heading: string; text: string } {
  const lines = whatsNew.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^##\s+(.+?)\s*$/.test(line));
  if (start === -1) throw new Error("docs/WHATS-NEW.md has no ## section");
  const heading = /^##\s+(.+?)\s*$/.exec(lines[start]!)![1]!;
  const first = /^Fixes (\d+) to (\d+), /.exec(heading);
  const last = version.split('.').pop();
  if (first === null || first[1] !== last) {
    throw new Error(`docs/WHATS-NEW.md's newest section is "${heading}", not the batch of ${version}; the docs commit writes it first`);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith('## ')) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end);
  while (section.length > 0 && section[section.length - 1]!.trim() === '') section.pop();
  return { heading, text: section.join('\n') + '\n' };
}

// M9 fix 609: what an unpacked build's resources\app-update.yml points the
// updater at, so the release refuses a build made before fix 608 put the
// github provider in, which would ship installers that look for updates
// on this box's local feed.
export function appUpdateTarget(text: string): string {
  const keys = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+):\s*(.*?)\s*$/.exec(raw);
    if (m === null) continue;
    let v = m[2]!;
    if (v.length >= 2 && ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))) v = v.slice(1, -1);
    keys.set(m[1]!, v);
  }
  const provider = keys.get('provider');
  if (provider === undefined) return 'none';
  if (provider === 'github') return `github ${keys.get('owner') ?? ''}/${keys.get('repo') ?? ''}`;
  if (provider === 'generic') return `generic ${keys.get('url') ?? ''}`;
  return provider;
}

// M9 fix 609: always a draft, which no updater sees; the user publishes
// it in GitHub, and that click is the promotion.
export function releaseCreateArgs(version: string, notesFile: string, assets: string[]): string[] {
  return ['release', 'create', `v${version}`, '--draft', '--repo', PUBLIC_RELEASES_REPO, '--title', `Emerald ${version}`, '--notes-file', notesFile, ...assets];
}
