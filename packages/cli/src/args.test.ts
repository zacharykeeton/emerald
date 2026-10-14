import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integerOption, parse, positionals } from './args.ts';
import { CliError, EXIT } from './cli-error.ts';

const options = {
  json: { type: 'boolean', default: false },
  lines: { type: 'string' },
} as const;

function usageFailure(fn: () => unknown, pattern: RegExp): void {
  assert.throws(fn, (err: unknown) => err instanceof CliError && err.exitCode === EXIT.usage && pattern.test(err.message));
}

test('parse reads options and positionals and splits at a bare --', () => {
  const p = parse(['C:\\work', '--json', '--lines', '3', '--', '--model', 'x', '--json'], options);
  assert.deepEqual(p.positionals, ['C:\\work']);
  assert.equal(p.values.json, true);
  assert.equal(p.values.lines, '3');
  // The tail is untouched: our --json after the -- belongs to the program.
  assert.deepEqual(p.rest, ['--model', 'x', '--json']);
});

test('parse without a -- leaves rest empty and defaults booleans', () => {
  const p = parse(['abc'], options);
  assert.deepEqual(p.rest, []);
  assert.equal(p.values.json, false);
  assert.equal(p.values.lines, undefined);
});

test('parse turns an unknown option into a usage error', () => {
  usageFailure(() => parse(['--nope'], options), /Unknown option '--nope'/);
});

test('positionals names the missing argument and refuses extras', () => {
  const got = positionals({ positionals: ['s1', 'hello'] }, ['session'], ['text']);
  assert.deepEqual(got, { session: 's1', text: 'hello' });
  assert.deepEqual(positionals({ positionals: ['s1'] }, ['session'], ['text']), { session: 's1' });
  usageFailure(() => positionals({ positionals: [] }, ['session']), /missing session/);
  usageFailure(() => positionals({ positionals: ['a', 'b'] }, ['session']), /unexpected argument "b"/);
});

test('integerOption accepts whole numbers only', () => {
  assert.equal(integerOption(undefined, 'lines', 7), 7);
  assert.equal(integerOption('0', 'lines', 7), 0);
  assert.equal(integerOption('42', 'lines', 7), 42);
  usageFailure(() => integerOption('4x', 'lines', 7), /--lines must be a whole number/);
  usageFailure(() => integerOption('-1', 'lines', 7), /--lines must be a whole number/);
});
