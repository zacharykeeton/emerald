import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';
import { usageError } from './cli-error.ts';

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
