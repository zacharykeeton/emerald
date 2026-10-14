import { useEffect, useRef, useState } from 'react';
import type { GitShow, ReviewFile } from '../../preload/api.ts';
import { monaco, replaceText } from './monaco.ts';
import { keepDraft, openDraft, removeComment } from './review-model.ts';
import type { ReviewComment } from './review-model.ts';
import { updateReview, useReview } from './review-state.ts';

// The diff of one file of a review (M64): base on the left, work tree on
// the right, both read-only, on Monaco's diff editor over the app's
// worker-free setup. The base text is `git show <hash>:<path>` and the
// work tree side the file itself, re-read on the same poll as the file
// list so the session's edits land in place. The models are the tab's
// own (a review URI, not the file's, so an open file tab's model is not
// taken over) and go with the component.
//
// The comments live in the work tree side's margin: hovering a row turns
// its glyph margin into an amber + and tints the row, a press there (or
// on the line number) opens the box under the line as a view zone, Keep
// (or Ctrl+Enter) keeps it, Escape cancels; a kept comment is one 20px
// row under its line with edit and remove, and a blue mark in the margin
// for good. The diff editor aligns the two sides itself: a zone under a
// work tree line gets a blank of the same height under the base line it
// sits beside (measured in verify:review), so nothing here draws a
// filler. Comments are on the work tree side only: that is what the
// session can still change.

const POLL_MS = 5000;
const COMMENT_ROW_PX = 20;
const BOX_PX = 74;

type Side = { kind: 'text'; text: string } | { kind: 'binary' } | { kind: 'missing' } | { kind: 'error'; error: string };

export function ReviewDiff({ sessionId, folder, file, baseHash, baseName, branch }: { sessionId: string; folder: string; file: ReviewFile; baseHash: string | null; baseName: string; branch: string | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const modelsRef = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null);
  const [base, setBase] = useState<Side | null>(null);
  const [work, setWork] = useState<Side | null>(null);
  const review = useReview(sessionId);
  const comments = review.comments.filter((c) => c.rel === file.rel);
  const draft = review.draft !== null && review.draft.rel === file.rel ? review.draft : null;
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const editor = monaco.editor.createDiffEditor(host, {
      readOnly: true,
      originalEditable: false,
      domReadOnly: true,
      readOnlyMessage: { value: 'emerald shows the diff read-only; comment in the margin' },
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      renderMarginRevertIcon: false,
      renderIndicators: false,
      renderOverviewRuler: false,
      automaticLayout: true,
      glyphMargin: true,
      lineDecorationsWidth: 12,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      fontSize: 13,
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      wordWrap: 'off',
      hideUnchangedRegions: { enabled: false },
    });
    editorRef.current = editor;
    // For the verify scripts, as emeraldEditor on a file tab's host.
    (host as HTMLDivElement & { emeraldDiff?: monaco.editor.IStandaloneDiffEditor }).emeraldDiff = editor;
    const modified = editor.getModifiedEditor();
    // The hover: the + in the margin and the tint on the row under the
    // mouse, on the work tree side only.
    const hover = modified.createDecorationsCollection();
    const hoverMove = modified.onMouseMove((e) => {
      const line = e.target.position?.lineNumber;
      if (line === undefined) {
        hover.clear();
        return;
      }
      hover.set([{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'review-hover-line', glyphMarginClassName: 'review-glyph-add', zIndex: 1 } }]);
    });
    const hoverLeave = modified.onMouseLeave(() => hover.clear());
    // A press in the margin or on the line number opens the box on that
    // line, with the line's text quoted for the prompt.
    const press = modified.onMouseDown((e) => {
      const t = e.target;
      const inMargin = t.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || t.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS || t.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;
      const line = t.position?.lineNumber;
      if (!inMargin || line === undefined) return;
      e.event.preventDefault();
      const code = modified.getModel()?.getLineContent(line) ?? '';
      updateReview(sessionId, (s) => openDraft(s, file.rel, line, code));
    });
    // The editor takes the keyboard on the release after the press that
    // opened the box; the box takes it back, so typing starts at once.
    const release = modified.onMouseUp(() => {
      const area = host.querySelector<HTMLTextAreaElement>('.review-comment-input');
      if (area !== null && document.activeElement !== area) area.focus();
    });
    return () => {
      hoverMove.dispose();
      hoverLeave.dispose();
      press.dispose();
      release.dispose();
      editorRef.current = null;
      editor.setModel(null);
      editor.dispose();
      modelsRef.current?.original.dispose();
      modelsRef.current?.modified.dispose();
      modelsRef.current = null;
    };
    // The editor lives as long as the component; the file and session
    // are in the key the parent renders it under.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The base side once, since the hash is pinned; the work tree side on
  // every poll and on any watched folder changing.
  useEffect(() => {
    let live = true;
    if (baseHash === null) setBase({ kind: 'missing' });
    else
      void window.emerald.files
        .gitShow(folder, baseHash, file.rel)
        .then((r: GitShow) => {
          if (live) setBase(r);
        })
        .catch(warn('git show'));
    return () => {
      live = false;
    };
  }, [folder, baseHash, file.rel]);

  useEffect(() => {
    let live = true;
    const load = () =>
      void window.emerald.files
        .read(file.path)
        .then((r) => {
          if (!live) return;
          // The same text keeps the same state, so a poll that found
          // nothing new rebuilds no zone (and takes no focus from a box).
          if ('text' in r) setWork((prev) => (prev?.kind === 'text' && prev.text === r.text ? prev : { kind: 'text', text: r.text }));
          else if ('binary' in r) setWork({ kind: 'binary' });
          else setWork(/not found|ENOENT|no such/i.test(r.error) ? { kind: 'missing' } : { kind: 'error', error: r.error });
        })
        .catch(warn('read'));
    load();
    const timer = setInterval(load, POLL_MS);
    const off = window.emerald.files.onChanged(() => load());
    return () => {
      live = false;
      clearInterval(timer);
      off();
    };
  }, [file.path]);

  // The models follow the two reads; a re-read of the work tree replaces
  // the text as one edit so the scroll position holds.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || base === null || work === null) return;
    const originalText = base.kind === 'text' ? base.text : '';
    const modifiedText = work.kind === 'text' ? work.text : '';
    if (modelsRef.current === null) {
      const uri = (side: string) => monaco.Uri.from({ scheme: 'emerald-review', path: `/${side}/${baseHash ?? 'none'}/${file.rel}` });
      const original = monaco.editor.createModel(originalText, undefined, uri('base'));
      const modified = monaco.editor.createModel(modifiedText, undefined, uri('work'));
      modelsRef.current = { original, modified };
      editor.setModel({ original, modified });
    } else {
      replaceText(modelsRef.current.original, originalText);
      replaceText(modelsRef.current.modified, modifiedText);
    }
  }, [base, work, baseHash, file.rel]);

  // The marks and the zones follow the comments and the draft's place.
  // The draft's text is not a dependency: the box is built once per line
  // and writes the store on every keystroke (the header's count reads
  // it), and a rebuild on each key would take the focus with it.
  const commentsKey = comments.map((c) => `${c.line}:${c.text}`).join('\n');
  const draftLine = draft?.line ?? null;
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || modelsRef.current === null) return;
    const modified = editor.getModifiedEditor();
    const marks = modified.createDecorationsCollection(
      comments.map((c) => ({ range: new monaco.Range(c.line, 1, c.line, 1), options: { glyphMarginClassName: 'review-glyph-mark', zIndex: 2 } })),
    );
    const rightIds: string[] = [];
    const lineCount = modelsRef.current.modified.getLineCount();
    const zones: Array<{ line: number; height: number; node: HTMLElement }> = [];
    for (const c of comments) {
      if (c.line === draftLine || c.line > lineCount) continue;
      zones.push({ line: c.line, height: COMMENT_ROW_PX, node: keptRow(c, sessionId) });
    }
    if (draft !== null && draft.line <= lineCount) zones.push({ line: draft.line, height: BOX_PX, node: draftBox(draft, sessionId) });
    modified.changeViewZones((acc) => {
      for (const z of zones) rightIds.push(acc.addZone({ afterLineNumber: z.line, heightInPx: z.height, domNode: z.node, suppressMouseDown: false }));
    });
    const box = zones.find((z) => z.node.classList.contains('review-comment-box'));
    // The keyboard goes to the box now and once more a moment later,
    // after the release of the press that opened it has given the
    // editor its focus back.
    let refocus: ReturnType<typeof setTimeout> | null = null;
    if (box !== undefined) {
      modified.revealLineInCenterIfOutsideViewport(box.line);
      const area = box.node.querySelector<HTMLTextAreaElement>('textarea');
      area?.focus();
      refocus = setTimeout(() => area?.focus(), 150);
    }
    return () => {
      if (refocus !== null) clearTimeout(refocus);
      marks.clear();
      modified.changeViewZones((acc) => rightIds.forEach((id) => acc.removeZone(id)));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsKey, draftLine, base, work, sessionId, file.rel]);

  // An added file has no base (M9 fix 105): the empty string is one line
  // to Monaco, which it marked deleted against the file's first line, so
  // the base side said `1` in red under a file that never had a line 1.
  // The side is blanked instead: no line numbers, no deletion marks (the
  // CSS under data-new-file), and the caption says what it is.
  const newFile = file.letter === 'A' && base?.kind === 'missing';
  useEffect(() => {
    editorRef.current?.getOriginalEditor().updateOptions({ lineNumbers: newFile ? 'off' : 'on' });
  }, [newFile]);

  const note = (side: Side | null, what: string) => (side === null ? `Reading the ${what}` : side.kind === 'binary' ? `Binary at ${what}` : side.kind === 'missing' ? `Not at ${what}` : side.kind === 'error' ? side.error : null);
  return (
    <div className="review-diff" data-rel={file.rel} data-state={base !== null && work !== null ? 'ready' : 'loading'} data-comments={comments.length} data-draft={draftLine ?? undefined} data-new-file={newFile || undefined}>
      <div className="review-captions">
        <span className="review-caption" title={baseHash ?? undefined}>
          base {baseName}
          {baseHash !== null && <span className="review-caption-hash"> {baseHash.slice(0, 7)}</span>}
          {newFile ? <span className="review-caption-note"> · new file</span> : note(base, 'the base') !== null && <span className="review-caption-note"> · {note(base, 'the base')}</span>}
        </span>
        <span className="review-caption">
          work tree{branch !== null && ` ⑂ ${branch}`}
          {note(work, 'the work tree') !== null && <span className="review-caption-note"> · {note(work, 'the work tree')}</span>}
        </span>
      </div>
      <div className="review-editor" ref={hostRef} />
    </div>
  );
}

// A kept comment, collapsed to one row: the mark, the text on one line,
// edit and remove at the right. A click on the text opens it for editing.
function keptRow(c: ReviewComment, sessionId: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'review-comment';
  row.dataset['line'] = String(c.line);
  const mark = document.createElement('span');
  mark.className = 'review-comment-mark';
  mark.textContent = '▪';
  const text = document.createElement('span');
  text.className = 'review-comment-text';
  text.textContent = c.text;
  text.title = c.text;
  const edit = button('edit', 'review-comment-edit', () => updateReview(sessionId, (s) => openDraft(s, c.rel, c.line, c.code)));
  const remove = button('remove', 'review-comment-remove', () => updateReview(sessionId, (s) => removeComment(s, c.rel, c.line)));
  text.addEventListener('click', () => edit.click());
  row.append(mark, text, edit, remove);
  return row;
}

// The box under a line: a textarea, Keep and Cancel. Ctrl+Enter keeps,
// Escape cancels; every keystroke goes to the store so the count and
// Send see the draft.
function draftBox(d: ReviewComment, sessionId: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'review-comment-box';
  box.dataset['line'] = String(d.line);
  const area = document.createElement('textarea');
  area.className = 'review-comment-input';
  area.placeholder = 'A comment on this line';
  area.value = d.text;
  area.rows = 2;
  area.addEventListener('input', () => updateReview(sessionId, (s) => (s.draft === null ? s : { ...s, draft: { ...s.draft, text: area.value } })));
  const keep = () => updateReview(sessionId, (s) => keepDraft(s));
  const cancel = () => updateReview(sessionId, (s) => ({ ...s, draft: null }));
  area.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      cancel();
    } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      keep();
    }
    // The editor's own keys stay out of the box.
    ev.stopPropagation();
  });
  // The editor takes a mousedown as its own; the box keeps its clicks.
  box.addEventListener('mousedown', (ev) => ev.stopPropagation());
  const actions = document.createElement('div');
  actions.className = 'review-comment-actions';
  actions.append(button('Keep', 'review-comment-keep', keep), button('Cancel', 'review-comment-cancel', cancel));
  box.append(area, actions);
  return box;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = label;
  b.addEventListener('mousedown', (ev) => ev.stopPropagation());
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return b;
}
