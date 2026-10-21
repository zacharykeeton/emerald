import { useEffect, useRef } from 'react';
import { folderName } from './files-model.ts';
import { useClashAsk } from './files-drop.ts';

// M9 fix 953: a drop from Explorer that meets names already in the folder
// asks once for the whole drop, as Explorer asks, in UnsavedDialog's
// parts.
export function MoveClashDialog() {
  const ask = useClashAsk();
  const skipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ask !== null) skipRef.current?.focus();
  }, [ask]);
  if (ask === null) return null;
  const { clashes, answer } = ask;
  const folder = folderName(ask.dir);
  const one = clashes.length === 1;
  const title = one ? `Replace ${folderName(clashes[0]!.to)} in ${folder}?` : `${clashes.length} names are already in ${folder}`;
  return (
    <div className="dialog-backdrop" onMouseDown={() => answer('cancel')}>
      <div
        className="dialog move-clash-dialog"
        role="dialog"
        data-count={clashes.length}
        onMouseDown={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            answer('cancel');
          }
        }}
      >
        <div className="dialog-title">{title}</div>
        <div className="move-clash-list">
          {clashes.map((c) => {
            const name = folderName(c.to);
            return (
              <div key={c.from} className="move-clash-row" data-name={name} title={c.to}>
                {name}
                {c.held !== null && <span className="move-clash-held">: kept, {c.held}</span>}
              </div>
            );
          })}
        </div>
        <div className="move-clash-hint">Replace sends what is there to the recycle bin first, and a folder is replaced whole, not merged; Skip leaves it and the rest still go.</div>
        <div className="dialog-actions">
          <button data-choice="replace" onClick={() => answer('replace')}>
            {one ? 'Replace' : 'Replace all'}
          </button>
          <button ref={skipRef} data-choice="skip" onClick={() => answer('skip')}>
            {one ? 'Skip' : 'Skip all'}
          </button>
          <button data-choice="cancel" onClick={() => answer('cancel')}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
