// The update feed (M9 fix 239): a static folder holding the three files
// electron-builder writes for its generic provider, latest.yml with the
// version and the installer's sha512, the installer and its .blockmap.
// The app reads it through electron-updater; the CLI publishes into it
// and serves it. The port and the folder are the one setting the app and
// the CLI must agree on, so they live here.
export const FEED_PORT = 7420;
export const FEED_DIR_NAME = 'emerald-feed';
export const FEED_MANIFEST = 'latest.yml';
// The public releases repository (fix 608): electron-builder.yml's publish block names it for app-update.yml, the updater reads it on a box with no local feed, and the release script (fix 609) cuts its releases there.
export const GITHUB_RELEASES = { owner: 'zacharykeeton', repo: 'emerald' } as const;
// The updater's cache folder under %LOCALAPPDATA% (M9 fix 371):
// electron-builder.yml's updaterCacheDirName spells it for the build,
// and the app's sweep of its pending\ folder and the install script's
// reads of it take it from here.
export const UPDATER_CACHE_DIR_NAME = 'emerald-updater';

export function feedUrl(port: number = FEED_PORT, host = '127.0.0.1'): string {
  return `http://${host}:${port}/`;
}

// What latest.yml says about one build: the installer's name and sha512
// (base64, as electron-builder writes it) and its size when the files
// list carries one.
export interface LatestManifest {
  version: string;
  path: string;
  sha512: string;
  size: number | null;
  releaseDate: string | null;
}

// electron-builder's latest.yml is flat YAML: scalars at the top level
// and one `files` list of mappings that repeats the installer. A whole
// YAML parser would be one more dependency in the CLI for four keys, so
// this reads that shape and nothing else. Throws on a text without a
// version, a path or a sha512.
export function parseLatestYml(text: string): LatestManifest {
  const top = new Map<string, string>();
  let size: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^(\s*)-?\s*([A-Za-z0-9_]+):\s*(.*)$/.exec(raw);
    if (m === null) continue;
    const [, indent, key, value] = m;
    if (indent === '') {
      top.set(key!, unquote(value ?? ''));
    } else if (key === 'size' && size === null) {
      size = Number(unquote(value ?? ''));
    }
  }
  const version = top.get('version');
  const p = top.get('path');
  const sha512 = top.get('sha512');
  if (!version || !p || !sha512) throw new Error('latest.yml has no version, path or sha512');
  return {
    version,
    path: p,
    sha512,
    size: size !== null && Number.isFinite(size) ? size : null,
    releaseDate: top.get('releaseDate') ?? null,
  };
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))) return v.slice(1, -1);
  return v;
}

// Whether `latest` is a newer build than `current`, both `0.1.<first fix
// id>` style dotted numbers (a `-` suffix is ignored). The badge shows on
// this, and it must agree with electron-updater's semver compare, which a
// plain numeric compare of the parts does.
export function isNewerVersion(latest: string, current: string): boolean {
  const a = numbers(latest);
  const b = numbers(current);
  if (a === null || b === null) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

function numbers(v: string): number[] | null {
  const core = v.trim().replace(/^v/, '').split('-')[0] ?? '';
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split('.').map(Number);
}
