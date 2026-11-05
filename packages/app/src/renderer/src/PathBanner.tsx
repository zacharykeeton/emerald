import { useEffect, useState } from 'react';
import { PATH_COPIED_NOTE, PATH_NOTE_LEAD, pathBannerShows } from './path-banner-model.ts';
import { flashCornerNote, useUi } from './ui.ts';

// Offers the line that puts emmer on a Mac's PATH (M9 fix 1026), asked of
// the main process once at mount; main asks the login shell once per
// launch and answers null on Windows, in a dev tree, when emmer is already
// there, or after a Copy or Not now in any window of this launch. Its own
// class, not .banner, since the scripts wait for .banner to clear.
//
// One strip at a time (M9 fix 1072): it waits while the hooks strip is up
// or still checking, so a Mac's first launch shows hooks, then PATH.
export function PathBanner() {
  const [command, setCommand] = useState<string | null>(null);
  const hooksBanner = useUi().hooksBanner;

  useEffect(() => {
    let live = true;
    window.emerald.pathLink().then(
      (c) => {
        if (live) setCommand(c);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  if (command === null || !pathBannerShows(command, hooksBanner)) return null;
  const close = () => {
    window.emerald.dismissPathLink();
    setCommand(null);
  };
  return (
    <div className="path-banner">
      <span className="path-banner-text">
        {`${PATH_NOTE_LEAD} `}
        <code className="path-banner-command">{command}</code>
      </span>
      <button
        className="path-copy"
        onClick={() => {
          void window.emerald.clipboard.write(command).then(() => flashCornerNote(PATH_COPIED_NOTE));
          close();
        }}
      >
        Copy
      </button>
      <button className="secondary path-dismiss" onClick={close}>
        Not now
      </button>
    </div>
  );
}
