// The install's minute of nothing on screen (M9 fix 282). The badge's
// second click closes the window, stops the daemon and runs the installer,
// and the new build comes up on its own about a minute later; in between
// there is nothing on screen to say whether to wait, and a person who
// clicks the emerald icon meanwhile starts the old exe, which the installer
// then takes down hard. So the click writes installing.json under the
// emerald home ({ version, at }) beside installed.json and posts a
// notification saying the window comes back on its own, and a packed
// build launched while the marker is young and names another version
// posts the same word again and quits rather than opening a window. The
// new build's own first launch finds the marker naming its version and
// removes it; a marker older than three minutes is a failed install and
// is removed the same way, so a bad click never locks the app out.
//
// M9 fix 408: both words went through the app's own notifier and the gap
// launch held its quit up to six seconds on the toast's show event, and
// no install has ever shown either toast: the installer's running-app
// loop kills this exe before the event lands. Both now go through the
// install poster's worker (install-poster.ts), which outlives the
// process that spawned it, so the gap's quit goes as soon as the worker
// is up and the six-second wait is gone with it.
import fs from 'node:fs';

export interface InstallMarker {
  version: string;
  // When the click landed, an ISO string like installed.json's.
  at: string;
}

// How long a marker counts as an install in progress. The install takes
// about a minute; three gives a slow disk room and still frees a person
// whose install failed within the time they would wait anyway.
export const GAP_MS = 3 * 60 * 1000;
// What the notification's `about N s to go` counts down from.
export const INSTALL_MS = 60 * 1000;

// 'gap': another version's install is under way, post the word and quit.
// 'fresh': the marker is spent (this build's own, or too old) and goes.
// 'none': no marker, or not one this module wrote.
export type GapState = 'gap' | 'fresh' | 'none';

export function gapState(marker: InstallMarker | null, version: string, now: number): GapState {
  if (marker === null) return 'none';
  if (marker.version === version) return 'fresh';
  const at = Date.parse(marker.at);
  if (Number.isNaN(at) || now - at >= GAP_MS) return 'fresh';
  return 'gap';
}

// The seconds the notification says are left, off the click's time and
// the minute an install takes; never under 10, since a launch inside
// the gap means the install is still going whatever the clock says.
export function secondsToGo(marker: InstallMarker, now: number): number {
  const at = Date.parse(marker.at);
  const left = Number.isNaN(at) ? INSTALL_MS : INSTALL_MS - (now - at);
  return Math.max(10, Math.round(left / 10000) * 10);
}

export function installingNotice(version: string): { title: string; body: string } {
  return { title: `Installing emerald ${version}`, body: 'The window closes now and comes back on its own in about a minute.' };
}

export function gapNotice(marker: InstallMarker, now: number): { title: string; body: string } {
  return { title: `Still installing emerald ${marker.version}`, body: `About ${secondsToGo(marker, now)} s to go; the window comes back on its own.` };
}

export function readMarker(file: string): InstallMarker | null {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown; at?: unknown };
    if (typeof o.version !== 'string' || typeof o.at !== 'string') return null;
    return { version: o.version, at: o.at };
  } catch {
    return null;
  }
}

export function writeMarker(file: string, version: string, now: number): void {
  fs.writeFileSync(file, JSON.stringify({ version, at: new Date(now).toISOString() }) + '\n');
}
