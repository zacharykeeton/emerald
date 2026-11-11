// M9 fix 1156: the root postinstall's decision, on planCopy alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCopy, NODE_PTY_VERSION, CONOUT_FILES, CONOUT_MARK } from './patch-node-pty.mjs';

const ours = ['conn text', 'worker text'];

test('no node-pty installed is missing', () => {
  assert.equal(planCopy({ version: null, installed: [null, null], ours }), 'missing');
});

test('another node-pty version is left as it is', () => {
  assert.equal(planCopy({ version: '1.2.0', installed: ['x', 'y'], ours }), 'version');
});

test('both texts already ours is nothing to do', () => {
  assert.equal(planCopy({ version: NODE_PTY_VERSION, installed: [...ours], ours }), 'already');
});

test('one text differing or missing is a copy', () => {
  assert.equal(planCopy({ version: NODE_PTY_VERSION, installed: ['npm text', ours[1]], ours }), 'copy');
  assert.equal(planCopy({ version: NODE_PTY_VERSION, installed: [ours[0], null], ours }), 'copy');
});

test('the two files and the mark', () => {
  assert.equal(NODE_PTY_VERSION, '1.1.0');
  assert.equal(CONOUT_MARK, 'emerald fix 1156');
  assert.deepEqual(CONOUT_FILES, ['windowsConoutConnection.js', 'worker/conoutSocketWorker.js']);
});
