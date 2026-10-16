import type { SessionInfo } from '@emerald/shared';
import { promptRefusal } from './prompt-model.ts';
import { normalizePath } from './files-model.ts';
import { DOCUMENT_SCHEME, documentKey, documentQuery, withQuery } from './tabs-model.ts';

// The pure part of the review tab (M64): the comments a person writes on
// a session's changes, the count the header shows, the prompt the
// session receives, and the words on the Send button for each state. The
// tab itself (ReviewTab.tsx) draws these; the comments live per session
// in review-state.ts for the app's run, never on disk.

// A comment on one line of the work tree side of a file: the path as the
// session would type it (relative to its folder, forward slashes), the
// line as the work tree has it, the line's text quoted once so the
// session finds the spot after the file moves under it, and the comment.
export interface ReviewComment {
  rel: string;
  line: number;
  code: string;
  text: string;
}

export interface ReviewState {
  comments: readonly ReviewComment[];
  // The box open under a line, with what has been typed so far; one at
  // a time, and Send keeps it before sending so nothing typed is lost.
  draft: ReviewComment | null;
  // One general comment for what is not about a line.
  general: string;
  generalOpen: boolean;
  // Which base the tab compares against.
  base: ReviewBase;
}

// HEAD is the index and work tree against the last commit; default is the
// branch's whole story since it left main (or master); session is
// everything since the commit the session's conversation started on.
export type ReviewBase = 'head' | 'default' | 'session';

// M9 fix 790: the start commit of the conversation the chat view shows:
// the last span whose conversation is the Claude session id, else the last
// span, else (a record with no spans) the record's own startHead. A found
// span's own null stays null.
export function sessionStartHead(session: Pick<SessionInfo, 'claudeSessionId' | 'spans' | 'startHead'>): string | null {
  const spans = session.spans ?? [];
  if (spans.length === 0) return session.startHead ?? null;
  const span = spans.findLast((s) => s.conversation === session.claudeSessionId) ?? spans[spans.length - 1]!;
  return span.startHead ?? null;
}

// M9 fix 790: the base as gitReview is asked for it. A session base with
// no start commit reads as HEAD.
export function reviewBaseArg(base: ReviewBase, startHead: string | null): string {
  if (base === 'default') return 'default';
  if (base === 'session' && startHead !== null) return `since:${startHead}`;
  return 'HEAD';
}

export const EMPTY_REVIEW: ReviewState = { comments: [], draft: null, general: '', generalOpen: false, base: 'head' };

// A review tab is a document of the app's own (M54's scheme), keyed by
// the session it belongs to, so there is one per session and the strip
// reopens rather than duplicates it. Since M9 fix 199 the path can carry
// the file to show first as a query (`?file=<rel>`, the tab's state the
// way a commits document's is), and a tab opened with no session in the
// folder (a view pane's rail) is keyed by the folder instead:
// `emerald://review/folder/<encoded path>`.
export function reviewPath(sessionId: string, file?: string): string {
  return withQuery(`${DOCUMENT_SCHEME}review/${sessionId}`, reviewFileQuery(file));
}

export function reviewFolderPath(folder: string, file?: string): string {
  return withQuery(`${DOCUMENT_SCHEME}review/folder/${encodeURIComponent(normalizePath(folder))}`, reviewFileQuery(file));
}

// The session a review path names, null for a folder review and for any
// other document. `folder` cannot be a session id: the daemon's ids are
// UUIDs.
export function reviewSessionId(path: string): string | null {
  const m = /^emerald:\/\/review\/(.+)$/.exec(documentKey(path));
  if (m === null || m[1]!.startsWith('folder/')) return null;
  return m[1]!;
}

export function reviewFolder(path: string): string | null {
  const m = /^emerald:\/\/review\/folder\/(.+)$/.exec(documentKey(path));
  if (m === null) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

// The file the tab was asked to show, off a path with a query or off the
// query alone (what tabQuery hands back); null for none.
export function reviewFile(pathOrQuery: string | null): string | null {
  if (pathOrQuery === null) return null;
  const query = pathOrQuery.startsWith(DOCUMENT_SCHEME) ? documentQuery(pathOrQuery) : pathOrQuery;
  if (query === null) return null;
  const file = new URLSearchParams(query).get('file');
  return file === null || file === '' ? null : file;
}

function reviewFileQuery(file: string | undefined): string | undefined {
  return file === undefined || file === '' ? undefined : `file=${encodeURIComponent(file)}`;
}

// The key a folder review's comments live under in review-state.ts, so
// a later open of the same folder finds them; a session review's is
// the session id.
export function reviewFolderKey(folder: string): string {
  return `folder:${normalizePath(folder).toLowerCase()}`;
}

// The draft becomes a kept comment on its line, replacing one already
// there: one comment per line, edited in place. An empty draft keeps
// nothing.
export function keepDraft(state: ReviewState): ReviewState {
  const d = state.draft;
  if (d === null) return state;
  const text = d.text.trim();
  const rest = state.comments.filter((c) => !(c.rel === d.rel && c.line === d.line));
  const comments = text === '' ? rest : [...rest, { ...d, text }].sort(byPlace);
  return { ...state, comments, draft: null };
}

export function removeComment(state: ReviewState, rel: string, line: number): ReviewState {
  return { ...state, comments: state.comments.filter((c) => !(c.rel === rel && c.line === line)) };
}

// Opening the box on a commented line edits that comment.
export function openDraft(state: ReviewState, rel: string, line: number, code: string): ReviewState {
  const existing = state.comments.find((c) => c.rel === rel && c.line === line);
  return { ...state, draft: { rel, line, code, text: existing?.text ?? '' } };
}

function byPlace(a: ReviewComment, b: ReviewComment): number {
  return a.rel === b.rel ? a.line - b.line : a.rel.localeCompare(b.rel);
}

// The header's count: the kept comments plus the draft while something
// is typed in it, so the count never says less than what Send will send.
export function commentCount(state: ReviewState): number {
  return state.comments.length + (state.draft !== null && state.draft.text.trim() !== '' ? 1 : 0);
}

export function commentsOn(state: ReviewState, rel: string): number {
  return state.comments.filter((c) => c.rel === rel).length;
}

export function countText(n: number): string {
  return n === 1 ? '1 comment' : `${n} comments`;
}

// What the session receives, one prompt for the whole review: a block per
// comment in file and line order, and the general comment last when
// there is one. baseName is what the base is called to a reader: HEAD,
// or the default branch's name.
export function reviewPrompt(comments: readonly ReviewComment[], general: string, baseName: string): string {
  const sorted = [...comments].sort(byPlace);
  const files = new Set(sorted.map((c) => c.rel)).size;
  const head = files === 0 ? `Review, against ${baseName}:` : `Review of ${files} ${files === 1 ? 'file' : 'files'}, against ${baseName}:`;
  const blocks = sorted.map((c) => `${c.rel}:${c.line}\n    ${c.code.trim()}\n${c.text.trim()}`);
  const overall = general.trim() === '' ? [] : [`Overall: ${general.trim()}`];
  return [head, ...blocks, ...overall].join('\n\n');
}

// The header's branch line: `⑂ m53 · 3 files, +84 −12`, the counts left
// out when every file is binary or new and untracked.
export function branchLine(branch: string | null, files: readonly { added: number | null; removed: number | null }[]): string {
  const n = files.length;
  const added = files.reduce((sum, f) => sum + (f.added ?? 0), 0);
  const removed = files.reduce((sum, f) => sum + (f.removed ?? 0), 0);
  const count = `${n} ${n === 1 ? 'file' : 'files'}`;
  const counts = files.some((f) => f.added !== null || f.removed !== null) ? `, +${added} −${removed}` : '';
  return `${branch === null ? '' : `⑂ ${branch} · `}${count}${counts}`;
}

// The Send button's state: off at needs-input (a prompt cannot queue
// behind a question) and once the session has exited, live otherwise,
// with a note while the session works since the text lands when the turn
// ends, the same contract as typing into a working pane.
export function sendGate(session: Pick<SessionInfo, 'state'>, count: number): { enabled: boolean; note: string | null } {
  const refusal = promptRefusal(session);
  if (refusal !== null) return { enabled: false, note: refusal };
  if (count === 0) return { enabled: false, note: null };
  return { enabled: true, note: session.state === 'working' || session.state === 'waiting' ? 'queues behind this turn' : null };
}
