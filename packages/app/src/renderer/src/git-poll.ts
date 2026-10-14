import { useEffect, useState } from 'react';

// One cadence for everything the rail reads from git (the status colours
// since M20, the Changes and Timeline tabs since M45): fetched when the
// root moves or the caller's tick bumps, again a moment after any watched
// folder changes (a save, or git itself writing), and every 5 s while the
// window is on screen so a commit or a checkout made in a pane, or in
// another window, shows without a save; a minimized window does not poll.
// A reply that lands after the root moved on is dropped. key (M9 fix
// 286): a word the caller's read depends on (the graph's remotes flag),
// which refetches when it changes, the way the tick does. stampOf (M9
// fix 354): a string that says what of the read the caller draws; a
// reply whose stamp matches the held value's is dropped, so the value
// keeps its identity and a consumer's effects keyed on it run only on
// a change, where every poll used to hand the graph a fresh object and
// re-ask a hundred conversations' usage. Without one every reply is a
// change, as before.
const GIT_POLL_MS = 5000;
const GIT_DEBOUNCE_MS = 300;

export interface GitPollEnv {
  onChanged: (fn: () => void) => () => void;
  visible: () => boolean;
}

// The poll itself, out of the hook so a test can drive it: fetch now,
// again a moment after a change, and on the interval while visible;
// onValue is called with a reply whose stamp differs from the last
// one's. Returns the stop.
export function startGitPoll<T>(root: string, fetchFor: (root: string) => Promise<T>, what: string, stampOf: ((r: T) => string) | null, onValue: (r: T) => void, env: GitPollEnv): () => void {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // The stamp of the last reply handed on; null until the first, which
  // always goes through (the caller's empty start has no stamp).
  let lastStamp: string | null = null;
  const fetch = () => {
    timer = null;
    void fetchFor(root)
      .then((r) => {
        if (!live) return;
        if (stampOf !== null) {
          const stamp = stampOf(r);
          if (lastStamp !== null && stamp === lastStamp) return;
          lastStamp = stamp;
        }
        onValue(r);
      })
      .catch((err: unknown) => console.warn(`[emerald] ${what} failed`, err));
  };
  const soon = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(fetch, GIT_DEBOUNCE_MS);
  };
  fetch();
  const offChanged = env.onChanged(soon);
  const poll = setInterval(() => {
    if (env.visible()) fetch();
  }, GIT_POLL_MS);
  return () => {
    live = false;
    if (timer !== null) clearTimeout(timer);
    clearInterval(poll);
    offChanged();
  };
}

const windowEnv: GitPollEnv = {
  onChanged: (fn) => window.emerald.files.onChanged(fn),
  visible: () => document.visibilityState === 'visible',
};

export function useGitPoll<T>(root: string | null, tick: number, empty: T, fetchFor: (root: string) => Promise<T>, what: string, key = '', stampOf: ((r: T) => string) | null = null): T {
  const [value, setValue] = useState<T>(empty);
  useEffect(() => {
    if (root === null) {
      setValue(empty);
      return;
    }
    // A new root, tick or key starts the stamp over, so the first reply
    // of the new read is always handed on.
    return startGitPoll(root, fetchFor, what, stampOf, setValue, windowEnv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, tick, key]);
  return value;
}
