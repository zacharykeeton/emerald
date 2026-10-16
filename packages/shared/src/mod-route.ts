// A prompt to a Claude session whose emerald mod is up goes in through the
// mod (M9 fix 741) rather than typed into the pty, so no Enter pause is
// needed: Claude Code's paste detection turns an Enter that arrives too
// soon into a newline (docs/PLAN.md, M5 gotcha 4). Shared since M9 fix 781,
// when the app's chat box began to route its sends the same way.

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
