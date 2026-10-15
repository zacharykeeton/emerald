import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveMark, wireDrivenPage } from './browser-drive-store.ts';

// M9 fixes 672 and 673: the driven mark's words. The module touches no
// window at import, which this import proves.
test('the mark says who drives, stays through the linger, and says when the person paused it', () => {
  assert.equal(driveMark(null), null);
  const running = { text: 'alpha is driving', title: 'alpha is driving this page with emmer browser; a click or a key in the page pauses it' };
  assert.deepEqual(driveMark({ by: 'alpha', running: true, paused: false }), running);
  assert.deepEqual(driveMark({ by: 'alpha', running: false, paused: false }), running);
  assert.deepEqual(driveMark({ by: 'alpha', running: false, paused: true }), { text: 'alpha paused', title: "A click or a key of yours paused alpha's commands" });
});

// M9 fix 693: a guest whose id cannot be read at its attach is registered
// at its dom-ready, and the miss is said once as a warning.
test('a guest not readable at its attach is registered at dom-ready, with one warning', () => {
  const calls: Array<[string, number]> = [];
  const g = globalThis as unknown as { window?: unknown };
  const before = g.window;
  g.window = {
    emerald: {
      browser: {
        onDrive: () => undefined,
        onTakeFocus: () => () => undefined,
        tookFocus: () => undefined,
        guest: (paneId: string, id: number) => calls.push([paneId, id]),
      },
    },
  };
  const warns: string[] = [];
  const warn = console.warn;
  console.warn = (msg: string) => warns.push(msg);
  try {
    let reads = 0;
    const page = Object.assign(new EventTarget(), {
      getWebContentsId: () => {
        reads += 1;
        if (reads === 1) throw new Error('not attached');
        return 7;
      },
    }) as unknown as HTMLElement & { getWebContentsId(): number };
    const unwire = wireDrivenPage(page, () => 'p1');
    page.dispatchEvent(new Event('did-attach'));
    page.dispatchEvent(new Event('dom-ready'));
    unwire();
    page.dispatchEvent(new Event('dom-ready'));
    assert.deepEqual(warns, ['[emerald] browser guest not registered at attach']);
    assert.deepEqual(calls, [['p1', 7]]);
  } finally {
    console.warn = warn;
    g.window = before;
  }
});
