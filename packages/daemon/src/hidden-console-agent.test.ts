import { test } from 'node:test';
import assert from 'node:assert/strict';
import type child_process from 'node:child_process';
import { hideConsoleListAgent } from './hidden-console-agent.ts';

// A stand-in for the child_process module: records what fork was called
// with, so the test never spawns anything.
function stub() {
  const calls: unknown[][] = [];
  const cp = { fork: ((...args: unknown[]) => calls.push(args)) as unknown as typeof child_process.fork };
  return { cp, calls };
}

test('the console list agent is forked hidden with piped stdio, in either fork shape', () => {
  const { cp, calls } = stub();
  hideConsoleListAgent(cp);
  cp.fork('C:\\x\\node_modules\\node-pty\\lib\\conpty_console_list_agent', ['123']);
  cp.fork('C:\\x\\node_modules\\node-pty\\lib\\conpty_console_list_agent', { cwd: 'C:\\' });
  assert.deepEqual(calls[0], ['C:\\x\\node_modules\\node-pty\\lib\\conpty_console_list_agent', ['123'], { windowsHide: true, silent: true }]);
  assert.deepEqual(calls[1], ['C:\\x\\node_modules\\node-pty\\lib\\conpty_console_list_agent', { cwd: 'C:\\', windowsHide: true, silent: true }, undefined]);
});

test('any other fork goes through untouched', () => {
  const { cp, calls } = stub();
  hideConsoleListAgent(cp);
  cp.fork('worker.js', ['a'], { cwd: 'C:\\' });
  assert.deepEqual(calls[0], ['worker.js', ['a'], { cwd: 'C:\\' }]);
});
