// M56: a prompt saved by name, kept by the daemon (prompts.json) so
// every window and the CLI cycle one list. The name is what the box's
// history arrows and emmer prompt --saved go by.
export interface SavedPrompt {
  name: string;
  text: string;
}

// A name is one short line: what a hint in the box or a CLI argument
// can carry. Sixty-four characters is generous for `plan-next-batch`.
export const PROMPT_NAME_MAX = 64;

export function isPromptName(v: unknown): v is string {
  return typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= PROMPT_NAME_MAX && !/[\r\n]/.test(v);
}

export function isSavedPrompt(v: unknown): v is SavedPrompt {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return isPromptName(o['name']) && typeof o['text'] === 'string' && o['text'].length > 0;
}
