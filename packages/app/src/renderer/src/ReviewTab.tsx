import { useEffect, useRef, useState } from 'react';
import { describeState, hasState, markKind, workingMotion } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import type { GitReview, ReviewFile } from '../../preload/api.ts';
import { sendPrompt } from './actions.ts';
import { folderName } from './files-model.ts';
import { countsText } from './git-changes-model.ts';
import { ReviewDiff } from './ReviewDiff.tsx';
import { branchLine, commentCount, commentsOn, countText, keepDraft, reviewFile, reviewFolder, reviewFolderKey, reviewBaseArg, reviewPrompt, reviewSessionId, sendGate, sessionStartHead } from './review-model.ts';
import type { ReviewBase } from './review-model.ts';
import { getReview, updateReview, useReview } from './review-state.ts';
import { colorStyle } from './session-color.ts';
import { SessionMark } from './session-mark.tsx';
import { useSkin } from './skin.ts';
import { useStore } from './store.ts';
import { tabQuery } from './tabs-model.ts';
import { useUi } from './ui.ts';

// The review tab (M64): one session's changed files as a read-only diff,
// comments on the work tree side, and Send review typing them into the
// session as one prompt. Opened from a session (the row menu, the pane
// menu, the Changed list's Review line, Ctrl+Shift+R), so it carries the
// session from the start: its folder is the session's live folder, its
// mark and colour are the session's, and the comments live on the
// session (review-state.ts). The base is HEAD or the branch's fork point
// off the default branch, pinned to a hash while the tab is open so a
// commit the session makes mid-review does not empty the diff under the
// reviewer; the chips and Refresh re-pin it.
//
// M9 fix 199: a changed row's letter opens the tab on that file, carried
// as the tab's query (`?file=<rel>`), and a later open of the same tab
// with another file moves the selection. With no session in the folder
// (a view pane's rail) the tab is the folder's: the header shows the
// folder's name in place of the mark and the name, there is no state
// word and no Send, and the comments live under the folder's key so a
// later open finds them.
//
// M9 fix 790: a third base, the commit the session's current conversation
// started on, which the chat view's diff chip opens on, so the chip's
// lines and the tab's agree for everything inside the folder.

// The same rhythm as the rail's git poll: the list and the shown file
// follow the session's writes without a watch of their own.
const POLL_MS = 5000;
const FOLD_KEY = 'emerald.reviewFilesFolded';

export function ReviewTab({ path }: { path: string }) {
  const sessionId = reviewSessionId(path);
  const ownFolder = reviewFolder(path);
  const { sessions } = useStore('sessions');
  const { tabs } = useUi();
  const skin = useSkin();
  const session = sessionId === null ? undefined : sessions.get(sessionId);
  // The comments' key: the session, or the folder for a folder review.
  const reviewKey = sessionId ?? (ownFolder === null ? '' : reviewFolderKey(ownFolder));
  const review = useReview(reviewKey);
  const folder = session?.cwd ?? ownFolder;
  const startHead = session === undefined ? null : sessionStartHead(session);
  const [git, setGit] = useState<GitReview | null>(null);
  // The file the opener asked for, off the tab's state; it wins whenever
  // it changes, and the list's first file stands in until it is known.
  const wanted = reviewFile(tabQuery(tabs, path));
  const [selected, setSelected] = useState<string | null>(wanted);
  useEffect(() => {
    if (wanted !== null) setSelected(wanted);
  }, [wanted]);
  const [folded, setFolded] = useState<boolean>(loadFolded);
  // The outcome of the last Send: the prompt that went, for the note's tooltip, or the refusal.
  const [sent, setSent] = useState<{ kind: 'sent'; text: string } | { kind: 'refused'; reason: string } | null>(null);
  // The hash the tab holds; null until the first fetch pins one, and
  // cleared when the base chip changes so the next fetch pins afresh.
  const pinned = useRef<string | null>(null);
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);

  // Replies land in order of asking: a poll's answer against the old
  // hash arriving after a re-pin would put the old base back.
  const asked = useRef(0);
  const fetch = (repin: boolean) => {
    if (folder === null) return;
    if (repin) pinned.current = null;
    const base = pinned.current ?? reviewBaseArg(review.base, startHead);
    const seq = ++asked.current;
    void window.emerald.files
      .gitReview(folder, base)
      .then((g) => {
        if (seq !== asked.current) return;
        pinned.current = g.baseHash;
        setGit(g);
      })
      .catch(warn('git review'));
  };
  // Fetched on open and on a base change, then on the poll and on any
  // folder the rail watches changing (the session's edits land in the
  // files rail's watch when their folder is open there).
  useEffect(() => {
    pinned.current = null;
    fetch(true);
    const timer = setInterval(() => fetch(false), POLL_MS);
    const off = window.emerald.files.onChanged(() => fetch(false));
    return () => {
      clearInterval(timer);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, review.base]);

  const files = git?.files ?? [];
  useEffect(() => {
    // An empty list keeps the selection: the files may not have landed
    // yet, and a wanted file must survive until they do.
    if (files.length === 0) return;
    if (selected === null || !files.some((f) => f.rel === selected)) setSelected(files[0]!.rel);
  }, [files, selected]);

  const count = commentCount(review);
  const gate = session === undefined ? { enabled: false, note: sessionId === null ? 'No session in this folder' : 'No such session' } : sendGate(session, count);
  const baseName =
    review.base === 'default' && git?.defaultBranch != null
      ? git.defaultBranch
      : review.base === 'session' && git?.baseHash != null
        ? `session start ${git.baseHash.slice(0, 7)}`
        : 'HEAD';
  const onDefault = git !== null && git.defaultBranch !== null && git.head === git.defaultBranch;
  const chooseBase = (base: ReviewBase) => {
    if (base === review.base) return;
    updateReview(reviewKey, (s) => ({ ...s, base }));
  };
  // A session base with no start commit opens the review on HEAD, as before.
  useEffect(() => {
    if (review.base === 'session' && session !== undefined && startHead === null) updateReview(reviewKey, (s) => ({ ...s, base: 'head' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.base, session === undefined, startHead, reviewKey]);
  const send = () => {
    if (session === undefined || !gate.enabled) return;
    // The draft is kept first, so nothing typed is lost.
    const state = keepDraft(getReview(reviewKey));
    const text = reviewPrompt(state.comments, state.general, baseName);
    void sendPrompt(session.id, text).then((outcome) => {
      if (outcome.kind === 'refused') {
        setSent({ kind: 'refused', reason: outcome.reason });
        return;
      }
      updateReview(reviewKey, (s) => ({ ...s, comments: [], draft: null, general: '', generalOpen: false }));
      setSent({ kind: 'sent', text });
    });
  };
  const fold = () => {
    const next = !folded;
    setFolded(next);
    try {
      localStorage.setItem(FOLD_KEY, next ? '1' : '0');
    } catch {
      // The fold just will not survive the restart.
    }
  };
  const shown = files.find((f) => f.rel === selected) ?? null;
  const label = session === undefined ? null : describeState(session);
  const motion = session === undefined ? null : workingMotion(session);
  const kind = session === undefined ? 'claude' : markKind(session);
  return (
    <div
      className="file-view review-tab"
      data-path={path}
      data-session-id={sessionId ?? undefined}
      data-folder={ownFolder ?? undefined}
      data-selected={selected ?? undefined}
      data-base={review.base}
      data-base-hash={git?.baseHash ?? undefined}
      data-files={files.length}
      data-comments={count}
      data-state={git === null ? 'loading' : 'ready'}
      data-folded={folded || undefined}
      style={session === undefined ? undefined : colorStyle(session)}
    >
      <div className="file-header review-header">
        {sessionId !== null && <SessionMark kind={kind} tone={kind === 'claude' ? (label?.tone ?? 'unknown') : undefined} working={kind === 'claude' && motion !== null} size="row" className="review-mark" />}
        <span className="review-name" title={folder ?? undefined}>
          {sessionId === null ? (ownFolder === null ? '' : folderName(ownFolder)) : (session?.name ?? sessionId)}
        </span>
        <span className="review-branch" title={git?.baseHash === null || git === null ? undefined : `base ${git.baseHash.slice(0, 7)}`}>
          {branchLine(git?.head ?? session?.branch ?? null, files)}
        </span>
        {session !== undefined && hasState(session) && (
          <span className={`review-state state-${label?.tone ?? 'unknown'}`} data-state={session.state} title={label?.detail ?? undefined}>
            {label?.text}
          </span>
        )}
        <span className="review-spacer" />
        <span className="review-chips" role="group" aria-label="Compare against">
          <button className="review-chip" data-base="head" data-on={review.base === 'head' || undefined} title="The index and work tree against the last commit" onClick={() => chooseBase('head')}>
            HEAD
          </button>
          <button
            className="review-chip"
            data-base="default"
            data-on={review.base === 'default' || undefined}
            disabled={git === null || git.defaultBranch === null || onDefault}
            title={
              git === null || git.defaultBranch === null
                ? 'No main or master branch here'
                : onDefault
                  ? `Already on ${git.defaultBranch}; HEAD is the whole story`
                  : `Everything the branch changed since it left ${git.defaultBranch}`
            }
            onClick={() => chooseBase('default')}
          >
            Since {git?.defaultBranch ?? 'main'}
          </button>
          {sessionId !== null && (
            <button
              className="review-chip"
              data-base="session"
              data-on={review.base === 'session' || undefined}
              disabled={startHead === null}
              title={startHead === null ? 'No start commit kept for this session' : `Everything since the commit the session started on, ${startHead.slice(0, 7)}`}
              onClick={() => chooseBase('session')}
            >
              Since session start
            </button>
          )}
        </span>
        <button className="files-button review-refresh" title="Read the changes again, against the commit HEAD is at now" onClick={() => fetch(true)}>
          ↻
        </button>
        <span className="review-count" data-count={count}>
          {count > 0 && <span className="review-count-mark">▪</span>} {countText(count)}
        </span>
        {gate.note !== null && (
          <span className="review-note" data-enabled={gate.enabled || undefined}>
            {gate.enabled ? '↳' : skin === 'emerald' ? (
              <span className="review-note-glyph" data-glyphs="gem">
                ◆
              </span>
            ) : (
              '✳'
            )}{' '}
            {gate.note}
          </span>
        )}
        {sessionId !== null && (
          <button className="review-send" disabled={!gate.enabled} title={gate.enabled ? `Type the ${countText(count)} into ${session?.name ?? 'the session'} as one prompt` : (gate.note ?? 'Nothing to send')} onClick={send}>
            Send review
          </button>
        )}
      </div>
      <GeneralLine sessionId={reviewKey} open={review.generalOpen} text={review.general} />
      {sent !== null && (
        <div className="review-sent" data-outcome={sent.kind} title={sent.kind === 'sent' ? sent.text : undefined}>
          {sent.kind === 'sent' ? `Sent to ${session?.name ?? 'the session'}; the diff follows its edits. Hover for what went.` : sent.reason}
          <button className="files-button" onClick={() => setSent(null)}>
            ×
          </button>
        </div>
      )}
      <div className="review-body">
        <div className="review-files" data-folded={folded || undefined}>
          <button className="review-files-fold" title={folded ? 'Show the file names' : 'Fold the list to its letters'} onClick={fold}>
            {folded ? '▸' : '◂'}
          </button>
          {git !== null && git.root === null && <div className="files-empty">Not a git repository</div>}
          {git !== null && git.root !== null && files.length === 0 && <div className="files-empty">Nothing changed</div>}
          {files.map((f) => (
            <FileRow key={f.rel} file={f} comments={commentsOn(review, f.rel)} selected={f.rel === selected} folded={folded} onClick={() => setSelected(f.rel)} />
          ))}
        </div>
        <div className="review-diff-host">
          {shown !== null && git !== null && folder !== null && (session !== undefined || sessionId === null) ? (
            <ReviewDiff key={`${git.baseHash ?? ''}:${shown.rel}`} sessionId={reviewKey} folder={folder} file={shown} baseHash={git.baseHash} baseName={baseName} branch={git.head ?? session?.branch ?? null} />
          ) : (
            <div className="review-empty">{git === null ? 'Reading the changes' : files.length === 0 ? 'Nothing to review' : ''}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// One file of the list: the status letter, the basename with the count
// of comments on it, the line counts and the folder under it; folded, the
// letter and the count alone.
function FileRow({ file, comments, selected, folded, onClick }: { file: ReviewFile; comments: number; selected: boolean; folded: boolean; onClick: () => void }) {
  const dir = file.rel.includes('/') ? file.rel.slice(0, file.rel.lastIndexOf('/')) : '';
  const counts = countsText(file.added, file.removed);
  return (
    <div className="review-file" data-rel={file.rel} data-letter={file.letter} data-selected={selected || undefined} data-comments={comments || undefined} title={folded ? `${file.rel}${counts === null ? '' : ` ${counts}`}` : file.rel} onClick={onClick}>
      <span className="review-file-letter" data-letter={file.letter}>
        {file.letter}
      </span>
      {!folded && (
        <span className="review-file-text">
          <span className="review-file-name">
            {folderName(file.rel)}
            {comments > 0 && <span className="review-file-comments">▪{comments}</span>}
          </span>
          <span className="review-file-sub">
            {counts !== null && <span className="review-file-counts">{counts}</span>}
            {dir !== '' && <span className="review-file-dir">{dir}</span>}
          </span>
        </span>
      )}
      {folded && comments > 0 && <span className="review-file-comments">▪{comments}</span>}
    </div>
  );
}

// The general comment, for what is not about a line: a line under the
// header that grows into the box on click, so an empty textarea does not
// read as an unfinished form every time the tab opens.
function GeneralLine({ sessionId, open, text }: { sessionId: string; open: boolean; text: string }) {
  const set = (patch: { general?: string; generalOpen?: boolean }) => updateReview(sessionId, (s) => ({ ...s, ...patch }));
  if (!open && text.trim() === '') {
    return (
      <button className="review-general-line" onClick={() => set({ generalOpen: true })}>
        + a general comment, for what is not about a line
      </button>
    );
  }
  return (
    <div className="review-general" data-open>
      <textarea
        className="review-general-box"
        placeholder="For what is not about a line"
        value={text}
        rows={2}
        autoFocus={open && text === ''}
        onChange={(ev) => set({ general: ev.target.value })}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') set({ generalOpen: false });
        }}
      />
      <button className="files-button review-general-close" title="Fold the box (the text stays)" onClick={() => set({ generalOpen: false })}>
        ×
      </button>
    </div>
  );
}

function loadFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

// What the row menu and the Changed list need to say before the tab is
// open: how many files the session's folder has changed, so the menu
// item can carry the count and go off on a clean tree.
export function useChangedCount(session: SessionInfo | undefined): number | null {
  const [count, setCount] = useState<number | null>(null);
  const folder = session?.cwd ?? null;
  useEffect(() => {
    let live = true;
    if (folder === null) {
      setCount(null);
      return;
    }
    void window.emerald.files
      .gitReview(folder, 'HEAD')
      .then((g) => {
        if (live) setCount(g.root === null ? null : g.files.length);
      })
      .catch(() => {
        if (live) setCount(null);
      });
    return () => {
      live = false;
    };
  }, [folder]);
  return count;
}
