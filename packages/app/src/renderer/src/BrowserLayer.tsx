import { useEffect, useLayoutEffect, useRef } from 'react';
import { allPanes, browserPartition, findPane, focusPane, guestNavigationAllowed, isLocalPageUrl, paneUrl, setPaneView } from '@emerald/shared';
import type { BrowserPaneView } from '@emerald/shared';
import { adoptFrames, allBrowserSlots, browserSlot, dropPageState, framePageState, frameRect, LIVE_RELOAD_MS, navigationRefusal, paneOfWebContents, patchPageState, rememberLocalRoot, setFrameElement, setPaneFrames, subscribeSlots, useFramePage, withPageUrl } from './browser-layer.ts';
import type { WebviewLike } from './browser-layer.ts';
import { localPageFolders, normalizePath } from './files-model.ts';
import { wireDrivenPage } from './browser-drive-store.ts';
import { editTab, useStore } from './store.ts';
import { useUi } from './ui.ts';

type NavigateEvent = Event & { url: string; isMainFrame?: boolean };
type TitleEvent = Event & { title: string };
type FailEvent = Event & { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean };
type ConsoleEvent = Event & { level: number | string; message: string };

const LOCAL_RESOURCE = 'Not allowed to load local resource: ';
const refusedLink = (url: string) => `This page tried to open ${url}; a browser pane opens only http and https pages`;
// M9 fix 896: a link into the disk from a page not of the same folder.
const refusedLocal = (url: string) => `This page tried to open ${url}; a web page cannot open a page from the disk`;

const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);

// The window-level browser layer (M9 fix 669): every browser pane's page,
// across every layout tab, laid over the slot its pane keeps
// (BrowserView's `.browser-body`). Rendered once as the last child of
// `.panes-view`, so a file tab hides it with the rest and it can never
// paint over a file tab. A frame is never a `.pane` and carries no
// `data-pane-id`, since the drag hit tests and every verify script read
// those as panes.
export function BrowserLayer() {
  const { layout } = useStore('layout');
  const { zoomedPaneId, tabs, pickerPaneId, sessionDrag } = useUi();
  const hostRef = useRef<HTMLDivElement>(null);
  const framesRef = useRef<Map<string, string>>(new Map());
  const urlsRef = useRef<Map<string, string>>(new Map());
  const orderRef = useRef<string[]>([]);
  const counterRef = useRef(0);
  const pickerRef = useRef(pickerPaneId);
  pickerRef.current = pickerPaneId;

  const panes =
    layout === null
      ? []
      : allPanes(layout).flatMap((p) => (p.view?.kind === 'browser' && p.view.url !== '' ? [{ id: p.id, url: p.view.url, profile: p.view.profile, root: p.view.root }] : []));
  // M9 fix 896: each page from the disk's folder, for Back onto it once
  // its record has linked out to the web and dropped the root.
  if (layout !== null) for (const p of allPanes(layout)) if (p.view?.kind === 'browser') rememberLocalRoot(p.view);
  // Computed in render and kept in refs: adoptFrames on its own result
  // with the same panes changes nothing, so a second render is a no-op.
  const frames = adoptFrames(framesRef.current, panes, urlsRef.current, () => `f${++counterRef.current}`);
  framesRef.current = frames;
  urlsRef.current = new Map(panes.map((p) => [p.id, p.url]));
  // The frames in the order they were first made, never the tree's: React
  // then only appends or removes a frame and never re-inserts one, and a
  // <webview> taken out of the document and put back is a new guest
  // (its disconnectedCallback detaches the guest), so a re-sort on a
  // split would load every page again.
  const live = new Set(frames.values());
  orderRef.current = orderRef.current.filter((f) => live.has(f));
  for (const f of frames.values()) if (!orderRef.current.includes(f)) orderRef.current.push(f);
  const paneOf = new Map([...frames].map(([paneId, frameId]) => [frameId, paneId]));
  const urlOf = new Map(panes.map((p) => [p.id, p.url]));
  const profileOf = new Map(panes.map((p) => [p.id, p.profile]));
  const rootOf = new Map(panes.map((p) => [p.id, p.root]));
  const frameKey = [...frames].map(([p, f]) => `${p}=${f}`).join(',');

  useLayoutEffect(() => {
    setPaneFrames(framesRef.current);
  }, [frameKey]);

  // Each frame over its slot, inset off the pane's ring, or hidden while
  // the slot is not on show (another layout tab, the zoom's hidden half)
  // or the picker sits over the pane. Read synchronously, never on an
  // animation frame, which an off-screen or covered window may not run.
  const place = () => {
    const host = hostRef.current;
    if (host === null) return;
    const hostBox = host.getBoundingClientRect();
    for (const el of Array.from(host.children) as HTMLElement[]) {
      const paneId = el.dataset['browserPane'];
      const slot = paneId === undefined ? null : browserSlot(paneId);
      const show = slot !== null && slot.isConnected && slot.checkVisibility() && pickerRef.current !== paneId;
      if (el.hidden !== !show) el.hidden = !show;
      if (!show) continue;
      const r = frameRect(slot.getBoundingClientRect(), hostBox);
      el.style.left = `${r.left}px`;
      el.style.top = `${r.top}px`;
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
    }
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  useLayoutEffect(() => {
    placeRef.current();
  }, [layout, zoomedPaneId, tabs.active, pickerPaneId, frameKey]);

  useEffect(() => {
    const host = hostRef.current?.parentElement ?? null;
    const ro = new ResizeObserver(() => placeRef.current());
    const watch = () => {
      ro.disconnect();
      if (host !== null) ro.observe(host);
      for (const slot of allBrowserSlots()) ro.observe(slot);
      placeRef.current();
    };
    watch();
    const unsub = subscribeSlots(watch);
    return () => {
      unsub();
      ro.disconnect();
    };
  }, []);

  // M9 fix 670: a click into a page focuses its pane, as a press on any
  // other pane does, so a chord pressed next acts on that pane. The
  // page's press never reaches the window; main hears it on the guest.
  useEffect(
    () =>
      window.emerald.keys.onGuestInput(({ webContentsId, kind }) => {
        if (kind !== 'mouse') return;
        const paneId = paneOfWebContents(webContentsId);
        if (paneId === null) return;
        void editTab((t) => (t.focusedPaneId === paneId ? t : focusPane(t, paneId)), paneId).catch(warn('focus'));
      }),
    [],
  );

  return (
    <div className="browser-layer" ref={hostRef}>
      {orderRef.current.map((frameId) => {
        const paneId = paneOf.get(frameId)!;
        const dropZone = sessionDrag?.target?.paneId !== paneId ? null : sessionDrag.file ? 'file' : sessionDrag.target.zone;
        return <Frame key={frameId} frameId={frameId} paneId={paneId} url={urlOf.get(paneId) ?? ''} root={rootOf.get(paneId)} profile={profileOf.get(paneId)} dropZone={dropZone} />;
      })}
    </div>
  );
}

interface FrameProps {
  frameId: string;
  paneId: string;
  // The pane's record URL.
  url: string;
  // M9 fix 898: the folder a page from the disk is served from, for its
  // live reload.
  root: string | undefined;
  // M9 fix 673: the page's own cookies and storage, read once at the
  // element's making, since a partition is fixed at the first attach.
  profile: string | undefined;
  dropZone: string | null;
}

// One page. The webview is made once, imperatively, on mount, so a
// record that changes under the page (its own navigation written back)
// never reloads it, as a React-managed src would. The main process holds
// the element to its partition and strips node and a preload from it
// (browser-guard.ts); a page's new window goes to the system browser.
function Frame({ frameId, paneId, url, root, profile, dropZone }: FrameProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<WebviewLike | null>(null);
  const profileRef = useRef(profile);
  // The latest pane and record, read by the page's listeners: a moved
  // pane's frame writes to the pane it belongs to now.
  const paneRef = useRef(paneId);
  paneRef.current = paneId;
  const urlRef = useRef(url);
  urlRef.current = url;
  const rootRef = useRef(root);
  rootRef.current = root;
  const { error } = useFramePage(frameId);

  useEffect(() => {
    const hostEl = hostRef.current;
    if (hostEl === null) return undefined;
    const page = document.createElement('webview') as WebviewLike;
    page.className = 'browser-page';
    page.setAttribute('partition', browserPartition(profileRef.current));
    // Without it Chromium drops a window.open or a target=_blank before
    // the main process's handler sees it; that handler denies every
    // window and sends the URL to the system browser.
    page.setAttribute('allowpopups', '');
    page.setAttribute('src', urlRef.current);
    // Methods throw before dom-ready.
    const nav = () => {
      if (!framePageState(frameId).ready) return;
      patchPageState(frameId, { back: page.canGoBack(), forward: page.canGoForward() });
    };
    // M9 fix 933: the pages from the disk this frame has shown, for navigationRefusal.
    const shownLocal = new Set<string>();
    const navigated = (ev: Event) => {
      const e = ev as NavigateEvent;
      if (e.isMainFrame === false) return;
      if (isLocalPageUrl(e.url)) shownLocal.add(e.url);
      patchPageState(frameId, { error: null, url: e.url });
      nav();
      // M9 fix 896: a link inside a page from the disk moves the record
      // too, the root kept by withPageUrl.
      if (e.url !== urlRef.current && paneUrl(e.url) === e.url) {
        const target = paneRef.current;
        void editTab((t) => setPaneView(t, target, withPageUrl(findPane(t, target)?.view, e.url)), target).catch(warn('browser url'));
      }
    };
    const listeners: Array<[string, (ev: Event) => void]> = [
      [
        'dom-ready',
        () => {
          patchPageState(frameId, { ready: true });
          nav();
        },
      ],
      // M9 fix 668: Chromium refuses a file: link from an http page inside
      // the page's own renderer, before main's guard or a failed load sees
      // it, and says so only on the console. The prefix is unambiguous; the
      // one-word and refused checks keep a page's own console.error from
      // writing free text on the line. The level is not read: its type
      // changed between Electron versions.
      [
        'console-message',
        (ev) => {
          const e = ev as ConsoleEvent;
          if (!e.message.startsWith(LOCAL_RESOURCE)) return;
          const refused = e.message.slice(LOCAL_RESOURCE.length).trim();
          if (/^\S+$/.test(refused) && !guestNavigationAllowed(refused)) patchPageState(frameId, { error: refusedLink(refused) });
        },
      ],
      // What reaches main's guard first (it logs the same refusal).
      [
        'will-navigate',
        (ev) => {
          const url = (ev as NavigateEvent).url;
          // getURL throws before the first dom-ready; '' is then a web origin.
          let from = '';
          try {
            from = page.getURL();
          } catch {
            from = '';
          }
          const refusal = navigationRefusal(url, from, shownLocal);
          if (refusal !== null) patchPageState(frameId, { error: refusal === 'local' ? refusedLocal(url) : refusedLink(url) });
        },
      ],
      ['did-navigate', navigated],
      ['did-navigate-in-page', navigated],
      // The history's own entry is not always committed by did-navigate,
      // so Back and Forward are read again once the load settles.
      ['did-stop-loading', nav],
      ['page-title-updated', (ev) => patchPageState(frameId, { title: (ev as TitleEvent).title })],
      [
        'did-fail-load',
        (ev) => {
          const e = ev as FailEvent;
          // -3 is an aborted load: a new navigation started over it.
          if (!e.isMainFrame || e.errorCode === -3) return;
          patchPageState(frameId, { error: `Could not load ${e.validatedURL}: ${e.errorDescription}` });
        },
      ],
    ];
    for (const [name, fn] of listeners) page.addEventListener(name, fn);
    hostEl.appendChild(page);
    setFrameElement(frameId, page);
    pageRef.current = page;
    // emmer browser (M9 fix 672): the guest told to main on each attach,
    // and the focus guard while a command runs.
    const unwire = wireDrivenPage(page, () => paneRef.current);
    // The element goes with the frame, which goes only when its pane
    // closes or stops being a page.
    return () => {
      unwire();
      pageRef.current = null;
      page.remove();
      dropPageState(frameId);
    };
  }, [frameId]);

  // A move hands the frame to a new pane id (fix 669's adoptFrames); the
  // driver hears the new id for the same guest. Before the first attach
  // the id is not there yet, and did-attach or dom-ready registers it then.
  useEffect(() => {
    const page = pageRef.current;
    if (page === null) return;
    try {
      window.emerald.browser.guest(paneId, page.getWebContentsId());
    } catch {
      // Not attached yet.
    }
  }, [paneId]);

  // M9 fix 898: a page from the disk reloads when the Files rail's
  // watcher pushes one of its folders (FilesRail adds them to the watch
  // set). The renderer's call on its own webview, since only it knows
  // which pane shows which page; a page on a hidden layout tab reloads
  // too, so it is current when shown. A push with no info is the git
  // log's and changes no file of the page.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = window.emerald.files.onChanged((dir, info) => {
      if (info === undefined) return;
      const view: BrowserPaneView = { kind: 'browser', url: urlRef.current, ...(rootRef.current === undefined ? {} : { root: rootRef.current }) };
      const changed = normalizePath(dir).toLowerCase();
      if (!localPageFolders(view).some((f) => f.toLowerCase() === changed)) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const page = pageRef.current;
        if (page === null || !framePageState(frameId).ready) return;
        try {
          if (isLocalPageUrl(page.getURL())) page.reload();
        } catch {
          // Not attached yet.
        }
      }, LIVE_RELOAD_MS);
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      off();
    };
  }, [frameId]);

  return (
    <div className="browser-frame" data-browser-pane={paneId} data-frame-id={frameId}>
      {/* The webview is appended here by hand; React keeps no children
          in this box, so it never reorders around the page. */}
      <div className="browser-host" ref={hostRef} />
      {error !== null && <div className="browser-error">{error}</div>}
      {dropZone !== null && <div className="drop-overlay" data-drop-zone={dropZone} />}
    </div>
  );
}
