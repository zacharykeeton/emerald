import { ChildProcess } from 'node:child_process';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

// The main process's event loop delay, logged every couple of seconds to
// main.log while EMERALD_LOOP_DELAY is set (M9 fix 226): a keystroke and
// its echo both cross this process, so a long task here is a felt lag,
// and the typing-lag bench reads these lines to say whether one was.
// The daemon logs the same line to emmerd.log (daemon/src/loop-delay.ts).
// Nothing runs without the variable.
const INTERVAL_MS = 2000;

export function startLoopDelayLog(log: (msg: string) => void, env: NodeJS.ProcessEnv = process.env): void {
  if (env['EMERALD_LOOP_DELAY'] === undefined || env['EMERALD_LOOP_DELAY'] === '') return;
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const ms = (ns: number) => (ns / 1e6).toFixed(2);
  setInterval(() => {
    log(`loop delay p50=${ms(h.percentile(50))} p90=${ms(h.percentile(90))} p99=${ms(h.percentile(99))} max=${ms(h.max)}`);
    h.reset();
  }, INTERVAL_MS).unref();
  // Every child this process starts goes through ChildProcess.prototype
  // .spawn, whose CreateProcess runs on the loop thread; one that takes
  // longer than SLOW_SPAWN_MS is logged with its file, since that is where
  // the bench found the stalls.
  const proto = ChildProcess.prototype as unknown as { spawn: (this: unknown, options: { file?: string; args?: string[] }) => unknown };
  const original = proto.spawn;
  proto.spawn = function (this: unknown, options) {
    const t0 = performance.now();
    try {
      return original.call(this, options);
    } finally {
      const took = performance.now() - t0;
      if (took >= SLOW_SPAWN_MS) log(`slow spawn ${options?.file ?? '?'} ${(options?.args ?? []).slice(1, 3).join(' ')} took ${took.toFixed(1)} ms`);
    }
  };
}

const SLOW_SPAWN_MS = 20;
