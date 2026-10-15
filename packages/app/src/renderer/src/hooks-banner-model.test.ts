import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HookTestOutcome, HooksStatus } from '../../preload/api.ts';
import { FIX_HINT, INSTALL_HINT, OTHER_WRITER, bannerHint, bannerOnStatus, hooksProblem, installLabel, isDeadProblem, shouldPromptHooks, testText } from './hooks-banner-model.ts';

const ALL = ['SessionStart', 'SessionEnd', 'Stop', 'Notification'];

function status(over: Partial<HooksStatus>): HooksStatus {
  return { complete: false, installed: ALL, missing: [], scriptPresent: true, scriptStale: false, statusLine: true, skill: true, settings: 'C:\\u\\.claude\\settings.json', fighting: false, deadOurs: 0, ...over };
}

test('shouldPromptHooks is on unless the config turns it off', () => {
  assert.equal(shouldPromptHooks({}), true);
  assert.equal(shouldPromptHooks({ promptHooks: true }), true);
  assert.equal(shouldPromptHooks({ promptHooks: false }), false);
});

test('hooksProblem says nothing when the CLI reports complete', () => {
  assert.equal(hooksProblem(status({ complete: true })), null);
});

test('hooksProblem names the most useful reason first', () => {
  assert.match(hooksProblem(status({ installed: [], missing: ALL }))!, /not installed/);
  assert.match(hooksProblem(status({ installed: ALL.slice(0, 3), missing: ALL.slice(3) }))!, /Only 3 of 4/);
  assert.match(hooksProblem(status({ scriptPresent: false }))!, /script is missing/);
  assert.match(hooksProblem(status({ scriptStale: true }))!, /older than/);
  assert.match(hooksProblem(status({ statusLine: false }))!, /status line/);
  assert.match(hooksProblem(status({ skill: false }))!, /emmer-cli skill/);
  // Incomplete for a reason the status does not spell out still shows something.
  assert.match(hooksProblem(status({}))!, /need attention/);
});

test('installLabel follows the phase', () => {
  assert.equal(installLabel('prompt'), 'Install hooks');
  assert.equal(installLabel('installing'), 'Installing');
  assert.equal(installLabel('failed'), 'Retry');
});

test('bannerHint is the install hint, or the failure', () => {
  assert.equal(bannerHint('prompt', ''), INSTALL_HINT);
  assert.equal(bannerHint('installing', ''), INSTALL_HINT);
  assert.equal(bannerHint('failed', 'boom'), 'Install failed: boom');
});

test('every problem and the hint stay short enough for one line at 1200px (fix 579)', () => {
  const statuses = [
    status({ installed: [], missing: ALL }),
    // The two-digit count, the widest form of "Only N of M".
    status({ installed: Array.from({ length: 12 }, (_, i) => `e${i}`), missing: ['e12'] }),
    status({ scriptPresent: false }),
    status({ scriptStale: true }),
    status({ statusLine: false }),
    status({ skill: false }),
    status({ deadOurs: 16 }),
    status({}),
  ];
  // 185 characters is the longest problem plus the hint (180) and a little, a
  // stand-in for the 1024px the measurement gave; a unit test cannot measure a font.
  // M9 fix 606: the other writer's sentence and every Test result take
  // the hint's place, and stay inside the same bound.
  const tails = [INSTALL_HINT, FIX_HINT, OTHER_WRITER, ...OUTCOMES.map(testText)];
  for (const st of statuses) {
    for (const tail of tails) {
      const line = `${hooksProblem(st)} ${tail}`;
      assert.ok(line.length <= 185, `${line.length} characters: ${line}`);
    }
  }
});

const OUTCOMES: HookTestOutcome[] = ['passed', 'no-script', 'no-daemon', 'old-daemon', 'not-heard'];

test("emerald's dead entries raise the banner with Fix (M9 fix 710)", () => {
  assert.equal(hooksProblem(status({ deadOurs: 16 })), "16 hooks in Claude's settings point at missing files.");
  assert.equal(hooksProblem(status({ deadOurs: 1 })), "1 hook in Claude's settings points at a missing file.");
  // Not installed, or some missing, still says so: the same Install clears the dead ones too.
  assert.match(hooksProblem(status({ installed: [], missing: ALL, deadOurs: 3 }))!, /not installed/);
  assert.equal(isDeadProblem(status({ deadOurs: 16 })), true);
  assert.equal(isDeadProblem(status({ installed: [], missing: ALL, deadOurs: 3 })), false);
  assert.equal(isDeadProblem(status({ deadOurs: 0 })), false);
  assert.equal(isDeadProblem(status({ complete: true, deadOurs: 2 })), false);
  assert.equal(installLabel('prompt', true), 'Fix');
  assert.equal(installLabel('failed', true), 'Retry');
  assert.equal(installLabel('installing', true), 'Installing');
  assert.equal(bannerHint('prompt', '', true), FIX_HINT);
  assert.equal(bannerHint('prompt', ''), INSTALL_HINT);
});

test('the fighting phase offers no install and names the other writer (M9 fix 606)', () => {
  assert.equal(installLabel('fighting'), 'Install hooks');
  assert.equal(bannerHint('fighting', ''), OTHER_WRITER);
  assert.equal(OTHER_WRITER, 'Another program, or a second emerald, keeps rewriting these settings.');
});

test('testText says what each Test found, in the decided words (M9 fix 606)', () => {
  assert.equal(testText('passed'), 'Test passed: the hook reached emerald.');
  assert.equal(testText('no-script'), 'Test failed: the hook script is missing.');
  assert.equal(testText('no-daemon'), "Test failed: emerald's daemon is not running.");
  assert.equal(testText('old-daemon'), 'Test failed: the daemon predates the Test; restart it.');
  assert.equal(testText('not-heard'), 'Test failed: the hook ran but emerald never heard it.');
});

test('bannerOnStatus follows a pushed status (M9 fix 606)', () => {
  const missing = status({ installed: [], missing: ALL });
  const problem = hooksProblem(missing)!;
  const fewer = status({ installed: ALL.slice(0, 3), missing: ALL.slice(3) });
  // An install in flight is kept whatever the status says.
  const installing = { phase: 'installing' as const, problem };
  assert.equal(bannerOnStatus(installing, status({ complete: true }), null), installing);
  // Complete hides.
  assert.equal(bannerOnStatus({ phase: 'prompt', problem }, status({ complete: true }), null), null);
  // A dismissed problem stays hidden, another raises the banner.
  assert.equal(bannerOnStatus(null, missing, problem), null);
  assert.deepEqual(bannerOnStatus(null, fewer, problem), { phase: 'prompt', problem: hooksProblem(fewer) });
  // Another writer.
  assert.deepEqual(bannerOnStatus(null, status({ installed: [], missing: ALL, fighting: true }), null), { phase: 'fighting', problem });
  // A failure is kept for the same problem, and drops to prompt for another.
  assert.deepEqual(bannerOnStatus({ phase: 'failed', problem }, missing, null), { phase: 'failed', problem });
  assert.deepEqual(bannerOnStatus({ phase: 'failed', problem }, fewer, null), { phase: 'prompt', problem: hooksProblem(fewer) });
  // Otherwise prompt.
  assert.deepEqual(bannerOnStatus(null, missing, null), { phase: 'prompt', problem });
});
