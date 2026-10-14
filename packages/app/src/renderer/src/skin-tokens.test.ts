import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The skin's tokens read back out of style.css (M9 fix 569): every colour
// in the window is a name of the top :root, and the Emerald skin is one
// block that sets those names again. A literal left in a rule is a colour
// neither skin can reach, so the merged tree fails here on any branch that
// adds one; a new rule uses the names of the top :root.
const raw = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8');

// Comments out, newlines kept, so a reported line is the file's line.
const css = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

// The body of the first rule whose header is exactly `head`, with its
// start and end offsets.
function blockAt(head: string): { body: string; start: number; end: number } {
  const start = css.indexOf(`${head} {`);
  assert.ok(start >= 0, `a ${head} block`);
  const open = css.indexOf('{', start);
  const end = css.indexOf('}', open);
  return { body: css.slice(open + 1, end), start, end: end + 1 };
}

function decls(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.replace(/\s+/g, ' ').trim());
  return out;
}

const classicBlock = blockAt(':root');
const emeraldBlock = blockAt(':root[data-skin="emerald"]');
const classic = decls(classicBlock.body);
const emerald = decls(emeraldBlock.body);

test('the Classic root holds every name fix 569 added at the value of the literal it replaced', () => {
  const added: [string, string][] = [
    ['--brand', '#e8a33d'],
    ['--selection', 'rgba(74, 144, 217, 0.3)'],
    ['--line-flash', 'rgba(97, 175, 239, 0.35)'],
    ['--filter-rest', '#333333'],
    ['--unit-out', '#c4a36f'],
    ['--unit-returned', '#5d7a65'],
    ['--unit-inactive', '#9a9a9a'],
    ['--unit-shell-idle', '#8fb4d6'],
    ['--overlay-veil', 'rgba(30, 30, 30, 0.96)'],
    ['--drop-fill', 'rgba(74, 144, 217, 0.22)'],
    ['--drop-file-fill', 'rgba(106, 196, 126, 0.18)'],
    ['--drop-target-fill', 'rgba(106, 196, 126, 0.12)'],
    ['--daemon-bg', '#4a2d5a'],
    ['--history-glyph', '#d97757'],
    ['--review-hover', 'rgba(232, 163, 61, 0.08)'],
    ['--review-comment', 'rgba(74, 144, 217, 0.1)'],
    ['--outside-line', '#4a4a4a'],
    ['--outside-ink', '#6e6e6e'],
    ['--agent-activity', '#c8c4bd'],
    ['--commits-sheen', '#f0e6da'],
    ['--agent-dim', '#b8b2a6'],
    ['--shade-subject', '#b4b4b4'],
    ['--segment', '#2f2f2f'],
    ['--find-match', '#4a4a2a'],
    ['--find-match-border', '#8a8a4a'],
    ['--find-active', '#7a5a1a'],
    ['--find-active-border', '#e5c07b'],
    ['--chrome-bg', '#1e1e1e'],
    ['--chrome-overlay', '#202020'],
    ['--chrome-symbol', '#9a9a9a'],
    // Moved in from the later :root blocks, at their old values.
    ['--load-peak-ink', '#7d6c4d'],
    ['--load-rule', '#242424'],
    ['--load-none', '#4a4a4a'],
    ['--load-base-focus', '#3a3230'],
    ['--pane-bg', '#1e1e1e'],
    ['--blocked-debt-fill', 'rgba(78, 201, 176, 0.16)'],
  ];
  for (const [name, value] of added) assert.equal(classic.get(name), value, `${name} in the Classic :root`);
});

test('every Classic name is set in the Emerald block, and the block sets no name Classic lacks', () => {
  const exempt = new Map<string, string>([
    // A size, not a colour: the seam is 1px on both skins.
    ['--gutter-size', 'not a colour'],
    // The scheme sets it inline on <html> (scheme-store.ts), above any
    // rule, so an Emerald value here would never apply.
    ['--pane-bg', 'set by the scheme'],
  ]);
  for (const [name, value] of classic) {
    if (exempt.has(name)) continue;
    // An alias or a mix of names follows the names it is built from.
    if (value.startsWith('var(') || value.startsWith('color-mix(')) continue;
    assert.ok(emerald.has(name), `${name} has an Emerald value`);
  }
  for (const name of emerald.keys()) assert.ok(classic.has(name), `${name} is a Classic name too`);
  assert.ok(!emerald.has('--pane-bg'), 'the scheme owns --pane-bg');
});

test('no colour literal outside the two skin blocks', () => {
  // Black shadows and the scrim are black on both skins; the active menu
  // swatch's white ring (slip 13) is white on both.
  const allowed = [/^rgba\(0, 0, 0, [\d.]+\)$/];
  const allowedLines = [/^\s*border-color: white;$/];
  const misses: string[] = [];
  const lines = css.split('\n');
  let offset = 0;
  lines.forEach((line, i) => {
    const at = offset;
    offset += line.length + 1;
    if ((at >= classicBlock.start && at < classicBlock.end) || (at >= emeraldBlock.start && at < emeraldBlock.end)) return;
    if (allowedLines.some((re) => re.test(line))) return;
    const found = [
      ...line.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
      ...line.matchAll(/\b(?:rgba?|hsla?)\([^)]*\)/g),
      ...line.matchAll(/:\s*(?:[^;]*\s)?\b(?:white|black)\b/g),
    ].map((m) => m[0]);
    for (const lit of found) {
      if (allowed.some((re) => re.test(lit))) continue;
      misses.push(`style.css:${i + 1}: ${line.trim()}`);
      break;
    }
  });
  assert.deepEqual(misses, [], 'every colour is a token of the top :root');
});

// WCAG relative luminance and contrast, as in session-mark-css.test.ts.
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test('the Emerald state colours keep the handoff\'s contrast floors', () => {
  const hex = (name: string): string => {
    const v = emerald.get(name);
    assert.ok(v && /^#[0-9a-f]{6}$/.test(v), `${name} is a hex in the Emerald block`);
    return v!;
  };
  const floor = (ink: string, ground: string, min: number) => {
    const ratio = contrast(hex(ink), hex(ground));
    assert.ok(ratio >= min, `${ink} on ${ground} is ${ratio.toFixed(2)}:1, under ${min}`);
  };
  for (const ink of ['--working', '--blocked', '--done', '--error'])
    for (const ground of ['--sidebar-bg', '--bg', '--title-bg', '--focus-header']) floor(ink, ground, 4.5);
  floor('--focus-ink', '--focus', 7);
  floor('--focus-ink', '--focus-hover', 7);
  floor('--unit-inactive', '--sidebar-bg', 4.5);
  floor('--unit-shell-idle', '--sidebar-bg', 4.5);
});

test("the Emerald history row's star is the muted grey of its facts line (M9 fix 595)", () => {
  assert.equal(emerald.get('--history-glyph'), emerald.get('--muted'));
  assert.equal(emerald.get('--muted'), '#8a8a8a');
});
