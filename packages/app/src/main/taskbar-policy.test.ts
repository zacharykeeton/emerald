import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_SIZE, PULSE_MS, badgeColour, createTaskbarPolicy, drawBadge } from './taskbar-policy.ts';
import type { TaskbarWindow } from './taskbar-policy.ts';

// M9 fix 560: the taskbar's attention policy, pinned over a recording
// window and a fake timer.

function setup(opts: { held?: boolean; windows?: boolean } = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const pulses: Array<{ ms: number; fn: () => void; stopped: boolean }> = [];
  const win: TaskbarWindow = {
    flashFrame: (on) => calls.push(`flash ${on}`),
    setOverlay: (count, bright) => calls.push(count === null ? 'overlay none' : `overlay ${count} ${bright ? 'bright' : 'dim'}`),
  };
  const policy = createTaskbarPolicy(() => win, {
    held: opts.held ?? false,
    windows: opts.windows ?? true,
    log: (m) => logs.push(m),
    every: (ms, fn) => {
      const p = { ms, fn, stopped: false };
      pulses.push(p);
      return () => {
        p.stopped = true;
      };
    },
  });
  return { policy, calls, logs, pulses };
}

test('taskbar policy: a count that is not a finite number of zero or more is ignored', () => {
  const s = setup({ held: true });
  for (const wanting of [-1, NaN, '2' as unknown as number]) s.policy.set({ wanting, flash: true });
  assert.deepEqual(s.logs, []);
  assert.deepEqual(s.calls, []);
});

test('taskbar policy: a fractional count is floored', () => {
  const s = setup({ held: true });
  s.policy.set({ wanting: 2.7, flash: false });
  assert.deepEqual(s.logs, ['taskbar held under a private EMERALD_HOME: 2 wanting, no flash']);
});

test('taskbar policy: held, one line per change and the window never touched', () => {
  const s = setup({ held: true });
  s.policy.set({ wanting: 2, flash: true });
  s.policy.set({ wanting: 2, flash: false });
  s.policy.set({ wanting: 2, flash: true });
  s.policy.set({ wanting: 0, flash: false });
  s.policy.set({ wanting: 0, flash: false });
  assert.deepEqual(s.logs, [
    'taskbar held under a private EMERALD_HOME: 2 wanting, flash',
    'taskbar held under a private EMERALD_HOME: 2 wanting, flash',
    'taskbar held under a private EMERALD_HOME: cleared',
  ]);
  assert.deepEqual(s.calls, []);
  assert.equal(s.pulses.length, 0);
});

test('taskbar policy: on Windows a rise flashes, paints and pulses; zero clears and stops', () => {
  const s = setup();
  s.policy.set({ wanting: 2, flash: true });
  assert.deepEqual(s.calls, ['flash true', 'overlay 2 bright']);
  assert.equal(s.pulses.length, 1);
  assert.equal(s.pulses[0]!.ms, PULSE_MS / 2);
  assert.equal(s.policy.pulsing(), true);
  s.pulses[0]!.fn();
  assert.equal(s.calls.at(-1), 'overlay 2 dim', 'a tick paints the dim frame');
  s.policy.set({ wanting: 3, flash: true });
  assert.equal(s.pulses.length, 1, 'a second rise starts no second pulse');
  s.calls.length = 0;
  s.policy.set({ wanting: 0, flash: false });
  assert.deepEqual(s.calls, ['flash false', 'overlay none']);
  assert.equal(s.pulses[0]!.stopped, true);
  assert.equal(s.policy.pulsing(), false);
  s.calls.length = 0;
  s.policy.set({ wanting: 0, flash: false });
  assert.deepEqual(s.calls, [], 'a second zero does nothing');
});

test('taskbar policy: off Windows the flash alone, no overlay and no pulse', () => {
  const s = setup({ windows: false });
  s.policy.set({ wanting: 2, flash: true });
  assert.deepEqual(s.calls, ['flash true']);
  assert.equal(s.pulses.length, 0);
});

test('drawBadge: the text caps at 99, and the dim frame is half alpha', () => {
  assert.ok(drawBadge(150, true).equals(drawBadge(99, true)), '150 draws as 99');
  const dim = drawBadge(0, false);
  const centre = (Math.floor(BADGE_SIZE / 2) * BADGE_SIZE + Math.floor(BADGE_SIZE / 2)) * 4;
  assert.equal(dim[centre + 3], 128);
});

test('drawBadge: the disc is amber by default and for Classic, gold for Emerald (M9 fix 569)', () => {
  // (2, 7): inside the disc, clear of the digit. Premultiplied BGRA.
  const at = (7 * BADGE_SIZE + 2) * 4;
  const px = (buf: Buffer) => [...buf.subarray(at, at + 4)];
  assert.deepEqual(px(drawBadge(1, true)), [0x3d, 0xa3, 0xe8, 255]);
  assert.deepEqual(px(drawBadge(1, true, badgeColour('classic'))), [0x3d, 0xa3, 0xe8, 255]);
  assert.deepEqual(px(drawBadge(1, true, badgeColour('emerald'))), [0x49, 0xb9, 0xe8, 255]);
});
