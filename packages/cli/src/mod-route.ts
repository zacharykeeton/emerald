// The CLI's half of the mod route (M9 fix 741); MOD_CHANNEL_LEVEL and
// modRoutable live in @emerald/shared since M9 fix 781, when the app's chat
// box began to route its sends the same way.

import { describeState } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import { CliError } from './cli-error.ts';
import { shortId } from './resolve.ts';

// send and prompt's --if-idle (M9 fix 741): with the mod a prompt to a
// working session waits for its turn's end, so a caller that wants the
// old refusal asks for it; exit 1, nothing sent.
export function refuseBusy(found: SessionInfo): void {
  if (found.state !== 'working' && found.state !== 'waiting') return;
  throw new CliError(`${shortId(found.id)} ${found.name} is ${describeState(found).text}; --if-idle sends only to a session that is not working`);
}

// M9 fix 995: what a send to a Claude mid-turn says in place of "sent",
// since the text has not reached Claude yet. The mod's prompt waits for
// the turn's end; a typed one enters at the turn's next tool round. Only a
// Claude row: a shell reads working while a command runs and has no turn,
// and a waiting session takes a submit at once (sendRoute, fix 911).
export function queuedLine(found: SessionInfo, via: 'mod' | 'typed', now = Date.now()): string | null {
  if (found.kind !== 'claude' || found.state !== 'working') return null;
  const minutes = Math.floor((now - found.stateSince) / 60_000);
  const age = minutes < 1 ? 'under 1m' : `${minutes}m`;
  return via === 'mod'
    ? `queued behind a turn running ${age}; it goes in when that turn ends`
    : `queued into a turn running ${age}; it goes in at the turn's next tool call, or when that turn ends`;
}
