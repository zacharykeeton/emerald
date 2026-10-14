// The update feed's publish half (M9 fix 239): copying a release into
// the feed folder. The app's updater reads latest.yml, the installer and
// its .blockmap from a URL, and electron-builder writes those three into
// release/ at every dist, so a publish is a copy. The serve half lives in
// @emerald/shared/feed-server since M9 fix 240, when the daemon took it up.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FEED_MANIFEST, parseLatestYml } from '@emerald/shared';
import type { LatestManifest } from '@emerald/shared';

// The folder and the server moved into shared for M9 fix 240 (the daemon
// hosts the server); re-exported so the command and its test read as before.
export { defaultFeedDir, serveFeed } from '@emerald/shared/feed-server';
export type { FeedServer } from '@emerald/shared/feed-server';

export interface Published {
  manifest: LatestManifest;
  // The files written into the feed, latest.yml first.
  files: string[];
  // Files the release named that were not there, the .blockmap for one
  // built without it; the publish goes ahead without them.
  missing: string[];
}

// Copies latest.yml, the installer it names and the installer's .blockmap
// from a release folder into the feed folder, checking the installer's
// sha512 against the manifest first so a half-written build never lands
// in the feed. Older builds' files are left in place; the manifest is
// what the app reads, and the old installer stays for a differential
// download's old blockmap.
export function publishFeed(releaseDir: string, feedDir: string): Published {
  const manifestFile = path.join(releaseDir, FEED_MANIFEST);
  if (!fs.existsSync(manifestFile)) throw new Error(`${manifestFile} is missing (run npm run dist -w @emerald/app first)`);
  const manifest = parseLatestYml(fs.readFileSync(manifestFile, 'utf8'));
  const installer = path.join(releaseDir, manifest.path);
  if (!fs.existsSync(installer)) throw new Error(`${installer} is missing, though ${FEED_MANIFEST} names it`);
  const hash = sha512Base64(installer);
  if (hash !== manifest.sha512) throw new Error(`${manifest.path} does not match the sha512 in ${FEED_MANIFEST}`);
  fs.mkdirSync(feedDir, { recursive: true });
  const files: string[] = [];
  const missing: string[] = [];
  // The installer and its blockmap first, the manifest last, so an app
  // checking mid-publish never reads a manifest naming a file not yet
  // there.
  for (const name of [manifest.path, `${manifest.path}.blockmap`]) {
    const from = path.join(releaseDir, name);
    if (!fs.existsSync(from)) {
      missing.push(name);
      continue;
    }
    copyThrough(from, path.join(feedDir, name));
    files.push(name);
  }
  copyThrough(manifestFile, path.join(feedDir, FEED_MANIFEST));
  return { manifest, files: [FEED_MANIFEST, ...files], missing };
}

// M9 fix 486: a copy straight onto the feed's file let a reader mid-copy
// meet a short or empty one (an empty one killed the daemon before fix
// 484). Each goes to `<name>.tmp` beside it and is renamed over, so a
// reader sees the old file or the new one whole; the .tmp is a name the
// updater never asks for, and none is left once the publish returns,
// whether the rename or the copy failed (M9 fix 554).
function copyThrough(from: string, to: string): void {
  const tmp = `${to}.tmp`;
  try {
    fs.copyFileSync(from, tmp);
    fs.renameSync(tmp, to);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export function sha512Base64(file: string): string {
  const h = crypto.createHash('sha512');
  h.update(fs.readFileSync(file));
  return h.digest('base64');
}
