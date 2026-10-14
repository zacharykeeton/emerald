import { useEffect, useState } from 'react';
import { MarkdownView } from './MarkdownView.tsx';
import { closeFileTab } from './ui.ts';
import { whatsNewStamp } from './whats-new-model.ts';

// The What's New tab (M9 fix 227): the release notes, docs/WHATS-NEW.md,
// rendered by the same markdown view a README gets, under the file
// header the other document tabs wear. A document, not a file: the text
// comes through the main process (installed, the file sits under
// resources/ beside the daemon), so there is no path to reveal or open
// with Windows and the header carries the name and the close alone. The
// tab opens on its own once per batch (App.tsx) and from the `whats-new`
// action any time after. The older batches open folded (M9 fix 272), a
// heading each under the new one.
export function WhatsNewView({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    window.emerald.whatsNew
      .read()
      .then((r) => {
        if (live) setText(r.text);
      })
      .catch((err: unknown) => {
        console.warn('[emerald] could not read the release notes', err);
        if (live) setText('');
      });
    return () => {
      live = false;
    };
  }, [path]);
  const stamp = text === null ? null : whatsNewStamp(text);
  return (
    <div className="file-view whats-new-view" data-path={path} data-state={text === null ? 'loading' : text === '' ? 'error' : 'text'} data-stamp={stamp ?? undefined}>
      <div className="file-header">
        <span className="file-path whats-new-title" title="What is new in this build of emerald">
          What&apos;s new
        </span>
        <button className="files-button" title="Close (Ctrl+W)" onClick={() => closeFileTab(path)}>
          ×
        </button>
      </div>
      <div className="file-body">
        {text !== null && text !== '' && <MarkdownView path={path} text={text} foldOlder />}
        {text === '' && (
          <div className="file-message">
            <div>The release notes could not be read. The main log under ~/.emerald/logs says where they were looked for.</div>
            <button onClick={() => closeFileTab(path)}>Close tab</button>
          </div>
        )}
      </div>
    </div>
  );
}
