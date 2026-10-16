import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The sheet's motion rule (CLAUDE.md, Style; M9 fix 535): an animation that
// loops is transform or opacity only, since every other property is a
// main-thread repaint of the element's whole box on every frame. Read from
// style.css, since no screenshot shows a repaint's cost.
const css = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8');

function keyframes(name: string): string {
  const m = new RegExp(`@keyframes ${name}\\s*\\{`).exec(css);
  assert.ok(m, `@keyframes ${name}`);
  // The at-rule's body ends at its matching brace.
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (depth > 0 && i < css.length) {
    const c = css[i++];
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  return css.slice(start, i - 1);
}

function declaredProperties(body: string): Set<string> {
  const props = new Set<string>();
  for (const m of body.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:/g)) props.add(m[1]!);
  return props;
}

// A looping animation that is allowed to repaint, with the reason. The
// wanting row's pulse is a row-sized colour cycle that runs only while
// something waits on someone and ends on a click (fix 535 kept it).
const ALLOWED = ['attention-pulse'];

test('every infinite animation animates transform or opacity only', () => {
  const names = new Set<string>();
  for (const m of css.matchAll(/animation:\s*([a-z-]+)\s[^;]*\binfinite\b/g)) names.add(m[1]!);
  assert.ok(names.size >= 8, `found the looping animations, got ${[...names].join(', ')}`);
  for (const name of names) {
    if (ALLOWED.includes(name)) continue;
    for (const prop of declaredProperties(keyframes(name))) {
      assert.ok(prop === 'transform' || prop === 'opacity', `@keyframes ${name} animates ${prop}`);
    }
  }
});

test('the text-clip sheen is gone and the band moves by transform alone', () => {
  assert.ok(!/@keyframes turn-sheen/.test(css), 'no turn-sheen keyframes');
  assert.ok(!/turn-sheen/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no rule uses turn-sheen');
  assert.deepEqual([...declaredProperties(keyframes('turn-band'))], ['transform']);
});

test('each band host clips its band', () => {
  for (const host of [
    '.sidebar-row[data-working] .sidebar-row-agent',
    '.commits-agent-activity[data-working]',
    '.title-bar-update[data-phase="downloading"]',
  ]) {
    const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rules = [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]!).join('\n');
    assert.ok(/position:\s*relative/.test(rules), `${host} is positioned`);
    // The two text lines get their clip from the ellipsis rule; the
    // sidebar's is repeated in the band rule, the rail's is on its base.
    const clipped = /overflow:\s*hidden/.test(rules) || (host.startsWith('.commits-agent-activity') && /\.commits-agent-activity\s*\{[^}]*overflow:\s*hidden/.test(css));
    assert.ok(clipped, `${host} clips its overflow`);
    assert.ok(new RegExp(`${escaped}::after\\s*\\{[^}]*animation:\\s*turn-band 2\\.6s linear infinite`).test(css), `${host}::after runs the band`);
  }
});

// M9 fix 789: band-visibility.ts marks a line out of view and the sheet
// stops its band.
test('the bands stop off screen (fix 789)', () => {
  for (const host of ['.sidebar-row[data-working] .sidebar-row-agent[data-offscreen]', '.commits-agent-activity[data-working][data-offscreen]']) {
    const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`${escaped}::after\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(m, `${host}::after has a rule`);
    assert.equal(m[1]!.trim(), 'animation: none;', `${host}::after stops the band`);
  }
});
