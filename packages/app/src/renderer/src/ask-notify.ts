import type { NotifyAction } from '../../preload/api.ts';
import { typeInto } from './actions.ts';
import { toastAnswer } from './ask-notify-model.ts';
import { getState } from './store.ts';
import { acknowledgeAttention } from './ui.ts';

// The answer from a permission ask's toast (M9 fix 1199). Main hands a
// button's press to the window as `emerald:notify-action`; it is
// re-dispatched as a window event of the same name and answered from
// there, so the one path a script can dispatch is the path a real toast
// takes from the preload on. The press is typed into the session as the
// card's own button would type it, only while toastAnswer says the same
// ask is still on screen; anything else is logged and handed back to main,
// which raises the window as a body click does.
//
// The quiet line the chat draws after it is the latest answer per
// session, in renderer memory only (gone on reload, a new prompt puts it
// away); the answered calls are kept apart, capped, so a replaced line
// still drops its call's second press.

export interface AskNotifyLine {
  toolUseId: string;
  allowed: boolean;
  command: string;
  at: number;
}

const ANSWERED_KEPT = 200;
const lines = new Map<string, AskNotifyLine>();
const answered = new Set<string>();
const listeners = new Set<() => void>();

export function subscribeAskNotify(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function askNotifyLine(sessionId: string): AskNotifyLine | null {
  return lines.get(sessionId) ?? null;
}

function store(sessionId: string, line: AskNotifyLine): void {
  lines.set(sessionId, line);
  answered.add(line.toolUseId);
  if (answered.size > ANSWERED_KEPT) {
    const oldest = answered.values().next().value;
    if (oldest !== undefined) answered.delete(oldest);
  }
  for (const fn of listeners) fn();
}

async function answer(action: NotifyAction): Promise<void> {
  const { sessionId, toolUseId, index } = action;
  const rows = await window.emerald
    .request('pty.screen', { sessionId })
    .then((r) => r.rows)
    .catch(() => null);
  const session = getState().sessions.get(sessionId);
  const out = toastAnswer({ session, toolUseId, index, rows, answered: answered.has(toolUseId) });
  if ('dropped' in out) {
    console.log('[emerald] toast answer dropped: ' + out.dropped);
    window.emerald.notify.dropped(sessionId);
    return;
  }
  typeInto(sessionId, out.keys);
  acknowledgeAttention(sessionId);
  console.log('[emerald] toast answer sent: ' + (out.allowed ? 'allow once' : 'deny'));
  store(sessionId, { toolUseId, allowed: out.allowed, command: session?.askedFor?.input ?? '', at: Date.now() });
}

export function installAskNotify(): () => void {
  const unsub = window.emerald.notify.onAction((action) => {
    window.dispatchEvent(new CustomEvent('emerald:notify-action', { detail: action }));
  });
  const onEvent = (ev: Event) => {
    const detail = (ev as CustomEvent<NotifyAction>).detail;
    if (typeof detail?.sessionId !== 'string' || typeof detail.toolUseId !== 'string' || typeof detail.index !== 'number') return;
    void answer(detail).catch((err: unknown) => console.warn('[emerald] toast answer failed', err));
  };
  window.addEventListener('emerald:notify-action', onEvent);
  return () => {
    unsub();
    window.removeEventListener('emerald:notify-action', onEvent);
  };
}
