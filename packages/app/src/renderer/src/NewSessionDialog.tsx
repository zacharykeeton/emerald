import { useEffect, useRef, useState } from 'react';
import type { SessionKind } from '@emerald/shared';
import { findPane, setPaneSession, tabHolding } from '@emerald/shared';
import { roomBesideFocused } from './actions.ts';
import { splitArgs } from './new-session-model.ts';
import { loadRecent, rememberFolderUsed } from './recent-folders.ts';
import { editTab, useStore } from './store.ts';
import { closeNewSession, useUi } from './ui.ts';
import type { NewSessionPreset } from './ui.ts';

// Modal for starting a session with choices: folder, Claude or shell, extra
// Claude args. Since M9 a plain shell starts without it (see actions.ts),
// so this is the Claude path. The new session lands in the pane the dialog
// was opened for, or, from a folder heading's + (M32), in a new pane
// beside the focused one, made on Start so a cancel leaves nothing behind.

export function NewSessionDialog() {
  const { newSessionPaneId, newSessionPreset } = useUi();
  if (newSessionPaneId === null) return null;
  return <Dialog key={newSessionPaneId} paneId={newSessionPaneId} preset={newSessionPreset} />;
}

function Dialog({ paneId, preset }: { paneId: string; preset: NewSessionPreset | null }) {
  const { layout, sessions } = useStore('layout', 'sessions');
  const [recent] = useState<string[]>(loadRecent);
  // Prefer the heading's folder when there is one, then the folder of the
  // session already in the target pane, then the last folder used, then
  // home (filled in asynchronously).
  const tab = layout === null ? null : tabHolding(layout, paneId);
  const currentSession = sessions.get((tab === null ? null : findPane(tab, paneId))?.sessionId ?? '');
  const [cwd, setCwd] = useState(preset?.folder ?? currentSession?.cwd ?? recent[0] ?? '');
  const [kind, setKind] = useState<SessionKind>('claude');
  const [args, setArgs] = useState('');
  // M56: what the session starts on, handed to claude as its last
  // argument, so the first turn begins without a pane being focused.
  const [firstPrompt, setFirstPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cwdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cwdRef.current?.focus();
    cwdRef.current?.select();
  }, []);

  useEffect(() => {
    if (cwd !== '') return;
    void window.emerald.info().then((info) => setCwd((c) => (c === '' ? info.homeDir : c)));
    // Runs once on purpose: only the initial empty value gets the home
    // directory, clearing the box later must not refill it under the user's
    // fingers.
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        closeNewSession();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  const browse = () => {
    void window.emerald
      .pickFolder(cwd.trim() === '' ? null : cwd.trim())
      .then((picked) => {
        if (picked !== null) setCwd(picked);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const start = () => {
    const folder = cwd.trim();
    if (folder === '') {
      setError('Pick a folder first.');
      return;
    }
    setBusy(true);
    setError(null);
    const extra = kind === 'claude' ? [...splitArgs(args), ...(firstPrompt.trim() === '' ? [] : [firstPrompt.trim()])] : [];
    // The pane resizes the PTY as soon as the terminal mounts, so any sane
    // starting size will do.
    window.emerald
      .request('session.spawn', { kind, cwd: folder, cols: 120, rows: 30, ...(extra.length > 0 ? { args: extra } : {}) })
      .then(async ({ session }) => {
        const target = preset?.split === true ? await roomBesideFocused() : paneId;
        return editTab((t) => setPaneSession(t, target, session.id), target);
      })
      .then(() => {
        rememberFolderUsed(folder);
        closeNewSession();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      });
  };

  // Enter in a text box starts the session; on a button it stays a click.
  const onFormKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter' && !busy && ev.target instanceof HTMLInputElement && ev.target.type !== 'radio') {
      ev.preventDefault();
      start();
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={closeNewSession}>
      <div className="dialog new-session" onMouseDown={(ev) => ev.stopPropagation()} onKeyDown={onFormKeyDown}>
        <div className="dialog-title">New session</div>
        <label className="dialog-field">
          <span>Folder</span>
          <div className="dialog-inline">
            <input ref={cwdRef} name="cwd" value={cwd} onChange={(e) => setCwd(e.target.value)} spellCheck={false} />
            <button type="button" onClick={browse}>
              Browse
            </button>
          </div>
        </label>
        {recent.length > 0 && (
          <div className="dialog-recent">
            {recent.map((f) => (
              <button type="button" key={f} className="dialog-recent-item" title={f} onClick={() => setCwd(f)}>
                {f}
              </button>
            ))}
          </div>
        )}
        <div className="dialog-field">
          <span>Kind</span>
          <div className="dialog-inline">
            <label>
              <input type="radio" name="kind" value="claude" checked={kind === 'claude'} onChange={() => setKind('claude')} /> Claude
            </label>
            <label>
              <input type="radio" name="kind" value="shell" checked={kind === 'shell'} onChange={() => setKind('shell')} /> Shell
            </label>
          </div>
        </div>
        {kind === 'claude' && (
          <label className="dialog-field">
            <span>Extra Claude args</span>
            <input name="args" value={args} onChange={(e) => setArgs(e.target.value)} placeholder='--model opus --add-dir "C:\other"' spellCheck={false} />
          </label>
        )}
        {kind === 'claude' && (
          <label className="dialog-field">
            <span>First prompt</span>
            <input name="firstPrompt" value={firstPrompt} onChange={(e) => setFirstPrompt(e.target.value)} placeholder="What to start on, or leave empty" spellCheck={false} />
          </label>
        )}
        {error !== null && <div className="error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={closeNewSession}>
            Cancel
          </button>
          <button type="button" onClick={start} disabled={busy}>
            {busy ? 'Starting' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}
