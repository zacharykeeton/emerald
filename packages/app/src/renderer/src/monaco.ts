import * as monaco from 'monaco-editor/editor/editor.api.js';
// The Monarch grammars for colouring, and the JSON language for the same,
// with almost none of the language services: no TypeScript, CSS or HTML
// workers, and the JSON one down to tokens and document formatting. A
// tab shows a file the way VS Code colours it, and a little more: folding
// (M9 fix 298, the gutter chevron and Ctrl+Shift+[ and ]), formatting (M9
// fix 339, the JSON worker behind a .json file's Pretty view and its Raw
// view's Format button, so it starts on the first .json view rather than
// never, and lives in the JSON language's own worker file, the label
// telling it from the editor's), and since M9 fix 421 the three a read
// tab wants beside those: Ctrl+F's find widget, bracket matching and the
// word highlight on a selected word. Since M9 fix 487 the usual editing
// keys too, since fix 248 made a tab editable: word jumps (Ctrl+Left and
// Right), line moves and copies, comment toggling and multiple cursors,
// imported below ahead of any editor. Every other contribution stays out
// of the app's own choosing; JSON still folds by indentation, not
// `foldingRanges` below. The JSON language's own register.js brings its
// whole contribution list with it regardless (M9 fix 359 found Monaco's
// own context menu among them, told not to show, FileView.tsx,
// contextmenu: false; emerald's own menu, file-menu-model.ts, is the one a
// right-click shows); M9 fix 421 found five more of that list, imported
// here on purpose so their services are ready when the JSON worker
// manager reaches for them (the comment below the format import says
// why), and idle but for suggest, which since M9 fix 634 shows Monaco's own
// word-based completions (registered for every language by the editor
// worker service) in code and JSON files; the app registers no code
// action, code lens or inlay hint provider of its own.
import 'monaco-editor/languages/definitions/register.all.js';
import 'monaco-editor/features/folding/register.js';
import 'monaco-editor/features/format/register.js';
import 'monaco-editor/features/find/register.js';
import 'monaco-editor/features/bracketMatching/register.js';
import 'monaco-editor/features/wordHighlighter/register.js';
// M9 fix 487: without these Ctrl+Left and Ctrl+Right did nothing until the
// first .json view happened to pull the whole contribution list in late.
import 'monaco-editor/features/wordOperations/register.js';
import 'monaco-editor/features/wordPartOperations/register.js';
import 'monaco-editor/features/linesOperations/register.js';
import 'monaco-editor/features/comment/register.js';
import 'monaco-editor/features/multicursor/register.js';
// M9 fix 421: these five register nothing emerald's own JSON language ever
// asks for (no completions, code actions, code lenses or inlay hints are
// registered, so their controllers sit idle; suggest is the exception since
// M9 fix 634: Monaco's word-based provider feeds it in every language, and
// its controller is imported statically below for its colours and
// stylesheet), but the JSON language's own
// worker manager (jsonMode.js, loaded on the first .json model) imports
// them anyway through monaco-editor's internal/common/workers.js, whose
// side-effecting registerSingleton calls land too late for the
// standalone editor's services container once that happens lazily: every
// editor.create then throws instantiating them ("depends on UNKNOWN
// service"), five uncaught errors in main.log on the first file opened.
// Importing them here, synchronously, ahead of the editor's own
// creation, registers their services in time, and the JSON language's
// later import of the same modules is then a no-op (an ES module runs
// its top level once).
import 'monaco-editor/features/codelens/register.js';
import 'monaco-editor/features/inlayHints/register.js';
import 'monaco-editor/features/dropOrPasteInto/register.js';
import 'monaco-editor/features/suggest/register.js';
// M9 fix 634: the suggest controller, its widget, suggest.css and the widget's colours, statically, so they land in the main chunk and the colours register before the first setTheme below; inside the JSON chunk alone they came late, the box had no ground (the theme service writes variables only for colours registered at its last theme change) and before any .json no box at all.
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/features/codeAction/register.js';
import { getWorker as getJsonWorker, jsonDefaults } from 'monaco-editor/languages/features/json/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker';
import type { FileStamp, TextFormat } from '../../preload/api.ts';
import { setEditState, clearEditState, editStateFor, isDirty } from './file-edits.ts';
import { normalizePath, renamedPath } from './files-model.ts';
import { schemeTheme } from './monaco-theme-model.ts';
import type { TerminalScheme } from './scheme-model.ts';
import { isJson } from './tabs-model.ts';
import { getUiState, pinFileTab, subscribeUi } from './ui.ts';

jsonDefaults.setModeConfiguration({
  documentFormattingEdits: true,
  // M9 fix 420: the file menu's Format JSON selection runs
  // editor.action.formatSelection, which needs this on; formatActions.js
  // (imported above) registers the action already.
  documentRangeFormattingEdits: true,
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  tokens: true,
  colors: false,
  foldingRanges: false,
  diagnostics: false,
  selectionRanges: false,
});
// No markers on the editor (diagnostics is off above); the Pretty view
// asks the worker whether the file parses (formatJson below). Comments
// are let through, since a tsconfig.json has them and formats fine.
jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: true,
  comments: 'ignore',
  trailingCommas: 'error',
  schemas: [],
  enableSchemaRequest: false,
  schemaValidation: 'ignore',
  schemaRequest: 'ignore',
});

// The editor worker does links, word highlights and the like off the UI
// thread; without one Monaco runs the same code on the main thread and
// says so once in the console. The JSON language asks by its own label.
window.MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
};
monaco.editor.setTheme('vs-dark');

export { monaco };

// M9 fix 438: a file's own colour scheme colours its syntax too, not
// just its ground. One Monaco theme per scheme (monaco-theme-model.ts
// has the pure token map), defined the first time that scheme is asked
// for and reused after (monaco.editor.defineTheme is cheap to call
// again, but there is no need to); FileView calls setFileTheme with
// whichever file view is focused, so the two functions below are the
// whole of what this file adds for the fix.
const definedThemes = new Set<string>();

export function setFileTheme(scheme: TerminalScheme): void {
  const { name, data } = schemeTheme(scheme);
  if (!definedThemes.has(name)) {
    monaco.editor.defineTheme(name, data);
    definedThemes.add(name);
  }
  monaco.editor.setTheme(name);
}

// One model per open file, kept across tab switches so each keeps its
// scroll position (the view state next to it), and dropped when nothing
// shows it any more. Keyed by the normalized path the tabs use. Since
// M9 fix 248 the file is editable, so the model carries what was last
// read or saved beside it: the alternative version id at that point,
// against which the model is dirty or clean, the text on disk as last
// read (what Reload puts back) and the file's line end and BOM for the
// save. Since M9 fix 525 it carries two stamps of the file (its size and
// mtime): `stamp`, the disk the model last agreed with, which a save
// carries and the main process checks before it writes, and `diskStamp`,
// the one that goes with `disk`, which Reload and Keep mine take on.
interface Held {
  model: monaco.editor.ITextModel;
  savedId: number;
  disk: string;
  format: TextFormat;
  stamp: FileStamp;
  diskStamp: FileStamp;
}
const held = new Map<string, Held>();
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();
// How many views (a tab's, a pane's) show each file right now; a model
// is kept while a tab lists it or a view holds it, so a file in a pane
// with no tab keeps its edits.
const retained = new Map<string, number>();
// Models a rename moved for a file pane whose layout edit has not
// landed yet (M9 fix 591); prune keeps them until the pane's view
// retains the new path.
const handover = new Set<string>();

// The read landed. A file not held yet gets a model; a clean one takes
// the text (as one edit, so the editor keeps its scroll position); a
// dirty one keeps its edits, and other text on disk than the last read
// or save is a conflict the header shows, with the disk text held for
// Reload. The language comes from the path's extension, which is what
// the URI carries; Monaco picks it from the grammars registered above.
// A dirty model whose disk text is the same as before (a touch, or the
// watcher's echo of our own save) takes the read's stamp, since the
// model still agrees with that disk (M9 fix 525).
export function takeRead(path: string, text: string, format: TextFormat, stamp: FileStamp): monaco.editor.ITextModel {
  const key = normalizePath(path);
  const h = held.get(key);
  if (h === undefined) {
    const model = monaco.editor.createModel(text, undefined, monaco.Uri.file(key));
    // A .json file formats in its own indent, two spaces when it has
    // none to read (M9 fix 339).
    if (isJson(key)) model.detectIndentation(true, 2);
    const fresh: Held = { model, savedId: model.getAlternativeVersionId(), disk: text, format, stamp, diskStamp: stamp };
    held.set(key, fresh);
    model.onDidChangeContent(() => refresh(key));
    return model;
  }
  h.format = format;
  if (h.model.getAlternativeVersionId() !== h.savedId) {
    if (!sameText(text, h.disk)) {
      h.disk = text;
      h.diskStamp = stamp;
      setEditState(key, { conflict: true });
    } else {
      h.stamp = h.diskStamp = stamp;
    }
    return h.model;
  }
  replaceText(h.model, text);
  if (isJson(key)) h.model.detectIndentation(true, 2);
  h.disk = text;
  h.stamp = h.diskStamp = stamp;
  h.savedId = h.model.getAlternativeVersionId();
  setEditState(key, { dirty: false, conflict: false });
  return h.model;
}

export function hasModel(path: string): boolean {
  return held.has(normalizePath(path));
}

// The model's text, for the rendered markdown view after a save (M9 fix
// 248), or null while the file has no model.
export function heldText(path: string): string | null {
  return held.get(normalizePath(path))?.model.getValue() ?? null;
}

// A re-read after a change on disk replaces the text as one edit rather
// than setValue, so the editor keeps its scroll position.
export function replaceText(model: monaco.editor.ITextModel, text: string): void {
  if (model.getValue() === text) return;
  model.applyEdits([{ range: model.getFullModelRange(), text }]);
}

// Line ends are the file's business (the save puts them back), so two
// texts that differ only there are the same.
function sameText(a: string, b: string): boolean {
  return a === b || a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
}

function refresh(key: string): void {
  const h = held.get(key);
  if (h === undefined) return;
  const was = isDirty(key);
  setEditState(key, { dirty: h.model.getAlternativeVersionId() !== h.savedId });
  // M9 fix 488: the first edit keeps a preview tab. Here rather than in
  // setEditState because this runs once per content change and the pin
  // is a no-op unless the tab is the preview; the next single rail click
  // would otherwise replace the tab and prune would dispose the edits.
  if (!was && isDirty(key)) pinFileTab(key);
}

// The model's text onto the file. The version id is taken before the
// write, so typing while the disk is busy leaves the model dirty by
// exactly those keystrokes. A refused write keeps the edits and puts the
// reason on the header; the promise rejects too, for the close dialog.
//
// M9 fix 525: the write carries the stamp of the disk the model last
// agreed with, and the main process answers `changed` without writing
// when the file has moved since. The file is then read again: other
// text raises the changed-on-disk line (Reload or Keep mine), the same
// text (a touch) is written once more on the fresh stamp, and a second
// `changed` stops with the line up. Resolves 'changed' for that case,
// never throws for it, so the close dialog keeps the tab open.
export async function saveFile(path: string): Promise<'saved' | 'changed'> {
  const key = normalizePath(path);
  const h = held.get(key);
  if (h === undefined) return 'saved';
  for (let attempt = 0; ; attempt++) {
    const text = h.model.getValue();
    const id = h.model.getAlternativeVersionId();
    let answer;
    try {
      answer = await window.emerald.files.write(path, text, h.format, h.stamp);
    } catch (err) {
      setEditState(key, { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    if ('saved' in answer) {
      h.savedId = id;
      h.disk = text;
      h.stamp = h.diskStamp = answer.saved;
      setEditState(key, { conflict: false, error: null });
      refresh(key);
      return 'saved';
    }
    const r = await window.emerald.files.read(path);
    if (!('text' in r)) {
      setEditState(key, { error: 'Changed on disk; not saved' });
      return 'changed';
    }
    takeRead(path, r.text, { eol: r.eol, bom: r.bom }, r.stamp);
    const dirty = h.model.getAlternativeVersionId() !== h.savedId;
    if (!dirty || editStateFor(key).conflict) return 'changed';
    if (attempt > 0) {
      setEditState(key, { conflict: true });
      return 'changed';
    }
  }
}

// Reload from the header's changed-on-disk line, and Discard from the
// close dialog: the model takes the disk text back and is clean.
export function reloadFromDisk(path: string): void {
  const key = normalizePath(path);
  const h = held.get(key);
  if (h === undefined) return;
  replaceText(h.model, h.disk);
  h.savedId = h.model.getAlternativeVersionId();
  h.stamp = h.diskStamp;
  setEditState(key, { dirty: false, conflict: false, error: null });
}

// Keep mine: the edits stand, the next save writes over what is on disk,
// once and only against the disk as last read (M9 fix 525).
export function keepMine(path: string): void {
  const h = held.get(normalizePath(path));
  if (h !== undefined) h.stamp = h.diskStamp;
  setEditState(path, { conflict: false });
}

export function dismissSaveError(path: string): void {
  setEditState(path, { error: null });
}

export function saveViewState(path: string, state: monaco.editor.ICodeEditorViewState | null): void {
  viewStates.set(normalizePath(path), state);
}

export function viewStateFor(path: string): monaco.editor.ICodeEditorViewState | null {
  return viewStates.get(normalizePath(path)) ?? null;
}

// A view showing the file says so while it is mounted on it, so the
// model outlives the tab list for a file in a pane.
export function retain(path: string): () => void {
  const key = normalizePath(path);
  retained.set(key, (retained.get(key) ?? 0) + 1);
  handover.delete(key);
  return () => {
    const n = (retained.get(key) ?? 1) - 1;
    if (n <= 0) retained.delete(key);
    else retained.set(key, n);
    prune();
  };
}

// A file no tab lists and no view shows takes its model with it, edits
// included, and its Pretty model (M9 fix 339); the close paths ask
// first (ui.ts).
function prune(): void {
  const open = new Set(getUiState().tabs.files);
  for (const [key, h] of held) {
    if (open.has(key) || retained.has(key) || handover.has(key)) continue;
    h.model.dispose();
    held.delete(key);
    viewStates.delete(key);
    clearEditState(key);
    dropPretty(key);
  }
}
subscribeUi(prune);

// The rail's rename (M9 fix 574). A Monaco model's URI is fixed, so each
// held file the rename moves gets a new model at the new path with the
// old one's text, dirty or clean as it was, and its edit state moves with
// it; the undo history does not survive. A model a file pane holds moves
// too and is handed over until the pane's layout edit lands (M9 fix 591).
// Runs before the tabs move, since prune would otherwise dispose a dirty
// background tab's model, edits and all. Returns the keys handed over.
export function renameModels(from: string, to: string): string[] {
  const open = new Set(getUiState().tabs.files);
  const handed: string[] = [];
  for (const [key, h] of [...held]) {
    const next = renamedPath(key, from, to);
    if (next === null || next === key || (!open.has(key) && !retained.has(key))) continue;
    let shown = false;
    for (const ed of monaco.editor.getEditors()) {
      if (ed.getModel() === h.model) {
        viewStates.set(next, ed.saveViewState());
        shown = true;
      }
    }
    if (!shown && viewStates.has(key)) viewStates.set(next, viewStates.get(key) ?? null);
    const model = monaco.editor.createModel(h.model.getValue(), undefined, monaco.Uri.file(next));
    if (isJson(next)) model.detectIndentation(true, 2);
    const dirty = h.model.getAlternativeVersionId() !== h.savedId;
    // An alternative version id is never negative, so -1 keeps the model
    // dirty until a save or a Reload sets savedId.
    held.set(next, { model, savedId: dirty ? -1 : model.getAlternativeVersionId(), disk: h.disk, format: h.format, stamp: h.stamp, diskStamp: h.diskStamp });
    if (!open.has(key)) {
      handed.push(next);
      handover.add(next);
    }
    model.onDidChangeContent(() => refresh(next));
    setEditState(next, editStateFor(key));
    clearEditState(key);
    dropPretty(key);
    viewStates.delete(key);
    held.delete(key);
    h.model.dispose();
  }
  return handed;
}

// The layout edit failed, so no view will take these; they go as any
// unheld model goes (M9 fix 591).
export function endHandover(keys: readonly string[]): void {
  for (const k of keys) handover.delete(k);
  prune();
}

// M9 fix 339: a .json file's Pretty view. A second, read-only model
// beside the file's, keyed pretty: plus the path, holding the file's
// text as the JSON worker formats it (whitespace alone, so the keys keep
// their order and a comment stays), in the file's own indent
// (detectIndentation above, two spaces for a file with none). It is
// recomputed on the file model's changes, debounced, so a Raw edit
// shows in Pretty on the next switch. A file the worker finds a syntax
// error in has no pretty text; the state says so with the message and
// the line, and FileView shows the Raw editor under a notice. The model
// goes with the file's.
export interface PrettyState {
  status: 'pending' | 'ok' | 'invalid';
  // The worker's message and the line it points at, on invalid.
  message: string | null;
  line: number | null;
}
const PRETTY_PENDING: PrettyState = { status: 'pending', message: null, line: null };
interface PrettyHeld {
  model: monaco.editor.ITextModel;
  state: PrettyState;
  // The file model's content listener, disposed with the pretty model.
  listener: monaco.IDisposable;
  timer: ReturnType<typeof setTimeout> | null;
  // Which reformat is the latest; an older one landing is dropped. Also
  // the verify script's counter (M9 fix 358, data-pretty-runs): it only
  // steps inside reformat, so a run held back by prettyLiveCount below
  // never moves it.
  run: number;
  // A Raw edit landed while nobody was live; the next view to go live
  // reformats at once instead of waiting for the next edit.
  stale: boolean;
}
const pretty = new Map<string, PrettyHeld>();
// How many views (a tab's, a pane's) show each file's Pretty tab right
// now, in retain's shape above: more than one can at once (a tab and a
// pane on the same file), so the last one leaving is what goes idle. Not
// prettyShown (FileView.tsx): a file the worker refuses is still live,
// so its own mending reformat can turn Pretty back on (M9 fix 358).
const prettyLiveCount = new Map<string, number>();
const prettyListeners = new Set<() => void>();
const PRETTY_DEBOUNCE_MS = 200;

function emitPretty(): void {
  for (const l of prettyListeners) l();
}

// The pretty model for a file that has a model, made on the first ask
// and formatted at once; null before the file is read.
export function prettyModel(path: string): monaco.editor.ITextModel | null {
  const key = normalizePath(path);
  const p = pretty.get(key);
  if (p !== undefined) return p.model;
  const h = held.get(key);
  if (h === undefined) return null;
  const model = monaco.editor.createModel('', 'json', monaco.Uri.from({ scheme: 'emerald-pretty', path: key }));
  const fresh: PrettyHeld = {
    model,
    state: PRETTY_PENDING,
    listener: h.model.onDidChangeContent(() => schedulePretty(key)),
    timer: null,
    run: 0,
    stale: false,
  };
  pretty.set(key, fresh);
  void reformat(key);
  return model;
}

// FileView calls this in an effect while it shows the Pretty tab, true
// on the way in and false on a view change or unmount (M9 fix 358); a
// Raw edit while the count is at zero holds a stale mark on the pretty
// state instead of running the worker on every debounce, and the count
// going from zero reformats at once, the state held at its last value
// until the new text lands (no `pending` blink).
export function prettyLive(path: string, live: boolean): void {
  const key = normalizePath(path);
  const before = prettyLiveCount.get(key) ?? 0;
  const after = Math.max(0, before + (live ? 1 : -1));
  if (after === 0) prettyLiveCount.delete(key);
  else prettyLiveCount.set(key, after);
  if (before > 0 || after === 0) return;
  const p = pretty.get(key);
  if (p === undefined || !p.stale) return;
  p.stale = false;
  if (p.timer !== null) {
    clearTimeout(p.timer);
    p.timer = null;
  }
  void reformat(key);
}

// The count of reformats the worker has actually run for this file,
// read onto data-pretty-runs; idle time with nobody on Pretty never
// moves it (schedulePretty below holds it off instead of debouncing).
export function prettyRuns(path: string): number {
  return pretty.get(normalizePath(path))?.run ?? 0;
}

function schedulePretty(key: string): void {
  const p = pretty.get(key);
  if (p === undefined) return;
  if ((prettyLiveCount.get(key) ?? 0) === 0) {
    p.stale = true;
    return;
  }
  if (p.timer !== null) clearTimeout(p.timer);
  p.timer = setTimeout(() => {
    p.timer = null;
    void reformat(key);
  }, PRETTY_DEBOUNCE_MS);
}

async function reformat(key: string): Promise<void> {
  const p = pretty.get(key);
  const h = held.get(key);
  if (p === undefined || h === undefined) return;
  const run = ++p.run;
  let next: PrettyState;
  let text: string | null = null;
  try {
    const result = await formatJson(h.model);
    if ('error' in result) next = { status: 'invalid', message: result.error.message, line: result.error.line };
    else {
      text = result.text;
      next = { status: 'ok', message: null, line: null };
    }
  } catch (err) {
    // The worker did not answer; the pretty text is the file's own.
    console.warn('[emerald] JSON format failed', err);
    text = h.model.getValue();
    next = { status: 'ok', message: null, line: null };
  }
  if (pretty.get(key) !== p || p.run !== run) return;
  if (text !== null) {
    const { tabSize, insertSpaces } = h.model.getOptions();
    p.model.updateOptions({ tabSize, insertSpaces });
    // The file's line ends, so a copy out of the Pretty view matches
    // the file's own (a model starts on the platform's, CRLF here).
    p.model.setEOL(h.model.getEOL() === '\n' ? monaco.editor.EndOfLineSequence.LF : monaco.editor.EndOfLineSequence.CRLF);
    replaceText(p.model, text);
  }
  p.state = next;
  emitPretty();
}

function dropPretty(key: string): void {
  const p = pretty.get(key);
  if (p === undefined) return;
  if (p.timer !== null) clearTimeout(p.timer);
  p.listener.dispose();
  p.model.dispose();
  pretty.delete(key);
  prettyLiveCount.delete(key);
  viewStates.delete(prettyKey(key));
  emitPretty();
}

// The view state key the Pretty view saves under, apart from the Raw
// view's, since the two models' lines do not match.
export function prettyKey(path: string): string {
  return `pretty:${normalizePath(path)}`;
}

export function prettyStateFor(path: string): PrettyState {
  return pretty.get(normalizePath(path))?.state ?? PRETTY_PENDING;
}

export function subscribePretty(listener: () => void): () => void {
  prettyListeners.add(listener);
  return () => {
    prettyListeners.delete(listener);
  };
}

// The JSON worker, once the language has set itself up (register.js
// wires the mode on the first json model, a beat after createModel
// returns, and getWorker rejects until then).
async function jsonWorker(): Promise<Awaited<ReturnType<typeof getJsonWorker>>> {
  let last: unknown = null;
  for (let i = 0; i < 40; i++) {
    try {
      return await getJsonWorker();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`JSON worker not ready: ${String(last)}`);
}

// The worker's syntax diagnostics (severity 1 is an error), then its
// formatting edits applied to a copy of the text, in the model's indent.
// The same worker call is what editor.action.formatDocument makes
// through the registered provider, so the Pretty view and the Format
// button agree to the character.
export async function formatJson(model: monaco.editor.ITextModel): Promise<{ text: string } | { error: { message: string; line: number } }> {
  const worker = await jsonWorker();
  const client = (await worker(model.uri)) as unknown as JsonWorkerClient;
  const uri = model.uri.toString();
  const diagnostics = await client.doValidation(uri);
  const error = diagnostics.find((d) => d.severity === 1);
  if (error !== undefined) return { error: { message: error.message, line: error.range.start.line + 1 } };
  const { tabSize, insertSpaces } = model.getOptions();
  const edits = await client.format(uri, null, { tabSize, insertSpaces });
  return { text: applyLspEdits(model.getValue(), edits) };
}

// The two worker methods the language's own providers call, which its
// public IJSONWorker type leaves out (it declares the schema reads
// alone); the shapes are the LSP's.
interface JsonWorkerClient {
  doValidation(uri: string): Promise<{ severity?: number; message: string; range: { start: { line: number } } }[]>;
  format(uri: string, range: null, options: { tabSize: number; insertSpaces: boolean }): Promise<LspEdit[]>;
}

interface LspEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

// LSP edits (zero-based line and character) onto a string, last first so
// the earlier offsets stand.
function applyLspEdits(text: string, edits: LspEdit[]): string {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const offset = (pos: { line: number; character: number }) => (starts[pos.line] ?? text.length) + pos.character;
  const sorted = [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start));
  let out = text;
  for (const e of sorted) out = out.slice(0, offset(e.range.start)) + e.newText + out.slice(offset(e.range.end));
  return out;
}
