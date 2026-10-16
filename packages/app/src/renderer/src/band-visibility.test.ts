import { test } from 'node:test';
import assert from 'node:assert/strict';

// M9 fix 789: the module makes its observer on the first call, so the fake
// goes on globalThis before the module is imported.
interface Fake {
  options: IntersectionObserverInit | undefined;
  callback: (entries: Array<{ target: unknown; isIntersecting: boolean }>) => void;
  observed: unknown[];
  unobserved: unknown[];
}
const made: Fake[] = [];
class FakeObserver {
  fake: Fake;
  constructor(callback: Fake['callback'], options?: IntersectionObserverInit) {
    this.fake = { options, callback, observed: [], unobserved: [] };
    made.push(this.fake);
  }
  observe(el: unknown): void {
    this.fake.observed.push(el);
  }
  unobserve(el: unknown): void {
    this.fake.unobserved.push(el);
  }
}
(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
const { observeBand } = await import('./band-visibility.ts');

// An element with just the attribute calls the module makes.
function fakeEl() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    hasAttribute: (k: string) => attrs.has(k),
  };
}

test('observeBand watches every band line with one observer, and the callback sets data-offscreen', () => {
  const a = fakeEl();
  const b = fakeEl();
  const cleanA = observeBand(a as unknown as HTMLElement);
  observeBand(b as unknown as HTMLElement);
  assert.equal(made.length, 1, 'one observer');
  const fake = made[0]!;
  assert.equal(fake.options?.rootMargin, '100px 0px');
  assert.equal(fake.options?.threshold, 0);
  assert.deepEqual(fake.observed, [a, b]);
  fake.callback([{ target: a, isIntersecting: false }]);
  assert.equal(a.hasAttribute('data-offscreen'), true, 'out of view');
  assert.equal(b.hasAttribute('data-offscreen'), false, 'the other is untouched');
  fake.callback([{ target: a, isIntersecting: true }]);
  assert.equal(a.hasAttribute('data-offscreen'), false, 'back in view');
  fake.callback([{ target: a, isIntersecting: false }]);
  assert.equal(typeof cleanA, 'function');
  cleanA!();
  assert.deepEqual(fake.unobserved, [a]);
  assert.equal(a.hasAttribute('data-offscreen'), false, 'the cleanup clears the attribute');
});

test('observeBand(null) returns nothing', () => {
  assert.equal(observeBand(null), undefined);
});
