import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';
import { CliError, usageError } from './cli-error.ts';

export type OptionSpec = NonNullable<ParseArgsConfig['options']>;

export interface Parsed<O extends OptionSpec> {
  values: ReturnType<typeof parseArgs<{ options: O; strict: true; allowPositionals: true }>>['values'];
  positionals: string[];
  // Everything after a bare `--`, untouched. `emmer new <dir> -- --model x`
  // hands the tail to Claude.
  rest: string[];
}

// node:util parseArgs with the two things every command wants: unknown
// options become a usage error instead of a stack trace, and a `--` splits
// the line so options after it are never parsed as ours.
export function parse<O extends OptionSpec>(argv: readonly string[], options: O): Parsed<O> {
  const dash = argv.indexOf('--');
  const own = dash === -1 ? [...argv] : argv.slice(0, dash);
  const rest = dash === -1 ? [] : argv.slice(dash + 1);
  try {
    const { values, positionals } = parseArgs({ args: own, options, strict: true, allowPositionals: true });
    return { values, positionals, rest };
  } catch (err) {
    throw usageError((err as Error).message.replace(/\. To specify.*$/s, ''));
  }
}

// Positional arguments by name, refusing too few or too many so a typo in
// a session id never silently becomes a text argument.
export function positionals<N extends string, O extends string = never>(
  parsed: { positionals: string[] },
  names: N[],
  optional: O[] = [],
): Record<N, string> & Partial<Record<O, string>> {
  const got = parsed.positionals;
  if (got.length < names.length) {
    throw usageError(`missing ${names[got.length]}`);
  }
  if (got.length > names.length + optional.length) {
    throw usageError(`unexpected argument ${JSON.stringify(got[names.length + optional.length])}`);
  }
  const out: Record<string, string> = {};
  [...names, ...optional].forEach((name, i) => {
    const value = got[i];
    if (value !== undefined) out[name] = value;
  });
  return out as Record<N, string> & Partial<Record<O, string>>;
}

// A numeric option, refused rather than coerced when it is not a whole number.
export function integerOption(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw usageError(`--${name} must be a whole number, got ${JSON.stringify(value)}`);
  return Number(value);
}

// M9 fix 854: a verb's text read whole from stdin or a file, so a newline, a % or a double quote reaches the command as written; emmer.cmd's %* and Windows PowerShell 5.1 change all three on the command line (the backlog entry of 2026-10-16).
export async function readText(
  src: { stdin: boolean; file: string | undefined },
  flags: { stdin: string; file: string },
  keepNewline: boolean,
): Promise<string | null> {
  if (!src.stdin && src.file === undefined) return null;
  if (src.stdin && src.file !== undefined) throw usageError(`${flags.stdin} and ${flags.file} together`);
  let bytes: Buffer;
  if (src.file !== undefined) {
    const abs = path.resolve(src.file);
    if (!isFile(abs)) throw new CliError(`no file ${abs}`);
    bytes = fs.readFileSync(abs);
  } else if (testStdin !== null) {
    bytes = Buffer.from(testStdin, 'utf8');
  } else {
    if (process.stdin.isTTY === true) throw usageError(`${flags.stdin} reads text piped in, and nothing is piped`);
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer));
    bytes = Buffer.concat(chunks);
  }
  let text = bytes.toString('utf8');
  if (text.startsWith('﻿')) text = text.slice(1);
  if (!keepNewline) text = text.replace(/\r?\n$/, '');
  return text;
}

let testStdin: string | null = null;

// Makes readText take text in place of process.stdin (and skip the
// terminal check) until the returned function is called; for tests.
export function stdinText(text: string): () => void {
  const before = testStdin;
  testStdin = text;
  return () => {
    testStdin = before;
  };
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
