// The updater's state (M9 fix 239, the app's main/updater.ts), shared
// since M9 fix 271: the app reports it to the daemon on every change
// (update.report), the daemon keeps the last one for `emmer update`
// (update.state), and the CLI's clicks reach the app as update.requested
// pushes (update.act). The renderer's update-model.ts re-exports the
// types for the badge.

// off: a dev build or EMERALD_NO_UPDATE, no check ever runs. idle: checked
// and nothing newer, or not checked yet. checking, available, downloading
// and ready follow the updater's events; installing is the moment after
// the restart click while the daemon stops; error is a failure after the
// person asked for something (a download, a retry).
export const UPDATE_PHASES = ['off', 'idle', 'checking', 'available', 'downloading', 'ready', 'installing', 'error'] as const;
export type UpdatePhase = (typeof UPDATE_PHASES)[number];

export interface UpdateState {
  phase: UpdatePhase;
  // The running build's version.
  current: string;
  // The feed's version, once a check has answered.
  latest: string | null;
  // The download's progress, 0 to 100, while downloading.
  percent: number | null;
  // The failure's words, in the error phase; on idle, the last check's
  // outcome (M9 fix 242): `no feed at 127.0.0.1:7420` when nothing
  // answered, `checked 18:43, up to date` when the feed had nothing
  // newer, null before the first check.
  message: string | null;
  // How many checks this window has seen answered since it started (M9
  // fix 539), so `emmer update --check` sees an answer that reads the same
  // as the last one; absent from a window before this build.
  checks?: number;
}

// The shape check the daemon runs on a reported state, since the app on
// the other end may be any build.
export function isUpdateState(v: unknown): v is UpdateState {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    (UPDATE_PHASES as readonly string[]).includes(String(s['phase'])) &&
    typeof s['current'] === 'string' &&
    (s['latest'] === null || typeof s['latest'] === 'string') &&
    (s['percent'] === null || typeof s['percent'] === 'number') &&
    (s['message'] === null || typeof s['message'] === 'string') &&
    (s['checks'] === undefined || typeof s['checks'] === 'number')
  );
}

// One line for the state, the way `emmer update` prints it and the
// daemon's log names it: `0.1.240 installed, 0.1.258 ready`.
export function updateText(state: UpdateState): string {
  const head = `${state.current} installed`;
  switch (state.phase) {
    case 'off':
      return `${head}, update check off in this build`;
    case 'idle':
      return `${head}, ${state.message ?? 'not checked yet'}`;
    case 'checking':
      return `${head}, checking the feed`;
    case 'available':
      return `${head}, ${state.latest ?? '?'} available`;
    case 'downloading':
      return `${head}, downloading ${state.latest ?? '?'}${state.percent === null ? '' : ` ${state.percent}%`}`;
    case 'ready':
      return `${head}, ${state.latest ?? '?'} ready`;
    case 'installing':
      return `${head}, installing ${state.latest ?? '?'}`;
    case 'error':
      return `${head}, update failed: ${state.message ?? 'unknown error'}`;
  }
}
