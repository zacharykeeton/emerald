import { useEffect, useRef, useState } from 'react';
import type { SessionKind } from '@emerald/shared';
import { findPane, setPaneHost, setPaneSession, tabHolding } from '@emerald/shared';
import { removeSession, retireReplaced, roomBesideFocused } from './actions.ts';
import { closeOldOffer, panesShowing, replacedFate, splitArgs } from './new-session-model.ts';
import { loadRecent, rememberFolderUsed } from './recent-folders.ts';
import { editTab, getState, useStore } from './store.ts';
import { closeNewSession, getUiState, loadClaudeOpensOn, loadCloseReplaced, rememberCloseReplaced, setChatFace, useUi } from './ui.ts';
import type { NewSessionPreset } from './ui.ts';

// Modal for starting a session with choices: folder, Claude or shell, extra
// Claude args. Since M9 a plain shell starts without it (see actions.ts),
// so this is the Claude path. The new session lands in the pane the dialog
// was opened for, or, from a folder heading's + (M32), in a new pane
// beside the focused one, made on Start so a cancel leaves nothing behind.

export function NewSessionDialog() {
  const { newSessionPaneId, newSessionPreset, newSessionReplace } = useUi();
  if (newSessionPaneId === null) return null;
  return <Dialog key={newSessionPaneId} paneId={newSessionPaneId} preset={newSessionPreset} replace={newSessionReplace} />;
}

function Dialog({ paneId, preset, replace }: { paneId: string; preset: NewSessionPreset | null; replace: boolean }) {
  const { layout, sessions } = useStore('layout', 'sessions');
  const [recent] = useState<string[]>(loadRecent);
  // Prefer the heading's folder when there is one, then the folder of the
  // session already in the target pane, then the last folder used, then
  // home (filled in asynchronously).
  const tab = layout === null ? null : tabHolding(layout, paneId);
  const currentSession = sessions.get((tab === null ? null : findPane(tab, paneId))?.sessionId ?? '');
  // M9 fix 1131: read at the open, so a turn that starts while the dialog is up does not move the tick under the pointer.
  const [old] = useState(() => (replace ? currentSession : undefined));
  const [offer] = useState(() => closeOldOffer(old, layout === null || old === undefined ? 0 : panesShowing(layout, old.id), replace));
  const [oldOnChat] = useState(() => old !== undefined && getUiState().chatPanes.get(paneId) === old.id);
  const [closeOld, setCloseOld] = useState(() => offer.offered && !offer.busy && loadCloseReplaced());
  const [cwd, setCwd] = useState(preset?.folder ?? currentSession?.cwd ?? recent[0] ?? '');
  // M9 fix 1086: the host the session starts on, the preset's (the on
  // row's or a host section's) else the pane's session's; absent is this
  // PC. A host's folder is that machine's, so Browse and this PC's recent
  // list are not offered for it.
  const host = preset?.host ?? currentSession?.host;
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
    // From the empty pane's More... the face follows the `opens on` pick (M9 fix 723), read now;
    // over a Claude on the chat face the new one keeps that face (M9 fix 1131).
    const chat = kind === 'claude' && ((preset?.opensOn === true && loadClaudeOpensOn() === 'chat') || oldOnChat);
    // The pane resizes the PTY as soon as the terminal mounts, so any sane
    // starting size will do.
    window.emerald
      .request('session.spawn', { kind, cwd: folder, cols: 120, rows: 30, ...(extra.length > 0 ? { args: extra } : {}) }, host)
      .then(async ({ session }) => {
        const target = preset?.split === true ? await roomBesideFocused() : paneId;
        await editTab((t) => setPaneHost(setPaneSession(t, target, session.id), target, session.host), target);
        if (chat) setChatFace(target, session.id, true);
        // M9 fix 1131: not awaited, so a kill that fails leaves the dialog
        // closed and the new session in place. A working session's untick is
        // not remembered, so the next idle replace reads the person's own default.
        if (offer.offered && old !== undefined) {
          if (!offer.busy) rememberCloseReplaced(closeOld);
          const live = getState().sessions.get(old.id);
          const fate = replacedFate(closeOld, live);
          if (fate === 'retire') void retireReplaced(old.id, target).catch((err: unknown) => console.warn('[emerald] could not close the replaced session', err));
          // M9 fix 1146: an old session that exited while the dialog was up is forgotten, as the exited notice's Close forgets one; it is on no pane by now, so session.remove alone, not closeSession.
          else if (fate === 'forget') void removeSession(old.id).catch((err: unknown) => console.warn('[emerald] could not forget the replaced session', err));
        }
      })
      .then(() => {
        if (host === undefined) rememberFolderUsed(folder);
        closeNewSession();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      });
  };

  // Enter in a text box starts the session; on a button it stays a click.
  const onFormKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter' && !busy && ev.target instanceof HTMLInputElement && ev.target.type !== 'radio' && ev.target.type !== 'checkbox') {
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
            {host === undefined && (
              <button type="button" onClick={browse}>
                Browse
              </button>
            )}
          </div>
        </label>
        {host !== undefined && (
          <div className="dialog-field dialog-host" data-host={host}>
            <span>On</span>
            <span className="dialog-host-name">{host}</span>
          </div>
        )}
        {host === undefined && recent.length > 0 && (
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
        {offer.offered && old !== undefined && (
          <div className="dialog-field dialog-close-old">
            <label>
              <input type="checkbox" name="closeOld" checked={closeOld} onChange={(e) => setCloseOld(e.target.checked)} /> {`Close "${old.name}"`}
            </label>
            {offer.busy && <span className="dialog-close-old-busy">{`"${old.name}" is working`}</span>}
          </div>
        )}
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
