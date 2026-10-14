import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_COLORS } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import { withPreview } from './color-preview-model.ts';
import { colorSwatches } from './session-color.ts';
import { endSessionColorPreview, getState, holdSessionColorPreview, onPush, previewSessionColor, savedSessionColor } from './store.ts';
import { aSession } from './test-support.ts';

// The colour preview (M9 fix 157): the pure overlay, then the store's
// snapshot under a hover, a leave, a pick held until the push, and the
// swatch model's handlers driving it.

function session(id: string, color: string | null): SessionInfo {
  return aSession({ id, name: id, color });
}

test('withPreview lays the colour over the one session and hands the map back untouched otherwise', () => {
  const a = session('a', '#111111');
  const b = session('b', '#222222');
  const map = new Map([
    ['a', a],
    ['b', b],
  ]);
  assert.equal(withPreview(map, null), map);
  assert.equal(withPreview(map, { sessionId: 'zz', color: '#333333', held: false }), map);
  assert.equal(withPreview(map, { sessionId: 'a', color: '#111111', held: false }), map);
  const over = withPreview(map, { sessionId: 'a', color: '#333333', held: false });
  assert.notEqual(over, map);
  assert.equal(over.get('a')?.color, '#333333');
  assert.equal(over.get('b'), b);
  assert.equal(map.get('a')?.color, '#111111');
});

// The store's snapshot: fed by pushes, as the daemon feeds it.
const push = (s: SessionInfo) => onPush({ type: 'session.changed', session: s } as Parameters<typeof onPush>[0]);

test('the store shows the preview on hover, the saved colour on leave, and holds a pick until the push', () => {
  push(session('p', '#111111'));
  push(session('q', '#222222'));
  assert.equal(getState().preview, null);
  previewSessionColor('p', '#333333');
  assert.equal(getState().sessions.get('p')?.color, '#333333');
  assert.equal(getState().sessions.get('q')?.color, '#222222');
  assert.equal(savedSessionColor('p'), '#111111');
  assert.equal(savedSessionColor('nobody'), undefined);
  // A leave puts the saved colour back.
  endSessionColorPreview('p');
  assert.equal(getState().sessions.get('p')?.color, '#111111');
  assert.equal(getState().preview, null);
  // A leave named for another session leaves a preview alone.
  previewSessionColor('p', '#333333');
  endSessionColorPreview('q');
  assert.equal(getState().sessions.get('p')?.color, '#333333');
  // A pick holds through the leave the menu's close brings, until the
  // daemon pushes the session back; a hover elsewhere cannot displace it.
  holdSessionColorPreview('p', '#444444');
  endSessionColorPreview('p');
  assert.equal(getState().sessions.get('p')?.color, '#444444');
  previewSessionColor('q', '#555555');
  assert.equal(getState().sessions.get('q')?.color, '#222222');
  push(session('p', '#444444'));
  assert.equal(getState().preview, null);
  assert.equal(getState().sessions.get('p')?.color, '#444444');
  // A failed request ends a held preview by force.
  holdSessionColorPreview('p', '#666666');
  endSessionColorPreview('p', true);
  assert.equal(getState().sessions.get('p')?.color, '#444444');
  // A removed session takes its preview with it.
  previewSessionColor('q', '#555555');
  onPush({ type: 'session.removed', sessionId: 'q' } as Parameters<typeof onPush>[0]);
  assert.equal(getState().preview, null);
});

test('the swatch model previews on enter, ends on leave, holds on a pick and marks the saved colour', async () => {
  const first = SESSION_COLORS[0]!;
  push(session('s', first));
  const requests: unknown[] = [];
  (globalThis as { window?: unknown }).window = { emerald: { request: (type: string, body: unknown) => (requests.push([type, body]), Promise.resolve({})) } };
  let closed = 0;
  const swatches = colorSwatches(getState().sessions.get('s')!, () => (closed += 1));
  const other = swatches.swatches.find((sw) => sw.color !== first)!;
  other.onEnter?.();
  assert.equal(getState().sessions.get('s')?.color, other.color);
  // The mark is on the saved colour even when the row is rebuilt under
  // the preview.
  const rebuilt = colorSwatches(getState().sessions.get('s')!, () => undefined);
  assert.deepEqual(
    rebuilt.swatches.filter((sw) => sw.active).map((sw) => sw.color),
    [first],
  );
  swatches.onLeave?.();
  assert.equal(getState().sessions.get('s')?.color, first);
  other.onEnter?.();
  other.onPick();
  swatches.onLeave?.();
  assert.equal(closed, 1);
  assert.equal(getState().sessions.get('s')?.color, other.color, 'held through the close');
  assert.deepEqual(requests, [['session.set', { sessionId: 's', color: other.color }]]);
  push(session('s', other.color));
  assert.equal(getState().preview, null);
  assert.equal(getState().sessions.get('s')?.color, other.color);
  // A request that fails ends the hold.
  (globalThis as { window?: unknown }).window = { emerald: { request: () => Promise.reject(new Error('not-found')) } };
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    swatches.swatches[0]!.onPick();
    assert.equal(getState().sessions.get('s')?.color, swatches.swatches[0]!.color);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(getState().sessions.get('s')?.color, other.color, 'back to the saved colour once the request failed');
  } finally {
    console.warn = warn;
  }
});
