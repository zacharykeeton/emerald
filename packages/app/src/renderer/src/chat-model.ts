import type { NeedsInputReason, SessionState } from '@emerald/shared';

// The chat view's pure parts (M9 fix 689), kept out of the components so
// node:test can cover them: the face's stored set, the spinner read off
// the screen, and the hint under the box.

// The panes on the chat face, stored as [paneId, sessionId] pairs. A
// corrupt entry, or one that is not a pair of strings, reads as nothing.
export function parseChatPanes(raw: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (raw === null) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  for (const pair of parsed) {
    if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string') out.set(pair[0], pair[1]);
  }
  return out;
}

export function serializeChatPanes(chatPanes: ReadonlyMap<string, string>): string {
  return JSON.stringify([...chatPanes.entries()]);
}

// The face a pane shows: the chat only while it holds the session it was
// turned to chat on, so a pane shown another session is on the terminal
// at once.
export function faceOf(chatPanes: ReadonlyMap<string, string>, paneId: string, sessionId: string | null): 'chat' | 'terminal' {
  return sessionId !== null && chatPanes.get(paneId) === sessionId ? 'chat' : 'terminal';
}

// Claude Code's spinner row while it works, as claim 8 of M9 fix 688's
// claims (docs/DONE.md) read it at 2.1.300: a glyph stepping
// through `· ✢ * ✶ ✻ ✽`, one word with an ellipsis, then in brackets the
// seconds and the tokens received (`✶ Forging… (3s · ↓ 88 tokens)`,
// `✢ Forging… (running PreToolUse hooks… 0/3 · 2s · ↓ 8 tokens)`, or
// the word alone early on). A tool row (`● Running 1 shell command…`)
// has more than one word and another glyph, so it never matches.
const SPINNER_ROW = /^\s*[·✢*✶✻✽✳⋆]\s+([A-Za-z][\w'-]*)…(?:\s+\((.*)\))?\s*$/;
const DOWN = /↓\s*([\d.,]+[kKmM]?)\s*tokens/;

export function spinnerOf(rows: readonly string[]): { word: string; down: string | null } | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const m = SPINNER_ROW.exec(rows[i]!);
    if (m === null) continue;
    const down = m[2] === undefined ? null : (DOWN.exec(m[2])?.[1] ?? null);
    return { word: m[1]!, down };
  }
  return null;
}

// A working session's transcript gets a dozen line writes a second, and
// every session in the same project folder writes beside it, so the view
// re-reads at most this often, with a trailing read.
export const CHAT_REREAD_MS = 500;

// M9 fix 690: the ask card's heading, the same four strings as the
// sidebar's answer card (AnswerPopover.tsx), which stays its own.
export function askHeading(reason: NeedsInputReason | null | undefined): string {
  if (reason === 'permission') return 'Claude is asking permission';
  if (reason === 'agent-permission') return 'A subagent is asking permission';
  if (reason === 'question') return 'Claude has a question';
  return 'Waiting on you';
}

// The card reads the screen this often while it shows, as the sidebar's
// card does.
export const ASK_REFRESH_MS = 1000;

// The slash commands that open a picker or a dialog of their own in the
// TUI, which the chat view cannot draw: a send of one shows the fallback
// bar over the box.
export const TERMINAL_COMMANDS: readonly string[] = ['/model', '/permissions', '/mcp', '/config', '/agents', '/hooks', '/memory', '/resume', '/theme', '/login', '/status', '/doctor'];

export function opensMenu(text: string): boolean {
  const first = text.trim().split(/\s+/)[0] ?? '';
  return TERMINAL_COMMANDS.includes(first);
}

// Whether the fallback bar goes when the transcript grows: claim 6 of M9
// fix 688's claims (docs/DONE.md) read Claude Code 2.1.300 writing a picker
// command's lines when the picker closes (Escape wrote `/model` and
// `Kept model as ...` together), so a later read that is longer means
// the menu is gone.
export const FALLBACK_ON_GROWTH = true;

// The words under the box, by the session's state.
export function hintText(state: SessionState | undefined): string {
  if (state === 'working') return 'Sent when the turn ends';
  if (state === 'needs-input') return 'The ask takes the keys';
  return '';
}
