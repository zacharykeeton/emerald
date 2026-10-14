import { useEffect, useRef } from 'react';
import { useEditState } from './file-edits.ts';
import { folderName } from './files-model.ts';
import { reloadFromDisk, saveFile } from './monaco.ts';
import { clearCloseAsk, useUi } from './ui.ts';

// M9 fix 248: the ask before a close drops unsaved edits, the app's own
// small dialog over a dimmed window (window.confirm would block the
// renderer). Save writes the file and then goes on with the close;
// Discard puts the disk text back and goes on; Keep open, Escape and a
// click outside leave the tab where it is. A refused save keeps the
// dialog up with the reason under the buttons, and a save that found the
// file changed on disk (M9 fix 525) closes the dialog and keeps the tab
// open with its changed-on-disk line up.
export function UnsavedDialog() {
  const { closeAsk } = useUi();
  const path = closeAsk?.path ?? '';
  const { error } = useEditState(path);
  const saveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (closeAsk !== null) saveRef.current?.focus();
  }, [closeAsk]);
  if (closeAsk === null) return null;
  const { proceed } = closeAsk;
  const save = () =>
    void saveFile(path)
      .then((outcome) => {
        clearCloseAsk();
        if (outcome === 'saved') proceed();
      })
      .catch(() => {
        // The reason is on the edit state; the dialog shows it.
      });
  const discard = () => {
    reloadFromDisk(path);
    clearCloseAsk();
    proceed();
  };
  return (
    <div className="dialog-backdrop" onMouseDown={clearCloseAsk}>
      <div
        className="dialog unsaved-dialog"
        role="dialog"
        data-path={path}
        onMouseDown={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            clearCloseAsk();
          }
        }}
      >
        <div className="dialog-title">Save changes to {folderName(path)}?</div>
        <div className="unsaved-dialog-path" title={path}>
          {path}
        </div>
        <div className="unsaved-dialog-hint">Discard puts the file back as it is on disk; Keep open leaves the tab and its edits.</div>
        {error !== null && <div className="unsaved-dialog-error">Could not save: {error}</div>}
        <div className="dialog-actions">
          <button ref={saveRef} data-choice="save" onClick={save}>
            Save
          </button>
          <button data-choice="discard" onClick={discard}>
            Discard
          </button>
          <button data-choice="keep" onClick={clearCloseAsk}>
            Keep open
          </button>
        </div>
      </div>
    </div>
  );
}
