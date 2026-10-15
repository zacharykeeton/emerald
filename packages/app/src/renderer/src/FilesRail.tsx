import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { currentTab, findPane, formatDuration } from '@emerald/shared';
import type { PaneView, SessionInfo } from '@emerald/shared';
import type { ChangedFile, FileEntry, FileListing, FileSearch, GitChanges, SearchMode } from '../../preload/api.ts';
import { applyListing, canEditFrom, collapseAll, emptyModel, expandFolder, filePaneFolders, folderName, joinPath, normalizePath, parentPath, pathLabel, refusalWords, relativePath, renameInModel, renamedPath, REVEAL_IN_FILES_MS, revealStep, rootIsEmpty, select, sessionInFolder, setRoot, stemEnd, toggleFolder, touchedAt, touchedIndex, touchedUnder, liftKeep, walk, watchOrder, withPending } from './files-model.ts';
import { endHandover, renameModels } from './monaco.ts';
import { dropFileSchemes, renameFileSchemes } from './file-scheme-store.ts';
import { dirtyFiles, isDirty } from './file-edits.ts';
import type { FilesModel, MenuFrom, Pending, Row, TouchedBy, TouchedIndex } from './files-model.ts';
import { indexCodes, indexStatuses, letterAt, letterFor, statusAt } from './git-status-model.ts';
import type { CodeIndex, GitFile, GitStatus, StatusIndex } from './git-status-model.ts';
import { fileIcon } from './file-icons.ts';
import { focusTerminal } from './focus.ts';
import { countsText, folderCounts, folderCountsTitle } from './git-changes-model.ts';
import type { FolderCounts } from './git-changes-model.ts';
import { useGitPoll } from './git-poll.ts';
import { useGitChanges } from './git-changes-hook.ts';
import { GitLetter } from './GitLetter.tsx';
import { Menu, menuOpen } from './Menu.tsx';
import { RenameBox } from './RenameBox.tsx';
import { HistoryPanel } from './HistoryPanel.tsx';
import { ClaudeStar } from './skin-star.tsx';
import { CommitsPanel } from './CommitsPanel.tsx';
import { BranchIcon } from './Sidebar.tsx';
import { ActivitySection, useRailScope, useRailUnit } from './ActivitySection.tsx';
import { openViewBeside, typeInto } from './actions.ts';
import { fileViewSupported, viewStateSupported, viewsSupported } from './daemon-model.ts';
import { startDrag } from './pane-drag.ts';
import { useFocusedSession, useFocusedView } from './shown-sessions.ts';
import { graphFolder } from './graph-folder.ts';
import { commitsPath, defaultView, deletedFilePanes, isDocument, isFileTab, renameFilePanes } from './tabs-model.ts';
import { commitsQuery, commitsView } from './view-state.ts';
import { editLayout, getState, useStore } from './store.ts';
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clearRevealFile, closeFileTabsUnder, flashCornerNote, keepSearchScopeUnder, openFileTab, openFolderReviewTab, openPreviewTab, openReviewTab, pinFileTab, renameFileTabs, setFilesChanged, setFilesWidth, setRailTab, setSearchMode, setSearchScope, toggleFiles, useUi } from './ui.ts';
import type { RailTab } from './ui.ts';

// The file tree of the folder the focused pane's session is in, at the
// right edge, like Orca's. It follows the session's live cwd, so it moves
// with focus and with a shell's cd. Folders are listed by the main process
// (the renderer is sandboxed) the first time they open, kept while a fresh
// listing is on its way so nothing flickers, and watched while open so a
// change on disk re-lists just that folder. What is expanded is kept by
// absolute path across root changes; see files-model.ts.
//
// Since M19 the rail has two panels behind an icon row at its top, as
// Orca's does: the tree, and the session history (HistoryPanel.tsx). The
// tree's state lives on whichever is showing, so switching away and back
// finds the folders as they were.
//
// The watch can miss a write (a folder opened before its watcher was
// dropped past WATCH_CAP, or fs.watch losing one under load), so since M35
// the open folders are listed again on the two moments a person looks: the
// focus moving to another pane, and the window coming back to the front.
// Per session, the last cwd the daemon read a branch in (fix 114).
const lastRepoCwd = new Map<string, string>();
// The last root the rail had (M9 fix 140): an activity view (M69) is
// pinned to a window, not a place, so while one has focus the rail keeps
// the folder it showed before, the strip and the graph with it, the way
// it keeps the repository while a session's cwd is outside one. An empty
// pane still clears the rail, since "No session in this pane" is true
// there.
let lastRoot: string | null = null;
// The repository root above a file's folder (M9 fix 331), asked of the
// main process once per folder and kept for the window's life, so a
// file tab or a file pane in front puts the rail on the file's own
// repository rather than the panes tab's folder (a file tab was not seen
// at all before, since the focus hooks read the layout tab under it). A
// folder in no repository maps to itself; a folder with no entry is
// still being asked about, and the rail keeps its root meanwhile.
const fileRoots = new Map<string, string>();
const fileRootsAsked = new Set<string>();
// How long a row Reveal in Files showed (M9 fix 652) keeps data-flash;
// the animation itself is 0.8 s, so the attribute outlives it.
const REVEAL_FLASH_MS = 1000;

// Whether p is under root, compared the way relativePath compares.
function isUnder(root: string, p: string): boolean {
  return relativePath(root, p) !== normalizePath(p);
}

export function FilesRail() {
  const { filesCollapsed, filesWidth, tabs, railTab, filesChanged, search: searchSettings, revealFile } = useUi();
  const focused = useFocusedSession();
  const focusedView = useFocusedView();
  // A look above the followed folder (M9 fix 332): the header's up button
  // sets it to the parent of what is shown, and it drops whenever the
  // followed root changes (a cd, another pane focused, a file tab in
  // front), so the rail is back on following; a click into the tree does
  // not drop it.
  const [lift, setLift] = useState<string | null>(null);
  // The folders every lift since the rail last followed came from (M9 fix
  // 436, a chain since fix 524): each parent's listing asks for the one it
  // holds by name, so a parent of more folders than the cap still holds
  // the row the lift left open, and a second lift's relist of the first
  // parent keeps the first lift's row too.
  const liftChain = useRef<string[]>([]);
  const [, fileRootsChanged] = useState(0);
  // The file in front (M9 fix 331): a file tab on show, else the focused
  // pane's file view.
  const frontFile = isFileTab(tabs) && !isDocument(tabs.active) ? tabs.active : focusedView?.kind === 'file' ? focusedView.path : null;
  const frontFolder = frontFile === null ? null : parentPath(frontFile);
  useEffect(() => {
    if (frontFolder === null || fileRoots.has(frontFolder) || fileRootsAsked.has(frontFolder)) return;
    fileRootsAsked.add(frontFolder);
    window.emerald.history
      .project(frontFolder)
      .then((r) => fileRoots.set(frontFolder, r === null ? frontFolder : normalizePath(r)))
      .catch(() => fileRoots.set(frontFolder, frontFolder))
      .finally(() => fileRootsChanged((n) => n + 1));
  }, [frontFolder]);
  // A file under the shown root moves nothing, so a file opened from the
  // rail leaves the tree where it stood (a lift included); only a file
  // from elsewhere (a commit's file, a search in another folder, a tab
  // from another repository) moves it. The reading comes before the
  // focused session's, since the panes tab's session is what is wrong
  // when a file tab is in front; the fix 140 rule for an activity pane
  // stays, and a file pane with nothing before it (a reload with the
  // pane focused) waits for its repository rather than showing its own
  // folder, which the answer would then never leave.
  const shownBefore = lift ?? lastRoot;
  const fileRoot = frontFile === null ? null : shownBefore !== null && isUnder(shownBefore, frontFile) ? lastRoot : (fileRoots.get(frontFolder!) ?? lastRoot);
  const root = frontFile !== null ? fileRoot : focused?.cwd ?? (focusedView?.kind === 'commits' ? focusedView.folder : focusedView?.kind === 'activity' || focusedView?.kind === 'browser' ? lastRoot : null);
  if (root !== null) lastRoot = root;
  // What the tree shows: the lift while one is on, else the followed root.
  const shown = lift ?? root;
  // The Commits graph is the session's repository, not wherever the
  // session's shell happens to stand (M9 fix 114): a cd into a folder
  // outside any repo (a log folder, a temp folder) used to turn the
  // graph into "Not a git repository" until the next cd. The daemon
  // reads the branch off the live cwd, null outside a repo, so that is
  // the test; while it is null the graph stays on the last folder the
  // session had a branch in, else the folder it was started in. M9 fix
  // 590: a session at home in a folder with no repository (a Claude where
  // it started, a shell where it was spawned) shows that folder, `Not a
  // git repository` and the init button with it (fix 255); graph-folder.ts
  // holds the rule. The Files tree keeps following the live cwd, since
  // that is its point.
  if (focused !== null && focused.branch !== null) lastRepoCwd.set(focused.id, focused.cwd);
  // A file in front (fix 331) moves the graph and the strip with the
  // tree; a lift (fix 332) does not, since it is a look above.
  const commitsRoot = focused === null || frontFile !== null ? root : graphFolder(focused, lastRepoCwd.get(focused.id));
  // The focused pane of the tab on show (M36): a tab switch counts as a
  // look too.
  const { layout: layoutForFocus, daemon, sessions } = useStore('layout', 'daemon', 'sessions');
  const focusedPaneId = layoutForFocus === null ? null : currentTab(layoutForFocus).focusedPaneId;
  // The files every session wrote (M9 fix 198), one index for the rows'
  // dots; rebuilt per render, which the store's pushes drive.
  const touched = touchedIndex(sessions.values());
  const [model, setModel] = useState<FilesModel>(emptyModel);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // A file or folder being made (M9 fix 309): its name box sits as the
  // first row of its folder until Enter makes it or Escape drops it.
  const [pending, setPending] = useState<PendingBox | null>(null);
  // An entry being renamed in place (M9 fix 574): its name box stands in
  // for its row until Enter renames it or Escape drops it.
  const [renaming, setRenaming] = useState<RenameBoxState | null>(null);
  // The tree takes the keyboard for F2 (M9 fix 574) on a right-click on a
  // row or a second click on the selected file, and no other way.
  const listRef = useRef<HTMLDivElement>(null);
  const focusTree = () => listRef.current?.focus({ preventScroll: true });
  // The header's + menu (M9 fix 309), the root's way to a new entry.
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const [needle, setNeedle] = useState('');
  // Names or Contents (M25) and the scope a Find in folder set, both kept
  // in ui.ts since M27 so a reload finds them; the scope goes when the box
  // clears or the root moves out from above it.
  const { mode, scope } = searchSettings;
  // The Activity tab's strip keeps to the rail's folder or shows all (M66).
  const [activityScope, setActivityScope] = useRailScope();
  const [activityUnit, setActivityUnit] = useRailUnit();
  const setMode = setSearchMode;
  const setScope = setSearchScope;
  const filterInput = useRef<HTMLInputElement>(null);
  const searchRoot = scope ?? model.root;
  const scopeRel = scope === null || model.root === null ? null : relativePath(model.root, scope) || folderName(scope);
  // Bumped by a rename from the rail (M9 fix 618), so a hit reads the new
  // name at once rather than at the next keystroke; not by the watcher,
  // since a search is a walk of the tree.
  const [searchTick, setSearchTick] = useState(0);
  // With Changed on, a names filter runs over the flat list itself
  // (M9 fix 70) and no search is asked for.
  const search = useSearch(searchRoot, filesChanged && mode === 'names' ? '' : needle, mode, searchTick);
  // Bumped by every re-list so the git colours are fetched with it.
  const [refreshTick, setRefreshTick] = useState(0);
  const git = useGitStatus(model.root, refreshTick);
  const changes = useGitChanges(model.root, refreshTick);
  const changed = indexChanges(changes);
  const { rows: treeRows, open } = walk(model);
  const rows = withPending(treeRows, model.root, pending);
  // The open set as a string so the effect below runs only when a folder
  // opens or closes, not on every listing that arrives.
  const openKey = open.join('\n');
  const openRef = useRef(open);
  openRef.current = open;
  // The order the folders were opened in, for the watch's order (fix 523).
  const expandedRef = useRef(model.expanded);
  expandedRef.current = model.expanded;
  // The folders of the open file tabs are watched too, so a file view
  // hears about a change to its file (FileView.tsx); they are not listed.
  // M9 fix 337: a file opened in a pane with no tab of its own (M9 fix
  // 180) never joins tabs.files, so its folder comes from the layout's
  // panes directly, or its notice never showed.
  const paneFolders = layoutForFocus === null ? [] : filePaneFolders(layoutForFocus);
  const tabFolders = [...new Set([...tabs.files.filter((f) => !isDocument(f)).map(parentPath), ...paneFolders])];
  const tabKey = tabFolders.join('\n');
  const tabFoldersRef = useRef(tabFolders);
  tabFoldersRef.current = tabFolders;

  // The followed root moving puts the rail back on following (fix 332).
  useEffect(() => {
    liftChain.current = [];
    setLift(null);
  }, [root]);
  useEffect(() => {
    setModel((m) => setRoot(m, shown));
    keepSearchScopeUnder(shown);
    // A box open on the folder the rail just left has nowhere to go.
    setPending(null);
    setRenaming(null);
  }, [shown]);

  // M9 fix 574: Escape on the tree hands the keyboard back to the
  // terminal, as the filter box does, except the Escape that closes a
  // menu, which leaves the tree holding it. The Escape that closes a menu
  // is read off `menuOpen()` (M9 fix 589), since this listener runs before
  // the menu's.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || document.activeElement !== listRef.current || menuOpen()) return;
      focusTerminal();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  const list = (dir: string) =>
    window.emerald.files
      .list(dir, liftKeep(liftChain.current, dir))
      .then((listing: FileListing) => {
        setModel((m) => applyListing(m, dir, listing));
        return listing;
      })
      .catch((err: unknown) => {
        console.warn(`[emerald] could not list ${dir}`, err);
        return undefined;
      });

  // A folder is listed the first time it is open on screen; the main
  // process watches exactly the open set.
  useEffect(() => {
    for (const dir of openRef.current) {
      if (!model.listings.has(dir)) void list(dir);
    }
    void window.emerald.files
      .watch(watchOrder(openRef.current, expandedRef.current, tabFoldersRef.current))
      .catch((err: unknown) => console.warn('[emerald] files watch failed', err));
    // Only a change to what is open re-runs this, not a listing landing.
  }, [openKey, tabKey]);

  useEffect(
    () =>
      window.emerald.files.onChanged((dir, info) => {
        // A push with only content changes (M9 fix 551) leaves the
        // listing alone, since it holds names and kinds only; a git push
        // carries no info and relists.
        if (info?.renamed === false) return;
        if (openRef.current.includes(dir)) void list(dir);
      }),
    [],
  );

  // The Refresh button's work: every open folder that has a listing is
  // listed again (the effect above lists the ones that have none), and the
  // git status comes with it.
  const listingsRef = useRef(model.listings);
  listingsRef.current = model.listings;
  const relist = () => {
    for (const dir of openRef.current) {
      if (listingsRef.current.has(dir)) void list(dir);
    }
    setRefreshTick((t) => t + 1);
  };
  // Keyed on the pane id, so a click in the pane one is already in does
  // nothing. When the focus also moves the root, the model has not caught
  // up on the first run and the run when it has is the one that counts;
  // that is also where a folder listed before, then shown again, gets its
  // fresh listing (the effect above leaves it alone since it has one).
  useEffect(() => {
    if ((shown === null ? null : normalizePath(shown)) !== model.root) return;
    relist();
  }, [focusedPaneId, model.root]);
  // The window coming back to the front: a session finishes while one is
  // elsewhere. Element focus does not bubble, so this is the window alone.
  const relistRef = useRef(relist);
  relistRef.current = relist;
  useEffect(() => {
    const onFocus = () => relistRef.current();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Reveal in Files (M9 fix 652). A new request puts the tree on screen
  // (Changed off, the filter cleared, a lift that does not hold the file
  // dropped) and is noted with its deadline; every model change after it
  // reads where it stands, opens the file's folders while it waits on the
  // root or a listing, and either shows the row (selected, scrolled to,
  // flashed once) or says it cannot. The timer only wakes the read at the
  // deadline, since nothing else may change by then.
  const revealing = useRef<{ path: string; seq: number; until: number; relist: 'none' | 'pending' | 'done'; fresh: Map<string, FileListing> } | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  // The n alternates the row's data-flash between 'a' and 'b' (M9 fix 684),
  // so a second reveal on a row still flashing restarts the animation: a
  // changed animation-name restarts it where a changed value under one
  // rule does not. flashSeq is never reset, so two reveals always differ.
  const [flashRow, setFlashRow] = useState<{ path: string; n: number } | null>(null);
  const flashSeq = useRef(0);
  const [scrollToRow, setScrollToRow] = useState<string | null>(null);
  const revealSeq = revealFile?.seq ?? null;
  useEffect(() => {
    if (revealFile === null) return;
    const { path, seq } = revealFile;
    setFilesChanged(false);
    setNeedle('');
    if (lift !== null && !isUnder(lift, path)) {
      liftChain.current = [];
      setLift(null);
    }
    revealing.current = { path, seq, until: Date.now() + REVEAL_IN_FILES_MS, relist: 'none', fresh: new Map() };
    setRevealTick((t) => t + 1);
    const timer = setTimeout(() => setRevealTick((t) => t + 1), REVEAL_IN_FILES_MS + 20);
    return () => clearTimeout(timer);
  }, [revealSeq]);
  useEffect(() => {
    const r = revealing.current;
    if (r === null) return;
    const step = revealStep(model, r.path);
    if (step.kind === 'shown') {
      revealing.current = null;
      setModel((m) => select(m, step.row));
      setFlashRow({ path: step.row, n: ++flashSeq.current });
      setScrollToRow(step.row);
      clearRevealFile(r.seq);
      return;
    }
    if (Date.now() >= r.until) {
      revealing.current = null;
      flashCornerNote('Not in the Files rail');
      clearRevealFile(r.seq);
      return;
    }
    if (step.kind === 'missing') {
      // A folder listed before and closed since keeps a stale listing, so
      // a file made meanwhile reads as missing; list the file's listed
      // folders once more before saying so (M9 fix 683).
      if (r.relist === 'pending') return;
      if (r.relist === 'none') {
        r.relist = 'pending';
        const dirs = [...model.listings.keys()].filter((d) => isUnder(d, r.path));
        void Promise.all(dirs.map((d) => list(d))).then((got) => {
          if (revealing.current !== r) return;
          dirs.forEach((d, i) => {
            const l = got[i];
            if (l !== undefined) r.fresh.set(d, l);
          });
          r.relist = 'done';
          setRevealTick((t) => t + 1);
        });
        return;
      }
      // The render the tick causes can still hold the model from before the
      // fresh listings were applied (seen in verify:files: a file made while
      // the folder was closed said Not in the Files rail), so it says so only
      // once every fresh listing is in the model; their arrival runs this
      // effect again, and the deadline above ends a wait that never ends.
      for (const [d, l] of r.fresh) {
        if (model.listings.get(d) !== l) return;
      }
      revealing.current = null;
      flashCornerNote('Not in the Files rail');
      clearRevealFile(r.seq);
      return;
    }
    // Outside (the root has not moved to the file's repository yet) or
    // waiting: open what is known to be on the way and wait for the
    // listings the open set asks for.
    const open = step.kind === 'waiting' ? step.open : undefined;
    if (open !== undefined && !model.expanded.has(open)) setModel((m) => expandFolder(m, open));
  }, [model, shown, revealTick]);
  // The scroll waits for the row to be in the DOM, so it is a layout
  // effect after every render until the row is there.
  useLayoutEffect(() => {
    if (scrollToRow === null) return;
    const el = listRef.current?.querySelector(`.files-row[data-path="${CSS.escape(scrollToRow)}"]`);
    if (el === null || el === undefined) return;
    el.scrollIntoView({ block: 'nearest' });
    setScrollToRow(null);
  });
  useEffect(() => {
    if (flashRow === null) return;
    const timer = setTimeout(() => setFlashRow(null), REVEAL_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashRow]);

  if (filesCollapsed) {
    return (
      <div className="files-rail-collapsed">
        <button className="files-expand" title="Show files (Ctrl+Shift+F)" onClick={toggleFiles} onMouseDown={(ev) => ev.preventDefault()}>
          «
        </button>
        <span className="files-rail-label" onClick={toggleFiles}>
          Files
        </span>
      </div>
    );
  }
  const onContextMenu = (ev: React.MouseEvent, path: string, kind: FileEntry['kind'], from: MenuFrom = 'row') => {
    ev.preventDefault();
    setMenu({ path, kind, x: ev.clientX, y: ev.clientY, from });
  };
  // The folder the header names, the lift while one is up (`model.root`
  // follows `shown`); it leaves the keyboard where it was, no
  // `focusTree`, no selection (M9 fix 588).
  const onRootMenu = (ev: React.MouseEvent) => {
    if (model.root === null) return;
    onContextMenu(ev, model.root, 'dir', 'root');
  };
  // A click on a file opens it in a tab (and selects it); a click on a
  // folder toggles it, so the two clicks of a double click cancel out and
  // one more puts it where a double click on a folder is expected to
  // leave it.
  // A contents hit brings its line (M27), and the tab opens there.
  // M9 fix 203: the single click opens into the preview tab, which the
  // next single click reuses; the double click on a file pins it (the
  // two clicks before it previewed the same file, so the pin lands on
  // the tab that is open). Open in a tab from the row's menu pins.
  const onOpen = (path: string, kind: FileEntry['kind'], line?: number, column?: number) => {
    setModel((m) => (kind === 'dir' ? toggleFolder(m, path) : select(m, path)));
    if (kind === 'file') openPreviewTab(path, line, column);
  };
  const onDoubleClick = (path: string, kind: FileEntry['kind']) => {
    if (kind === 'dir') setModel((m) => toggleFolder(m, path));
    else pinFileTab(path);
  };
  // M9 fix 199: a changed row's letter, or Show diff on its menu, opens
  // the file in the review tab, the focused session's when there is one
  // and the folder's otherwise (a view pane's rail, a folder whose
  // session has gone). The file is named the way the review lists it,
  // relative to the repository's root with forward slashes, which the
  // changes list already carries. A row with no letter (an untracked
  // file) offers neither: its letter cell is empty, and the menu keeps
  // to what the cell says.
  const showDiff = (p: string) => {
    const f = changedAt(changed, p);
    if (f === undefined || changes.root === null) return;
    if (focused !== null) openReviewTab(focused.id, f.rel);
    else openFolderReviewTab(changes.root, f.rel);
  };
  const diffOf = (p: string) => {
    const f = changedAt(changed, p);
    return f === undefined || letterFor(f.code) === null ? undefined : () => showDiff(p);
  };
  // M9 fix 310: Revert changes on a changed file's menu, the index and
  // the work tree back to HEAD's version, whole. A file HEAD does not
  // have (untracked, or added and not yet committed) has nothing to go
  // back to, and the item says so, disabled. The revert asks the rail's
  // git reads to run again at once, so the row's letter goes within a
  // tick rather than at the next poll; an open tab or review diff of
  // the file rereads through the watcher.
  const revertOf = (p: string): RevertItem | undefined => {
    const f = changedAt(changed, p);
    if (f === undefined || changes.root === null) return undefined;
    const root = changes.root;
    if (f.code.startsWith('?') || f.code.startsWith('A')) return { reason: 'Nothing to go back to: this file has no committed version', revert: null };
    return {
      reason: null,
      revert: () =>
        void window.emerald.files
          .gitRevert(root, f.rel)
          .then((ok) => {
            if (!ok) console.warn(`[emerald] revert of ${f.rel} refused`);
            relist();
          })
          .catch((err: unknown) => console.warn('[emerald] revert failed', err)),
    };
  };
  // M9 fix 617: Delete on a row's menu, to the recycle bin, wherever
  // Rename shows. Disabled, the reason on the item, on a folder a session
  // stands in, a file with unsaved edits in a tab and a folder holding
  // one; read once when the menu renders. Moved or already gone, the
  // entry's scheme picks, tabs and file panes go and the tree, the hits
  // and the Changed list read again at once; a refusal says so in the
  // corner and leaves everything where it was.
  const trashOf = (p: string, kind: FileEntry['kind']): TrashItem => {
    if (kind === 'dir' && sessionInFolder(p, getState().sessions.values())) return { reason: refusalWords('in-use', true), trash: null };
    if (kind === 'file' && isDirty(p)) return { reason: 'Unsaved edits in a tab: save or discard them first', trash: null };
    if (kind === 'dir' && [...dirtyFiles()].some((key) => renamedPath(key, p, p) !== null)) return { reason: 'A file under it has unsaved edits in a tab: save or discard them first', trash: null };
    return {
      reason: null,
      trash: () =>
        void window.emerald.files
          .trash(p)
          .then((r) => {
            if (!r.ok && r.reason === 'refused') {
              flashCornerNote(`${folderName(p)} could not go to the recycle bin`);
              return;
            }
            dropFileSchemes(p);
            closeFileTabsUnder(p);
            void editLayout((l) => deletedFilePanes(l, p)).catch((err: unknown) => console.warn('[emerald] closing the file panes after a delete failed', err));
            list(parentPath(p));
            setRefreshTick((t) => t + 1);
            setSearchTick((t) => t + 1);
          })
          .catch((err: unknown) => {
            console.warn('[emerald] delete failed', err);
            flashCornerNote(`${folderName(p)} could not go to the recycle bin`);
          }),
    };
  };
  // M9 fix 180: a file row can be picked up and dropped on a pane, and
  // the row menu offers the same, once the daemon keeps the kind.
  const filesDrag = fileViewSupported(daemon);
  // M9 fix 309: New file or New folder from a folder's menu or the
  // header's +. The folder opens if it was closed, so the box is seen,
  // and the box is the folder's first row. Enter with a name asks the
  // main process, which never writes over what is there: a name taken
  // (or one with a slash in it, which would be a path) keeps the box
  // open with the reason on the row; a made file opens in a tab the way
  // a click on its row would, and a made folder opens in the tree. The
  // watcher on the folder lists the new entry on its own.
  const startNew = (dir: string, kind: FileEntry['kind']) => {
    const key = normalizePath(dir);
    if (key !== model.root) setModel((m) => expandFolder(m, key));
    setRenaming(null);
    setPending({ dir: key, kind, name: '', refused: null, tries: 0 });
  };
  const finishNew = (name: string | null) => {
    if (pending === null) return;
    if (name === null || name === '') {
      setPending(null);
      return;
    }
    const refuse = (why: PendingBox['refused']) => setPending((p) => (p === null ? null : { ...p, name, refused: why, tries: p.tries + 1 }));
    if (/[\\/]/.test(name)) {
      refuse('name');
      return;
    }
    const target = joinPath(pending.dir, name);
    const made = pending.kind === 'dir' ? window.emerald.files.mkdir(target) : window.emerald.files.create(target);
    void made
      .then((r) => {
        if (!r.ok) {
          refuse(r.reason);
          return;
        }
        setPending(null);
        if (pending.kind === 'dir') setModel((m) => expandFolder(m, target));
        else openFileTab(target);
      })
      .catch((err: unknown) => {
        console.warn('[emerald] new entry failed', err);
        refuse('refused');
      });
  };
  // M9 fix 574: Rename from a row's menu, or F2 on the selected row while
  // the tree holds the keyboard. The box stands in for the row with the
  // stem of a file's name selected. Enter asks the main process, which
  // never renames over what is there: a taken name, one with a slash or
  // a refusal keeps the box open with the reason on the row. A rename
  // moves the open tabs, their unsaved edits and the tree's open folders
  // and selection with it, before the watcher's relist lands.
  const startRename = (path: string, kind: FileEntry['kind']) => {
    setPending(null);
    setModel((m) => select(m, path));
    setRenaming({ path: normalizePath(path), kind, name: folderName(path), refused: null, tries: 0 });
  };
  const finishRename = (name: string | null) => {
    if (renaming === null) return;
    const from = renaming.path;
    if (name === null || name === '' || name === folderName(from)) {
      setRenaming(null);
      focusTree();
      return;
    }
    const refuse = (why: RenameBoxState['refused']) => setRenaming((r) => (r === null ? null : { ...r, name, refused: why, tries: r.tries + 1 }));
    if (/[\\/]/.test(name)) {
      refuse('name');
      return;
    }
    const to = joinPath(parentPath(from), name);
    const kind = renaming.kind;
    void window.emerald.files
      .rename(from, to)
      .then((r) => {
        if (!r.ok) {
          if (r.reason === 'exists') refuse('exists');
          else refuse(r.busy && kind === 'dir' && sessionInFolder(from, getState().sessions.values()) ? 'in-use' : 'refused');
          return;
        }
        setRenaming(null);
        // The order is pinned: prune (monaco.ts) disposes a held model no
        // tab lists, so the models move before the tabs do; the file panes
        // move last, through the layout, their models handed over
        // meanwhile (M9 fix 591).
        const handed = renameModels(from, to);
        renameFileSchemes(from, to);
        renameFileTabs(from, to);
        void editLayout((l) => renameFilePanes(l, from, to)).catch((err: unknown) => {
          console.warn('[emerald] moving the file panes after a rename failed', err);
          endHandover(handed);
        });
        setModel((m) => renameInModel(m, from, to));
        list(parentPath(from));
        // M9 fix 618: the search and the Changed list read again at once,
        // so a renamed hit or Changed row shows its new name.
        setSearchTick((t) => t + 1);
        setRefreshTick((t) => t + 1);
        focusTree();
      })
      .catch((err: unknown) => {
        console.warn('[emerald] rename failed', err);
        refuse('refused');
      });
  };
  // F2 alone, on the tree itself while it shows, with no box up, renames
  // the selected row (M9 fix 574). A key inside a name box stops there.
  const onTreeKey = (ev: React.KeyboardEvent) => {
    if (ev.target !== ev.currentTarget || ev.key !== 'F2' || ev.ctrlKey || ev.altKey || ev.shiftKey || ev.metaKey) return;
    if (search !== null || filesChanged || pending !== null || renaming !== null || model.selected === null) return;
    const row = rows.find((r) => r.type === 'entry' && r.path === model.selected);
    if (row === undefined || row.type !== 'entry') return;
    ev.preventDefault();
    startRename(row.path, row.kind);
  };
  return (
    <div className="files-rail" style={{ width: filesWidth }} data-root={model.root ?? undefined} data-tab={railTab} data-changed={filesChanged || undefined}>
      <FilesResizer width={filesWidth} />
      <RailTabs active={railTab} changed={git.files.filter((f) => f.status !== 'ignored').length} dragFolder={viewsSupported(daemon) ? root : null} />
      {railTab === 'history' && <HistoryPanel />}
      {railTab === 'timeline' && <ActivitySection folder={root} scope={activityScope} onScope={setActivityScope} unit={activityUnit} onUnit={setActivityUnit} place="rail" />}
      {railTab === 'timeline' && (
        <CommitsPanel
          folder={commitsRoot}
          branch={focused?.branch ?? null}
          createdAt={focused?.createdAt ?? null}
          tick={refreshTick}
          // M9 fix 178: the tab and the pane open as a snapshot of this
          // panel; an older daemon drops the record's state, so the pane
          // then opens bare and keeps the shared prefs as before.
          onExpand={(dir, state) => openFileTab(commitsPath(dir, commitsQuery(state)))}
          onOpenPane={viewsSupported(daemon) ? (dir, state) => void openViewBeside(commitsView(dir, viewStateSupported(daemon) ? state : null)).catch((err: unknown) => console.warn('[emerald] commits in a pane failed', err)) : undefined}
        />
      )}
      {railTab === 'files' && (
        <>
      <div className="files-header">
        {model.root !== null && parentPath(model.root) !== model.root && (
          <button
            className="files-button files-up"
            title={`Up to ${pathLabel(parentPath(model.root))}`}
            onClick={() => {
              // The old root stays open as a row of the parent's tree
              // (setRoot keeps the expanded set, and the root itself was
              // never in it).
              const from = model.root!;
              liftChain.current = [...liftChain.current, from];
              setModel((m) => expandFolder(m, from));
              setLift(parentPath(from));
            }}
            onMouseDown={(ev) => ev.preventDefault()}
          >
            <UpIcon />
          </button>
        )}
        {model.root !== null && <FolderIcon />}
        {lift !== null ? (
          // M9 fix 365: the header names the lift, since that is what the
          // rail shows; a click is the way back down to the folder it
          // follows, which the effect above still computes even while a
          // lift covers it.
          <button
            className="files-root"
            data-lift=""
            title="Back to the folder the rail follows"
            onClick={() => {
              liftChain.current = [];
              setLift(null);
            }}
            onMouseDown={(ev) => ev.preventDefault()}
            onContextMenu={onRootMenu}
          >
            {pathLabel(lift)}
          </button>
        ) : (
          <span className="files-root" title={model.root ?? undefined} onContextMenu={onRootMenu} onMouseDown={(ev) => ev.preventDefault()}>
            {model.root === null ? 'Files' : pathLabel(model.root)}
          </span>
        )}
        {model.root !== null && git.head !== null && (
          <span className="files-branch" title={`Branch of ${model.root}`}>
            <BranchIcon />
            <span className="files-branch-name">{git.head}</span>
          </span>
        )}
        <button className="files-button" title="Collapse all folders" onClick={() => setModel(collapseAll)} onMouseDown={(ev) => ev.preventDefault()}>
          <CollapseIcon />
        </button>
        {model.root !== null && (
          <button
            ref={newButton}
            className="files-button files-new"
            title="New file or folder at the root"
            onClick={() => {
              const r = newButton.current?.getBoundingClientRect();
              setNewMenu(newMenu !== null || r === undefined ? null : { x: r.left, y: r.bottom + 2 });
            }}
            onMouseDown={(ev) => ev.preventDefault()}
          >
            +
          </button>
        )}
        <button className="files-button" title="Refresh" onClick={relist} onMouseDown={(ev) => ev.preventDefault()}>
          <RefreshIcon />
        </button>
      </div>
      {model.root !== null && (
        <FilterBox
          value={needle}
          onChange={setNeedle}
          mode={mode}
          onMode={setMode}
          scope={scopeRel}
          onClearScope={() => setScope(null)}
          changed={filesChanged}
          onChanged={setFilesChanged}
          onClear={() => {
            setNeedle('');
            setScope(null);
          }}
          inputRef={filterInput}
        />
      )}
      {/* M9 fix 588: a right-click anywhere in the list that is not a row
          (the blank space under the rows, a note, an empty line) opens the
          folder's menu, in every view (the tree, the hits and the Changed
          list), since the menu is about the folder; a row's own handler
          opens the row's menu, and the rename and new-entry rows
          (`files-row` too) keep the right-click to their box. The list's
          `tabIndex={-1}` would take the keyboard on any press, so the right
          button's press is stopped here (the left button's is left as it
          is). */}
      <div
        className="files-list"
        ref={listRef}
        tabIndex={-1}
        onKeyDown={onTreeKey}
        onContextMenu={(ev) => {
          if (ev.target instanceof Element && ev.target.closest('.files-row') !== null) return;
          onRootMenu(ev);
        }}
        onMouseDown={(ev) => {
          if (ev.button === 2 && !(ev.target instanceof Element && ev.target.closest('.files-row') !== null)) ev.preventDefault();
        }}
      >
        {model.root === null && <div className="files-empty">No session in this pane</div>}
        {search === null && !filesChanged && rows.length === 0 && rootIsEmpty(model) && (
          <div className="files-empty" data-empty="folder">
            Empty folder
          </div>
        )}
        {search === null &&
          !filesChanged &&
          rows.map((row) =>
            row.type === 'pending' ? (
              <PendingRow key={`${row.dir}#new`} row={row} box={pending} onDone={finishNew} />
            ) : row.type === 'entry' && renaming !== null && row.path === renaming.path ? (
              <RenamingRow key={`${row.path}#rename`} row={row} box={renaming} onDone={finishRename} />
            ) : (
            <FileRow
              key={row.type === 'entry' ? row.path : `${row.path}#${row.text}`}
              row={row}
              status={row.type === 'entry' ? statusAt(git.index, row.path, git.codes) : undefined}
              letter={row.type === 'entry' && row.kind === 'file' ? letterAt(git.codes, row.path) : null}
              counts={row.type === 'entry' && row.kind === 'file' ? countsAt(changed, row.path) : null}
              folder={row.type === 'entry' && row.kind === 'dir' ? folderCounts(changes, row.path) : null}
              touched={row.type !== 'entry' ? [] : row.kind === 'file' ? touchedAt(touched, row.path) : row.expanded ? [] : touchedUnder(touched, row.path)}
              onShowDiff={row.type === 'entry' && row.kind === 'file' ? diffOf(row.path) : undefined}
              selected={row.type === 'entry' && row.path === model.selected}
              onClick={(ev) => {
                if (row.type !== 'entry') return;
                // M9 fix 574: a second click on the selected file puts the
                // keyboard on the tree for F2; the second click of a double
                // click (detail 2) does not count.
                const again = row.kind === 'file' && row.path === model.selected && ev.detail < 2;
                onOpen(row.path, row.kind);
                if (again) focusTree();
              }}
              onDoubleClick={() => row.type === 'entry' && onDoubleClick(row.path, row.kind)}
              onContextMenu={(ev) => {
                if (row.type !== 'entry') return;
                // M9 fix 574: a right-click selects the row, a folder too,
                // and puts the keyboard on the tree for F2.
                focusTree();
                setModel((m) => select(m, row.path));
                onContextMenu(ev, row.path, row.kind);
              }}
              draggable={filesDrag && row.type === 'entry' && row.kind === 'file'}
              flash={row.type === 'entry' && flashRow !== null && row.path === flashRow.path ? (flashRow.n % 2 === 0 ? 'a' : 'b') : undefined}
            />
            ),
          )}
        {search === null && filesChanged && model.root !== null && (
          <ChangedList changes={changes} needle={needle} selected={model.selected} onOpen={onOpen} onContextMenu={onContextMenu} session={focused} draggable={filesDrag} touched={touched} onShowDiff={showDiff} renaming={renaming} onRenameDone={finishRename} />
        )}
        {search !== null && model.root !== null && searchRoot !== null && (
          <SearchHits
            searchRoot={searchRoot}
            scopeRel={scopeRel}
            mode={mode}
            search={search}
            git={git}
            changed={filesChanged ? changed : null}
            selected={model.selected}
            draggable={filesDrag}
            onOpen={onOpen}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            renaming={renaming}
            onRenameDone={finishRename}
          />
        )}
      </div>
      {newMenu !== null && model.root !== null && (
        <Menu
          x={newMenu.x}
          y={newMenu.y}
          onClose={() => setNewMenu(null)}
          className="files-menu files-new-menu"
          data={{ path: model.root }}
          anchor={newButton.current}
          items={newItems(model.root, (dir, kind) => {
            setNewMenu(null);
            startNew(dir, kind);
          })}
        />
      )}
      {menu !== null && model.root !== null && (
        <EntryMenu
          menu={menu}
          root={model.root}
          onClose={() => setMenu(null)}
          onNew={startNew}
          onRename={canEditFrom(menu.from) ? startRename : undefined}
          onFindInFolder={(dir: string | null) => {
            setMode('contents');
            setScope(dir);
            filterInput.current?.focus();
          }}
          onOpenInPane={filesDrag ? (path) => void openViewBeside({ kind: 'file', path: normalizePath(path) }).catch((err: unknown) => console.warn('[emerald] file in a pane failed', err)) : undefined}
          onShowDiff={menu.kind === 'file' ? diffOf(menu.path) : undefined}
          revert={menu.kind === 'file' ? revertOf(menu.path) : undefined}
          trash={canEditFrom(menu.from) ? trashOf(menu.path, menu.kind) : undefined}
        />
      )}
        </>
      )}
    </div>
  );
}

// The tab row at the top of the rail: one button per panel, an icon and
// its word (M9 fix 45: the icons alone said nothing until hovered), with
// the collapse button at the right end so it is in the same place on
// every panel. Since M45 there are Files, Activity (Timeline until M49,
// Commits until M66, and still keyed timeline: the day's strip over the
// repository's commits) and Sessions (the session history, called
// History until M9 fix 83 named it for what the list is and gave it the
// star its rows draw); the Changes tab M45 added folded into Files in M9
// fix 70, its count of changed files now on the Files tab. Three words do
// not fit a narrow rail, so the strip's container query (style.css) drops
// every word at once as the rail narrows; the title says the word either
// way. The Commits tab can be picked up and dropped on a pane (M52), a
// view of the folder the rail is on pinned there; dragFolder is that
// folder, null when the rail is on nothing or the daemon is too old to
// keep a view. Nothing shows until the mouse has moved, so a click still
// switches tabs.
function RailTabs({ active, changed, dragFolder }: { active: RailTab; changed: number; dragFolder: string | null }) {
  const tab = (key: RailTab, label: string, title: string, icon: React.ReactNode, count?: number, onPress?: (ev: React.MouseEvent) => void) => (
    <button
      className="rail-tab"
      data-tab={key}
      data-active={active === key || undefined}
      data-draggable={onPress === undefined ? undefined : ''}
      title={title}
      onClick={() => setRailTab(key)}
      onMouseDown={(ev) => {
        ev.preventDefault();
        onPress?.(ev);
      }}
    >
      {icon}
      <span className="rail-tab-label">{label}</span>
      {count !== undefined && count > 0 && <span className="rail-tab-count">{count}</span>}
    </button>
  );
  const pressCommits = dragFolder === null ? undefined : (ev: React.MouseEvent) => startDrag({ kind: 'view', view: { kind: 'commits', folder: dragFolder } }, ev.nativeEvent, () => {});
  return (
    <div className="rail-tabs">
      {tab('files', 'Files', changed > 0 ? `Files, ${changed} changed in the repository` : 'Files', <FolderIcon />, changed)}
      {tab('timeline', 'Activity', dragFolder === null ? 'What the sessions did: the day\'s time above, the repository\'s commits below' : 'What the sessions did: the day\'s time above, the repository\'s commits below; drag onto a pane to keep this folder\'s there', <TimelineIcon />, undefined, pressCommits)}
      {tab('history', 'Sessions', 'Sessions of Claude Code on this machine', <ClaudeStar size={14} className="files-icon" />)}
      <span className="rail-tabs-spacer" />
      <button className="files-button files-collapse" title="Hide the rail (Ctrl+Shift+F)" onClick={toggleFiles} onMouseDown={(ev) => ev.preventDefault()}>
        »
      </button>
    </div>
  );
}

// A commit line: a dot on a vertical rule, for the Commits tab.
function TimelineIcon() {
  return (
    <svg className="files-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 1.5v3.5M8 11v3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

// Where the menu was opened is MenuFrom (files-model.ts): a tree row, a
// names hit, a contents hit, a Changed row, a deleted file's Changed row
// or the rail's own folder from its name in the header or the list's
// blank space (M9 fixes 588 and 618). The root's menu has no Rename and
// no Copy relative path; Rename shows where canEditFrom says.
interface MenuState {
  path: string;
  kind: FileEntry['kind'];
  x: number;
  y: number;
  from: MenuFrom;
}

// The name box of a new entry (M9 fix 309): what the tree needs to
// place it, the name typed last, why it was turned down (a name already
// there, one with a slash, or a write the main process refused) and a
// count that remounts the box on each refusal so it asks again.
interface PendingBox extends Pending {
  name: string;
  refused: 'exists' | 'name' | 'refused' | null;
  tries: number;
}

// The rename's box (M9 fix 574), in PendingBox's shape: the entry being
// renamed, the name typed last, why it was turned down (a name already
// there, one with a slash, a folder a session stands in, or a rename the
// main process refused) and a count that remounts the box on each
// refusal so it asks again.
interface RenameBoxState {
  path: string;
  kind: FileEntry['kind'];
  name: string;
  refused: 'exists' | 'name' | 'refused' | 'in-use' | null;
  tries: number;
}

// The two items a folder's menu and the header's + share.
function newItems(dir: string, onNew: (dir: string, kind: FileEntry['kind']) => void) {
  return [
    { label: 'New file', title: `An empty file in ${folderName(dir)}, opened in a tab`, onClick: () => onNew(dir, 'file') },
    { label: 'New folder', title: `An empty folder in ${folderName(dir)}`, onClick: () => onNew(dir, 'dir') },
  ];
}

// The row a new entry is named in (M9 fix 309): the chevron slot and the
// kind's icon as a listed row has them, then the box where the name
// goes. A refusal keeps the row, says why on it and puts the box back
// with the name still in it.
function PendingRow({ row, box, onDone }: { row: Extract<Row, { type: 'pending' }>; box: PendingBox | null; onDone: (name: string | null) => void }) {
  const refused = box?.refused ?? null;
  const why = refused === null ? undefined : refusalWords(refused, false);
  return (
    <div className="files-row files-pending" style={{ paddingLeft: 8 + row.depth * 14 }} data-kind={row.kind} data-dir={row.dir} data-refused={refused ?? undefined} title={why}>
      <span className="files-chevron">{row.kind === 'dir' ? '▾' : ''}</span>
      <TypeIcon name={box?.name ?? ''} kind={row.kind} expanded={row.kind === 'dir'} />
      <RenameBox key={box?.tries ?? 0} initial={box?.name ?? ''} className="files-rename" onDone={onDone} answerSame />
    </div>
  );
}

// The row an entry is renamed in (M9 fix 574), in PendingRow's shape: the
// chevron slot and the icon, then the box holding the name with a file's
// stem selected. A refusal keeps the row, says why on it and puts the
// box back with the name still in it; a click away keeps what was typed.
function RenamingRow({ row, box, onDone }: { row: Extract<Row, { type: 'entry' }>; box: RenameBoxState; onDone: (name: string | null) => void }) {
  return (
    <div className="files-row files-renaming" style={{ paddingLeft: 8 + row.depth * 14 }} data-path={row.path} data-kind={row.kind} data-refused={box.refused ?? undefined} title={box.refused === null ? undefined : refusalWords(box.refused, true)}>
      <span className="files-chevron">{row.kind === 'dir' ? (row.expanded ? '▾' : '▸') : ''}</span>
      <TypeIcon name={box.name} kind={row.kind} expanded={row.expanded} />
      <RenameBox key={box.tries} initial={box.name} className="files-rename" onDone={onDone} answerSame selectEnd={stemEnd(box.name, row.kind)} />
    </div>
  );
}

// The name box drawn on a names hit or a Changed row (M9 fix 618), in
// RenamingRow's shape with no indent or chevron. A row of its own rather
// than a box inside HitRow or ChangedRow, so a click or a press in the
// box never reaches the row's open or its drag; the list's class stays
// on it, so a read of `.files-hit` or `.files-changed-row` finds it.
function RenamingListRow({ path, kind, className, box, onDone }: { path: string; kind: FileEntry['kind']; className: string; box: RenameBoxState; onDone: (name: string | null) => void }) {
  return (
    <div className={`files-row ${className} files-renaming`} data-path={path} data-kind={kind} data-refused={box.refused ?? undefined} title={box.refused === null ? undefined : refusalWords(box.refused, true)}>
      <TypeIcon name={box.name} kind={kind} />
      <RenameBox key={box.tries} initial={box.name} className="files-rename" onDone={onDone} answerSame selectEnd={stemEnd(box.name, kind)} />
    </div>
  );
}

// The filter: while it holds text the tree gives way to a flat list of
// hits under the root (names, or lines of the files under it), run 150 ms
// after the last keystroke and again when the root or the mode moves.
// null means the tree is showing. A search that is no longer wanted (a
// newer keystroke, a mode or root move, a cleared box, the rail gone) is
// stopped in the main process, so its walk ends rather than running to
// its cap (M9 fix 519), and its reply, if one still comes, is dropped.
function useSearch(root: string | null, needle: string, mode: SearchMode, tick: number): FileSearch | null {
  const [result, setResult] = useState<FileSearch | null>(null);
  const trimmed = needle.trim();
  useEffect(() => {
    if (root === null || trimmed === '') {
      setResult(null);
      return;
    }
    let live = true;
    // Only a search that was asked is stopped: a keystroke inside the
    // 150 ms sends nothing either way.
    let asked = false;
    const timer = setTimeout(() => {
      asked = true;
      void window.emerald.files
        .search(root, trimmed, mode)
        .then((r) => {
          if (live) setResult(r);
        })
        .catch((err: unknown) => console.warn('[emerald] files search failed', err));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
      if (asked) void window.emerald.files.stopSearch().catch(() => {});
    };
  }, [root, trimmed, mode, tick]);
  return root === null || trimmed === '' ? null : result;
}

interface FilterBoxProps {
  value: string;
  onChange: (v: string) => void;
  mode: SearchMode;
  onMode: (mode: SearchMode) => void;
  // The scoped folder relative to the root, or null for the whole tree.
  scope: string | null;
  onClearScope: () => void;
  // Escape and the × clear the text and the scope both.
  onClear: () => void;
  // The Changed toggle (M9 fix 70).
  changed: boolean;
  onChanged: (on: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

// The box, the Names | Contents switch under it with the Changed toggle
// beside it and, while a Find in folder is in force, the scoped folder
// with an × that widens the search back to the root without losing what
// was typed.
function FilterBox({ value, onChange, mode, onMode, scope, onClearScope, onClear, changed, onChanged, inputRef }: FilterBoxProps) {
  const modeButton = (key: SearchMode, label: string, title: string) => (
    <button className="files-mode" data-mode={key} data-active={mode === key || undefined} title={title} onClick={() => onMode(key)} onMouseDown={(ev) => ev.preventDefault()}>
      {label}
    </button>
  );
  return (
    <div className="files-filter">
      <div className="files-filter-box">
        <input
          ref={inputRef}
          className="files-filter-input"
          placeholder={mode === 'names' ? 'Find files' : 'Find in files'}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(ev) => {
            // Escape clears the box and hands the keyboard back to the
            // terminal; neither key should reach a chord.
            if (ev.key === 'Escape') {
              onClear();
              focusTerminal();
            }
            ev.stopPropagation();
          }}
        />
        {value !== '' && (
          <button
            className="files-filter-clear"
            title="Clear"
            onClick={() => {
              onClear();
              focusTerminal();
            }}
            onMouseDown={(ev) => ev.preventDefault()}
          >
            ×
          </button>
        )}
      </div>
      <div className="files-filter-row">
        {modeButton('names', 'Names', 'Match file and folder names')}
        {modeButton('contents', 'Contents', 'Match lines in the files, case-insensitive; .git, node_modules and binary files are skipped')}
        <button
          className="files-mode files-changed-toggle"
          data-active={changed || undefined}
          title="List the repository's changed files alone, with their paths from the root"
          onClick={() => onChanged(!changed)}
          onMouseDown={(ev) => ev.preventDefault()}
        >
          Changed
        </button>
        {scope !== null && (
          <span className="files-scope" title={`Searching under ${scope} only`}>
            <span className="files-scope-name">in {scope}</span>
            <button className="files-scope-clear" title="Search the whole tree" onClick={onClearScope} onMouseDown={(ev) => ev.preventDefault()}>
              ×
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

interface SearchHitsProps {
  // The folder the search ran under, which the hit's name is relative to,
  // and that folder relative to the tree's root (null when they are the
  // same), so a scoped hit still shows its path from the root.
  searchRoot: string;
  scopeRel: string | null;
  mode: SearchMode;
  search: FileSearch;
  git: GitView;
  // With Changed on, only hits in the changed files are listed (M9 fix 70).
  changed: ChangedIndex | null;
  selected: string | null;
  // Whether a file hit can be dragged onto a pane (M9 fix 333), the way
  // a tree row and a Changed row do; a folder hit and a contents hit
  // (the line is not a FilePaneView) never drag.
  draggable: boolean;
  onOpen: (path: string, kind: FileEntry['kind'], line?: number, column?: number) => void;
  onDoubleClick: (path: string, kind: FileEntry['kind']) => void;
  onContextMenu: (ev: React.MouseEvent, path: string, kind: FileEntry['kind'], from: MenuFrom) => void;
  // The rename's box (M9 fix 618), drawn on the names hit it renames.
  renaming: RenameBoxState | null;
  onRenameDone: (name: string | null) => void;
}

// The hit's line with its match in a mark (fix 33), so the row says why
// it is there; the textContent is the plain line still.
function HitText({ text, at, len }: { text: string; at: number | undefined; len: number | undefined }) {
  if (at === undefined || len === undefined || len === 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="files-hit-match">{text.slice(at, at + len)}</mark>
      {text.slice(at + len)}
    </>
  );
}

// A names hit is a row like the tree's; a contents hit adds the line
// number and the line, and there is one per matching line, so the key
// carries the line.
// A hit's row, its own component so the drag's ref is the row's (M9 fix
// 333), as ChangedRow already does. A folder hit does not drag; a
// contents hit carries its line and column on the drag (M9 fix 437), and
// the pane it lands on opens there.
function HitRow({ path, kind, line, col, selected, status, title, draggable, onOpen, onDoubleClick, onContextMenu, children }: { path: string; kind: FileEntry['kind']; line: number | undefined; col: number | undefined; selected: boolean; status: GitStatus | undefined; title: string; draggable: boolean; onOpen: (path: string, kind: FileEntry['kind'], line?: number, column?: number) => void; onDoubleClick: (path: string, kind: FileEntry['kind']) => void; onContextMenu: (ev: React.MouseEvent, path: string, kind: FileEntry['kind']) => void; children: React.ReactNode }) {
  const press = useFilePress(draggable ? path : null, line, col);
  return (
    <div
      className="files-row files-hit"
      data-path={path}
      data-kind={kind}
      data-line={line}
      data-selected={selected || undefined}
      data-git={status}
      data-draggable={draggable || undefined}
      title={title}
      onClick={() => {
        if (!press.swallowClick()) onOpen(path, kind, line, col);
      }}
      onDoubleClick={() => onDoubleClick(path, kind)}
      onContextMenu={(ev) => onContextMenu(ev, path, kind)}
      onMouseDown={press.onMouseDown}
    >
      {children}
    </div>
  );
}

function SearchHits({ searchRoot, scopeRel, mode, search, git, changed, selected, draggable, onOpen, onDoubleClick, onContextMenu, renaming, onRenameDone }: SearchHitsProps) {
  // Hits keep the forward slashes the walk gave them; the scope is a
  // tree path, so it is turned the same way.
  const prefix = scopeRel === null ? '' : scopeRel.replaceAll('\\', '/') + '/';
  const hits = changed === null ? search.hits : search.hits.filter((hit) => changedAt(changed, joinPath(searchRoot, hit.name)) !== undefined);
  return (
    <>
      {hits.length === 0 && <div className="files-empty">{mode === 'names' ? 'No matching names' : changed === null ? 'No matching lines' : 'No matching lines in the changed files'}</div>}
      {hits.map((hit) => {
        const p = joinPath(searchRoot, hit.name);
        const shown = prefix + hit.name;
        const status = statusAt(git.index, p, git.codes);
        const letter = hit.kind === 'file' ? letterAt(git.codes, p) : null;
        if (hit.line === undefined && renaming !== null && normalizePath(p) === renaming.path) {
          return <RenamingListRow key={`${p}#rename`} path={p} kind={hit.kind} className="files-hit" box={renaming} onDone={onRenameDone} />;
        }
        return (
          <HitRow
            key={hit.line === undefined ? p : `${p}:${hit.line}`}
            path={p}
            kind={hit.kind}
            line={hit.line}
            col={hit.col}
            selected={p === selected}
            status={status}
            title={status === undefined ? shown : `${shown} (${status})`}
            draggable={draggable && hit.kind === 'file'}
            onOpen={onOpen}
            onDoubleClick={onDoubleClick}
            onContextMenu={(ev, path, kind) => onContextMenu(ev, path, kind, hit.line === undefined ? 'hit' : 'line')}
          >
            <TypeIcon name={hit.name.slice(hit.name.lastIndexOf('/') + 1)} kind={hit.kind} />
            {hit.kind === 'file' && <GitLetter letter={letter} />}
            <span className="files-name">{shown}</span>
            {hit.kind === 'file' && hit.line === undefined && <Counts text={countsAt(changed, p)} />}
            {hit.line !== undefined && <span className="files-hit-line">{hit.line}</span>}
            {hit.text !== undefined && (
              <span className="files-hit-text" title={hit.text}>
                <HitText text={hit.text} at={hit.at} len={hit.len} />
              </span>
            )}
          </HitRow>
        );
      })}
      {search.truncated && <div className="files-note">{mode === 'names' ? 'Stopped early; type more of the name' : 'Stopped early; type more, or search one folder'}</div>}
    </>
  );
}

// The right-click menu of a row or a hit. Open in a tab is what a click
// does; Open with Windows hands the file to whatever program has it.
// Insert path types the path relative to the root into the focused
// pane's session, quoted when it has a space and with no Enter, the
// quick way to hand a file to Claude.
interface EntryMenuProps {
  menu: MenuState;
  root: string;
  onClose: () => void;
  // Find in folder: a contents search scoped to the folder; null for the
  // root's menu (M9 fix 588): the plain box with no scope, since a scope
  // on the root reads the whole path as its chip.
  onFindInFolder: (dir: string | null) => void;
  // Open in a pane (M9 fix 180): the file as a view beside the focused
  // pane; absent under a daemon that does not keep the kind.
  onOpenInPane?: ((path: string) => void) | undefined;
  // Show diff (M9 fix 199), heading the menu of a changed file; absent
  // on a clean one.
  onShowDiff?: (() => void) | undefined;
  // New file or New folder (M9 fix 309), heading a folder's menu.
  onNew: (dir: string, kind: FileEntry['kind']) => void;
  // Rename (M9 fix 574); since fix 618 on a tree row, a names hit and a
  // Changed row (canEditFrom), the box drawn on the row itself.
  onRename?: ((path: string, kind: FileEntry['kind']) => void) | undefined;
  // Revert changes (M9 fix 310) under Show diff on a changed file;
  // absent on a clean one.
  revert?: RevertItem | undefined;
  // Delete (M9 fix 617), the menu's last item, wherever Rename shows.
  trash?: TrashItem | undefined;
}

// What the menu's Delete has (M9 fix 617), in RevertItem's shape: the
// move to the recycle bin, or null with the reason it cannot.
interface TrashItem {
  reason: string | null;
  trash: (() => void) | null;
}

// What the menu's Revert changes has (M9 fix 310): the revert to run,
// or null with the reason it cannot, on the disabled item's tooltip.
interface RevertItem {
  reason: string | null;
  revert: (() => void) | null;
}

function EntryMenu({ menu, root, onClose, onFindInFolder, onOpenInPane, onShowDiff, onNew, onRename, revert, trash }: EntryMenuProps) {
  // Revert changes asks twice (M9 fix 310): the first click turns the
  // label into the question and keeps the menu open, the second reverts.
  const [revertArmed, setRevertArmed] = useState(false);
  // Delete asks twice the same way (M9 fix 617).
  const [trashArmed, setTrashArmed] = useState(false);
  const rel = relativePath(root, menu.path);
  // The root's own menu (M9 fix 588) types and names the whole path,
  // since its path relative to itself is the whole path or nothing.
  const atRoot = menu.from === 'root';
  const typed = atRoot ? menu.path : rel;
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);
  // M9 fix 370: the main process's clipboard (window.emerald.clipboard),
  // the route Sidebar.tsx's folder heading menu uses since fix 345, not
  // navigator.clipboard, which asks a permission this menu's click does
  // not carry.
  const copy = (text: string) => void window.emerald.clipboard.write(text).catch(warn('copy'));
  const insert = () => {
    const layout = getState().layout;
    const pane = layout === null ? null : findPane(currentTab(layout), currentTab(layout).focusedPaneId);
    if (pane?.sessionId == null) return;
    typeInto(pane.sessionId, typed.includes(' ') ? `"${typed}"` : typed);
  };
  const done = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const renameItems = onRename === undefined ? [] : [{ label: 'Rename', title: 'Rename in place; F2 on the selected row does the same', onClick: done(() => onRename(menu.path, menu.kind)) }];
  // Last and behind a rule, so the items above keep their places.
  const trashItems =
    trash === undefined
      ? []
      : trash.trash === null
        ? [{ label: 'Delete', title: trash.reason ?? undefined, disabled: true, onClick: () => {}, separator: true }]
        : trashArmed
          ? [{ label: 'Delete, to the recycle bin?', title: 'The recycle bin keeps it; Restore there puts it back', onClick: done(trash.trash), separator: true }]
          : [{ label: 'Delete', title: 'Move it to the recycle bin; asks once more', onClick: () => setTrashArmed(true), separator: true }];
  return (
    <Menu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      className="files-menu"
      data={{ path: menu.path, from: menu.from }}
      items={[
        ...(menu.kind === 'file'
          ? [
              ...(onShowDiff === undefined ? [] : [{ label: 'Show diff', title: 'The change to this file in the review tab', onClick: done(onShowDiff) }]),
              ...(revert === undefined
                ? []
                : revert.revert === null
                  ? [{ label: 'Revert changes', title: revert.reason ?? undefined, disabled: true, onClick: () => {} }]
                  : revertArmed
                    ? [{ label: 'Revert, are you sure?', title: 'Throw the change away and put the committed version back', onClick: done(revert.revert) }]
                    : [{ label: 'Revert changes', title: 'Put the file back to its committed version; asks once more', onClick: () => setRevertArmed(true) }]),
              { label: 'Open in a tab', title: 'A tab of its own, kept when the next file is clicked', onClick: done(() => openFileTab(menu.path)) },
              ...renameItems,
              ...(onOpenInPane === undefined ? [] : [{ label: 'Open in a pane', title: 'The file beside the focused pane, in the layout with the shells', onClick: done(() => onOpenInPane(menu.path)) }]),
            ]
          : [
              ...renameItems,
              ...newItems(menu.path, (dir, kind) => done(() => onNew(dir, kind))()),
              {
                label: 'Find in folder',
                title: `Search the lines of the files under ${atRoot ? pathLabel(menu.path) : rel || folderName(menu.path)}`,
                onClick: done(() => onFindInFolder(atRoot ? null : menu.path)),
              },
            ]),
        {
          label: menu.kind === 'dir' ? 'Open in Explorer' : 'Open with Windows',
          title: menu.kind === 'dir' ? 'Open the folder in Explorer' : 'Open with the program Windows has for it',
          onClick: done(() => void window.emerald.files.open(menu.path).catch(warn('open'))),
        },
        { label: 'Reveal in Explorer', onClick: done(() => void window.emerald.files.reveal(menu.path).catch(warn('reveal'))) },
        { label: 'Copy path', title: menu.path, onClick: done(() => copy(menu.path)), separator: true },
        ...(atRoot ? [] : [{ label: 'Copy relative path', title: rel, onClick: done(() => copy(rel)) }]),
        { label: 'Insert path into pane', title: `Type ${typed} into the focused pane`, onClick: done(insert), separator: true },
        ...trashItems,
      ]}
    />
  );
}

// What the rail keeps of the tree's git status: the two lookups the rows
// use and the files themselves for the Changes tab's count (M45). Polled
// on the rail's one git cadence (git-poll.ts); an empty view outside a
// repo, so the rows are plain.
export interface GitView {
  index: StatusIndex;
  codes: CodeIndex;
  files: GitFile[];
  // The branch under the folder in the header's pill (M9 fix 335); null
  // outside a repository.
  head: string | null;
}

const EMPTY_GIT: GitView = { index: new Map(), codes: new Map(), files: [], head: null };

// The changed files (useGitChanges, git-changes-hook.ts) indexed for the
// tree's rows and the Changed list; a row is looked up the way the status
// index keys its paths.
type ChangedIndex = Map<string, ChangedFile>;

function indexChanges(changes: GitChanges): ChangedIndex {
  return new Map(changes.files.map((f) => [f.path.toLowerCase(), f]));
}

function changedAt(changed: ChangedIndex, p: string): ChangedFile | undefined {
  return changed.get(normalizePath(p).toLowerCase());
}

function countsAt(changed: ChangedIndex | null, p: string): string | null {
  if (changed === null) return null;
  const f = changedAt(changed, p);
  return f === undefined ? null : countsText(f.added, f.removed);
}

function useGitStatus(root: string | null, tick: number): GitView {
  return useGitPoll(
    root,
    tick,
    EMPTY_GIT,
    (dir) => window.emerald.files.gitStatus(dir).then((r) => ({ index: indexStatuses(r.statuses), codes: indexCodes(r.files ?? []), files: r.files ?? [], head: r.head ?? null })),
    'git status',
    '',
    // The head and the status lines (M9 fix 354): an unchanged status
    // keeps the view object, so nothing keyed on it re-renders per poll.
    (v) => [v.head, ...v.files.map((f) => `${f.code} ${f.path}`)].join('\n'),
  );
}

interface FileRowProps {
  // A listed row or a note; the name box of a new entry is PendingRow's.
  row: Exclude<Row, { type: 'pending' }>;
  status: GitStatus | undefined;
  // The status column's letter (M45), null for a clean or untracked file.
  letter: string | null;
  // The `+N −M` of a changed file (M9 fix 70), null when the diff has
  // no numbers for it.
  counts: string | null;
  // A folder row's rollup of the changed files under it (M9 fix 197),
  // null for a file or a folder with nothing changed beneath.
  folder: FolderCounts | null;
  // The sessions that wrote the file (M9 fix 198), or anything under a
  // folded folder; empty for none.
  touched: TouchedBy[];
  // The letter's click (M9 fix 199), on a changed file's row alone.
  onShowDiff?: (() => void) | undefined;
  selected: boolean;
  onClick: (ev: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (ev: React.MouseEvent) => void;
  // Whether a press may become a drag onto a pane (M9 fix 180): a file
  // row under a daemon that keeps the kind; a folder row drags nothing.
  draggable: boolean;
  // The row Reveal in Files just showed (M9 fix 652), flashed once.
  flash?: 'a' | 'b' | undefined;
}

function FileRow({ row, status, letter, counts, folder, touched, onShowDiff, selected, onClick, onDoubleClick, onContextMenu, draggable, flash }: FileRowProps) {
  const indent = { paddingLeft: 8 + row.depth * 14 };
  const press = useFilePress(draggable && row.type === 'entry' ? row.path : null);
  if (row.type === 'note') {
    return (
      <div className="files-note" style={indent} data-path={row.path}>
        {row.text}
      </div>
    );
  }
  return (
    <div
      className="files-row"
      style={indent}
      data-path={row.path}
      data-kind={row.kind}
      data-depth={row.depth}
      data-expanded={row.expanded || undefined}
      data-selected={selected || undefined}
      data-flash={flash}
      data-git={status}
      title={status === undefined ? row.name : `${row.name} (${status})`}
      data-draggable={draggable || undefined}
      onClick={(ev) => {
        if (!press.swallowClick()) onClick(ev);
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      // Keyboard focus stays in the terminal, as with the sidebar; a left
      // press on a file may become a drag onto a pane. A right-click, or a
      // second click on the selected file, puts the keyboard on the tree
      // for F2 (M9 fix 574).
      onMouseDown={press.onMouseDown}
    >
      <span className="files-chevron">{row.kind === 'dir' ? (row.expanded ? '▾' : '▸') : ''}</span>
      <TypeIcon name={row.name} kind={row.kind} expanded={row.expanded} />
      {row.kind === 'file' && <GitLetter letter={letter} onShowDiff={onShowDiff} />}
      <span className="files-name">{row.name}</span>
      {folder === null ? <Counts text={counts} /> : <Counts text={countsText(folder.added, folder.removed)} title={folderCountsTitle(folder)} rollup />}
      <TouchedDots by={touched} />
    </div>
  );
}

// The dots after a row's counts (M9 fix 198): one per session that wrote
// the file, in the session's colour, newest first, so a tree two
// sessions work in says who was where; the tooltip names each and when.
// A folded folder carries the dots of the sessions at work under it.
// Colour means session everywhere else in the app, so the dot wears
// the same --session-color the sidebar's bar and the pane title do.
function TouchedDots({ by }: { by: TouchedBy[] }) {
  if (by.length === 0) return null;
  const now = Date.now();
  const title = by.map((t) => `${t.name} ${formatDuration(t.at, now)} ago${t.agentId === null ? '' : ' (a subagent)'}`).join('\n');
  return (
    <span className="files-touched" title={title}>
      {by.map((t) => (
        <span key={t.sessionId} className="files-touched-dot" data-session={t.sessionId} data-color={t.color ?? undefined} style={t.color === null ? undefined : ({ '--session-color': t.color } as React.CSSProperties)} />
      ))}
    </span>
  );
}

// M9 fix 180: a press on a file row may become a drag onto a pane, the
// file landing there as a view; nothing shows until the mouse has moved,
// so a click is unchanged, and the click that follows a drag released
// on the row is swallowed, as the sidebar's rows do. The press keeps the
// keyboard in the terminal either way. null is a row that does not drag.
// A line (a contents hit, M9 fix 437) rides on the drag and a markdown
// file lands in Raw, as the tab's reveal does, since the rendered view
// has no lines.
function useFilePress(path: string | null, line?: number, column?: number): { onMouseDown: (ev: React.MouseEvent) => void; swallowClick: () => boolean } {
  const dragged = useRef(false);
  return {
    onMouseDown: (ev) => {
      ev.preventDefault();
      dragged.current = false;
      if (path === null || ev.button !== 0) return;
      const file = normalizePath(path);
      const view: PaneView = line !== undefined && defaultView(file) !== null ? { kind: 'file', path: file, view: 'raw' } : { kind: 'file', path: file };
      startDrag({ kind: 'view', view, ...(line === undefined ? {} : { line, column: column ?? 1 }) }, ev.nativeEvent, () => {
        dragged.current = true;
      });
    },
    swallowClick: () => {
      if (!dragged.current) return false;
      dragged.current = false;
      return true;
    },
  };
}

// A row of the Changed list, its own component so the drag's ref is
// the row's (M9 fix 180).
function ChangedRow({ path, status, code, selected, title, draggable, onClick, onContextMenu, children }: { path: string; status: GitStatus; code: string; selected: boolean; title: string; draggable: boolean; onClick: () => void; onContextMenu: (ev: React.MouseEvent) => void; children: React.ReactNode }) {
  const press = useFilePress(draggable ? path : null);
  return (
    <div
      className="files-row files-changed-row"
      data-path={path}
      data-kind="file"
      data-selected={selected || undefined}
      data-git={status}
      data-code={code}
      data-draggable={draggable || undefined}
      title={title}
      onClick={() => {
        if (!press.swallowClick()) onClick();
      }}
      onContextMenu={onContextMenu}
      onMouseDown={press.onMouseDown}
    >
      {children}
    </div>
  );
}

// The line counts at the right of a changed row, `+3 −1` in the diff
// colours; nothing for a clean, an untracked or a binary file. A folder
// row's rollup (M9 fix 197) is the same cell in the muted weight, its
// tooltip counting the files under it; a folder of untracked files alone
// has no numbers and shows nothing, the tooltip with it.
function Counts({ text, title, rollup }: { text: string | null; title?: string; rollup?: boolean }) {
  if (text === null) return null;
  const [added, removed] = text.split(' ');
  return (
    <span className="changes-counts" title={title} data-rollup={rollup || undefined}>
      <span className="changes-added">{added}</span> <span className="changes-removed">{removed}</span>
    </span>
  );
}

interface ChangedListProps {
  changes: GitChanges;
  // The filter box's text, matched against the path.
  needle: string;
  selected: string | null;
  onOpen: (path: string, kind: FileEntry['kind']) => void;
  onContextMenu: (ev: React.MouseEvent, path: string, kind: FileEntry['kind'], from: MenuFrom) => void;
  // The session the rail's root follows (M64), for the Review line at
  // the top of the list; null when the root is a view's folder.
  session: SessionInfo | null;
  // Whether a row can be dropped on a pane (M9 fix 180).
  draggable: boolean;
  // Who wrote each file (M9 fix 198), for the dots after the counts.
  touched: TouchedIndex;
  // A row's letter opens its diff (M9 fix 199).
  onShowDiff: (path: string) => void;
  // The rename's box (M9 fix 618), drawn on the Changed row it renames.
  renaming: RenameBoxState | null;
  onRenameDone: (name: string | null) => void;
}

// The Changed toggle's list (M9 fix 70, what M45's Changes tab was): the
// repo's changed and untracked files flat, each with its path from the
// root for its name, its letter, its counts and the row's colour, sorted
// by path, the ignored ones left out. The rows carry the same data-path
// as the tree's, so a click, the menu and the letter work the same way.
// A deleted file has nothing to open; the row still says it went.
function ChangedList({ changes, needle, selected, onOpen, onContextMenu, session, draggable, touched, onShowDiff, renaming, onRenameDone }: ChangedListProps) {
  const lower = needle.trim().toLowerCase();
  const files = lower === '' ? changes.files : changes.files.filter((f) => f.rel.toLowerCase().includes(lower));
  return (
    <>
      {/* M64: the same changes as a diff to comment on, for the session on
          screen; with no session (M9 fix 199) the folder's own review,
          to read and comment on with nothing to send it to. */}
      {changes.root !== null && changes.files.length > 0 && (
        <button
          className="files-review-line"
          title={session === null ? 'Review the changes in this folder as a diff; no session here to send comments to' : `Review ${session.name}'s changes as a diff and send the comments back as one prompt (Ctrl+Shift+R)`}
          onClick={() => (session === null ? openFolderReviewTab(changes.root!) : openReviewTab(session.id))}
        >
          Review ›
        </button>
      )}
      {changes.root === null && <div className="files-empty">Not a git repository</div>}
      {changes.root !== null && changes.files.length === 0 && <div className="files-empty">No changes</div>}
      {changes.root !== null && changes.files.length > 0 && files.length === 0 && <div className="files-empty">No matching names</div>}
      {files.map((f) => {
        const letter = letterFor(f.code);
        const counts = countsText(f.added, f.removed);
        const deleted = letter === 'D';
        if (!deleted && renaming !== null && normalizePath(f.path) === renaming.path) {
          return <RenamingListRow key={`${f.path}#rename`} path={f.path} kind="file" className="files-changed-row" box={renaming} onDone={onRenameDone} />;
        }
        return (
          <ChangedRow
            key={f.path}
            path={f.path}
            status={f.status}
            code={f.code}
            selected={f.path === selected}
            title={`${f.rel} (${f.status}${counts === null ? '' : `, ${counts}`})`}
            draggable={draggable && !deleted}
            onClick={() => {
              if (!deleted) onOpen(f.path, 'file');
            }}
            onContextMenu={(ev) => onContextMenu(ev, f.path, 'file', deleted ? 'gone' : 'changed')}
          >
            <TypeIcon name={f.rel.slice(f.rel.lastIndexOf('/') + 1)} kind="file" />
            <GitLetter letter={letter} onShowDiff={() => onShowDiff(f.path)} />
            <span className="files-name">{f.rel}</span>
            <Counts text={counts} />
            <TouchedDots by={touchedAt(touched, f.path)} />
          </ChangedRow>
        );
      })}
    </>
  );
}

// The type icon of a row (M9 fix 71): the Material set's SVG for the
// name, coloured as the set draws it; data-icon carries the definition
// name so a script can read which one it is. The outlines below stay for
// the rail tab and the header, where one folder glyph is the point.
function TypeIcon({ name, kind, expanded }: { name: string; kind: FileEntry['kind']; expanded?: boolean }) {
  const { icon, url } = fileIcon(name, kind, expanded === true);
  return <img className="files-icon files-icon-img" src={url} width={14} height={14} alt="" draggable={false} data-icon={icon} />;
}

// The same outline the sidebar's groups use.
function FolderIcon() {
  return (
    <svg className="files-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// The header's up arrow (M9 fix 332).
function UpIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 13V3M4 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M2 4h12M2 8h8M2 12h4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// Dragging the left edge sets the width, the mirror of SidebarResizer.
function FilesResizer({ width }: { width: number }) {
  const [dragging, setDragging] = useState(false);
  const onMouseDown = (ev: React.MouseEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const startX = ev.clientX;
    const startWidth = width;
    setDragging(true);
    document.body.classList.add('dragging-col');
    const onMove = (e: MouseEvent) => setFilesWidth(startWidth - (e.clientX - startX));
    const onUp = (e: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('dragging-col');
      setDragging(false);
      setFilesWidth(startWidth - (e.clientX - startX));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return (
    <div
      className={dragging ? 'files-resizer dragging' : 'files-resizer'}
      onMouseDown={onMouseDown}
      title={`Drag to resize (${SIDEBAR_MIN_WIDTH} to ${SIDEBAR_MAX_WIDTH} px)`}
    />
  );
}
