// M9 fix 1159: when the page starts taking files from outside (emmer open, a launch with one). The main process holds an open until the page says it listens, and the listener goes in once this window's file tabs are under the key it keeps (the adopt, fix 867), so a launch's file lands in that key and stays. A page that never learns its window listens anyway after the fallback, so a launch with the daemon down still opens its file.
export interface OpenListenGate {
  ready(): void;
  dispose(): void;
}

export function openListenGate(listen: () => () => void, fallbackMs: number, late: () => void): OpenListenGate {
  let stop: (() => void) | null = null;
  let disposed = false;
  function listenNow(): void {
    clearTimeout(timer);
    if (disposed || stop !== null) return;
    stop = listen();
  }
  const timer = setTimeout(() => {
    if (disposed || stop !== null) return;
    late();
    listenNow();
  }, fallbackMs);
  return {
    ready: listenNow,
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      stop?.();
      stop = null;
    },
  };
}
