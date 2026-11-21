import { failedText, TOAST_MS, type FailedVerb } from './toast-model.ts';

// The one toast the window shows (M9 fix 1181), its own small store as
// rates-store.ts is, so a toast re-renders nothing but itself. Node-safe:
// no DOM, a module let and a listener set.

export interface ToastState {
  id: number;
  text: string;
}

let toast: ToastState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function publish(): void {
  for (const l of listeners) l();
}

export function subscribeToast(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getToast(): ToastState | null {
  return toast;
}

export function showToast(text: string): void {
  if (timer !== null) clearTimeout(timer);
  toast = { id: nextId++, text };
  timer = setTimeout(dismissToast, TOAST_MS);
  publish();
}

export function dismissToast(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (toast === null) return;
  toast = null;
  publish();
}

// M9 fix 1198: the catch of a single Resume or rename, in place of a
// component's warn: the same console line (logged names it when the site's
// own word differed), then the toast.
export function failedToast(verb: FailedVerb, logged: string = verb): (err: unknown) => void {
  return (err) => {
    console.warn(`[emerald] ${logged} failed`, err);
    showToast(failedText(verb, err));
  };
}
