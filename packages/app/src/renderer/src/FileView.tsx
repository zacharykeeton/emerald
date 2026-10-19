import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { FileRead } from '../../preload/api.ts';
import { normalizePath, parentPath } from './files-model.ts';
import { fileUrl } from './markdown-url.ts';
import { MarkdownView } from './MarkdownView.tsx';
import { useEditState } from './file-edits.ts';
import { fileMenu } from './file-menu-model.ts';
import { setFileScheme, useFileScheme } from './file-scheme-store.ts';
import { themeOf } from './scheme-model.ts';
import { useScheme } from './scheme-store.ts';
import type { FileMenuRun } from './file-menu-model.ts';
import { Menu } from './Menu.tsx';
import { dismissSaveError, hasModel, heldText, keepMine, monaco, prettyKey, prettyLive, prettyModel, prettyRuns, prettyStateFor, reloadFromDisk, retain, saveFile, saveViewState, setFileTheme, subscribePretty, takeRead, viewStateFor } from './monaco.ts';
import { DIRTY_MARK, defaultView, isAnimatedKind, isImage, isJson, isMermaidFile, isTranscript, quickSuggestionsFor, viewFor } from './tabs-model.ts';
import { mermaidDocument, mermaidThemeFor } from './markdown-mermaid.ts';
import type { FileTabView } from './tabs-model.ts';
import { TranscriptView } from './TranscriptView.tsx';
import { ViewFindBar } from './ViewFindBar.tsx';
import { askBeforeClose, clearReveal, closeFileTab, getUiState, revealInFiles, setFileTabView, toggleWrapLines, useUi } from './ui.ts';
import { focusPane } from '@emerald/shared';
import { editTab } from './store.ts';
import { useSqueeze } from './squeeze.ts';
import { anchoredScroll, clickCursor, clickTarget, fitScale, zoomChip, zoomStep } from './image-zoom-model.ts';
import type { ImageZoom } from './image-zoom-model.ts';

// A file tab's content: a header with the full path and the two ways out
// to Windows, then the file in a Monaco editor. One editor serves every
// tab; the models live in monaco.ts and outlive a switch, so coming back
// to a file finds it where it was. The folder of every open file is
// watched (FilesRail.tsx names it), so a change on disk re-reads the
// file and replaces the text in place. A markdown file has
// a second view, rendered, which is its default, and a Claude Code
// transcript its turns (M53); the header's switch picks, and the editor
// stays mounted underneath so Raw is instant. A
// contents hit opens the tab with a line to show (M27): once the model is
// in, the line is scrolled to the centre, the cursor put on it and the
// whole line flashed for a moment.
//
// M9 fix 180: the same body in a pane. The tab reads its view off the
// tabs model and closes through the tabs; a pane keeps the view on its
// own record and its close is the pane's, so both come in as props. A
// reveal names the pane it is for (M9 fix 437: a contents hit dropped on
// a pane), so a pane takes only one with its own id and a tab only one
// with none; a tab and a pane on the same file never both flash.
// A pane's reveal waits while its layout tab is not on show (M9 fix 765).
//
// M9 fix 248: the Raw view is an editor. Ctrl+S in it saves (monaco.ts
// writes the model's text through the file service, line ends and BOM
// as the read found them), the header wears the dirty mark and a Save
// button while the model differs from the disk, a close with unsaved
// edits asks first (ui.ts, UnsavedDialog.tsx), and a change on disk
// under a dirty model is a line on the header with Reload and Keep mine
// rather than a silent replace. A transcript's Raw view stays read-only:
// Claude Code owns those files. The rendered markdown view reads the
// model, so a save shows in it.
//
// M9 fix 270: a right-click on the body opens the app's own menu
// (file-menu-model.ts lists it) with Copy, Select all, Paste where the
// editor takes edits, and the three ways out. Monaco's clipboard actions
// are not in the build, and its own context menu is told not to show
// (contextmenu: false below, M9 fix 359: the JSON language's own
// register.js brings its whole contribution list in, that menu
// included), so this is the one menu a file shows. In the editor the
// menu opens from Monaco's onContextMenu, which knows the position under
// the pointer: a right-click outside the selection moves the cursor
// there first, as Monaco's own menu would, and the selection is read
// after that. The rendered and transcript views are plain DOM, so theirs
// reads the document's selection.
//
// M9 fix 338: the editor wraps long lines at the width by default. The
// setting is the window's (ui.ts, emerald.wrapLines), flipped by Alt+Z in
// the editor, the header's Wrap button or the file menu's item, and
// every open editor follows it.
//
// M9 fix 339: a .json file's own view is Pretty, the same editor made
// read-only on a second model that holds the file's text as the JSON
// worker formats it (monaco.ts, prettyModel); Raw is the file itself,
// with a Format button beside Save that runs the editor's format action
// on the file's model, one undoable edit that marks it dirty. A file
// the worker cannot parse shows the Raw editor under a notice naming
// the error and its line, so the Pretty switch never hides a broken
// file.
//
// M9 fix 420: the file menu's Format JSON selection (file-menu-model.ts)
// runs editor.action.formatSelection over the editor's selection alone,
// disabled with nothing selected; the header's Format button stays
// whole-file.
//
// M9 fix 358: the reformat is live only while a Pretty tab is on screen
// (monaco.ts, prettyLive), called here in an effect keyed on view, not
// prettyShown below (a file the worker refuses is still live, so its own
// mending reformat can turn Pretty back on). Typing in Raw while nobody
// is on Pretty holds the state at its last value instead of paying two
// worker round trips on every debounce; switching back reformats once,
// at once. data-pretty-runs on the view is the verify script's counter.
//
// M9 fix 340: a file can wear a colour scheme of its own, picked from
// the file menu's last section and kept by path (file-scheme-store.ts),
// so a file stands out from the terminals: the document (the editor's
// host, the rendered markdown, the transcript) takes the scheme's
// ground and foreground through --file-bg and --file-fg under
// .file-view[data-scheme]; the header stays on the window's.
//
// M9 fix 438: the same scheme colours the editor's syntax too, not just
// its ground. Monaco keeps one theme for the whole page, so it is
// whichever file view last had the keyboard that wins it (monaco.ts's
// setFileTheme, off monaco-theme-model.ts's token map): two file views
// on different schemes both wear the last focused one's syntax, and a
// file with no scheme of its own follows the window's while it is
// focused.
// M9 fix 851: what a typed key on a read-only editor says, in place of Monaco's stock "Cannot edit in read-only editor".
const PRETTY_READ_ONLY = 'Pretty is a formatted copy and does not take edits. Switch to Raw to edit the file.';
const TRANSCRIPT_READ_ONLY = 'This is a Claude transcript, shown read-only.';

interface Props {
  path: string;
  view?: FileTabView;
  onView?: (view: FileTabView) => void;
  onClose?: () => void;
  inPane?: boolean;
  paneId?: string;
  shown?: boolean;
}

export function FileView({ path, view: viewProp, onView, onClose, inPane = false, paneId, shown = true }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { tabs, reveal: revealed, wrapLines } = useUi();
  const reveal = revealed !== null && (inPane ? shown && revealed.paneId !== undefined && revealed.paneId === paneId : revealed.paneId === undefined) ? revealed : null;
  const own = defaultView(path);
  const view = viewProp ?? viewFor(tabs, path);
  // M9 fix 615: a picture shows as an <img> on the file: URL the page can
  // already load (the CSP allows file:). A raster has no view and is never
  // read through files.read (no 8 MB cap, no binary probe); an SVG is text
  // and keeps its read for Raw, and its Rendered view is the same <img>.
  const image = isImage(path);
  const raster = image && own === null;
  const showImage = raster || (image && view === 'rendered');
  const lastSep = path.lastIndexOf('\\');
  const pathFolder = lastSep >= 0 ? path.slice(0, lastSep + 1) : '';
  const pathName = lastSep >= 0 ? path.slice(lastSep + 1) : path;
  // Any change in the file's folder gives the <img> a new src, so a rewrite
  // shows; zoom starts fitted for each path.
  const [version, setVersion] = useState(0);
  const [zoom, setZoom] = useState<ImageZoom>('fit');
  useEffect(() => setZoom('fit'), [path]);
  const animated = raster && isAnimatedKind(path);
  const [paused, setPaused] = useState(false);
  useEffect(() => setPaused(false), [path]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loaded, setLoaded] = useState<{ src: string; w: number; h: number } | null>(null);
  // M9 fix 820: the host's room, read in the <img>'s onLoad (so no read
  // waits on an observer) and kept by a ResizeObserver after. Fit is the
  // scale that room gives the picture; zoom is 'fit' or a step.
  const imageHostRef = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const readRoom = () => {
    const h = imageHostRef.current;
    if (h !== null) setRoom((r) => (r.w === h.clientWidth && r.h === h.clientHeight ? r : { w: h.clientWidth, h: h.clientHeight }));
  };
  const fit = loaded === null ? 1 : fitScale(loaded, room);
  const scale = zoom === 'fit' ? fit : zoom;
  const zoomNote = useRef<{ x: number; y: number; ox: number; oy: number; from: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const url = showImage ? fileUrl(pathFolder, encodeURIComponent(pathName)) : '';
  const src = url === '' ? '' : `${url}?v=${version}`;
  const imageFailed = showImage && (src === '' || failed === src);
  // Pause draws the picture's current frame onto a canvas the same size and
  // hides the <img>; a layout effect runs before paint, so no frame of the
  // animation shows between. A rewrite on disk sets a new `loaded` and
  // redraws (M9 fix 638).
  useLayoutEffect(() => {
    const img = imgRef.current;
    const c = canvasRef.current;
    if (!paused || img === null || c === null || !img.complete || img.naturalWidth === 0) return;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')?.drawImage(img, 0, 0);
  }, [paused, loaded]);
  const imageShown = showImage && !(src === '' || failed === src);
  useEffect(() => {
    const h = imageHostRef.current;
    if (!imageShown || h === null) return;
    readRoom();
    const ro = new ResizeObserver(readRoom);
    ro.observe(h);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageShown]);
  // Ctrl+wheel steps the zoom about the pointer, the commit graph's shape
  // (CommitsPanel): capture and not passive so the host never scrolls on
  // it; the point under the pointer is noted per axis and the scroll set
  // once the scaled picture has rendered.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const host = imageHostRef.current;
    if (!imageShown || host === null) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      host.focus({ preventScroll: true });
      const from = scaleRef.current;
      const next = zoomStep(from, ev.deltaY < 0 ? 1 : -1);
      if (next === from) return;
      const shown = host.querySelector<HTMLElement>('.file-image:not([hidden])');
      if (shown !== null) {
        const hr = host.getBoundingClientRect();
        const ir = shown.getBoundingClientRect();
        zoomNote.current = { x: ev.clientX - ir.left, y: ev.clientY - ir.top, ox: ev.clientX - hr.left, oy: ev.clientY - hr.top, from };
      }
      setZoom(next);
    };
    host.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => host.removeEventListener('wheel', onWheel, { capture: true });
  }, [imageShown]);
  useLayoutEffect(() => {
    const n = zoomNote.current;
    zoomNote.current = null;
    const host = imageHostRef.current;
    const shown = host?.querySelector<HTMLElement>('.file-image:not([hidden])') ?? null;
    if (n === null || host === null || shown === null) return;
    const hr = host.getBoundingClientRect();
    const ir = shown.getBoundingClientRect();
    host.scrollLeft = anchoredScroll({ scroll: host.scrollLeft, imageStart: ir.left, hostStart: hr.left, into: n.x, offset: n.ox, from: n.from, to: scale });
    host.scrollTop = anchoredScroll({ scroll: host.scrollTop, imageStart: ir.top, hostStart: hr.top, into: n.y, offset: n.oy, from: n.from, to: scale });
  }, [zoom]);
  // Off fit the picture draws at its natural size times the scale.
  const imgSize = zoom !== 'fit' && loaded !== null ? { width: loaded.w * scale, height: loaded.h * scale } : undefined;
  const setView = onView ?? ((next: FileTabView) => setFileTabView(path, next));
  // A pane's close asks about unsaved edits the way the tab's does; the
  // tab's close asks inside closeFileTab itself.
  const close = onClose === undefined ? () => closeFileTab(path) : () => askBeforeClose(path, onClose) || onClose();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // The path the Ctrl+S command reads, since the command is bound once
  // and the tab's path changes under it.
  const pathRef = useRef(path);
  pathRef.current = path;
  const edit = useEditState(path);
  const json = isJson(path);
  const prettyState = useSyncExternalStore(subscribePretty, () => prettyStateFor(path));
  const { schemes, current: windowScheme } = useScheme();
  const schemePick = useFileScheme(path);
  // M9 fix 422: unlike the window's pick, which always resolves to a
  // scheme (pickScheme falls back to the default, since the window is
  // the bottom of the chain and has to wear something), the file's pick
  // resolves to null when its name is not on the list, whether the name
  // is a Windows Terminal scheme that went away or one emmer open
  // --scheme named that no scheme ever had (M9 fix 375); a file with no
  // scheme of its own then follows the window rather than wearing a
  // default of its own.
  const fileScheme = schemePick === null ? null : (schemes.find((sch) => sch.name === schemePick) ?? null);
  const fileTheme = fileScheme === null ? null : themeOf(fileScheme);
  // M9 fix 438: the scheme whose syntax this view wants once it has the
  // keyboard, the file's own or, with none, the window's.
  const syntaxScheme = fileScheme ?? windowScheme;
  const [focused, setFocused] = useState(false);
  // The Pretty view stands in for the editor once there is a model; a
  // file the worker refuses falls back to the Raw editor under a notice.
  const editorView = view === 'raw' || view === 'pretty';
  const prettyShown = view === 'pretty' && prettyState.status !== 'invalid';
  // The key whose model the editor holds and whose view state a switch
  // saves: the path for the file's model, prettyKey for the Pretty
  // view's (the model's URI does not spell the path the way the tabs
  // do, since Monaco lowercases the drive).
  const shownRef = useRef<string | null>(null);
  const [read, setRead] = useState<{ path: string; result: FileRead } | null>(null);
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // The open menu: where the pointer was, whether the editor or the DOM
  // owns the selection, and whether there was one when it opened.
  const [menu, setMenu] = useState<{ x: number; y: number; where: 'editor' | 'dom'; selected: boolean } | null>(null);
  // M9 fix 619: the find bar over the rendered and turns views, null
  // while closed, otherwise a count that goes up on every Ctrl+F so the
  // box takes the keyboard again. A switch to another view or another
  // file closes it.
  const [findSeq, setFindSeq] = useState<number | null>(null);
  useEffect(() => setFindSeq(null), [path, view]);

  // Leaving the file the editor shows, for another tab, for the panes or
  // for a full unmount, saves its scroll, cursor and fold state so coming
  // back restores it (M9 fix 298 found this losing the fold: the model
  // must still be on the editor when saveViewState runs, so the guard
  // here keeps a save from this and from the dispose cleanup below from
  // racing an empty one in after the model is gone, whichever runs first).
  const saveCurrentViewState = () => {
    const editor = editorRef.current;
    if (editor === null || editor.getModel() === null) return;
    const shown = shownRef.current;
    if (shown !== null) saveViewState(shown, editor.saveViewState());
  };

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const editor = monaco.editor.create(host, {
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      // Off (M9 fix 686): the sticky scroll contribution comes in only with the JSON language's chunk, so it would show after the first .json and not before; nobody asked for it, and in a read tab it covers the top lines.
      stickyScroll: { enabled: false },
      renderLineHighlight: 'line',
      fontSize: 13,
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      wordWrap: getUiState().wrapLines ? 'on' : 'off',
      // The JSON language's own contributions bring Monaco's context menu
      // in (M9 fix 359); emerald's own menu below is the one a right-click
      // shows.
      contextmenu: false,
    });
    editorRef.current = editor;
    // Ctrl+S is the editor's while it has the keyboard; keys.ts binds
    // nothing to the plain chord, so it reaches here.
    // addAction, not addCommand (M9 fix 489): the keybinding is scoped to
    // this editor and goes with it, where addCommand's is page-wide, keeps
    // no handle and outlived the editor, so the newest view's handler won
    // every Ctrl+S. keys.ts catches the key when the editor has no focus.
    const saveAction = editor.addAction({
      id: 'emerald.save',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => void saveFile(pathRef.current).catch(warn('save')),
    });
    // Alt+Z flips the wrap, as it does in VS Code.
    const wrapAction = editor.addAction({
      id: 'emerald.toggleWrap',
      label: 'Toggle word wrap',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyZ],
      run: () => toggleWrapLines(),
    });
    // For the verify scripts, as emeraldTerm on a terminal host: an occluded
    // window draws no frames, so the DOM says nothing about the cursor.
    (host as HTMLDivElement & { emeraldEditor?: monaco.editor.IStandaloneCodeEditor }).emeraldEditor = editor;
    // The body's own handler leaves a right-click in the editor to this
    // one, which has the position under the pointer.
    editor.onContextMenu((e) => {
      const at = e.target.position;
      const before = editor.getSelection();
      if (at !== null && (before === null || !before.containsPosition(at))) editor.setPosition(at);
      const selection = editor.getSelection();
      setMenu({ x: e.event.posx, y: e.event.posy, where: 'editor', selected: selection !== null && !selection.isEmpty() });
    });
    // M9 fix 438: which view's scheme colours the shared Monaco theme,
    // since only the focused one gets to (the effect below reads this).
    const onFocus = editor.onDidFocusEditorText(() => setFocused(true));
    const onBlur = editor.onDidBlurEditorText(() => setFocused(false));
    return () => {
      // Before the model and the editor go: a full unmount runs the
      // path-change cleanup below too, but a disposed editor's own
      // saveViewState comes back without the folds, so whichever of the
      // two runs first must be the one that saves.
      saveCurrentViewState();
      onFocus.dispose();
      onBlur.dispose();
      saveAction.dispose();
      wrapAction.dispose();
      editorRef.current = null;
      // The model is not the editor's to dispose; monaco.ts keeps it for
      // the tab.
      editor.setModel(null);
      editor.dispose();
    };
  }, []);

  // M9 fix 438: the focused view's scheme colours the editor's syntax,
  // the window's while the file has none of its own; two views on
  // different schemes both wear whichever was focused last, since Monaco
  // keeps one theme for the whole page.
  useEffect(() => {
    if (!focused) return;
    setFileTheme(syntaxScheme);
  }, [focused, syntaxScheme]);

  // The wrap follows the window's setting while the editor lives.
  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap: wrapLines ? 'on' : 'off' });
  }, [wrapLines]);

  // The view holds the file's model while it shows it (monaco.ts keeps
  // a model while a tab lists it or a view holds it), so a file in a
  // pane with no tab keeps its edits across the store's changes.
  useEffect(() => retain(path), [path]);

  // The read, first time and after each change on disk. A stale reply
  // for a path that is no longer showing is dropped.
  useEffect(() => {
    let live = true;
    const load = () =>
      void window.emerald.files
        .read(path)
        .then((result) => {
          if (live) setRead({ path, result });
        })
        .catch(warn('read'));
    if (!raster) load();
    const folder = parentPath(path);
    const off = window.emerald.files.onChanged((dir) => {
      if (dir === folder) {
        setVersion((v) => v + 1);
        if (!raster) load();
      }
    });
    return () => {
      live = false;
      off();
    };
  }, [path, raster]);

  // The model follows the read. Coming to a file restores its view state
  // and puts the keyboard in the editor; a re-read of the file showing
  // only replaces the text (takeRead), so nothing moves, and leaves a
  // dirty model alone. A rendered markdown tab leaves the editor alone
  // until Raw is picked, unless the file already has a model, whose
  // edits a change on disk must still be read against. The Pretty view
  // puts the derived model in, read-only, under the same rules.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || read === null || read.path !== path || !('text' in read.result)) return;
    if (!editorView && !hasModel(path)) return;
    const { text, eol, bom, stamp } = read.result;
    const fileModel = takeRead(path, text, { eol, bom }, stamp);
    if (!editorView) return;
    const model = prettyShown ? prettyModel(path) : fileModel;
    if (model === null || editor.getModel() === model) return;
    const readOnly = prettyShown || isTranscript(path);
    const readOnlyMessage = prettyShown ? { value: PRETTY_READ_ONLY } : isTranscript(path) ? { value: TRANSCRIPT_READ_ONLY } : undefined;
    // undefined clears an earlier message (Monaco's option merge writes it
    // over), which exactOptionalPropertyTypes does not let the type say.
    editor.updateOptions({ readOnly, domReadOnly: readOnly, readOnlyMessage, quickSuggestions: quickSuggestionsFor(model.getLanguageId()) } as monaco.editor.IEditorOptions);
    editor.setModel(model);
    const key = prettyShown ? prettyKey(path) : path;
    editor.restoreViewState(viewStateFor(key));
    editor.focus();
    shownRef.current = key;
  }, [read, path, view, editorView, prettyShown]);

  // Whether this view is on the Pretty tab (M9 fix 358), not prettyShown
  // above: a file the worker refuses is still live, so its own mending
  // reformat can turn Pretty back on. monaco.ts holds a count per file,
  // in retain's shape, so a tab and a pane on the same file both leaving
  // is what goes idle; going live reformats a stale Raw edit at once.
  useEffect(() => {
    if (view !== 'pretty') return;
    prettyLive(path, true);
    return () => prettyLive(path, false);
  }, [path, view]);

  // The reveal, after the model effect above has put the file in. The
  // flash is a whole-line decoration cleared by a timer rather than a CSS
  // animation's end, so it also lands under the harness, which gets no
  // frames. Taking the reveal clears it in the store, which re-runs this
  // effect at once, so the timer lives in a ref and only an unmount or
  // the next reveal cuts it short.
  const flashRef = useRef<{ clear: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const endFlash = () => {
    if (flashRef.current === null) return;
    clearTimeout(flashRef.current.timer);
    flashRef.current.clear();
    flashRef.current = null;
  };
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || reveal === null || normalizePath(reveal.path) !== normalizePath(path) || shownRef.current !== path) return;
    const model = editor.getModel();
    if (model === null) return;
    const line = Math.max(1, Math.min(reveal.line, model.getLineCount()));
    endFlash();
    // The editor may have been hidden until this render (M9 fix 765: a
    // reveal held for a layout tab not on show); lay it out at its size
    // now, before centring the line, rather than waiting for
    // automaticLayout's observer.
    editor.layout();
    editor.revealLineInCenter(line);
    const column = Math.max(1, Math.min(reveal.column, model.getLineMaxColumn(line)));
    editor.setPosition({ lineNumber: line, column });
    const flash = editor.createDecorationsCollection([{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'file-line-flash' } }]);
    flashRef.current = { clear: () => flash.clear(), timer: setTimeout(endFlash, FLASH_MS) };
    clearReveal(reveal.seq);
  }, [reveal, read, path, view]);
  useEffect(() => endFlash, []);

  // A path change while the editor stays mounted (file-to-file, no
  // unmount) goes through this cleanup instead of the one above.
  useEffect(() => saveCurrentViewState, [path]);

  const result = read !== null && read.path === path ? read.result : null;
  const hasText = result !== null && 'text' in result;
  const showEditor = hasText && editorView;
  const formatDocument = () => {
    const editor = editorRef.current;
    if (editor === null || editor.getModel() === null) return;
    void editor.getAction('editor.action.formatDocument')?.run().catch(warn('format'));
  };
  // M9 fix 420: Format JSON selection, the range formatter beside the
  // header's whole-file Format button.
  const formatSelection = () => {
    const editor = editorRef.current;
    if (editor === null || editor.getModel() === null) return;
    void editor.getAction('editor.action.formatSelection')?.run().catch(warn('format selection'));
  };

  // The header gives its parts up in a fixed order as the pane narrows
  // (M9 fix 389), squeeze.ts's rule (fix 76): the path's folder at the
  // first level (the name alone stays, .file-path-folder split off so
  // the CSS can hide it on its own), Open with Windows and Reveal at
  // the second (the right-click menu carries both), Wrap and Format
  // together at the third (the menu has both too), and the name itself
  // at the fourth; Save while dirty, the Pretty/Raw switch and the
  // close button never give. tell is .file-path itself: the header's
  // own overflow only shows once the buttons alone outrun the space
  // (the path can shrink to nothing without it), so the path's own
  // ellipsis, which does not widen the header, is what says a level is
  // not enough yet.
  const sizeText = showImage && !imageFailed && loaded !== null && loaded.src === src ? `${loaded.w} \u00d7 ${loaded.h}` : '';
  useSqueeze(headerRef, 5, '.file-path', [path, own, view, edit.dirty, json, showEditor, sizeText, animated, paused, zoom]);

  // The DOM views' menu. The editor's own right-click is left to Monaco's
  // handler above (its host cannot be the target while hidden, since
  // visibility: hidden takes no pointer events). The pane's menu opens
  // on a right-click anywhere in a view pane, so the event stops here.
  const onContextMenu = (ev: ReactMouseEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    const host = hostRef.current;
    if (host !== null && ev.target instanceof Node && host.contains(ev.target)) return;
    const selection = window.getSelection();
    const body = bodyRef.current;
    const selected = selection !== null && body !== null && selection.anchorNode !== null && body.contains(selection.anchorNode) && selection.toString() !== '';
    setMenu({ x: ev.clientX, y: ev.clientY, where: 'dom', selected });
  };
  // The view the DOM selection lives in: whichever child of the body is
  // not the editor's host.
  const domView = () => bodyRef.current?.querySelector(':scope > :not(.file-editor):not(.menu):not(.view-find-bar)') ?? null;
  // The views with no Monaco take Ctrl+F for the find bar of their own
  // (M9 fix 619); Raw and Pretty leave the key to the editor's find.
  const findView = view === 'rendered' ? '.markdown-view' : view === 'turns' ? '.transcript-view' : null;
  const openFind = () => setFindSeq((n) => (n ?? 0) + 1);
  const closeFind = () => {
    setFindSeq(null);
    if (findView !== null) bodyRef.current?.querySelector<HTMLElement>(findView)?.focus();
  };
  // On the root, so a press with the header's switch focused counts as in
  // the view. ev.code, as keys.ts matches, not ev.key.
  const onKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (showImage && !imageFailed && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      // M9 fix 820: + and - step the zoom (no anchoring), 0 goes to fit.
      const dir = ev.code === 'Equal' || ev.code === 'NumpadAdd' ? 1 : ev.code === 'Minus' || ev.code === 'NumpadSubtract' ? -1 : 0;
      if (dir !== 0) {
        ev.preventDefault();
        setZoom(zoomStep(scale, dir));
        return;
      }
      if (ev.code === 'Digit0' || ev.code === 'Numpad0') {
        ev.preventDefault();
        setZoom('fit');
        return;
      }
    }
    if (findView === null) return;
    if (ev.code !== 'KeyF' || !ev.ctrlKey || ev.shiftKey || ev.altKey || ev.metaKey) return;
    ev.preventDefault();
    ev.stopPropagation();
    openFind();
  };
  const runMenuItem = (run: FileMenuRun, where: 'editor' | 'dom', scheme?: string | null) => {
    const editor = editorRef.current;
    const model = editor?.getModel() ?? null;
    switch (run) {
      case 'copy': {
        const selection = editor?.getSelection() ?? null;
        const text = where === 'editor' ? (model !== null && selection !== null ? model.getValueInRange(selection) : '') : (window.getSelection()?.toString() ?? '');
        // M9 fix 370: the main process's clipboard, as the paste read
        // just below already is, not navigator.clipboard, which asks a
        // permission this menu's click does not carry.
        if (text !== '') void window.emerald.clipboard.write(text).catch(warn('copy'));
        return;
      }
      case 'select-all': {
        if (where === 'editor') {
          if (editor === null || model === null) return;
          editor.setSelection(model.getFullModelRange());
          editor.focus();
          return;
        }
        const el = domView();
        if (el !== null) window.getSelection()?.selectAllChildren(el);
        return;
      }
      case 'paste':
        // Through the main process, as the pane's Ctrl+V (M9 fix 92):
        // navigator.clipboard's read asks permission. Monaco's paste
        // handler puts the text at the cursor and moves it past.
        if (editor === null) return;
        void window.emerald.clipboard
          .read()
          .then(({ text }) => {
            if (text === null) return;
            editor.trigger('menu', 'paste', { text });
            editor.focus();
          })
          .catch(warn('paste'));
        return;
      case 'find':
        // M9 fix 619: the view's own bar where there is no editor, and
        // Monaco's find widget where there is, as Ctrl+F gives each.
        if (findView !== null) {
          openFind();
          return;
        }
        if (editor === null || model === null) return;
        editor.focus();
        void editor.getAction('actions.find')?.run().catch(warn('find'));
        return;
      case 'wrap':
        toggleWrapLines();
        return;
      case 'format':
        formatDocument();
        return;
      case 'format-selection':
        formatSelection();
        return;
      case 'scheme':
        setFileScheme(path, scheme ?? null);
        // M9 fix 438: a menu click blurs the editor (the button takes the
        // DOM focus), so without this the syntax theme's own focus effect
        // never sees the change and an old scheme's syntax colours leak
        // through once this view's --file-bg override goes with the pick.
        editor?.focus();
        return;
      case 'heading':
        // A heading has no click.
        return;
      case 'copy-path':
        void window.emerald.clipboard.write(path).catch(warn('copy'));
        return;
      case 'reveal':
        void window.emerald.files.reveal(path).catch(warn('reveal'));
        return;
      case 'reveal-files':
        // M9 fix 652: in a pane, the pane is focused first (zoomHere's
        // shape in Pane.tsx), so the rail's front file is this pane's
        // whether or not the right-click's press focused it.
        if (paneId !== undefined) {
          void editTab((t) => (t.focusedPaneId === paneId ? t : focusPane(t, paneId)), paneId)
            .then(() => revealInFiles(path))
            .catch(warn('reveal'));
        } else {
          revealInFiles(path);
        }
        return;
      case 'open':
        void window.emerald.files.open(path).catch(warn('open'));
        return;
    }
  };
  // The rendered view shows the model's text once there is one, so a
  // save (or an edit) shows without a second read.
  const shownText = hasText ? (heldText(path) ?? result.text) : '';
  return (
    // data-lines is for the verify script: an occluded window draws no
    // frames, so the editor's DOM says nothing about what it holds.
    <div
      className="file-view"
      data-path={path}
      data-state={showImage ? (imageFailed ? 'error' : 'image') : result === null ? 'loading' : 'text' in result ? 'text' : 'binary' in result ? 'binary' : 'error'}
      data-lines={hasText ? result.text.split('\n').length : undefined}
      data-view={own !== null ? view : undefined}
      data-zoom={showImage ? (zoom === 'fit' ? 'fit' : zoom === 1 ? 'actual' : 'scaled') : undefined}
      data-scale={showImage ? String(Math.round(scale * 100) / 100) : undefined}
      data-cursor={showImage ? (clickCursor(zoom, fit) ?? undefined) : undefined}
      data-pixelated={showImage && scale > 1 ? '' : undefined}
      data-pretty={view === 'pretty' ? prettyState.status : undefined}
      data-pretty-runs={json ? prettyRuns(path) : undefined}
      data-scheme={fileScheme?.name}
      style={fileTheme === null ? undefined : ({ '--file-bg': fileTheme.background, '--file-fg': fileTheme.foreground } as React.CSSProperties)}
      data-place={inPane ? 'pane' : undefined}
      data-dirty={edit.dirty || undefined}
      data-conflict={edit.conflict || undefined}
      onKeyDown={onKeyDown}
    >
      <div className="file-header" ref={headerRef}>
        {edit.dirty && (
          <span className="file-dirty" title="Unsaved edits (Ctrl+S saves)">
            {DIRTY_MARK}
          </span>
        )}
        <span className="file-path" title={path}>
          <span className="file-path-folder">{pathFolder}</span>
          <span className="file-path-name">{pathName}</span>
        </span>
        {sizeText !== '' && <span className="file-image-size">{sizeText}</span>}
        {sizeText !== '' && (
          <button className="files-button file-image-zoom" title="Back to fit (0)" onClick={() => setZoom('fit')}>
            {zoomChip(zoom, fit)}
          </button>
        )}
        {animated && !imageFailed && (
          <button className="files-button file-image-pause" title={paused ? 'Play the animation' : 'Pause the animation'} onClick={() => setPaused(!paused)}>
            {paused ? 'Play' : 'Pause'}
          </button>
        )}
        {edit.dirty && (
          <button className="files-button file-save" title="Save (Ctrl+S)" onClick={() => void saveFile(path).catch(warn('save'))}>
            Save
          </button>
        )}
        {json && view === 'raw' && hasText && (
          <button className="files-button file-format" title="Format the JSON in place, in its own indent (one undo step)" onClick={formatDocument}>
            Format
          </button>
        )}
        {own !== null && (
          <span className="file-view-switch" role="group" aria-label={image ? 'Image view' : own === 'turns' ? 'Transcript view' : own === 'pretty' ? 'JSON view' : isMermaidFile(path) ? 'Diagram view' : 'Markdown view'}>
            <button className="files-button" data-view={own} data-active={view === own || undefined} onClick={() => setView(own)}>
              {own === 'turns' ? 'Turns' : own === 'pretty' ? 'Pretty' : 'Rendered'}
            </button>
            <button className="files-button" data-view="raw" data-active={view === 'raw' || undefined} onClick={() => setView('raw')}>
              Raw
            </button>
          </span>
        )}
        {showEditor && (
          <button className="files-button file-wrap" data-active={wrapLines || undefined} title="Wrap long lines at the width (Alt+Z)" onClick={toggleWrapLines}>
            Wrap
          </button>
        )}
        <button className="files-button file-open" title="Open with the program Windows has for it" onClick={() => void window.emerald.files.open(path).catch(warn('open'))}>
          Open with Windows
        </button>
        <button className="files-button file-reveal" title="Reveal in Explorer" onClick={() => void window.emerald.files.reveal(path).catch(warn('reveal'))}>
          Reveal
        </button>
        <button className="files-button file-close" title={inPane ? 'Close pane' : 'Close (Ctrl+W)'} onClick={close}>
          ×
        </button>
      </div>
      {edit.conflict && (
        <div className="file-notice" data-kind="disk">
          <span>Changed on disk while you were editing.</span>
          <button className="files-button" title="Take what is on disk; your edits go" onClick={() => reloadFromDisk(path)}>
            Reload
          </button>
          <button className="files-button" title="Keep your edits; the next save writes over the file" onClick={() => keepMine(path)}>
            Keep mine
          </button>
        </div>
      )}
      {view === 'pretty' && prettyState.status === 'invalid' && (
        <div className="file-notice" data-kind="json">
          <span>
            Not valid JSON: {prettyState.message} at line {prettyState.line}
          </span>
        </div>
      )}
      {edit.error !== null && (
        <div className="file-notice" data-kind="error">
          <span>Could not save: {edit.error}</span>
          <button className="files-button" title="Dismiss" onClick={() => dismissSaveError(path)}>
            ×
          </button>
        </div>
      )}
      <div className="file-body" ref={bodyRef} onContextMenu={onContextMenu}>
        {menu !== null && (
          <Menu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            className="file-menu"
            data={{ path, view: own !== null ? view : 'raw', where: menu.where }}
            items={fileMenu({
              view: own !== null ? view : 'raw',
              editable: !isTranscript(path),
              selected: menu.selected,
              wrap: wrapLines,
              json,
              schemes: schemes.map((sch) => ({ name: sch.name, background: sch.background, source: sch.source })),
              scheme: schemePick,
            }).map((item) =>
              item.run === 'heading'
                ? { heading: item.label, title: item.title }
                : {
                    label: item.label,
                    hint: item.hint,
                    disabled: item.disabled,
                    title: item.title,
                    separator: item.separator,
                    checked: item.checked,
                    onClick: () => {
                      setMenu(null);
                      runMenuItem(item.run, menu.where, item.scheme);
                    },
                  },
            )}
          />
        )}
        <div className="file-editor" ref={hostRef} style={{ visibility: showEditor ? 'visible' : 'hidden' }} />
        {showImage && !imageFailed && (
          <div className="file-image-host" ref={imageHostRef} tabIndex={-1}>
            <img
              ref={imgRef}
              hidden={paused}
              className="file-image"
              src={src}
              alt={pathName}
              style={imgSize}
              onLoad={(ev) => {
                readRoom();
                setLoaded({ src, w: ev.currentTarget.naturalWidth, h: ev.currentTarget.naturalHeight });
              }}
              onError={() => setFailed(src)}
              onClick={() => setZoom(clickTarget(zoom))}
            />
            {paused && <canvas ref={canvasRef} className="file-image" style={imgSize} onClick={() => setZoom(clickTarget(zoom))} />}
          </div>
        )}
        {imageFailed && (
          <div className="file-message">
            <div>Could not show this image</div>
            <button onClick={() => void window.emerald.files.open(path).catch(warn('open'))}>Open with Windows</button>
          </div>
        )}
        {hasText && !image && view === 'rendered' && <MarkdownView path={path} text={isMermaidFile(path) ? mermaidDocument(shownText) : shownText} diagramTheme={mermaidThemeFor(fileScheme?.background ?? null)} paneId={paneId} />}
        {hasText && view === 'turns' && <TranscriptView path={path} text={result.text} />}
        {findSeq !== null && hasText && findView !== null && (
          <ViewFindBar body={bodyRef} viewSelector={findView} text={view === 'rendered' ? shownText : result.text} focusSeq={findSeq} onClose={closeFind} />
        )}
        {result !== null && 'binary' in result && (
          <div className="file-message">
            <div>Binary file, {formatSize(result.size)}</div>
            <button onClick={() => void window.emerald.files.open(path).catch(warn('open'))}>Open with Windows</button>
          </div>
        )}
        {result !== null && 'error' in result && (
          <div className="file-message">
            <div>{result.error}</div>
            <button onClick={close}>{inPane ? 'Close pane' : 'Close tab'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// How long a revealed line stays lit.
const FLASH_MS = 1500;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
