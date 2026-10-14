import { ChildProcess } from 'node:child_process';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { Logger } from './log.ts';

// The event loop's delay percentiles, logged every couple of seconds
// while EMERALD_LOOP_DELAY is set (M9 fix 226). The typing-lag bench reads
// these off the log to say whether a keystroke waited in this process's
// queue; a daemon started without the variable logs nothing. The
// histogram is reset per line so each line is its own window.
export const LOOP_DELAY_INTERVAL_MS = 2000;

export function startLoopDelayLog(log: Logger, env: NodeJS.ProcessEnv = process.env): (() => void) | null {
  if (env['EMERALD_LOOP_DELAY'] === undefined || env['EMERALD_LOOP_DELAY'] === '') return null;
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const ms = (ns: number) => Math.round(ns / 1e4) / 100;
  const timer = setInterval(() => {
    log.info('loop delay', { p50: ms(h.percentile(50)), p90: ms(h.percentile(90)), p99: ms(h.percentile(99)), max: ms(h.max) });
    h.reset();
  }, LOOP_DELAY_INTERVAL_MS);
  timer.unref();
  const unpatch = logSlowSpawns((line) => log.info(line));
  return () => {
    clearInterval(timer);
    h.disable();
    unpatch();
  };
}

// Every child process this process starts goes through
// ChildProcess.prototype.spawn, whose CreateProcess runs on the loop
// thread; one that takes longer than SLOW_SPAWN_MS is logged with its
// file and the time, since that is where the bench found the stalls.
export const SLOW_SPAWN_MS = 20;

export function logSlowSpawns(write: (line: string) => void): () => void {
  const proto = ChildProcess.prototype as unknown as { spawn: (this: unknown, options: { file?: string; args?: string[] }) => unknown };
  const original = proto.spawn;
  proto.spawn = function (this: unknown, options) {
    const t0 = performance.now();
    try {
      return original.call(this, options);
    } finally {
      const ms = performance.now() - t0;
      if (ms >= SLOW_SPAWN_MS) write(`slow spawn ${options?.file ?? '?'} ${(options?.args ?? []).slice(1, 3).join(' ')} took ${ms.toFixed(1)} ms`);
    }
  };
  return () => {
    proto.spawn = original;
  };
}
