import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatestYml, type LatestManifest } from './feed.ts';
import { appUpdateTarget, installerName, mergeLatestYml, PUBLIC_RELEASES_REPO, releaseCreateArgs, releaseNotes } from './release.ts';

// The feed.test.ts SAMPLE shape, one per arch.
function manifest(arch: 'arm64' | 'x64', over: Partial<LatestManifest> = {}): LatestManifest {
  return {
    version: '0.1.608',
    path: `Emerald-setup-0.1.608-${arch}.exe`,
    sha512: arch === 'arm64' ? 'AbC+/dEf==' : 'XyZ+/x64==',
    size: arch === 'arm64' ? 111222333 : 122333444,
    releaseDate: '2026-10-07T01:02:03.000Z',
    ...over,
  };
}

test('installerName is electron-builder.yml artifactName', () => {
  assert.equal(installerName('0.1.608', 'x64'), 'Emerald-setup-0.1.608-x64.exe');
});

test('mergeLatestYml lists both installers, arm64 first and at the top level', () => {
  const text = mergeLatestYml(manifest('arm64'), manifest('x64'));
  assert.equal(
    text,
    [
      'version: 0.1.608',
      'files:',
      '  - url: Emerald-setup-0.1.608-arm64.exe',
      '    sha512: AbC+/dEf==',
      '    size: 111222333',
      '  - url: Emerald-setup-0.1.608-x64.exe',
      '    sha512: XyZ+/x64==',
      '    size: 122333444',
      'path: Emerald-setup-0.1.608-arm64.exe',
      'sha512: AbC+/dEf==',
      "releaseDate: '2026-10-07T01:02:03.000Z'",
      '',
    ].join('\n'),
  );
});

test('a merged manifest reads back as the arm64 build', () => {
  assert.deepEqual(parseLatestYml(mergeLatestYml(manifest('arm64'), manifest('x64'))), manifest('arm64'));
});

test('mergeLatestYml leaves the date out when arm64 has none', () => {
  const text = mergeLatestYml(manifest('arm64', { releaseDate: null }), manifest('x64'));
  assert.ok(!text.includes('releaseDate'));
  assert.ok(text.endsWith('sha512: AbC+/dEf==\n'));
});

test('mergeLatestYml refuses two versions, a missing size and the wrong arch', () => {
  assert.throws(() => mergeLatestYml(manifest('arm64'), manifest('x64', { version: '0.1.450', path: 'Emerald-setup-0.1.450-x64.exe' })), {
    message: 'the two builds differ in version: arm64 0.1.608, x64 0.1.450',
  });
  assert.throws(() => mergeLatestYml(manifest('arm64'), manifest('x64', { size: null })), {
    message: 'latest.yml for Emerald-setup-0.1.608-x64.exe has no size',
  });
  assert.throws(() => mergeLatestYml(manifest('x64'), manifest('x64')), {
    message: 'Emerald-setup-0.1.608-x64.exe is not the arm64 installer',
  });
});

const WHATS_NEW = [
  "# What's new in emerald",
  '',
  'Intro line.',
  '',
  '## Fixes 608 to 619, 2026-10-07',
  '',
  '### Highlights',
  '',
  '- one',
  '',
  '### Details',
  '',
  '- two',
  '',
  '',
  '## Fixes 588 to 607, 2026-10-01',
  '',
  '- old',
  '',
].join('\n');

test('releaseNotes takes the newest section whole and stops at the next', () => {
  assert.deepEqual(releaseNotes(WHATS_NEW, '0.1.608'), {
    heading: 'Fixes 608 to 619, 2026-10-07',
    text: ['## Fixes 608 to 619, 2026-10-07', '', '### Highlights', '', '- one', '', '### Details', '', '- two', ''].join('\n'),
  });
});

test('releaseNotes reads CRLF as LF', () => {
  assert.deepEqual(releaseNotes(WHATS_NEW.replace(/\n/g, '\r\n'), '0.1.608'), releaseNotes(WHATS_NEW, '0.1.608'));
});

test('releaseNotes refuses a section that is not the batch, and a file with none', () => {
  assert.throws(() => releaseNotes(WHATS_NEW.replace('## Fixes 608 to 619', '## Fixes 588 to 607x'), '0.1.608'), {
    message: `docs/WHATS-NEW.md's newest section is "Fixes 588 to 607x, 2026-10-07", not the batch of 0.1.608; the docs commit writes it first`,
  });
  assert.throws(() => releaseNotes(WHATS_NEW, '0.1.609'), /newest section is "Fixes 608 to 619, 2026-10-07", not the batch of 0\.1\.609/);
  assert.throws(() => releaseNotes("# What's new\n\nnothing\n", '0.1.608'), { message: 'docs/WHATS-NEW.md has no ## section' });
});

test('appUpdateTarget reads the github lines in any order, the generic file and nothing', () => {
  assert.equal(appUpdateTarget('owner: zacharykeeton\nrepo: emerald\nprovider: github\nupdaterCacheDirName: emerald-updater\n'), 'github zacharykeeton/emerald');
  assert.equal(appUpdateTarget('provider: github\r\nrepo: emerald\r\nowner: zacharykeeton\r\n'), 'github zacharykeeton/emerald');
  assert.equal(appUpdateTarget('provider: generic\nurl: http://127.0.0.1:7420/\nupdaterCacheDirName: emerald-updater\n'), 'generic http://127.0.0.1:7420/');
  assert.equal(appUpdateTarget('provider: s3\nbucket: x\n'), 's3');
  assert.equal(appUpdateTarget(''), 'none');
});

test('releaseCreateArgs drafts on the public repo with the notes and the assets', () => {
  assert.deepEqual(releaseCreateArgs('0.1.608', 'n.md', ['a.exe', 'b.yml']), [
    'release',
    'create',
    'v0.1.608',
    '--draft',
    '--repo',
    PUBLIC_RELEASES_REPO,
    '--title',
    'Emerald 0.1.608',
    '--notes-file',
    'n.md',
    'a.exe',
    'b.yml',
  ]);
  assert.equal(PUBLIC_RELEASES_REPO, 'zacharykeeton/emerald');
});
