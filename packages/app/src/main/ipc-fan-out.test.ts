import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fanOut } from './ipc-fan-out.ts';

test('fanOut calls each live handler once, an off removes only its own, a throw stops no other, and the warning comes once at 50 (M9 fix 1137)', () => {
  const logs: Array<[string, string]> = [];
  const f = fanOut<[string]>('test-channel', (l, line) => logs.push([l, line]));
  const calls: string[] = [];
  const offA = f.add((x) => calls.push('a' + x));
  f.add((x) => calls.push('b' + x));
  f.emit('x');
  assert.deepEqual(calls, ['ax', 'bx']);
  offA();
  calls.length = 0;
  f.emit('y');
  assert.deepEqual(calls, ['by']);
  assert.equal(f.size(), 1);

  const g = fanOut<[]>('test-channel', (l, line) => logs.push([l, line]));
  let n = 0;
  const fn = () => { n++; };
  g.add(fn);
  const off2 = g.add(fn);
  g.emit();
  assert.equal(n, 2);
  off2();
  off2();
  n = 0;
  g.emit();
  assert.equal(n, 1);

  const h = fanOut<[]>('test-channel', (l, line) => logs.push([l, line]));
  let ran = false;
  h.add(() => { throw new Error('boom'); });
  h.add(() => { ran = true; });
  h.emit();
  assert.ok(ran);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.[0], 'error');
  assert.ok(logs[0]?.[1].startsWith('[emerald] a test-channel handler threw: Error: boom'));

  logs.length = 0;
  const w = fanOut<[]>('test-channel', (l, line) => logs.push([l, line]));
  const offs: Array<() => void> = [];
  for (let i = 0; i < 49; i++) offs.push(w.add(() => {}));
  assert.equal(logs.length, 0);
  offs.push(w.add(() => {}));
  assert.deepEqual(logs, [['warn', '[emerald] 50 handlers on test-channel; a subscriber may be missing its off']]);
  offs.push(w.add(() => {}));
  offs[0]?.();
  w.add(() => {});
  assert.equal(logs.length, 1);
});
