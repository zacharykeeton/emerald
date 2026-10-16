// A prompt to a Claude session whose emerald mod is up goes in through the
// mod (M9 fix 741) rather than typed into the pty, so no Enter pause is
// needed: Claude Code's paste detection turns an Enter that arrives too
// soon into a newline (docs/PLAN.md, M5 gotcha 4).

import { describeState } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import { CliError } from './cli-error.ts';
import { shortId } from './resolve.ts';

// The level of the daemon's session.submit and mod.channel.
export const MOD_CHANNEL_LEVEL = 65;

// Whether a text can go through the mod. A slash command, bash mode (`!`)
// and the memory key (`#`) are read by the prompt box alone, and a
// plugin's prompt expands no `@file` mention (PromptSubmitArgs in the
// mod's types), so those stay typed. An `@` with no space before it (an
// address) is not a mention.
export function modRoutable(text: string): boolean {
  const first = text.trimStart()[0];
  if (first === '/' || first === '!' || first === '#') return false;
  return !/(^|\s)@\S/.test(text);
}

// send and prompt's --if-idle (M9 fix 741): with the mod a prompt to a
// working session waits for its turn's end, so a caller that wants the
// old refusal asks for it; exit 1, nothing sent.
export function refuseBusy(found: SessionInfo): void {
  if (found.state !== 'working' && found.state !== 'waiting') return;
  throw new CliError(`${shortId(found.id)} ${found.name} is ${describeState(found).text}; --if-idle sends only to a session that is not working`);
}
