import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designLabel } from '@emerald/shared';
import type { DesignPick } from '@emerald/shared';
import { DESIGN_CALL, DESIGN_GUEST_SCRIPT, DESIGN_LABEL_SOURCE, clipRect, grabKey, readPick, shotName } from './design-guest.ts';

function goodPick(): DesignPick {
  return {
    url: 'http://127.0.0.1:5173/',
    viewport: { width: 800, height: 600 },
    dpr: 1.5,
    selector: '#cta',
    tag: 'button',
    role: 'button',
    text: 'Start free trial',
    html: '<button id="cta">Start free trial</button>',
    styles: [['display', 'inline-block']],
    rect: { x: 10, y: 20, width: 182, height: 44 },
    nearby: 'Plans and pricing',
    source: null,
  };
}

test('the guest script and the page calls parse as plain JavaScript (M9 fix 674)', () => {
  assert.doesNotThrow(() => new Function(DESIGN_GUEST_SCRIPT));
  for (const call of Object.values(DESIGN_CALL)) assert.doesNotThrow(() => new Function(call), call);
  assert.ok(DESIGN_GUEST_SCRIPT.includes(DESIGN_LABEL_SOURCE));
  assert.ok(!DESIGN_GUEST_SCRIPT.includes('`'));
  assert.ok(!DESIGN_GUEST_SCRIPT.includes('${'));
});

test("the script's copy of the label rule answers as designLabel does (M9 fix 674)", () => {
  const label = new Function(`${DESIGN_LABEL_SOURCE}\nreturn emeraldDesignLabel;`)() as (p: unknown) => string;
  const cases: DesignPick[] = [goodPick(), { ...goodPick(), text: 'x'.repeat(45) }, { ...goodPick(), tag: 'div', role: null, text: '' }];
  for (const p of cases) assert.equal(label({ tag: p.tag, role: p.role, text: p.text, rect: p.rect }), designLabel(p));
});

test('grabKey reads C, S and Escape without a modifier (M9 fix 674)', () => {
  const key = (code: string, over: Partial<{ type: string; control: boolean; shift: boolean; alt: boolean; meta: boolean }> = {}) => ({
    type: 'keyDown',
    code,
    control: false,
    shift: false,
    alt: false,
    meta: false,
    ...over,
  });
  assert.equal(grabKey(key('KeyC')), 'copy');
  assert.equal(grabKey(key('KeyS')), 'shot');
  assert.equal(grabKey(key('Escape')), 'cancel');
  assert.equal(grabKey(key('KeyC', { control: true })), null);
  assert.equal(grabKey(key('KeyS', { shift: true })), null);
  assert.equal(grabKey(key('KeyC', { type: 'keyUp' })), 'copy');
  assert.equal(grabKey(key('Escape', { type: 'rawKeyDown' })), 'cancel');
  assert.equal(grabKey(key('KeyC', { type: 'char' })), null);
  assert.equal(grabKey(key('KeyA')), null);
});

test('clipRect keeps the part of the box inside the viewport (M9 fix 674)', () => {
  const vp = { width: 800, height: 600 };
  assert.deepEqual(clipRect({ x: 10, y: 20, width: 100, height: 50 }, vp), { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(clipRect({ x: -20, y: 580, width: 100, height: 50 }, vp), { x: 0, y: 580, width: 80, height: 20 });
  assert.equal(clipRect({ x: 900, y: 20, width: 100, height: 50 }, vp), null);
  assert.equal(clipRect({ x: 10, y: 20, width: 0, height: 50 }, vp), null);
});

test('shotName is the local time to the millisecond (M9 fix 674)', () => {
  assert.equal(shotName(new Date(2026, 9, 14, 7, 5, 3, 9)), '20261014-070503-009.png');
});

test('readPick takes a good answer and refuses a bad one (M9 fix 674)', () => {
  assert.deepEqual(readPick(goodPick()), goodPick());
  assert.equal(readPick(null), null);
  assert.equal(readPick('x'), null);
  const { selector: _gone, ...missing } = goodPick();
  assert.equal(readPick(missing), null);
  assert.equal(readPick({ ...goodPick(), selector: 'a'.repeat(1025) }), null);
  assert.equal(readPick({ ...goodPick(), styles: Array.from({ length: 17 }, () => ['a', 'b']) }), null);
  assert.equal(readPick({ ...goodPick(), rect: { x: Number.NaN, y: 0, width: 1, height: 1 } }), null);
  assert.equal(readPick({ ...goodPick(), styles: [['a', 1]] }), null);
  assert.equal(readPick({ ...goodPick(), role: 3 }), null);
});
