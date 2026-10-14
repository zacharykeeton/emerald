import { useEffect, useRef, useState } from 'react';
import { BROWSER_PARTITION, browserUrl } from '@emerald/shared';

interface Props {
  paneId: string;
  // The record's URL, '' while the address bar has not been filled.
  url: string;
  // Writes a new URL to the pane's record.
  onUrl: (url: string) => void;
  // The page's title, for the pane's title row.
  onTitle: (title: string) => void;
}

// The renderer's tsconfig has no electron types, so the element is
// typed by the methods used here alone.
interface WebviewLike extends HTMLElement {
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  reload(): void;
  reloadIgnoringCache(): void;
  getURL(): string;
  getTitle(): string;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
}

type NavigateEvent = Event & { url: string; isMainFrame?: boolean };
type TitleEvent = Event & { title: string };
type FailEvent = Event & { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean };

const BAD_ADDRESS = 'Type a URL (http:// or https://) or host:port, such as localhost:3000';

// The browser pane's body (M9 fix 659): a toolbar over a <webview>. The
// address bar takes an http or https URL or host:port (browserUrl); a
// good answer is written to the pane's record and loaded. The webview
// is made once, imperatively, when the record first has a URL, so a
// record that changes under the page (the page's own navigation written
// back) never reloads it, as a React-managed src would. The main process
// holds the element to its partition and strips node and a preload from
// it (browser-guard.ts); a page's new window goes to the system browser.
// A hidden layout tab keeps its page, mounted under `hidden` as a
// terminal keeps its shell; a re-parent in the tree remounts the
// component and the page loads again from the record.
export function BrowserView({ paneId, url, onUrl, onTitle }: Props) {
  const [address, setAddress] = useState(url);
  const [invalid, setInvalid] = useState(false);
  const [back, setBack] = useState(false);
  const [forward, setForward] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<WebviewLike | null>(null);
  // Methods throw before dom-ready.
  const readyRef = useRef(false);
  // The latest record and writer, read by the page's listeners.
  const urlRef = useRef(url);
  urlRef.current = url;
  const onUrlRef = useRef(onUrl);
  onUrlRef.current = onUrl;
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  // Whether the person is typing in the address bar, so a navigation
  // does not overwrite what they are part way through.
  const editingRef = useRef(false);

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

  const pageOn = url !== '';
  useEffect(() => {
    if (!pageOn || pageRef.current !== null || hostRef.current === null) return;
    const page = document.createElement('webview') as WebviewLike;
    page.className = 'browser-page';
    page.setAttribute('partition', BROWSER_PARTITION);
    // Without it Chromium drops a window.open or a target=_blank before
    // the main process's handler sees it; that handler denies every
    // window and sends the URL to the system browser.
    page.setAttribute('allowpopups', '');
    page.setAttribute('src', urlRef.current);
    const nav = () => {
      if (!readyRef.current) return;
      setBack(page.canGoBack());
      setForward(page.canGoForward());
    };
    const navigated = (ev: Event) => {
      const e = ev as NavigateEvent;
      if (e.isMainFrame === false) return;
      setError(null);
      if (!editingRef.current) setAddress(e.url);
      nav();
      if (e.url !== urlRef.current && browserUrl(e.url) === e.url) onUrlRef.current(e.url);
    };
    const listeners: Array<[string, (ev: Event) => void]> = [
      [
        'dom-ready',
        () => {
          readyRef.current = true;
          nav();
        },
      ],
      ['did-navigate', navigated],
      ['did-navigate-in-page', navigated],
      // The history's own entry is not always committed by did-navigate,
      // so Back and Forward are read again once the load settles.
      ['did-stop-loading', nav],
      ['page-title-updated', (ev) => onTitleRef.current((ev as TitleEvent).title)],
      [
        'did-fail-load',
        (ev) => {
          const e = ev as FailEvent;
          // -3 is an aborted load: a new navigation started over it.
          if (!e.isMainFrame || e.errorCode === -3) return;
          setError(`Could not load ${e.validatedURL}: ${e.errorDescription}`);
        },
      ],
    ];
    for (const [name, fn] of listeners) page.addEventListener(name, fn);
    hostRef.current.appendChild(page);
    pageRef.current = page;
    return undefined;
  }, [pageOn]);

  // The element goes with the component.
  useEffect(
    () => () => {
      pageRef.current?.remove();
      pageRef.current = null;
      readyRef.current = false;
    },
    [],
  );

  const ready = (): WebviewLike | null => (readyRef.current ? pageRef.current : null);

  const go = () => {
    const href = browserUrl(address);
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
          value={address}
          onChange={(ev) => {
            editingRef.current = true;
            setAddress(ev.target.value);
          }}
          onBlur={() => {
            editingRef.current = false;
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
      </div>
      <div className="browser-body">
        {/* The webview is appended here by hand; React keeps no children
            in this box, so it never reorders around the page. */}
        <div className="browser-host" ref={hostRef} />
        {!pageOn && <div className="browser-empty muted">Type a URL or host:port above, such as localhost:3000</div>}
        {error !== null && <div className="browser-error">{error}</div>}
      </div>
    </div>
  );
}
