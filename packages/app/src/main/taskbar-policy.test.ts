import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BADGE_SIZE,
  PULSE_MS,
  TASKBAR_GLINT_FILL,
  badgeColour,
  createTaskbarPolicy,
  drawBadge,
  drawGlint,
  glintFrameAt,
  msToNextGlintFrame,
  taskbarProgress,
  taskbarTooltip,
} from './taskbar-policy.ts';
import type { TaskbarWindow } from './taskbar-policy.ts';
import fs from 'node:fs';

// M9 fix 560: the taskbar's attention policy, pinned over a recording
// window and a fake timer.

// M9 fix 1200: a glint frame named by its content, frames 4 and 5 reading
// as 2 and 1.
const glintName = (buf: Buffer | null): string => {
  if (buf === null) return 'glint none';
  for (const f of [1, 2, 3] as const) if (buf.equals(drawGlint(f)!)) return `glint ${f}`;
  return 'glint ?';
};

function setup(opts: { held?: boolean; windows?: boolean; dock?: boolean; reducedMotion?: boolean } = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const pulses: Array<{ ms: number; fn: () => void; stopped: boolean }> = [];
  // M9 fix 870: the bar and the tooltip, and their held lines, apart from
  // the badge's, so every badge assertion reads as before.
  const bars: string[] = [];
  const progress: string[] = [];
  // M9 fix 1200: the glint's calls, its descriptions, its log lines, its
  // timeouts and its clock, apart from the rest, so every earlier
  // assertion reads as before.
  const glints: string[] = [];
  const glintTexts: string[] = [];
  const glintLogs: string[] = [];
  const timeouts: Array<{ ms: number; fn: () => void; stopped: boolean }> = [];
  const clock = { now: 0 };
  const win: TaskbarWindow = {
    flashFrame: (on) => calls.push(`flash ${on}`),
    setOverlay: (count, bright) => calls.push(count === null ? 'overlay none' : `overlay ${count} ${bright ? 'bright' : 'dim'}`),
    setProgress: (fraction) => bars.push(fraction === null ? 'progress none' : `progress ${fraction}`),
    setTooltip: (text) => bars.push(`tooltip ${text}`),
    setGlint: (frame, description) => {
      glints.push(glintName(frame));
      glintTexts.push(description);
    },
  };
  const policy = createTaskbarPolicy(() => win, {
    held: opts.held ?? false,
    windows: opts.windows ?? true,
    ...(opts.dock === undefined ? {} : { dock: opts.dock }),
    log: (m) => (m.startsWith('taskbar progress') ? progress : m.startsWith('taskbar glint') ? glintLogs : logs).push(m),
    every: (ms, fn) => {
      const p = { ms, fn, stopped: false };
      pulses.push(p);
      return () => {
        p.stopped = true;
      };
    },
    timeout: (ms, fn) => {
      const t = { ms, fn, stopped: false };
      timeouts.push(t);
      return () => {
        t.stopped = true;
      };
    },
    now: () => clock.now,
    reducedMotion: () => opts.reducedMotion ?? false,
  });
  // Fire the one live timeout at a time on the clock.
  const tickAt = (ms: number) => {
    clock.now = ms;
    const live = timeouts.filter((t) => !t.stopped);
    assert.equal(live.length, 1, `one live glint timeout at ${ms}`);
    live[0]!.stopped = true;
    live[0]!.fn();
  };
  const liveTimeouts = () => timeouts.filter((t) => !t.stopped);
  return { policy, calls, logs, pulses, bars, progress, glints, glintTexts, glintLogs, timeouts, clock, tickAt, liveTimeouts };
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

test('taskbar policy: on the dock of a Mac the count on each change and the flash, no pulse, bar or tooltip (M9 fix 1024)', () => {
  const s = setup({ windows: false, dock: true });
  s.policy.set({ wanting: 2, flash: true, working: 1, live: 3 });
  assert.deepEqual(s.calls, ['flash true', 'overlay 2 bright']);
  assert.equal(s.policy.pulsing(), false);
  assert.equal(s.pulses.length, 0);
  s.calls.length = 0;
  s.policy.set({ wanting: 2, flash: false, working: 1, live: 3 });
  assert.deepEqual(s.calls, [], 'a repeat of the count does nothing');
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 3 });
  assert.deepEqual(s.calls, ['flash false', 'overlay none']);
  assert.deepEqual(s.bars, [], 'no bar and no tooltip on the dock');
});

test('taskbar policy: held on a Mac too, the dock never touched and the held lines as on Windows (M9 fix 1024)', () => {
  const s = setup({ held: true, windows: false, dock: true });
  s.policy.set({ wanting: 2, flash: true, working: 0, live: 2 });
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 2 });
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.logs, ['taskbar held under a private EMERALD_HOME: 2 wanting, flash', 'taskbar held under a private EMERALD_HOME: cleared']);
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

test('drawGlint: the rest is no overlay, and frames 1 to 5 light 1, 5, 9, 5 and 1 pixels around (5,9) in the glint fill, premultiplied (M9 fix 1200)', () => {
  assert.equal(drawGlint(0), null);
  const lit = (buf: Buffer) => {
    let n = 0;
    for (let i = 0; i < buf.length; i += 4) if (buf[i + 3] !== 0) n += 1;
    return n;
  };
  const frames = ([1, 2, 3, 4, 5] as const).map((f) => drawGlint(f)!);
  assert.deepEqual(frames.map(lit), [1, 5, 9, 5, 1]);
  for (const f of frames) assert.equal(f.length, BADGE_SIZE * BADGE_SIZE * 4);
  const px = (buf: Buffer, x: number, y: number) => [...buf.subarray((y * BADGE_SIZE + x) * 4, (y * BADGE_SIZE + x) * 4 + 4)];
  assert.deepEqual(px(frames[0]!, 5, 9), [134, 140, 128, 140], 'frame 1 centre at 0.55');
  assert.deepEqual(px(frames[2]!, 5, 9), [0xf4, 0xff, 0xea, 255], 'frame 3 centre at full');
  assert.deepEqual(px(frames[2]!, 7, 9), [110, 115, 106, 115], 'frame 3 arm tip at 0.45');
  assert.ok(frames[3]!.equals(frames[1]!), 'frame 4 is frame 2');
  assert.ok(frames[4]!.equals(frames[0]!), 'frame 5 is frame 1');
  // Every pixel off the table is four zeros.
  const table = new Set(['5,9', '4,9', '6,9', '5,8', '5,10', '3,9', '7,9', '5,7', '5,11']);
  for (const f of frames) {
    for (let y = 0; y < BADGE_SIZE; y += 1) {
      for (let x = 0; x < BADGE_SIZE; x += 1) if (!table.has(`${x},${y}`)) assert.deepEqual(px(f, x, y), [0, 0, 0, 0], `(${x},${y}) is clear`);
    }
  }
});

test('glintFrameAt and msToNextGlintFrame: five steps of 125 ms, then rest to the next 10 s (M9 fix 1200)', () => {
  assert.deepEqual(
    [0, 124, 125, 500, 624, 625, 9999, 10000, 20130].map(glintFrameAt),
    [1, 1, 2, 5, 5, 0, 0, 1, 2],
  );
  assert.deepEqual([0, 130, 625].map(msToNextGlintFrame), [125, 120, 9375]);
});

test('taskbar policy: the glint sweeps frames 1 to 5 from the moment something works, then rests to the next 10 s, the count on each frame (M9 fix 1200)', () => {
  const s = setup();
  s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  assert.deepEqual(s.glints, ['glint 1']);
  assert.deepEqual(s.glintTexts, ['1 session working']);
  assert.deepEqual(s.liveTimeouts().map((t) => t.ms), [127]);
  for (const at of [125, 250, 375, 500, 625]) s.tickAt(at);
  assert.deepEqual(s.glints, ['glint 1', 'glint 2', 'glint 3', 'glint 2', 'glint 1', 'glint none']);
  assert.equal(s.glintTexts.at(-1), '', 'the rest frame carries no description');
  assert.deepEqual(s.liveTimeouts().map((t) => t.ms), [9377]);
  const before = s.glints.length;
  s.policy.set({ wanting: 0, flash: false, working: 2, live: 2 });
  assert.equal(s.glints.length, before, 'a new count makes no call of its own');
  s.tickAt(10_000);
  assert.deepEqual(s.glints.slice(before), ['glint 1']);
  assert.equal(s.glintTexts.at(-1), '2 sessions working', 'the next frame names the new count');
  assert.deepEqual(s.calls, [], 'the badge is never touched');
});

test('taskbar policy: a want mid-sweep gives the corner to the badge with no glint call after it, and stops the glint (M9 fix 1200)', () => {
  const s = setup();
  s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  s.tickAt(125);
  s.tickAt(250);
  assert.equal(s.glints.at(-1), 'glint 3');
  const before = s.glints.length;
  s.policy.set({ wanting: 1, flash: false, working: 1, live: 2 });
  assert.equal(s.calls.at(-1), 'overlay 1 bright');
  assert.equal(s.glints.length, before, 'no glint call after the badge');
  assert.deepEqual(s.liveTimeouts(), [], 'the glint timeout is stopped');
  // The want answered with something still working: the badge clears,
  // then a fresh sweep starts.
  s.clock.now = 4000;
  s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  assert.equal(s.calls.at(-1), 'overlay none');
  assert.deepEqual(s.glints.slice(before), ['glint 1']);
});

test('taskbar policy: a late tick shows the frame its time names, skipping, and a sweep is never stretched (M9 fix 1200)', () => {
  const s = setup();
  s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  s.tickAt(380);
  assert.equal(s.glints.at(-1), 'glint 2', 'frame 4 at 380, skipping 2 and 3');
  s.tickAt(900);
  assert.equal(s.glints.at(-1), 'glint none');
  s.tickAt(10_050);
  assert.equal(s.glints.at(-1), 'glint 1');
  assert.deepEqual(s.glints, ['glint 1', 'glint 2', 'glint none', 'glint 1']);
});

test('taskbar policy: nothing working clears the glint once and stops it; dispose stops it; a second turn-on sweeps afresh (M9 fix 1200)', () => {
  const s = setup();
  s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  s.tickAt(125);
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 2 });
  assert.deepEqual(s.glints, ['glint 1', 'glint 2', 'glint none']);
  assert.deepEqual(s.liveTimeouts(), []);
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 2 });
  assert.equal(s.glints.length, 3, 'a second nothing-working makes no call');
  s.clock.now = 5000;
  s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  assert.equal(s.glints.at(-1), 'glint 1', 'a fresh sweep at once');
  s.tickAt(5125);
  assert.equal(s.glints.at(-1), 'glint 2', 'counted from the new turn-on');
  s.policy.dispose();
  assert.deepEqual(s.liveTimeouts(), [], 'dispose stops it mid-sweep');
  s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  assert.equal(s.glints.at(-1), 'glint 1', 'on again after dispose sweeps afresh');
  // A nothing-working after a sweep has rested makes no clear of its own.
  const r = setup();
  r.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  for (const at of [125, 250, 375, 500, 625]) r.tickAt(at);
  const n = r.glints.length;
  r.policy.set({ wanting: 0, flash: false, working: 0, live: 2 });
  assert.equal(r.glints.length, n, 'no clear when the rest frame is already shown');
});

test('taskbar policy: under reduced motion the glint rests, with no call and no timer, and says so once (M9 fix 1200)', () => {
  const s = setup({ reducedMotion: true });
  s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  s.policy.set({ wanting: 0, flash: false, working: 2, live: 2 });
  assert.deepEqual(s.glints, []);
  assert.deepEqual(s.timeouts, []);
  assert.deepEqual(s.glintLogs, ['taskbar glint still: reduced motion']);
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 2 });
  assert.deepEqual(s.glints, [], 'off after a still on makes no call');
});

test('taskbar policy: held, the glint is one line per change, on and off, with no window call and no timer (M9 fix 1200)', () => {
  const s = setup({ held: true });
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 2 });
  s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  s.policy.set({ wanting: 1, flash: false, working: 1, live: 2 });
  s.policy.set({ wanting: 0, flash: false, working: 0, live: 2 });
  s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  const prefix = 'taskbar glint held under a private EMERALD_HOME: ';
  assert.deepEqual(s.glintLogs, [`${prefix}on`, `${prefix}off`, `${prefix}on`]);
  assert.deepEqual(s.glints, []);
  assert.deepEqual(s.timeouts, []);
  assert.deepEqual(s.calls, []);
  // A held Mac writes none.
  const m = setup({ held: true, windows: false, dock: true });
  m.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
  assert.deepEqual(m.glintLogs, []);
});

test('taskbar policy: off Windows and on the dock the glint makes no call and no timer (M9 fix 1200)', () => {
  for (const o of [{ windows: false }, { windows: false, dock: true }]) {
    const s = setup(o);
    s.policy.set({ wanting: 0, flash: false, working: 1, live: 2 });
    s.policy.set({ wanting: 0, flash: false, working: 0, live: 2 });
    assert.deepEqual(s.glints, [], JSON.stringify(o));
    assert.deepEqual(s.timeouts, [], JSON.stringify(o));
  }
});

test('PULSE_MS is the sidebar needs-pulse, 1.8 s, and the glint is the title gem\'s fill (M9 fix 1200)', () => {
  assert.equal(PULSE_MS, 1800);
  // Read as text: the main project cannot import the renderer's file.
  const gem = fs.readFileSync(new URL('../renderer/src/title-gem-model.ts', import.meta.url), 'utf8');
  assert.equal(/export const GLINT_FILL = '(#[0-9a-f]{6})';/.exec(gem)?.[1], TASKBAR_GLINT_FILL);
});
