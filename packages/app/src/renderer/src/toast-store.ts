import { TOAST_MS } from './toast-model.ts';

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
