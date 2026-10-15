import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENDLESS_LEFT_ALONE, ONE_OFF_ANIMATIONS, PULSE_ANIMATIONS, isPulse } from './pulse-sync-model.ts';

// The three sets pin the sheet's keyframes (M9 fix 729): a new @keyframes
// fails here until someone says whether it is a pulse.
const css = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8');

test('M9 fix 729: every keyframe in the sheet is filed in exactly one of the three sets', () => {
  const inSheet = [...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]!).sort();
  const filed = [...PULSE_ANIMATIONS, ...ONE_OFF_ANIMATIONS, ...ENDLESS_LEFT_ALONE].sort();
  assert.deepEqual(filed, inSheet);
});

test('M9 fix 729: the three sets are disjoint', () => {
  const all = [...PULSE_ANIMATIONS, ...ONE_OFF_ANIMATIONS, ...ENDLESS_LEFT_ALONE];
  assert.equal(new Set(all).size, all.length);
});

test('M9 fix 729: a pulse loops forever and a one-shot does not', () => {
  const shorthands = [...css.matchAll(/(?:^|[;{\s])animation:\s*([^;}]+)[;}]/g)].map((m) => m[1]!);
  assert.ok(shorthands.length >= 15, `found the animation shorthands, got ${shorthands.length}`);
  for (const decl of shorthands) {
    const name = decl.trim().split(/\s+/)[0]!;
    if (PULSE_ANIMATIONS.has(name)) assert.match(decl, /\binfinite\b/, `${name} is a pulse and should say infinite: ${decl}`);
    if (ONE_OFF_ANIMATIONS.has(name)) assert.doesNotMatch(decl, /\binfinite\b/, `${name} is a one-shot and should not loop: ${decl}`);
  }
});

test('isPulse is true for a pulse and false for anything else', () => {
  assert.equal(isPulse('attention-pulse'), true);
  assert.equal(isPulse('focus-flash'), false);
  assert.equal(isPulse('usage-spin'), false);
  assert.equal(isPulse('fadeIn'), false);
});
