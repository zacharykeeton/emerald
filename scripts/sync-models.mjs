// The model menu's names and the price table, checked or rewritten
// against the installed Claude Code's own model catalog (M9 fix 1149).
//
//   node scripts/sync-models.mjs            the differences, exit 0
//   node scripts/sync-models.mjs --check    the differences, exit 1 when any
//   node scripts/sync-models.mjs --write    rewrite both files in place
//   ... --bundle <file>                     read that bundle instead
//
// The bundle is the highest version-named file under
// ~/.local/share/claude/versions. Exit 3 with one `note models not
// checked:` line when there is none or it holds no catalog this reads;
// docs-commit-check.py runs --check and treats exit 3 as a note, never a
// FAIL, so a box with no Claude Code passes the docs commit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_ANCHOR, compare, newestVersion, readCatalog, rewrite } from './sync-models-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHAT = path.join(root, 'packages', 'app', 'src', 'renderer', 'src', 'chat-model.ts');
const RATES = path.join(root, 'packages', 'shared', 'src', 'rates.ts');

const args = process.argv.slice(2);
const mode = args.includes('--write') ? 'write' : args.includes('--check') ? 'check' : 'show';
const bi = args.indexOf('--bundle');

function notChecked(line) {
  console.log(`note models not checked: ${line}`);
  process.exit(3);
}

let bundle;
let version;
if (bi >= 0 && args[bi + 1]) {
  bundle = path.resolve(args[bi + 1]);
  version = path.basename(bundle);
} else {
  const dir = path.join(os.homedir(), '.local', 'share', 'claude', 'versions');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    names = [];
  }
  version = newestVersion(names);
  if (version === null) notChecked(`no Claude Code bundle under ${dir}`);
  bundle = path.join(dir, version);
}

// The bundle is a few hundred MB; find the anchor in the buffer and decode
// only a window after it as latin1 (the catalog is ASCII; a few MB holds it).
let buf;
try {
  buf = fs.readFileSync(bundle);
} catch (e) {
  notChecked(`no Claude Code bundle at ${bundle} (${e.code ?? e.name})`);
}
const at = buf.indexOf(Buffer.from(CATALOG_ANCHOR, 'latin1'));
if (at < 0) notChecked(`Claude Code ${version} holds no model catalog the script can read (no catalog anchor)`);
const text = buf.subarray(at, Math.min(buf.length, at + 4 * 1024 * 1024)).toString('latin1');
const read = readCatalog(text);
if (!read.ok) notChecked(`Claude Code ${version} holds no model catalog the script can read (${read.reason})`);

const chatText = fs.readFileSync(CHAT, 'utf8');
const ratesText = fs.readFileSync(RATES, 'utf8');

if (mode === 'write') {
  const out = rewrite(read.catalog, chatText, ratesText);
  if (out === null) notChecked('MODEL_CHOICES or MODEL_RATES not found');
  let wrote = false;
  if (out.chat !== chatText) {
    fs.writeFileSync(CHAT, out.chat, 'utf8');
    console.log(`wrote ${path.relative(root, CHAT)} (${out.renamed} names)`);
    wrote = true;
  }
  if (out.rates !== ratesText) {
    fs.writeFileSync(RATES, out.rates, 'utf8');
    console.log(`wrote ${path.relative(root, RATES)} (${out.added} rows added, ${out.changed} changed)`);
    wrote = true;
  }
  if (!wrote) console.log(`nothing to write, Claude Code ${version}`);
  process.exit(0);
}

const { stale, notes } = compare(read.catalog, version, chatText, ratesText);
if (stale.length === 0) console.log(`ok   models: MODEL_CHOICES and MODEL_RATES match Claude Code ${version}`);
for (const s of stale) console.log(`stale: ${s}`);
for (const n of notes) console.log(`note: ${n}`);
if (stale.length > 0) {
  console.log('run node scripts/sync-models.mjs --write');
  if (mode === 'check') process.exit(1);
}
process.exit(0);
