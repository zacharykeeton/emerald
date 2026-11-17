import { useSyncExternalStore } from 'react';
import { dismissToast, getToast, subscribeToast } from './toast-store.ts';

// The window-wide toast (M9 fix 1181): one line at the bottom centre, gone
// after TOAST_MS or on a click.
export function Toast() {
  const toast = useSyncExternalStore(subscribeToast, getToast);
  if (toast === null) return null;
  return (
    <div className="app-toast" role="status" data-toast-id={toast.id} onClick={dismissToast}>
      {toast.text}
    </div>
  );
}
