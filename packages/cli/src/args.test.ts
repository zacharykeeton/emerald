import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { integerOption, parse, positionals, readText, stdinText } from './args.ts';
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

// M9 fix 854: text read whole from stdin or a file.
const FLAGS = { stdin: '--stdin', file: '--file' };

async function rejected(run: Promise<unknown>): Promise<CliError> {
  try {
    await run;
  } catch (err) {
    assert.ok(err instanceof CliError, `a CliError, got ${String(err)}`);
    return err;
  }
  assert.fail('expected readText to throw');
}

test('readText is null with neither flag, and both together is a usage error', async () => {
  assert.equal(await readText({ stdin: false, file: undefined }, FLAGS, false), null);
  const err = await rejected(readText({ stdin: true, file: 'x' }, FLAGS, false));
  assert.equal(err.exitCode, EXIT.usage);
  assert.equal(err.message, '--stdin and --file together');
});

test('readText of a file drops a BOM and one trailing newline unless told to keep it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emmer-readtext-'));
  try {
    const bom = path.join(dir, 'bom.txt');
    fs.writeFileSync(bom, '﻿a\r\nb\r\n');
    assert.equal(await readText({ stdin: false, file: bom }, FLAGS, false), 'a\r\nb');
    assert.equal(await readText({ stdin: false, file: bom }, FLAGS, true), 'a\r\nb\r\n');
    const two = path.join(dir, 'two.txt');
    fs.writeFileSync(two, 'a\n\n');
    assert.equal(await readText({ stdin: false, file: two }, FLAGS, false), 'a\n');
    const missing = path.join(dir, 'missing.txt');
    const err = await rejected(readText({ stdin: false, file: missing }, FLAGS, false));
    assert.equal(err.exitCode, EXIT.failure);
    assert.equal(err.message, `no file ${missing}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stdinText feeds --stdin until it is restored', async () => {
  const restore = stdinText('x\n');
  try {
    assert.equal(await readText({ stdin: true, file: undefined }, FLAGS, false), 'x');
    assert.equal(await readText({ stdin: true, file: undefined }, FLAGS, true), 'x\n');
  } finally {
    restore();
  }
});
