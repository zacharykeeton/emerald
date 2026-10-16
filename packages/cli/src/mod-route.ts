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
