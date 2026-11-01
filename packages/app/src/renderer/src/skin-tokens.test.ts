import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The skin's tokens read back out of style.css (M9 fix 569): every colour
// in the window is a name of the top :root, set again in four blocks:
// Classic and Emerald, each with a light twin under data-theme (M9 fix
// 1030). A literal left in a rule is a colour no block can reach, so the
// merged tree fails here on any branch that adds one; a new rule uses the
// names of the top :root.
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
const lightClassicBlock = blockAt(':root[data-theme="light"]');
const lightEmeraldBlock = blockAt(':root[data-skin="emerald"][data-theme="light"]');
const classic = decls(classicBlock.body);
const emerald = decls(emeraldBlock.body);
const classicLight = decls(lightClassicBlock.body);
const emeraldLight = decls(lightEmeraldBlock.body);

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

test('the four blocks come in order: Classic, Emerald, Classic light, Emerald light, each light one in color-scheme light (M9 fix 1030)', () => {
  const starts = [classicBlock, emeraldBlock, lightClassicBlock, lightEmeraldBlock].map((b) => b.start);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i]! > starts[i - 1]!, `block ${i} comes after block ${i - 1}`);
  for (const b of [lightClassicBlock, lightEmeraldBlock]) assert.match(b.body, /(^|[;\s])color-scheme:\s*light;/);
});

test('every Classic name is set in each other block, and no block sets a name Classic lacks', () => {
  const exempt = new Map<string, string>([
    // A size, not a colour: the seam is 1px on both skins.
    ['--gutter-size', 'not a colour'],
    // The scheme sets it inline on <html> (scheme-store.ts), above any
    // rule, so a value here would never apply.
    ['--pane-bg', 'set by the scheme'],
  ]);
  // Emerald light is (0,3,0) against the other two's (0,2,0), so it wins
  // only the names it sets; setting every one is what keeps it whole.
  const blocks: [string, Map<string, string>][] = [
    ['Emerald', emerald],
    ['Classic light', classicLight],
    ['Emerald light', emeraldLight],
  ];
  for (const [label, block] of blocks) {
    for (const [name, value] of classic) {
      if (exempt.has(name)) continue;
      // An alias or a mix of names follows the names it is built from.
      if (value.startsWith('var(') || value.startsWith('color-mix(')) continue;
      assert.ok(block.has(name), `${name} has a ${label} value`);
    }
    for (const name of block.keys()) assert.ok(classic.has(name), `${name} (${label}) is a Classic name too`);
    assert.ok(!block.has('--pane-bg'), `the scheme owns --pane-bg, not ${label}`);
  }
});

test('no colour literal outside the four skin blocks', () => {
  // Since fix 1030 the shadows, the scrims and the swatch ring are tokens
  // too, so no rule holds a literal.
  const misses: string[] = [];
  const lines = css.split('\n');
  let offset = 0;
  lines.forEach((line, i) => {
    const at = offset;
    offset += line.length + 1;
    if ([classicBlock, emeraldBlock, lightClassicBlock, lightEmeraldBlock].some((blk) => at >= blk.start && at < blk.end)) return;
    const found = [
      ...line.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
      ...line.matchAll(/\b(?:rgba?|hsla?)\([^)]*\)/g),
      ...line.matchAll(/:\s*(?:[^;]*\s)?\b(?:white|black)\b/g),
    ].map((m) => m[0]);
    if (found.length > 0) misses.push(`style.css:${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(misses, [], 'every colour is a token of the top :root');
});

test('the names fix 1030 added paint what the literals did under dark', () => {
  for (const [label, block] of [
    ['Classic', classic],
    ['Emerald', emerald],
  ] as const) {
    assert.equal(block.get('--scrim'), 'rgba(0, 0, 0, 0.5)', `${label} --scrim`);
    assert.equal(block.get('--shadow-ink'), 'rgba(0, 0, 0, 0.5)', `${label} --shadow-ink`);
    assert.equal(block.get('--shadow-deep'), 'rgba(0, 0, 0, 0.6)', `${label} --shadow-deep`);
    assert.equal(block.get('--attention-peak'), '45%', `${label} --attention-peak`);
    assert.equal(block.get('--focus-fill'), block.get('--focus'), `${label} --focus-fill is its --focus`);
  }
  assert.equal(classicLight.get('--attention-peak'), '22%');
  assert.equal(emeraldLight.get('--attention-peak'), '22%');
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

function hex(block: Map<string, string>, name: string): string {
  const v = block.get(name);
  assert.ok(v && /^#[0-9a-f]{6}$/.test(v), `${name} is a hex, got ${v}`);
  return v!;
}

function floor(block: Map<string, string>, ink: string, ground: string, min: number, label = ''): void {
  const ratio = contrast(hex(block, ink), hex(block, ground));
  assert.ok(ratio >= min, `${label}${ink} on ${ground} is ${ratio.toFixed(2)}:1, under ${min}`);
}

test("the Emerald state colours keep the handoff's contrast floors", () => {
  for (const ink of ['--working', '--blocked', '--done', '--error'])
    for (const ground of ['--sidebar-bg', '--bg', '--title-bg', '--focus-header']) floor(emerald, ink, ground, 4.5);
  floor(emerald, '--focus-ink', '--focus-fill', 7);
  floor(emerald, '--focus-ink', '--focus-hover', 7);
  floor(emerald, '--unit-inactive', '--sidebar-bg', 4.5);
  floor(emerald, '--unit-shell-idle', '--sidebar-bg', 4.5);
});

// The Palette board's measured pairs (docs/design/light-theme/Palette.dc.html,
// read by palcheck.mjs): a ground with --fg on it at 4.5, a text at 4.5 and a
// mark at 3 on the ground named, a fill with its ink on it at 4.5.
const GROUNDS = ['--bg', '--sidebar-bg', '--title-bg', '--chrome-status', '--row-hover', '--row-shown', '--tab-hover', '--row-selected', '--graph-focus-ground', '--focus-header', '--blocked-header', '--warn-bg', '--daemon-bg', '--filter-rest', '--chrome-bg', '--chrome-overlay'];
const TEXTS: [string, string][] = [['--text-hi', '--row-selected'], ['--text', '--bg'], ['--text-mute', '--sidebar-bg'], ['--fg', '--bg'], ['--text-dim', '--bg'], ['--muted', '--title-bg'], ['--focus-text', '--focus-header'], ['--agent-activity', '--bg'], ['--agent-dim', '--bg'], ['--shade-subject', '--bg'], ['--working', '--row-selected'], ['--blocked', '--blocked-header'], ['--done', '--sidebar-bg'], ['--error', '--row-selected'], ['--cost', '--sidebar-bg'], ['--path', '--sidebar-bg'], ['--folder', '--sidebar-bg'], ['--bash-mode', '--bg']];
const MARKS: [string, string][] = [['--placeholder', '--bg'], ['--chrome-symbol', '--chrome-overlay'], ['--focus', '--bg'], ['--gutter-hover', '--bg'], ['--now', '--sidebar-bg'], ['--idle', '--bg'], ['--history-glyph', '--sidebar-bg'], ['--outside-ink', '--bg'], ['--unit-out', '--chrome-status'], ['--unit-returned', '--chrome-status'], ['--unit-inactive', '--chrome-status'], ['--unit-shell-idle', '--chrome-status'], ['--load-peak-ink', '--sidebar-bg'], ['--find-active-border', '--bg'], ['--context-prompt', '--row-hover'], ['--context-tools', '--row-hover'], ['--context-mcp', '--row-hover'], ['--context-mcp-instructions', '--row-hover'], ['--context-agents', '--row-hover'], ['--context-memory', '--row-hover'], ['--context-skills', '--row-hover']];
const FILLS = ['--focus-fill', '--focus-hover'];

// Not the dark test's four-by-four grid, for a measured reason: under
// Classic light --done reads 4.26:1 on --title-bg and 4.35:1 on
// --focus-header, and the board measures it only on --sidebar-bg; and
// --focus-ink on --focus is 3.00:1 and 2.84:1, which is why the fill is
// its own name.
test("the light blocks keep the Palette board's floors, under both skins (M9 fix 1031)", () => {
  for (const [label, block] of [
    ['Classic light: ', classicLight],
    ['Emerald light: ', emeraldLight],
  ] as const) {
    for (const ground of GROUNDS) floor(block, '--fg', ground, 4.5, label);
    for (const [ink, ground] of TEXTS) floor(block, ink, ground, 4.5, label);
    for (const [ink, ground] of MARKS) floor(block, ink, ground, 3, label);
    for (const fill of FILLS) floor(block, '--focus-ink', fill, 7, label);
    for (const [ink] of MARKS.filter(([n]) => n.startsWith('--context-'))) floor(block, ink, '--sidebar-bg', 3, label);
  }
});

test("the Emerald history row's star is the muted grey of its facts line (M9 fix 595)", () => {
  assert.equal(emerald.get('--history-glyph'), emerald.get('--muted'));
  assert.equal(emerald.get('--muted'), '#8a8a8a');
  assert.equal(emeraldLight.get('--history-glyph'), emeraldLight.get('--muted'));
});

test('the sent bubble is the accent at 30 percent under dark and 22 under light (M9 fixes 891 and 1031)', () => {
  assert.equal(classic.get('--bubble-sent'), 'rgba(232, 163, 61, 0.3)');
  assert.equal(emerald.get('--bubble-sent'), 'rgba(62, 207, 142, 0.3)');
  assert.equal(classicLight.get('--bubble-sent'), 'rgba(232, 163, 61, 0.22)');
  assert.equal(emeraldLight.get('--bubble-sent'), 'rgba(62, 207, 142, 0.22)');
});
