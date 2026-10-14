// The update badge at the right of the title row (M9 fix 239): what it
// says for each phase of the updater (main/updater.ts), and when it says
// nothing. Pure, so the badge's words are testable without the updater.
import { isNewerVersion } from '@emerald/shared';
import type { UpdatePhase } from '@emerald/shared';

// The phases and the state live in @emerald/shared since M9 fix 271, so the
// daemon and the CLI read the same shape the badge draws.
export type { UpdatePhase, UpdateState } from '@emerald/shared';

export interface UpdateBadge {
  text: string;
  // The tooltip: what a click does, and for the restart what it does to
  // the panes.
  title: string;
}

// The panes' fate at a restart, said once in the tooltip and nowhere
// else: the daemon stops with its screens kept and the sessions come
// back through Resume, as at a hand install.
const RESTART_NOTE = 'The window closes, the daemon stops and every pane comes back through Resume once the new build opens; nothing is lost but the scrollback.';

export function updateBadge(current: string, latest: string | null, phase: UpdatePhase, percent: number | null = null, message: string | null = null): UpdateBadge | null {
  switch (phase) {
    case 'available':
      // Only after a download that failed (M9 fix 625): a newer build
      // downloads on its own, so available is the way to a retry, and the
      // words say what the click does (M9 fix 656).
      if (latest === null || !isNewerVersion(latest, current)) return null;
      return { text: `Retry ${latest}`, title: `emerald ${latest} is in the feed (this is ${current}). Its download did not finish; click to try again. Nothing changes until you restart.` };
    case 'downloading':
      // Nothing while the download runs (M9 fix 625); the app menu's hint
      // is the one place its progress shows.
      return null;
    case 'ready':
      return { text: 'Restart to update', title: `emerald ${latest ?? ''} is downloaded and checked (this is ${current}). Click to restart into it. ${RESTART_NOTE}` };
    case 'installing':
      return { text: 'Restarting…', title: 'Stopping the daemon, then running the installer.' };
    case 'error':
      return { text: 'update failed', title: `${message ?? 'The update failed.'} Click to check again.` };
    default:
      return null;
  }
}
