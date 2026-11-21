import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPEAT_MS, createNotifyPolicy } from './notify-policy.ts';
import type { NotifyDeps, ToastHandle } from './notify-policy.ts';

// M9 fix 560: the notification policy, pinned over a fake toast maker, a
// fake clock and a recording append.

interface FakeToast extends ToastHandle {
  fire(event: 'show' | 'close' | 'click'): void;
  fail(error: string): void;
  // M9 fix 1199: a button pressed, by its place.
  press(index: number): void;
  shown: boolean;
  actions: readonly string[] | undefined;
}

function fakeToast(actions?: readonly string[]): FakeToast {
  const listeners = new Map<string, Array<(e?: string | number) => void>>();
  const t = {
    shown: false,
    actions,
    on(event: string, fn: (e?: string | number) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
    show() {
      t.shown = true;
    },
    fire(event: string) {
      for (const fn of listeners.get(event) ?? []) fn();
    },
    fail(error: string) {
      for (const fn of listeners.get('failed') ?? []) fn(error);
    },
    press(index: number) {
      for (const fn of listeners.get('action') ?? []) fn(index);
    },
  };
  return t as unknown as FakeToast;
}

function setup(over: Partial<NotifyDeps> = {}) {
  let clock = 1_000_000;
  let focused = false;
  const logs: string[] = [];
  const lines: Array<[string, string]> = [];
  const made: FakeToast[] = [];
  const clicked: string[] = [];
  const actioned: Array<[string, string, number]> = [];
  let createThrows = false;
  const deps: NotifyDeps = {
    logFile: undefined,
    always: false,
    held: false,
    focused: () => focused,
    now: () => clock,
    appendLine: (file, line) => lines.push([file, line]),
    toasts: {
      supported: () => true,
      create: (_title, _body, actions) => {
        if (createThrows) throw new Error('no toast');
        const t = fakeToast(actions);
        made.push(t);
        return t;
      },
    },
    onClick: (id) => clicked.push(id),
    onAction: (id, toolUseId, index) => actioned.push([id, toolUseId, index]),
    log: (m) => logs.push(m),
    ...over,
  };
  const policy = createNotifyPolicy(deps);
  return {
    policy,
    logs,
    lines,
    made,
    clicked,
    actioned,
    tick: (ms: number) => (clock += ms),
    setFocused: (v: boolean) => (focused = v),
    throwOnCreate: () => (createThrows = true),
  };
}

const req = (sessionId: unknown = 's1') => ({ sessionId, title: 'T', body: 'B' }) as { sessionId: string; title: string; body: string };

test('notify policy: a bad request is skipped and posts nothing', async () => {
  const s = setup();
  assert.equal(await s.policy.post(req(7)), 'skipped');
  assert.equal(s.made.length, 0);
});

test('notify policy: a focused window is skipped without starting the repeat window, and always posts over focus', async () => {
  const s = setup();
  s.setFocused(true);
  assert.equal(await s.policy.post(req()), 'skipped');
  s.setFocused(false);
  const p = s.policy.post(req());
  assert.equal(s.made.length, 1, 'the same request at the same instant unfocused is posted');
  s.made[0]!.fire('show');
  assert.equal(await p, 'shown');

  s.setFocused(true);
  const q = s.policy.post(req('s2'), { always: true });
  s.made[1]!.fire('show');
  assert.equal(await q, 'shown', 'opts.always posts over focus');

  const a = setup({ always: true });
  a.setFocused(true);
  const r = a.policy.post(req());
  a.made[0]!.fire('show');
  assert.equal(await r, 'shown', 'the always env posts over focus');
});

test('notify policy: a repeat inside REPEAT_MS is skipped, and at REPEAT_MS it goes through', async () => {
  const s = setup({ held: true });
  assert.equal(await s.policy.post(req()), 'held');
  s.tick(REPEAT_MS - 1);
  assert.equal(await s.policy.post(req()), 'skipped');
  s.tick(1);
  assert.equal(await s.policy.post(req()), 'held');
});

test('notify policy: held logs its line and creates no toast', async () => {
  const s = setup({ held: true });
  assert.equal(await s.policy.post(req()), 'held');
  assert.deepEqual(s.logs, ['notification held under a private EMERALD_HOME: T: B']);
  assert.equal(s.made.length, 0);
});

test('notify policy (M9 fix 1199): a held permission ask writes its body on one line and names its buttons', async () => {
  const s = setup({ held: true });
  assert.equal(await s.policy.post({ sessionId: 's1', title: 'T', body: 'Claude asks to run Bash:\necho hi', ask: { toolUseId: 'u1', command: 'echo hi' } }), 'held');
  assert.deepEqual(s.logs, ['notification held under a private EMERALD_HOME: T: Claude asks to run Bash: echo hi [Allow once, Deny]']);
});

test('notify policy: a log file gets one JSON line, and an append that throws answers failed', async () => {
  const s = setup({ logFile: 'C:/x/notify.log' });
  assert.equal(await s.policy.post(req()), 'logged');
  assert.equal(s.lines.length, 1);
  assert.equal(s.lines[0]![0], 'C:/x/notify.log');
  assert.deepEqual(JSON.parse(s.lines[0]![1]), { sessionId: 's1', title: 'T', body: 'B', at: 1_000_000 });
  assert.ok(s.lines[0]![1].endsWith('\n'));

  const f = setup({
    logFile: 'C:/gone/notify.log',
    appendLine: () => {
      throw new Error('ENOENT');
    },
  });
  assert.equal(await f.policy.post(req()), 'failed');
  assert.deepEqual(f.logs, ['notification log C:/gone/notify.log not written: ENOENT']);
});

test('notify policy (M9 fix 1199): a permission ask carries its ask in the log file line', async () => {
  const s = setup({ logFile: 'C:/x/notify.log' });
  assert.equal(await s.policy.post({ ...req(), ask: { toolUseId: 'u1', command: 'echo hi' } }), 'logged');
  assert.deepEqual(JSON.parse(s.lines[0]![1]), { sessionId: 's1', title: 'T', body: 'B', ask: { toolUseId: 'u1', command: 'echo hi' }, at: 1_000_000 });
  const bad = setup({ logFile: 'C:/x/notify.log' });
  await bad.policy.post({ ...req(), ask: { toolUseId: 7 } } as never);
  assert.equal('ask' in JSON.parse(bad.lines[0]![1]), false, 'a malformed ask is posted as none');
});

test('notify policy: unsupported toasts answer unsupported', async () => {
  const s = setup();
  const u = setup({ toasts: { supported: () => false, create: () => fakeToast() } });
  assert.equal(await u.policy.post(req()), 'unsupported');
  assert.equal(s.made.length, 0);
});

test('notify policy: a toast is held before show, answers shown on show, failed on failed, and a throwing create answers failed', async () => {
  const s = setup();
  const p = s.policy.post(req());
  assert.equal(s.policy.heldToasts(), 1, 'held before show fires');
  assert.equal(s.made[0]!.shown, true, 'show() was called');
  s.made[0]!.fire('show');
  assert.equal(await p, 'shown');
  assert.equal(s.policy.heldToasts(), 1, 'still held after show');

  const q = s.policy.post(req('s2'));
  s.made[1]!.fail('the centre is off');
  assert.equal(await q, 'failed');
  assert.equal(s.policy.heldToasts(), 1, 'a failed toast is dropped');
  assert.ok(s.logs.includes('notification failed: the centre is off'));

  s.throwOnCreate();
  assert.equal(await s.policy.post(req('s3')), 'failed');
  assert.ok(s.logs.includes('notification failed: no toast'));
});

test('notify policy: 51 toasts hold 50, the oldest dropped, and close, click and failed each take one away', async () => {
  const s = setup();
  for (let i = 0; i < 51; i += 1) void s.policy.post(req(`s${i}`));
  assert.equal(s.made.length, 51);
  assert.equal(s.policy.heldToasts(), 50);
  // The first toast's handle is the one dropped: its close changes nothing.
  s.made[0]!.fire('close');
  assert.equal(s.policy.heldToasts(), 50, 'the first toast was already dropped');
  s.made[1]!.fire('close');
  assert.equal(s.policy.heldToasts(), 49, 'close takes one away');
  s.made[2]!.fire('click');
  assert.equal(s.policy.heldToasts(), 48, 'click takes one away');
  assert.deepEqual(s.clicked, ['s2'], 'click calls onClick with the session id');
  s.made[3]!.fail('x');
  assert.equal(s.policy.heldToasts(), 47, 'failed takes one away');
});

test('notify policy (M9 fix 1199): a permission ask\'s toast carries Allow once and Deny and routes a press with its toolUseId; every other toast has no actions', async () => {
  const s = setup();
  void s.policy.post({ ...req(), ask: { toolUseId: 'u1', command: 'echo hi' } });
  assert.deepEqual(s.made[0]!.actions, ['Allow once', 'Deny']);
  assert.equal(s.policy.heldToasts(), 1);
  s.made[0]!.press(1);
  assert.deepEqual(s.actioned, [['s1', 'u1', 1]]);
  assert.equal(s.policy.heldToasts(), 0, 'a press takes the toast away');
  assert.deepEqual(s.clicked, [], 'a press is not a click');
  void s.policy.post(req('s2'));
  assert.equal(s.made[1]!.actions, undefined, 'no ask, no actions argument');
});
