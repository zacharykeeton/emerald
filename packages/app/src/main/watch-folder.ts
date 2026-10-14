import fs from 'node:fs';
import path from 'node:path';

// The one way the main process watches a folder (M9 fix 481), for the
// files rail, the commits view's logs folder and the history panel. Two
// things libuv does on Windows that every caller must be kept from:
//
// A folder named in 8.3 form (os.tmpdir() is, on some boxes) makes
// libuv's watcher assert and abort the whole process at its first
// change, since the change comes back under the long name. So the
// folder is watched under fs.realpathSync.native; callers keep their own
// maps keyed by the string they were given.
//
// A watched folder that is deleted reports a `rename` naming the folder
// itself (its full \\?\ path) about 100,000 times a second, never an
// `error`, until the watcher is closed, which starves any debounce and
// holds a core. So an event naming the folder, or a check at most every
// GONE_CHECK_MS finding it no longer there, closes the watcher and calls
// onGone once; the caller decides whether and when to watch again.

const GONE_CHECK_MS = 50;

// The watcher, or null when the folder cannot be watched (gone, or
// refused). onChange gets the event's file name as fs.watch gives it, and
// its type: 'rename' when a name came or went, 'change' when only a
// file's contents or times did (M9 fix 551).
export function watchFolder(dir: string, onChange: (name: string | null, event: 'rename' | 'change') => void, onGone: () => void): fs.FSWatcher | null {
  let real: string;
  let w: fs.FSWatcher;
  try {
    real = fs.realpathSync.native(dir);
    w = fs.watch(real, { persistent: false });
  } catch {
    return null;
  }
  const self = real.toLowerCase();
  let ended = false;
  let checkQueued = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    w.close();
    onGone();
  };
  w.on('change', (event, name) => {
    if (ended) return;
    const file = typeof name === 'string' ? name : null;
    if (file !== null && namesFolder(file, self)) {
      end();
      return;
    }
    // A delete whose event names something else (or nothing) is caught
    // by one existence check per burst rather than one per event.
    if (!checkQueued) {
      checkQueued = true;
      setTimeout(() => {
        checkQueued = false;
        if (!ended && !fs.existsSync(real)) end();
      }, GONE_CHECK_MS).unref();
    }
    onChange(file, event === 'change' ? 'change' : 'rename');
  });
  // An error means the watch is dead either way; let the caller re-list
  // and decide, as for a delete.
  w.on('error', end);
  return w;
}

// Whether an event's file name is the watched folder itself: on a delete
// libuv names it by its full path, \\?\ prefix and all, where a change
// inside names a relative path.
function namesFolder(name: string, self: string): boolean {
  const bare = name.startsWith('\\\\?\\') ? name.slice(4) : name;
  return path.isAbsolute(bare) && bare.toLowerCase() === self;
}
