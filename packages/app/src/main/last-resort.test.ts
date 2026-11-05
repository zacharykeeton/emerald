import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installLastResort, LAST_RESORT_NOTE } from './last-resort.ts';

// M9 fix 1071: an uncaught throw in main is logged, the corner told, and the
// process carries on; a rejection is logged alone.
function harness(note?: (text: string) => void) {
  const proc = new EventEmitter() as EventEmitter & { exit: () => void };
  let exits = 0;
  proc.exit = () => {
    exits++;
  };
  const lines: string[] = [];
  const notes: string[] = [];
  installLastResort(proc, (msg) => lines.push(msg), note ?? ((text) => notes.push(text)));
  return { proc, lines, notes, exits: () => exits };
}

test('an uncaught exception is logged with its stack and noted, and the process is not ended', () => {
  const h = harness();
  h.proc.emit('uncaughtException', new Error('boom'));
  assert.equal(h.lines.length, 1);
  assert.ok(h.lines[0]!.startsWith('uncaught exception in main: Error: boom'), h.lines[0]);
  assert.deepEqual(h.notes, [LAST_RESORT_NOTE]);
  assert.equal(h.exits(), 0);
});

test('an unhandled rejection is logged and sends no note', () => {
  const h = harness();
  h.proc.emit('unhandledRejection', 'nope');
  assert.deepEqual(h.lines, ['unhandled rejection in main: nope']);
  assert.deepEqual(h.notes, []);
});

test('a note that throws does not make the handler throw', () => {
  const h = harness(() => {
    throw new Error('no windows yet');
  });
  assert.doesNotThrow(() => h.proc.emit('uncaughtException', new Error('early')));
  assert.equal(h.lines.length, 1);
});
