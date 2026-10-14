import { execFile } from 'node:child_process';
import fs from 'node:fs';
import type { Runner } from './node-runner.ts';
import { nodeCommand } from './node-runner.ts';

// The app changes the machine through the shipped CLI rather than a second
// implementation: `emmer hooks` is the one that knows how to merge into
// settings.json, and an installed app carries it under resources/cli next
// to the daemon. Only --json commands are run this way; the reply is the
// parsed stdout plus the exit code, because `hooks status` uses exit 1 to
// mean "incomplete", which is an answer, not a failure.
export interface CliOptions {
  cliMain: string;
  runner: Runner;
  log: (msg: string) => void;
}

export interface CliResult {
  code: number;
  json: unknown;
}

export function runCliJson(opts: CliOptions, args: string[]): Promise<CliResult> {
  if (!fs.existsSync(opts.cliMain)) {
    return Promise.reject(new Error(`emmer CLI not built: ${opts.cliMain} is missing (run npm run build at the repo root)`));
  }
  const { exe, env } = nodeCommand(opts.runner);
  return new Promise((resolve, reject) => {
    execFile(exe, [opts.cliMain, ...args], { env, windowsHide: true, timeout: 15_000 }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof err.code === 'number' ? err.code : -1;
      let json: unknown;
      try {
        json = JSON.parse(stdout);
      } catch {
        // Nothing usable on stdout means the CLI itself failed: a usage
        // error, a missing module, a kill by the timeout.
        const detail = stderr.trim() || (err !== null ? err.message : 'no output');
        opts.log(`emerald ${args.join(' ')} failed (exit ${code}): ${detail}`);
        reject(new Error(detail));
        return;
      }
      resolve({ code, json });
    });
  });
}
