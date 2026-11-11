// The pure half of scripts/sync-models.mjs (M9 fix 1149): reading Claude
// Code's own model catalog out of its bundle's text, and checking or
// rewriting the model menu's names (MODEL_CHOICES in the app's
// chat-model.ts) and the price table (MODEL_RATES in shared's rates.ts)
// against it. No fs here, so the tests drive every part on strings, as
// export-public-lib.mjs is to export-public.mjs.
//
// The catalog is one object literal in the bundle, opening with the text
// below; the variable it is assigned to moves between builds, so the
// text is the anchor. It is JavaScript, not JSON (`!0`, `1e6`, bare
// keys), and it references no identifier, so it is evaluated alone in an
// empty context.

import vm from 'node:vm';

export const CATALOG_ANCHOR = '{"//":"Hand-maintained baked-in model catalog';

// Our field names against the catalog tier's. Only the menu rows whose
// alias is in the catalog's `aliases` take their names from it; `default`
// and `opusplan` are built in Claude Code's code, not its catalog, and
// stay hand-kept, as does every row's line.
const RATE_FIELDS = [
  ['fresh', 'input'],
  ['cacheWrite', 'cache_write_5m'],
  ['cacheWrite1h', 'cache_write_1h'],
  ['cacheRead', 'cache_read'],
  ['output', 'output'],
];

// The literal from the anchor to its matching close brace, skipping the
// inside of every string so a brace in a value does not end it early.
export function sliceCatalog(text) {
  const start = text.indexOf(CATALOG_ANCHOR);
  if (start < 0) return { ok: false, reason: 'no catalog anchor' };
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') i++;
        i++;
      }
      if (i >= text.length) break;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return { ok: true, slice: text.slice(start, i + 1) };
    }
    i++;
  }
  return { ok: false, reason: 'the catalog braces never close' };
}

// The catalog as an object, or the reason it cannot be read.
export function readCatalog(text) {
  const s = sliceCatalog(text);
  if (!s.ok) return s;
  let cat;
  try {
    cat = vm.runInNewContext('(' + s.slice + ')', Object.create(null), { timeout: 1000 });
  } catch (e) {
    return { ok: false, reason: `evaluating the catalog threw ${e && e.name ? e.name : 'an error'}` };
  }
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(cat) || cat.schema_version !== 1 || !isObj(cat.pricing_tiers) || !Array.isArray(cat.models) || !isObj(cat.aliases)) {
    return { ok: false, reason: 'the catalog is not the shape this script reads' };
  }
  return { ok: true, catalog: cat };
}

// alias -> the display name of the model its default resolves to, in the
// catalog's own key order; an alias whose id names no model is left out.
export function aliasNames(cat) {
  const out = [];
  for (const [alias, entry] of Object.entries(cat.aliases)) {
    const id = entry && typeof entry === 'object' ? entry.default : entry;
    const row = cat.models.find((m) => m && m.id === id);
    if (row && typeof row.display_name === 'string') out.push({ alias, name: row.display_name });
  }
  return out;
}

// The five rates of the model a family names, or null when no model of
// the catalog has that display name or its tier is missing.
export function catalogRates(cat, family) {
  const row = cat.models.find((m) => m && m.display_name === family);
  if (!row) return null;
  const tier = cat.pricing_tiers[row.pricing];
  if (!tier || typeof tier !== 'object') return null;
  const out = {};
  for (const [ours, theirs] of RATE_FIELDS) {
    if (typeof tier[theirs] !== 'number') return null;
    out[ours] = tier[theirs];
  }
  return out;
}

const EOL = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

// The line range of an array literal opened by `head` and closed by a line
// reading `];`, or null.
function arrayBlock(lines, head) {
  const open = lines.findIndex((l) => l.startsWith(head));
  if (open < 0) return null;
  for (let i = open + 1; i < lines.length; i++) {
    if (lines[i].trim() === '];') return { open, close: i };
  }
  return null;
}

const CHOICE_RE = /^(\s*)\{ alias: '([^']*)', name: '([^']*)', line: '([^']*)' \},$/;
const RATE_RE = /^(\s*)\{ family: '([^']*)', fresh: ([^,]+), cacheWrite: ([^,]+), cacheWrite1h: ([^,]+), cacheRead: ([^,]+), output: ([^ ]+) \},$/;

export function parseChoices(text) {
  const lines = text.split(/\r?\n/);
  const b = arrayBlock(lines, 'export const MODEL_CHOICES');
  if (b === null) return null;
  const rows = [];
  for (let i = b.open + 1; i < b.close; i++) {
    const m = CHOICE_RE.exec(lines[i]);
    if (m) rows.push({ index: i, indent: m[1], alias: m[2], name: m[3], line: m[4] });
  }
  return { lines, block: b, rows };
}

export function parseRates(text) {
  const lines = text.split(/\r?\n/);
  const b = arrayBlock(lines, 'export const MODEL_RATES');
  if (b === null) return null;
  const rows = [];
  for (let i = b.open + 1; i < b.close; i++) {
    const m = RATE_RE.exec(lines[i]);
    if (m) {
      rows.push({
        index: i,
        indent: m[1],
        family: m[2],
        fresh: Number(m[3]),
        cacheWrite: Number(m[4]),
        cacheWrite1h: Number(m[5]),
        cacheRead: Number(m[6]),
        output: Number(m[7]),
      });
    }
  }
  return { lines, block: b, rows };
}

export function rateLine(indent, family, r) {
  return `${indent}{ family: '${family}', fresh: ${r.fresh}, cacheWrite: ${r.cacheWrite}, cacheWrite1h: ${r.cacheWrite1h}, cacheRead: ${r.cacheRead}, output: ${r.output} },`;
}

// What differs between the two files and the catalog: `stale` lines (each
// without its "stale: " lead) and `notes`, in the order the check prints.
export function compare(cat, version, chatText, ratesText) {
  const choices = parseChoices(chatText);
  const rates = parseRates(ratesText);
  const stale = [];
  const notes = [];
  if (choices === null) stale.push('MODEL_CHOICES not found in chat-model.ts');
  if (rates === null) stale.push('MODEL_RATES not found in rates.ts');
  if (stale.length > 0) return { stale, notes };
  const names = aliasNames(cat);
  for (const { alias, name } of names) {
    const row = choices.rows.find((r) => r.alias === alias);
    if (!row) {
      notes.push(`the catalog has alias ${alias}, which MODEL_CHOICES does not list`);
      continue;
    }
    if (row.name !== name) stale.push(`MODEL_CHOICES ${alias} reads ${row.name}, Claude Code ${version} resolves it to ${name}`);
  }
  for (const { name } of names) {
    if (catalogRates(cat, name) === null) continue;
    if (!rates.rows.some((r) => r.family === name)) stale.push(`MODEL_RATES has no row for ${name}`);
  }
  for (const row of rates.rows) {
    const theirs = catalogRates(cat, row.family);
    if (theirs === null) {
      notes.push(`MODEL_RATES ${row.family} kept by hand, not in Claude Code's catalog`);
      continue;
    }
    for (const [field] of RATE_FIELDS) {
      if (row[field] !== theirs[field]) stale.push(`MODEL_RATES ${row.family} ${field} ${row[field]}, Claude Code ${version} ${theirs[field]}`);
    }
  }
  return { stale, notes };
}

// Both files rewritten to the catalog: the listed aliases' names, every
// row's numbers refreshed from its tier, and a row appended for each
// alias's model the table lacks, in the catalog's alias order.
export function rewrite(cat, chatText, ratesText) {
  const choices = parseChoices(chatText);
  const rates = parseRates(ratesText);
  if (choices === null || rates === null) return null;
  const names = aliasNames(cat);

  const chatLines = choices.lines.slice();
  let renamed = 0;
  for (const { alias, name } of names) {
    const row = choices.rows.find((r) => r.alias === alias);
    if (!row || row.name === name) continue;
    chatLines[row.index] = `${row.indent}{ alias: '${row.alias}', name: '${name}', line: '${row.line}' },`;
    renamed++;
  }

  const rateLines = rates.lines.slice();
  let changed = 0;
  for (const row of rates.rows) {
    const theirs = catalogRates(cat, row.family);
    if (theirs === null) continue;
    const line = rateLine(row.indent, row.family, theirs);
    if (line !== rateLines[row.index]) {
      rateLines[row.index] = line;
      changed++;
    }
  }
  const indent = rates.rows.length > 0 ? rates.rows[0].indent : '  ';
  const added = [];
  for (const { name } of names) {
    if (rates.rows.some((r) => r.family === name) || added.some((a) => a.family === name)) continue;
    const theirs = catalogRates(cat, name);
    if (theirs === null) continue;
    added.push({ family: name, line: rateLine(indent, name, theirs) });
  }
  rateLines.splice(rates.block.close, 0, ...added.map((a) => a.line));

  return {
    chat: chatLines.join(EOL(chatText)),
    rates: rateLines.join(EOL(ratesText)),
    renamed,
    added: added.length,
    changed,
  };
}

// The highest version-named file of a list of names, compared numerically.
export function newestVersion(names) {
  const vs = names.filter((n) => /^\d+\.\d+\.\d+$/.test(n));
  vs.sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });
  return vs.length > 0 ? vs[vs.length - 1] : null;
}
