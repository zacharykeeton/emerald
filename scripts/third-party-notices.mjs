// Writes THIRD-PARTY-NOTICES.md at the root (M9 fix 660): every package the
// app ships, read off package-lock.json, with its licence and the text of
// its own licence file. The export refuses a stale file or a package whose
// licence is off the allow list in third-party-notices-lib.mjs.
//
//   node scripts/third-party-notices.mjs           write the file
//   node scripts/third-party-notices.mjs --check   say whether it is current; write nothing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedUnder, licenceFromText, renderNotices, runtimeKeys } from './third-party-notices-lib.mjs';

const LICENCE_FILE = /^(?:licen[cs]e|copying)(?:\.(?:md|txt|markdown))?$/i;

function licenceOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) {
    return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).filter(Boolean).join(' OR ');
  }
  return '';
}

// The repository as a browsable URL, or null.
function sourceOf(pkg) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (typeof url !== 'string') return null;
  return url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
}

// { text, count, refused }: the file's text, how many packages it names, and
// { name, version, licence } for each one whose licence may not ship.
export function buildNotices(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const byId = new Map();
  for (const key of runtimeKeys(lock)) {
    const dir = path.join(root, key);
    const manifest = path.join(dir, 'package.json');
    if (!fs.existsSync(manifest)) {
      if (lock.packages[key].optional) continue;
      throw new Error(`${key} is in package-lock.json but not installed; run npm ci`);
    }
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const id = `${pkg.name}@${pkg.version}`;
    if (byId.has(id)) continue;
    const file = fs
      .readdirSync(dir)
      .filter((n) => LICENCE_FILE.test(n))
      .sort()[0];
    const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n?/g, '\n').trimEnd() : null;
    const named = licenceOf(pkg);
    const fromFile = named === '' ? licenceFromText(text) : '';
    byId.set(id, { name: pkg.name, version: pkg.version, licence: named || fromFile, licenceFrom: fromFile !== '' ? 'file' : undefined, source: sourceOf(pkg), text });
  }
  const entries = [...byId.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0,
  );
  const refused = entries
    .filter((e) => allowedUnder(e.licence) === null)
    .map((e) => ({ name: e.name, version: e.version, licence: e.licence }));
  return { text: renderNotices(entries), count: entries.length, refused };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const check = process.argv.includes('--check');
  const { text, count, refused } = buildNotices(root);
  if (refused.length > 0) {
    for (const r of refused) {
      console.error(`third-party-notices: ${r.name} ${r.version} is under ${r.licence || 'no licence'}, not on the allow list; nothing written`);
    }
    process.exit(1);
  }
  const file = path.join(root, 'THIRD-PARTY-NOTICES.md');
  if (check) {
    const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (now === text) {
      console.log(`third-party-notices: THIRD-PARTY-NOTICES.md is current, ${count} packages`);
      process.exit(0);
    }
    console.error('third-party-notices: THIRD-PARTY-NOTICES.md is stale; run node scripts/third-party-notices.mjs');
    process.exit(1);
  }
  fs.writeFileSync(file, text);
  console.log(`third-party-notices: wrote THIRD-PARTY-NOTICES.md, ${count} packages`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
