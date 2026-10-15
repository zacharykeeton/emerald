import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addressShown, addressUrl } from '@emerald/shared';
import type { DesignNote } from '@emerald/shared';
import { browserPage, registerBrowserSlot, useBrowserPage } from './browser-layer.ts';
import { designTargetOf, sendDesign } from './design.ts';
import { addNote, deleteNote, editNote, noteTitle, removeSent } from './design-model.ts';
import { getUiState, setDesignNotes, setDesignPane, setDesignTray, useUi } from './ui.ts';
import { useStore } from './store.ts';

interface Props {
  paneId: string;
  // The record's URL, '' while the address bar has not been filled.
  url: string;
  // Writes a new URL to the pane's record.
  onUrl: (url: string) => void;
}

const BAD_ADDRESS = 'Only http and https pages open here; type an address such as google.com or localhost:3000, or words to search';
// Design Mode's hint bar: the page's keys, and while a comment box in the
// tray holds the keyboard, where they go instead (M9 fix 695). A 337 px pane
// leaves the text about 182 px beside Notes and Cancel (fix 730), so the tray
// hint is short and its full sentence is the span's title.
const PAGE_HINT = 'Hover and press C to copy, S for screenshot, or click to select';
const TRAY_HINT = 'Note · Esc back to the page';
const TRAY_TITLE = 'Typing a note. Click the page to pick again, or press C or S there; Esc or Ctrl+Enter hands the keys back to the page, and Ctrl+Shift+D ends the mode';

// The browser pane's body (M9 fix 659): a toolbar over a <webview>. The
// address bar takes an http or https URL, a host or host:port, or words
// to search (addressUrl, fix 667); a good answer is written to the
// pane's record and loaded. M9 fix 669:
// the page itself lives in the window's browser layer (BrowserLayer.tsx),
// laid over this pane's `.browser-body`, which registers itself as the
// page's slot. A split, a close beside the pane or a move re-parents the
// pane and remounts this component, but the page is not in it, so it
// survives with its history, its scroll and its state; the toolbar reads
// the page's Back and Forward from the layer, and the layer draws the
// failed load's line over the page.
export function BrowserView({ paneId, url, onUrl }: Props) {
  const [address, setAddress] = useState(url);
  const [invalid, setInvalid] = useState(false);
  const { back, forward, url: pageUrl } = useBrowserPage(paneId);
  const inputRef = useRef<HTMLInputElement>(null);
  const slotRef = useCallback((el: HTMLDivElement | null) => registerBrowserSlot(paneId, el), [paneId]);
  // Whether the person is typing in the address bar, so a navigation
  // does not overwrite what they are part way through.
  const editingRef = useRef(false);
  // Whether the press in the bar brought it the focus (M9 fix 691).
  const clickFocusRef = useRef(false);
  // Whether the box has the focus (M9 fix 667): it shows the address
  // whole then and without its scheme otherwise, the record and `address`
  // staying whole either way.
  const [focused, setFocused] = useState(false);
  // Focus selects the whole text, as a browser's bar does; this also keeps a
  // script's focus-then-select in one evaluation typing over the whole
  // address, before React draws the longer value.
  useLayoutEffect(() => {
    if (focused) inputRef.current?.select();
  }, [focused]);

  // A new pane's address bar takes the keyboard.
  useEffect(() => {
    if (url === '') inputRef.current?.focus();
    // Mount only: a later empty record is not a new pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The record moved from elsewhere (a reload, another window): show it
  // unless the person is typing.
  useEffect(() => {
    if (!editingRef.current) setAddress(url);
  }, [url]);

  // The page navigated: show where it went unless the person is typing.
  useEffect(() => {
    if (pageUrl !== '' && !editingRef.current) setAddress(pageUrl);
  }, [pageUrl]);

  const pageOn = url !== '';
  const ready = () => browserPage(paneId);

  // Design Mode (M9 fixes 674 and 675). While the mode is on, a grab runs
  // on the page: the page takes the keyboard at the first grab so C, S
  // and Escape reach main, and a click answers the pick. With the tray
  // closed the pick is sent at once and the mode ends; with it open the
  // pick becomes a note, its comment box takes the keyboard, and the next
  // grab starts at once (`grab` counts them).
  const { designPaneId, designNotes, designTrayPaneId } = useUi();
  const { sessions, layout } = useStore('sessions', 'layout');
  const designOn = designPaneId === paneId;
  const notes = designNotes[paneId] ?? EMPTY_NOTES;
  const trayOpen = designTrayPaneId === paneId;
  const [grab, setGrab] = useState(0);
  const [focusNote, setFocusNote] = useState<string | null>(null);
  // Whether the focus is inside the tray, which turns the hint to the tray's.
  const [trayFocus, setTrayFocus] = useState(false);
  useEffect(() => {
    if (!designOn || !pageOn) return;
    const page = ready();
    if (page === null) {
      setDesignPane(null);
      return;
    }
    let live = true;
    if (grab === 0) page.focus();
    // Main finds the guest by the pane, registered at did-attach and at
    // each dom-ready (M9 fix 693). Telling main again here is a cheap
    // second word: a registration it already holds returns early, and the
    // send reaches main before the start's invoke.
    try {
      window.emerald.browser.guest(paneId, page.getWebContentsId());
    } catch {
      // Not attached yet; main refuses the grab and the mode ends.
    }
    void window.emerald.design.start(paneId).then((r) => {
      if (!live) return;
      if (r.kind === 'cancel') {
        setDesignPane(null);
        return;
      }
      if (getUiState().designTrayPaneId === paneId) {
        const id = crypto.randomUUID();
        setDesignNotes(paneId, (n) => addNote(n, r.pick, r.shot, id));
        setFocusNote(id);
        setGrab((g) => g + 1);
        return;
      }
      sendDesign(paneId, [{ id: '', pick: r.pick, shot: r.shot, comment: '' }], false);
      setDesignPane(null);
    });
    return () => {
      live = false;
      window.emerald.design.cancel(paneId);
    };
    // ready() reads the layer; the effect follows the mode, the page and the grab count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designOn, pageOn, grab, paneId]);
  // A new mode starts its grabs from the page's focus again.
  useEffect(() => {
    if (!designOn) setGrab(0);
  }, [designOn]);
  const sendNotes = () => {
    const shown: DesignNote[] = [...notes];
    if (shown.length === 0) return;
    if (sendDesign(paneId, shown, true)) setDesignNotes(paneId, (n) => removeSent(n, shown.map((x) => x.id)));
  };
  const target = (designOn || trayOpen) && layout !== null ? designTargetOf(paneId) : null;
  const targetName = target === null ? null : (sessions.get(target)?.name ?? target);
  const notesButton = (
    <button className="files-button design-notes" aria-pressed={trayOpen} title="The picked elements waiting to be sent" onClick={() => setDesignTray(trayOpen ? null : paneId)}>
      Notes ({notes.length})
    </button>
  );

  const go = () => {
    const href = addressUrl(address);
    if (href === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setAddress(href);
    editingRef.current = false;
    if (href !== url) onUrl(href);
    const page = ready();
    if (page !== null) void page.loadURL(href).catch(() => {});
  };

  return (
    <div className="browser-view" data-pane-id={paneId}>
      <div className="browser-toolbar">
        <button className="files-button browser-back" aria-label="Back" title="Back" disabled={!back} onClick={() => ready()?.goBack()}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="files-button browser-forward" aria-label="Forward" title="Forward" disabled={!forward} onClick={() => ready()?.goForward()}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="files-button browser-reload"
          aria-label="Reload"
          title="Reload; right-click for a hard reload"
          onClick={() => ready()?.reload()}
          onContextMenu={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            ready()?.reloadIgnoringCache();
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          ref={inputRef}
          className="browser-address"
          aria-label="Address"
          aria-invalid={invalid ? 'true' : undefined}
          title={invalid ? BAD_ADDRESS : 'Address'}
          spellCheck={false}
          value={focused ? address : addressShown(address)}
          onChange={(ev) => {
            editingRef.current = true;
            setAddress(ev.target.value);
          }}
          onFocus={() => setFocused(true)}
          onMouseDown={(ev) => {
            clickFocusRef.current = document.activeElement !== ev.currentTarget;
          }}
          onMouseUp={(ev) => {
            // A click that brings the focus selects the whole address too (M9 fix 691): the press places the caret after the focus's select(), so the release selects again. A second click into a focused bar places the caret, and a drag that made its own selection is left alone.
            if (!clickFocusRef.current) return;
            clickFocusRef.current = false;
            const el = ev.currentTarget;
            if (el.selectionStart === el.selectionEnd) {
              ev.preventDefault();
              el.select();
            }
          }}
          onBlur={() => {
            editingRef.current = false;
            setFocused(false);
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              go();
            } else if (ev.key === 'Escape') {
              ev.preventDefault();
              editingRef.current = false;
              setAddress(ready()?.getURL() || url);
              setInvalid(false);
            }
          }}
        />
        <button
          className="files-button browser-devtools"
          aria-label="Developer tools"
          title="Developer tools"
          onClick={() => {
            const page = ready();
            if (page === null) return;
            if (page.isDevToolsOpened()) page.closeDevTools();
            else page.openDevTools();
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="files-button browser-design"
          aria-label="Design Mode"
          title="Design Mode: pick an element to send to Claude (Ctrl+Shift+D)"
          aria-pressed={designOn}
          disabled={!pageOn}
          onClick={() => setDesignPane(designOn ? null : paneId)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3.5 2.5l9 4.2-3.9 1.3-1.3 3.9z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M8.6 8.6l3.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        {!designOn && (notes.length > 0 || trayOpen) && notesButton}
      </div>
      {designOn && (
        <div className="design-hint" role="status">
          <span className="design-hint-text" title={trayOpen && trayFocus ? TRAY_TITLE : PAGE_HINT}>
            {trayOpen && trayFocus ? TRAY_HINT : PAGE_HINT}
          </span>
          {notesButton}
          <button className="files-button design-cancel" onClick={() => setDesignPane(null)}>
            Cancel
          </button>
        </div>
      )}
      <div className="browser-main">
        {/* The page's slot: the layer lays the page over this box. */}
        <div className="browser-body" ref={slotRef}>
          {!pageOn && <div className="browser-empty muted">Type an address such as google.com or localhost:3000, or words to search</div>}
        </div>
        {trayOpen && (
          <aside
            className="design-tray"
            aria-label="Design notes"
            // React's focus events bubble, so a focus anywhere inside counts,
            // and a move between two boxes in the tray does not flicker.
            onFocus={() => setTrayFocus(true)}
            onBlur={(ev) => {
              if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setTrayFocus(false);
            }}
          >
            <div className="design-tray-notes">
              {notes.length === 0 && (
                <div className="design-tray-empty muted">{designOn ? 'Click an element on the page to add a note' : 'Turn Design Mode on and click an element on the page to add a note'}</div>
              )}
              {notes.map((note, i) => (
                <div className="design-note" key={note.id} data-note-id={note.id}>
                  <div className="design-note-title" title={note.pick.selector}>
                    {noteTitle(i + 1, note)}
                  </div>
                  <textarea
                    aria-label={`Comment on note ${i + 1}`}
                    placeholder="What should change"
                    value={note.comment}
                    autoFocus={note.id === focusNote}
                    onChange={(ev) => setDesignNotes(paneId, (n) => editNote(n, note.id, ev.target.value))}
                    // The grab's keys are heard only in the page (main's
                    // before-input-event on the guest), so the box hands the
                    // keyboard back rather than acting on them itself; the
                    // mode, the grab and the comment stay as they are.
                    onKeyDown={(ev) => {
                      if (ev.key === 'Escape' || (ev.key === 'Enter' && ev.ctrlKey)) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ready()?.focus();
                      }
                    }}
                  />
                  <button className="files-button design-delete" aria-label={`Delete note ${i + 1}`} onClick={() => setDesignNotes(paneId, (n) => deleteNote(n, note.id))}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
            {notes.length > 0 && (
              <button
                className="files-button design-send"
                // With no Claude session in the tab the button copies the notes
                // instead, sendDesign's fallback, and the notes stay (M9 fix 697).
                // With no notes it is not drawn (fix 730).
                title={target === null ? 'No Claude session in this tab; copies the notes' : `Send to ${targetName}`}
                onClick={sendNotes}
              >
                {`${target === null ? 'Copy' : 'Send'} ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
              </button>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

const EMPTY_NOTES: readonly DesignNote[] = [];
