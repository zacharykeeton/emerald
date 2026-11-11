// Pure helpers behind the new-session dialog, covered by node:test.

import type { Layout, SessionInfo } from '@emerald/shared';
import { listPanes } from '@emerald/shared';

// Turns the extra-args box into argv. Whitespace separates, double quotes
// group so a path with spaces survives, and a backslash before a quote
// keeps it literal. Anything fancier belongs in a real shell.
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  let hasToken = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\' && text[i + 1] === '"') {
      current += '"';
      hasToken = true;
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
      hasToken = true;
    } else if (!inQuotes && /\s/.test(ch)) {
      if (hasToken) out.push(current);
      current = '';
      hasToken = false;
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (hasToken) out.push(current);
  return out;
}

export const RECENT_FOLDERS_MAX = 8;

// Most recent first, no duplicates, capped. Comparison ignores case and the
// slash style because Windows does, so C:/x and c:\x are the same entry.
export function rememberFolder(recent: readonly string[], folder: string, max = RECENT_FOLDERS_MAX): string[] {
  const key = normalizeFolder(folder);
  const rest = recent.filter((f) => normalizeFolder(f) !== key);
  return [folder, ...rest].slice(0, max);
}

export function normalizeFolder(folder: string): string {
  return folder.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

// M9 fix 1131: whether the dialog opened from a pane's menu offers to close
// the session its Start replaces. A live Claude alone: a shell is kept as it
// always was, an exited one has nothing to close, and one also shown in
// another pane is kept for that pane. busy is a working or asking Claude,
// whose box starts unticked whatever was remembered.
export function closeOldOffer(old: Pick<SessionInfo, 'kind' | 'state'> | undefined, panesShowing: number, replace: boolean): { offered: boolean; busy: boolean } {
  const offered = replace && old !== undefined && old.kind !== 'shell' && old.state !== 'exited' && panesShowing <= 1;
  return { offered, busy: offered && (old.state === 'working' || old.state === 'needs-input') };
}

// How many panes of every layout tab show the session.
export function panesShowing(layout: Layout, sessionId: string): number {
  let n = 0;
  for (const tab of layout.tabs) for (const pane of listPanes(tab)) if (pane.sessionId === sessionId) n++;
  return n;
}

// M9 fix 1146: what Start does with the session it replaced, the box and the
// session read at Start: kept when the box is off or the session is gone,
// closed as a pane's Close closes a live one, forgotten as the exited
// notice's Close forgets an exited one.
export function replacedFate(closeOld: boolean, live: Pick<SessionInfo, 'state'> | undefined): 'keep' | 'retire' | 'forget' {
  if (!closeOld || live === undefined) return 'keep';
  return live.state === 'exited' ? 'forget' : 'retire';
}
