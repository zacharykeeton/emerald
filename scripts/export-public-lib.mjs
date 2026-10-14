// The pure half of scripts/export-public.mjs (M9 fix 611): the exclude
// list's matcher and the secret scan, with no fs and no spawn so the tests
// can drive both on strings. Every expression below is a regex literal and
// every comment names the address the scan stops on only as "the work
// address", so this file scans clean under its own rules.

// One entry per line of the list that is not blank or a comment, in file
// order: { line, text, negate, dirOnly, re }. Gitignore's rules as far as
// the list needs them: a leading ! negates, a trailing / matches folders
// only, a / anywhere else anchors the pattern at the root (a leading /
// stripped), and a pattern with none matches at any depth.
export function parsePatterns(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === '' || raw.startsWith('#')) continue;
    let body = raw;
    const negate = body.startsWith('!');
    if (negate) body = body.slice(1);
    const dirOnly = body.endsWith('/');
    if (dirOnly) body = body.replace(/\/+$/, '');
    // The trailing slash was taken off first: `.claude/` is not anchored.
    const anchored = body.includes('/');
    if (body.startsWith('/')) body = body.slice(1);
    const glob = globToRegex(body);
    const re = new RegExp(anchored ? `^${glob}$` : `^(?:.*/)?${glob}$`);
    out.push({ line: i + 1, text: raw, negate, dirOnly, re });
  }
  return out;
}

function globToRegex(glob) {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        // `**/` is any run of folders, none included.
        out += '(?:.*/)?';
        i += 3;
      } else {
        out += '.*';
        i += 2;
      }
    } else if (c === '*') {
      out += '[^/]*';
      i += 1;
    } else if (c === '?') {
      out += '[^/]';
      i += 1;
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m);
      i += 1;
    }
  }
  return out;
}

// The pattern that decides a tracked file, or null when none does (kept).
// A file under a folder the list excludes cannot be brought back by a
// later negation, which is git's rule: the folders are walked from the top
// and the last pattern matching a folder decides when it is not a negation.
// Otherwise the last pattern matching the file itself decides, and a
// negation that decides keeps the file.
export function decide(patterns, file) {
  const parts = file.split('/');
  for (let n = 1; n < parts.length; n++) {
    const folder = parts.slice(0, n).join('/');
    let last = null;
    for (const p of patterns) if (p.re.test(folder)) last = p;
    if (last && !last.negate) return last;
  }
  let last = null;
  for (const p of patterns) if (!p.dirOnly && p.re.test(file)) last = p;
  return last;
}

export function isExcluded(patterns, file) {
  const p = decide(patterns, file);
  return p !== null && !p.negate;
}

// Files the export writes under another name (M9 fix 661): the source is
// left out by the list and its copy lands at `to`.
export const MAPPED = [{ from: 'scripts/public/CLAUDE.md', to: 'CLAUDE.md' }];

// What the scan looks for, in report order. A finding that fails stops the
// export unless passed to --allow; unc-path and excluded-ref are reported
// only, since every unc-path hit on the tree is a pipe fixture.
export const FINDINGS = [
  { name: 'work-email', fails: true, re: /@emergentsoftware\.net/i },
  { name: 'github-token', fails: true, re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { name: 'anthropic-key', fails: true, re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'api-key', fails: true, re: /\bsk-[A-Za-z0-9_]{20,}/ },
  { name: 'aws-key', fails: true, re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key', fails: true, re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  // The key=value form of a URL, an ini or an env file, no space around
  // the =: with spaces allowed every `const token = readToken(log)` hits.
  { name: 'secret-assignment', fails: true, re: /\b(?:password|passwd|pwd|secret|token)=(?![$%{])[^\s&"'<>]{8,}/i },
  // The drive form with either slash, Git Bash's /c/Users form, and the
  // 8.3 short name the temp folder comes back as.
  { name: 'home-path', fails: true, re: /(?:\b[A-Za-z]:|\/[a-z])[\\/]+Users[\\/]+(?:ZacharyKeeton|ZACHAR~1)/i },
  // The worktree folder beside this box's checkout.
  { name: 'box-worktrees', fails: true, re: /zorca[-]wt/i },
  // The db box, by address or by machine name.
  { name: 'box-address', fails: true, re: /\b10\.10\.10\.3\b|\bDESKTOP-H4S0JK[J]\b/i },
  // A UNC share (two backslashes, a host, a share), raw or escaped in a
  // string; never a pipe path, whose
  // host is a dot, and never an escaped drive path, which the lookbehind
  // drops.
  { name: 'unc-path', fails: false, re: /(?<![\w:\\/.~-])\\{2,}[A-Za-z][\w.$-]*\\{1,2}[\w.$-]+/ },
  // A pointer into a file the list leaves out: reported only, since most are
  // citations a reader can pass over; --verbose lists them.
  {
    name: 'excluded-ref',
    fails: false,
    re: /docs\/(?:design|hardening)\/|docs\/(?:BACKLOG|BACKLOG-INBOX|BENCH-LATENCY|DONE|GOTCHAS|PLAN|RETRO-LEDGER|WORKFLOW)\.md|backlog-and-batch\.workflow\.json|DECK_PROJECT_BRIEF\.md|\.claude\/(?:skills\/batch|agents)\/|migrate-from-zorca\.ps1|scripts\/rename\.mjs/,
  },
];

// Every finding on every line: { file, line, name, fails }.
export function scanText(file, text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const f of FINDINGS) {
      if (f.re.test(lines[i])) hits.push({ file, line: i + 1, name: f.name, fails: f.fails });
    }
  }
  return hits;
}

// rename.mjs's rule: a NUL in the first 8192 bytes.
export function isBinary(buf) {
  return buf.subarray(0, 8192).includes(0);
}

// A batch is in flight exactly when docs/PLAN.md holds the heading of its
// tasks section (the plan commit adds it, the docs commit moves it to
// docs/DONE.md). The heading carries a description after the two numbers
// (the last one: `## M9 tasks, fixes 608 to 619, the public batch: ...`),
// so only the start of the line is matched. { first, last } or null.
export function batchInFlight(planText) {
  const m = /^## M9 tasks, fixes (\d+) to (\d+)/m.exec(planText);
  return m ? { first: Number(m[1]), last: Number(m[2]) } : null;
}
