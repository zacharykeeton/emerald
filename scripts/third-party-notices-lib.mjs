// The pure half of scripts/third-party-notices.mjs (M9 fix 660): which
// licences the published code may ship, which packages it ships, and the
// text of THIRD-PARTY-NOTICES.md. No fs here, so the tests drive it on
// plain objects.

// Permissive licences, and one weak copyleft. Python-2.0, PSF-2.0 and
// BlueOak-1.0.0 are what the runtime tree held when the list was written
// (argparse 2, argparse 3, sax). Unlicense and EPL-2.0 came with mermaid
// (robust-predicates, and elkjs in the lazy elk layout chunk), let in by
// the user at the install of fixes 645 to 665: EPL-2.0 binds only the
// library itself, shipped unmodified, and its notice names where its
// source is (SOURCE_NAMED). MPL, LGPL, GPL, AGPL and anything else stay off.
export const ALLOWED_LICENCES = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'Python-2.0',
  'PSF-2.0',
  'BlueOak-1.0.0',
  'Unlicense',
  'EPL-2.0',
];

// The licences whose notice also says where the package's source is, as
// EPL-2.0 asks of anyone distributing the library in object form.
export const SOURCE_NAMED = ['EPL-2.0'];

// A licence read off a package's licence file, for a package.json that
// names none (khroma 2.1.0): MIT alone is recognised, by its title or its
// grant sentence, and anything else is '' and so refused.
export function licenceFromText(text) {
  if (typeof text !== 'string') return '';
  if (/^\s*(?:the )?mit licen[cs]e/i.test(text) || text.includes('Permission is hereby granted, free of charge')) return 'MIT';
  return '';
}

// Vite bundles these into the renderer although the lock marks them dev,
// so they and everything they depend on ship.
export const BUNDLED_DEV = ['monaco-editor', 'markdown-it', 'mermaid'];

const ID = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

// The SPDX expression's tokens, each with where it starts and ends in the
// text so a sub-expression can be handed back as written. Null on a token
// the grammar does not know.
function tokenize(expr) {
  const out = [];
  const re = /\s*(\(|\)|[^\s()]+)/g;
  let m;
  while ((m = re.exec(expr)) !== null) {
    if (m[0].trim() === '') break;
    const start = m.index + m[0].length - m[1].length;
    out.push({ text: m[1], start, end: start + m[1].length });
  }
  return out;
}

// A recursive descent over ids, AND, OR and parentheses, AND binding
// tighter than OR. Each node is { kind, start, end, parts? }; null on
// anything else, WITH included.
function parse(expr) {
  const toks = tokenize(expr);
  let i = 0;
  const atom = () => {
    const t = toks[i];
    if (!t) return null;
    if (t.text === '(') {
      i++;
      const inner = orExpr();
      if (!inner || !toks[i] || toks[i].text !== ')') return null;
      const end = toks[i].end;
      i++;
      return { ...inner, start: t.start, end };
    }
    if (t.text === ')' || t.text === 'AND' || t.text === 'OR' || t.text === 'WITH' || !ID.test(t.text)) return null;
    i++;
    return { kind: 'id', id: t.text, start: t.start, end: t.end };
  };
  const join = (kind, next) => () => {
    const first = next();
    if (!first) return null;
    const parts = [first];
    while (toks[i] && toks[i].text === kind) {
      i++;
      const n = next();
      if (!n) return null;
      parts.push(n);
    }
    return parts.length === 1 ? first : { kind, parts, start: first.start, end: parts[parts.length - 1].end };
  };
  const andExpr = join('AND', atom);
  const orExpr = join('OR', andExpr);
  const tree = orExpr();
  if (!tree || i !== toks.length) return null;
  return tree;
}

// The licence a package is used under, or null when it may not ship: a
// single allowed id is itself, `A OR B` is the first alternative in the
// order written that is allowed, and `A AND B` is the whole of it when
// every part is allowed.
export function allowedUnder(expr) {
  if (typeof expr !== 'string' || expr.trim() === '') return null;
  const text = expr.trim();
  const tree = parse(text);
  if (!tree) return null;
  const pick = (node) => {
    if (node.kind === 'id') return ALLOWED_LICENCES.includes(node.id) ? node.id : null;
    if (node.kind === 'OR') {
      for (const p of node.parts) {
        const got = pick(p);
        if (got !== null) return got;
      }
      return null;
    }
    return node.parts.every((p) => pick(p) !== null) ? text.slice(node.start, node.end) : null;
  };
  return pick(tree);
}

// The key a dependency of `from` resolves to, node's way: the nearest
// node_modules/<dep> walking up from the package's own folder.
function resolveDep(packages, from, dep) {
  let base = from;
  for (;;) {
    const key = `${base}/node_modules/${dep}`;
    if (packages[key]) return key;
    const cut = base.lastIndexOf('/node_modules/');
    if (cut < 0) break;
    base = base.slice(0, cut);
  }
  const top = `node_modules/${dep}`;
  return packages[top] ? top : null;
}

// Every package key that ships, sorted: the lock's non-dev, non-link
// node_modules entries that are not the workspaces themselves, and the
// dependency closure of BUNDLED_DEV.
export function runtimeKeys(lock) {
  const packages = lock.packages ?? {};
  const keys = new Set();
  for (const [key, entry] of Object.entries(packages)) {
    if (!key.startsWith('node_modules/')) continue;
    if (entry.dev || entry.link) continue;
    if (/(?:^|\/)node_modules\/@emerald\/[^/]+$/.test(key)) continue;
    keys.add(key);
  }
  const seen = new Set();
  const queue = BUNDLED_DEV.map((n) => `node_modules/${n}`).filter((k) => packages[k]);
  while (queue.length > 0) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    seen.add(key);
    keys.add(key);
    const entry = packages[key];
    for (const dep of Object.keys({ ...(entry.dependencies ?? {}), ...(entry.optionalDependencies ?? {}) })) {
      const got = resolveDep(packages, key, dep);
      if (got !== null && !seen.has(got)) queue.push(got);
    }
  }
  return [...keys].sort();
}

const HEADER = [
  '# Third-party notices',
  '',
  'Emerald ships the packages below, each under its own licence, whose text follows its name. This file is generated by `node scripts/third-party-notices.mjs` from `package-lock.json` and each package\'s own licence file; do not edit it by hand.',
  '',
  'Electron and Chromium, which the installer also carries, put their own notices beside `Emerald.exe`: `LICENSE.electron.txt` and `LICENSES.chromium.html`.',
  '',
  'The colour schemes Dracula, One Dark, Solarized Dark and Tokyo Night in `packages/app/resources/schemes` take their colours from the MIT-licensed themes of the same names.',
];

// The file's text from { name, version, licence, text } entries already
// sorted and deduped, `text` null when the package ships no licence file.
// `licenceFrom: 'file'` marks a licence read off the file, and `source`
// is the package's repository, said for a licence in SOURCE_NAMED.
// LF only, one newline at the end.
export function renderNotices(entries) {
  const lines = [...HEADER];
  for (const e of entries) {
    lines.push('', `## ${e.name} ${e.version}`, '');
    const used = allowedUnder(e.licence);
    const single = used !== null && ID.test(used);
    const from = e.licenceFrom === 'file' ? ', read off its licence file (its package.json names none)' : '';
    lines.push(`Licence: ${e.licence}` + (single && used !== e.licence ? `, used under ${used}` : '') + from);
    if (used !== null && SOURCE_NAMED.includes(used) && e.source) {
      lines.push('', `Shipped unmodified; its source is at ${e.source}.`);
    }
    lines.push('');
    if (e.text === null || e.text === undefined) {
      lines.push(`No licence file ships in the package; its package.json names ${e.licence}.`);
    } else {
      const longest = Math.max(0, ...(e.text.match(/`+/g) ?? []).map((r) => r.length));
      const fence = '`'.repeat(Math.max(3, longest + 1));
      lines.push(fence + 'text', e.text, fence);
    }
  }
  return lines.join('\n') + '\n';
}
