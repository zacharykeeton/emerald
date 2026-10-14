import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SessionInfo } from '@emerald/shared';
import { GEM_FACETS, GEM_OUTLINE, GLINT_BAND, titleGlint } from './title-gem-model.ts';

// The title-bar gem (M9 fix 571): the model written out as literals, not
// recomputed from the handoff's points (a recomputation would pass a wrong
// model), the glint's truth table, and its rules read out of style.css.

test('the gem is the nine flush shapes of the handoff, in paint order', () => {
  assert.deepEqual(GEM_FACETS, [
    { d: 'M104 40L152 40L140 84L116 84Z', fill: '#57d99c' },
    { d: 'M152 40L196 84L158 102L140 84Z', fill: '#3cc184' },
    { d: 'M196 84L196 172L158 154L158 102Z', fill: '#22905c' },
    { d: 'M196 172L152 216L140 172L158 154Z', fill: '#176a44' },
    { d: 'M152 216L104 216L116 172L140 172Z', fill: '#1c7f51' },
    { d: 'M104 216L60 172L98 154L116 172Z', fill: '#259a63' },
    { d: 'M60 172L60 84L98 102L98 154Z', fill: '#45c98c' },
    { d: 'M60 84L104 40L116 84L98 102Z', fill: '#9ff2c8' },
    { d: 'M116 84L140 84L158 102L158 154L140 172L116 172L98 154L98 102Z', fill: '#2fb67a' },
  ]);
  assert.equal(GEM_OUTLINE, 'M104 40L152 40L196 84L196 172L152 216L104 216L60 172L60 84Z');
  assert.equal(GLINT_BAND, 'M40 40h44l-60 176h-44z');
});

function session(over: Partial<SessionInfo>): SessionInfo {
  return { kind: 'claude', claudeSessionId: null, lastEventAt: null, state: 'working', stale: false, ...over } as SessionInfo;
}

test('the glint runs only under Emerald, collapsed, with a Claude session working', () => {
  for (const skin of ['classic', 'emerald'] as const) {
    for (const collapsed of [false, true]) {
      for (const working of [false, true]) {
        const sessions = [session({ state: working ? 'working' : 'idle' })];
        const want = skin === 'emerald' && collapsed && working;
        assert.equal(titleGlint(skin, collapsed, sessions), want, `${skin}, collapsed ${collapsed}, working ${working}`);
      }
    }
  }
  assert.equal(titleGlint('emerald', true, [session({ stale: true })]), false, 'a stale session does not count');
  assert.equal(titleGlint('emerald', true, [session({ kind: 'shell' })]), false, 'a plain shell does not count');
  assert.equal(titleGlint('emerald', true, []), false, 'no sessions');
});

const css = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8');

test('the glint keyframes move by transform alone', () => {
  const m = /@keyframes title-gem-glint\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(m, 'the keyframes');
  const stops = [...m[1]!.matchAll(/(\d+)%\s*\{([^}]*)\}/g)].map((s) => [s[1], s[2]!.trim()]);
  assert.deepEqual(stops, [
    ['0', 'transform: translateX(-120px);'],
    ['6', 'transform: translateX(330px);'],
    ['100', 'transform: translateX(330px);'],
  ]);
});

test('the glint animates only under no-preference and only on a glinting mark', () => {
  const uses = [...css.matchAll(/animation:\s*title-gem-glint 10s ease-in-out infinite;/g)];
  assert.equal(uses.length, 1, 'one animation rule');
  const before = css.slice(0, uses[0]!.index);
  const media = before.lastIndexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(media >= 0, 'inside a no-preference block');
  const inner = css.slice(media, uses[0]!.index);
  assert.ok(!inner.slice(inner.indexOf('{') + 1).includes('\n}'), 'no block closes between the media query and the rule');
  assert.match(inner, /\.title-bar-mark\[data-glint\] \.title-gem-glint\s*\{\s*$/, 'on the glinting mark alone');
  const rest = /\n\.title-gem-glint\s*\{\s*transform: translateX\(-120px\);\s*\}/.exec(css);
  assert.ok(rest, 'the band rests off the gem outside the media block');
  assert.ok(rest.index < media, 'the resting rule sits before the media block');
});
