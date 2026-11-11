// One ipcRenderer.on per channel, fanned out to a set of handlers (M9 fix 1137). Node warns at the eleventh listener on a channel, and with a file tab each that warning was ordinary use, so it could not tell a leak from load; the preload now holds one listener and a leak shows as a growing set, warned of once at FAN_OUT_WARN_AT. Imports nothing, so node:test runs it.

export const FAN_OUT_WARN_AT = 50;

export function fanOut<A extends unknown[]>(
  channel: string,
  log: (level: 'warn' | 'error', line: string) => void = (level, line) => console[level](line),
): { emit: (...args: A) => void; add: (handler: (...args: A) => void) => () => void; size: () => number } {
  const set = new Set<(...args: A) => void>();
  let warned = false;
  return {
    emit: (...args) => {
      for (const h of [...set]) {
        try {
          h(...args);
        } catch (err) {
          log('error', `[emerald] a ${channel} handler threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        }
      }
    },
    add: (handler) => {
      // A fresh wrapper, so the same function added twice is two entries.
      const wrapper = (...args: A) => handler(...args);
      set.add(wrapper);
      if (!warned && set.size >= FAN_OUT_WARN_AT) {
        warned = true;
        log('warn', `[emerald] ${set.size} handlers on ${channel}; a subscriber may be missing its off`);
      }
      return () => {
        set.delete(wrapper);
      };
    },
    size: () => set.size,
  };
}
