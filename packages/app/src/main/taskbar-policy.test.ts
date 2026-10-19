import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_SIZE, PULSE_MS, badgeColour, createTaskbarPolicy, drawBadge, taskbarProgress, taskbarTooltip } from './taskbar-policy.ts';
import type { TaskbarWindow } from './taskbar-policy.ts';

// M9 fix 560: the taskbar's attention policy, pinned over a recording
// window and a fake timer.

function setup(opts: { held?: boolean; windows?: boolean } = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const pulses: Array<{ ms: number; fn: () => void; stopped: boolean }> = [];
  // M9 fix 870: the bar and the tooltip, and their held lines, apart from
  // the badge's, so every badge assertion reads as before.
  const bars: string[] = [];
  const progress: string[] = [];
  const win: TaskbarWindow = {
    flashFrame: (on) => calls.push(`flash ${on}`),
    setOverlay: (count, bright) => calls.push(count === null ? 'overlay none' : `overlay ${count} ${bright ? 'bright' : 'dim'}`),
    setProgress: (fraction) => bars.push(fraction === null ? 'progress none' : `progress ${fraction}`),
    setTooltip: (text) => bars.push(`tooltip ${text}`),
  };
  const policy = createTaskbarPolicy(() => win, {
    held: opts.held ?? false,
    windows: opts.windows ?? true,
    log: (m) => (m.startsWith('taskbar progress') ? progress : logs).push(m),
    every: (ms, fn) => {
      const p = { ms, fn, stopped: false };
      pulses.push(p);
      return () => {
        p.stopped = true;
      };
    },
  });
  return { policy, calls, logs, pulses, bars, progress };
}

test('taskbar policy: a count that is not a finite number of zero or more is ignored', () => {
  const s = setup({ held: true });
  for (const wanting of [-1, NaN, '2' as unknown as number]) s.policy.set({ wanting, flash: true, working: 0, live: 0 });
  assert.deepEqual(s.logs, []);
  assert.deepEqual(s.calls, []);
});

test('taskbar policy: a fractional count is floored', () => {
  const s = setup({ held: true });
  s.policy.set({ wanting: 2.7, flash: false, working: 0, live: 0 });
  assert.deepEqual(s.logs, ['taskbar held under a private EMERALD_HOME: 2 wanting, no flash']);
});

test('taskbar policy: held, one line per change and the window never touched', () => {
  const s = setup({ held: true });
  s.policy.set({ wanting: 2, flash: true, working: 0, live: 0 });
  s.policy.set({ wanting: 2, flash: false, working: 0, live: 0 });
  s.policy.set({ wanting: 2, flash: true, working: 0, live: 0 });
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 0 });
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 0 });
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
  s.policy.set({ wanting: 2, flash: true, working: 0, live: 0 });
  assert.deepEqual(s.calls, ['flash true', 'overlay 2 bright']);
  assert.equal(s.pulses.length, 1);
  assert.equal(s.pulses[0]!.ms, PULSE_MS / 2);
  assert.equal(s.policy.pulsing(), true);
  s.pulses[0]!.fn();
  assert.equal(s.calls.at(-1), 'overlay 2 dim', 'a tick paints the dim frame');
  s.policy.set({ wanting: 3, flash: true, working: 0, live: 0 });
  assert.equal(s.pulses.length, 1, 'a second rise starts no second pulse');
  s.calls.length = 0;
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 0 });
  assert.deepEqual(s.calls, ['flash false', 'overlay none']);
  assert.equal(s.pulses[0]!.stopped, true);
  assert.equal(s.policy.pulsing(), false);
  s.calls.length = 0;
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 0 });
  assert.deepEqual(s.calls, [], 'a second zero does nothing');
});

test('taskbar policy: off Windows the flash alone, no overlay and no pulse', () => {
  const s = setup({ windows: false });
  s.policy.set({ wanting: 2, flash: true, working: 0, live: 0 });
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

test('taskbar policy: the bar is the share working and the tooltip names both counts (M9 fix 870)', () => {
  const s = setup();
  s.policy.set({ wanting: 1, flash: false, working: 3, live: 5 });
  assert.deepEqual(s.bars, ['progress 0.6', 'tooltip 3 working, 1 wants you']);
  s.policy.set({ wanting: 1, flash: false, working: 3, live: 5 });
  assert.deepEqual(s.bars, ['progress 0.6', 'tooltip 3 working, 1 wants you'], 'the same again paints nothing new');
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 5 });
  assert.deepEqual(s.bars.slice(2), ['progress none', 'tooltip Nothing running']);
  s.policy.set({ wanting: 2, flash: false, working: 0, live: 5 });
  assert.deepEqual(s.bars.slice(4), ['tooltip 2 want you'], 'no progress call while the bar stays cleared');
});

test('taskbar policy: held, one progress line per change and the window never touched (M9 fix 870)', () => {
  const s = setup({ held: true });
  s.policy.set({ wanting: 1, flash: false, working: 3, live: 5 });
  s.policy.set({ wanting: 1, flash: false, working: 3, live: 5 });
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 5 });
  s.policy.set({ wanting: 2, flash: false, working: 0, live: 5 });
  const prefix = 'taskbar progress held under a private EMERALD_HOME: ';
  assert.deepEqual(s.progress, [
    `${prefix}3 of 5 working, bar 60%, tooltip "3 working, 1 wants you"`,
    `${prefix}0 of 5 working, bar cleared, tooltip "Nothing running"`,
    `${prefix}0 of 5 working, bar cleared, tooltip "2 want you"`,
  ]);
  assert.deepEqual(s.bars, []);
  assert.deepEqual(s.calls, []);
});

test('taskbar policy: counts that are not finite numbers of zero or more read as zero, and working is capped at live (M9 fix 870)', () => {
  for (const working of [NaN, -1, '3' as unknown as number]) {
    const s = setup();
    s.policy.set({ wanting: 0, flash: false, working, live: 5 });
    assert.deepEqual(s.bars, ['tooltip Nothing running'], `working ${String(working)} reads as 0`);
  }
  const s = setup();
  s.policy.set({ wanting: 0, flash: false, working: 7, live: 5 });
  assert.deepEqual(s.bars, ['progress 1', 'tooltip 5 working']);
});

test('taskbar policy: off Windows no bar and no tooltip (M9 fix 870)', () => {
  const s = setup({ windows: false });
  s.policy.set({ wanting: 1, flash: true, working: 3, live: 5 });
  assert.deepEqual(s.bars, []);
  assert.deepEqual(s.calls, ['flash true']);
});

test('taskbarProgress: none at no working session or none live, the share otherwise (M9 fix 870)', () => {
  assert.equal(taskbarProgress(0, 5), null);
  assert.equal(taskbarProgress(0, 0), null);
  assert.equal(taskbarProgress(3, 5), 0.6);
  assert.equal(taskbarProgress(5, 5), 1);
});

test('taskbarTooltip: the parts that are there, or Nothing running (M9 fix 870)', () => {
  assert.equal(taskbarTooltip(1, 3), '1 working, 3 want you');
  assert.equal(taskbarTooltip(2, 0), '2 working');
  assert.equal(taskbarTooltip(0, 1), '1 wants you');
  assert.equal(taskbarTooltip(0, 0), 'Nothing running');
});
