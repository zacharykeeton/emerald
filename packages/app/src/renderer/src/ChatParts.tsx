import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { editCounts } from '@emerald/shared';
import type { SessionInfo, Step } from '@emerald/shared';
import { openBeside } from './actions.ts';
import { editHunk, lineOf } from './chat-hunk.ts';
import type { PendingEdit } from './chat-hunk.ts';
import { renderReply } from './chat-markdown.ts';
import { PATH_CACHE_MAX, PATH_MENU } from './chat-paths.ts';
import type { PathAction } from './chat-paths.ts';
import { browserViewSupported, fileViewSupported } from './daemon-model.ts';
import { normalizePath, relativePath } from './files-model.ts';
import { Menu } from './Menu.tsx';
import type { MenuItem } from './Menu.tsx';
import { getState } from './store.ts';
import { fileViewAt } from './tabs-model.ts';
import { openFileTab, openReviewTab, revealInPane } from './ui.ts';

// The chat view's drawn parts (M9 fixes 716 to 718): a reply rendered as
// Markdown with its paths live, the path menu, the thumbnails and their
// full-size view, and the edit card. ChatView.tsx keeps the view's frame.

// Whether a path in the session's folder is a file, by one stat each for
// the window's life (chat-paths.ts says why the map is dropped whole).
const known = new Map<string, 'file' | 'other'>();
const knownPath = (abs: string) => known.get(abs);

// M9 fix 717: every path the view draws carries data-path (and a reply's
// data-line), and one pair of handlers on the element around them serves
// them all: a left click opens the file in a tab, a right click opens
// the path menu, and a web link in a reply goes to the browser as the
// Markdown tab's does (MarkdownView.tsx). Every anchor's default is
// stopped, so nothing navigates the window. A Ctrl+click on a web link
// opens it in a browser pane beside this one (M9 fix 863), and a
// Ctrl+click on a path opens it in a file pane beside this one, at its
// line (M9 fix 864).
export function usePathLinks(paneId: string): { handlers: { onClick: (ev: MouseEvent<HTMLElement>) => void; onAuxClick: (ev: MouseEvent<HTMLElement>) => void; onContextMenu: (ev: MouseEvent<HTMLElement>) => void }; menu: ReactNode } {
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  // React carries a portal's events up the component tree, so a click in
  // the path menu (its root carries data-path too) or a thumbnail's full
  // size reaches these handlers; only the turn's own DOM is read.
  const ours = (ev: MouseEvent<HTMLElement>) => ev.currentTarget.contains(ev.target as Node);
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);
  const open = (ev: MouseEvent<HTMLElement>, beside: boolean) => {
    if (!ours(ev)) return;
    const target = ev.target as HTMLElement;
    const a = target.closest('a');
    if (a !== null) ev.preventDefault();
    const pathEl = target.closest<HTMLElement>('[data-path]');
    if (pathEl !== null) {
      const line = pathEl.getAttribute('data-line');
      const p = normalizePath(pathEl.getAttribute('data-path') ?? '');
      const at = line === null ? undefined : Number(line);
      if (beside && fileViewSupported(getState().daemon)) {
        void openBeside(fileViewAt(p, at), paneId)
          .then((id) => {
            if (at !== undefined) revealInPane(id, p, at);
          })
          .catch(warn('open beside'));
      } else openFileTab(p, at);
      return;
    }
    const href = a?.getAttribute('href') ?? null;
    if (href === null || !/^https?:/i.test(href)) return;
    if (beside && browserViewSupported(getState().daemon)) void openBeside({ kind: 'browser', url: href }, paneId).catch(warn('open link beside'));
    else void window.emerald.files.openExternal(href).catch(warn('open link'));
  };
  const handlers = {
    onClick: (ev: MouseEvent<HTMLElement>) => open(ev, ev.ctrlKey),
    onAuxClick: (ev: MouseEvent<HTMLElement>) => {
      if (ev.button === 1) open(ev, false);
    },
    onContextMenu: (ev: MouseEvent<HTMLElement>) => {
      if (!ours(ev)) return;
      const pathEl = (ev.target as HTMLElement).closest<HTMLElement>('[data-path]');
      if (pathEl === null) return;
      // The pane's own menu (Pane.tsx) would open over this one.
      ev.preventDefault();
      ev.stopPropagation();
      setMenu({ x: ev.clientX, y: ev.clientY, path: normalizePath(pathEl.getAttribute('data-path') ?? '') });
    },
  };
  const act = (action: PathAction, path: string): void => {
    if (action === 'tab') openFileTab(path);
    else if (action === 'pane') void openBeside({ kind: 'file', path }, paneId).catch(warn('open in a pane'));
    else if (action === 'windows') void window.emerald.files.open(path).catch(warn('open'));
    else if (action === 'reveal') void window.emerald.files.reveal(path).catch(warn('reveal'));
    // The box (m9-chat-box) listens and puts the path in the message.
    else if (action === 'mention') window.dispatchEvent(new CustomEvent('emerald:chat-mention', { detail: { paneId, path } }));
    else void window.emerald.clipboard.write(path).catch(warn('copy'));
  };
  const items = (path: string): MenuItem[] =>
    PATH_MENU.filter((i) => i.action !== 'pane' || fileViewSupported(getState().daemon)).map((i) => ({
      label: i.label,
      title: i.action === 'copy' ? path : i.title,
      hint: i.hint,
      separator: i.separator,
      onClick: () => {
        setMenu(null);
        act(i.action, path);
      },
    }));
  const drawn = menu === null ? null : <Menu x={menu.x} y={menu.y} className="chat-path-menu" data={{ path: menu.path }} items={items(menu.path)} onClose={() => setMenu(null)} />;
  return { handlers, menu: drawn };
}

// M9 fix 797: an update (Claude Code's ● progress line) is drawn as a
// reply in every mode, its kind on data-kind.
export function ChatReply({ step, session }: { step: Extract<Step, { kind: 'text' | 'update' }>; paneId: string; session: SessionInfo }) {
  // Bumped when a stat lands, so the paths it settled are drawn as links.
  const [version, setVersion] = useState(0);
  const { html, ask } = useMemo(() => renderReply(step.text, session.cwd, knownPath), [step.text, session.cwd, version]);
  useEffect(() => {
    if (ask.length === 0) return;
    let live = true;
    void Promise.all(
      ask.map((abs) =>
        window.emerald.files
          .stat(abs)
          .then((r) => ('kind' in r && r.kind === 'file' ? 'file' : 'other'))
          .catch(() => 'other' as const)
          .then((kind) => {
            if (known.size >= PATH_CACHE_MAX) known.clear();
            known.set(abs, kind);
          }),
      ),
    ).then(() => {
      if (live) setVersion((v) => v + 1);
    });
    return () => {
      live = false;
    };
  }, [ask]);
  // The clicks are the turn's (usePathLinks), which this sits inside.
  return (
    <div className="chat-step chat-reply" data-kind={step.kind}>
      {/* The tick is the cell's ::before, so the reply's text is the rendered Markdown's alone. */}
      <span className="chat-tick-cell" aria-hidden="true" />
      <div className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// M9 fixes 717 and 718: an image in the timeline, which a click opens at
// full size over the window. A browser pane takes http and https alone
// (browser-url.ts), so the full size is an overlay of the same data: URL;
// a click anywhere closes it, and so does Escape, which goes no further:
// React carries a portal's events up the component tree, to the view's
// own Escape that would otherwise reach the session. No lazy loading: it
// waits on intersection, which a covered window never computes.
export function ChatImage({ src, className, alt }: { src: string; className: string; alt: string }) {
  const [full, setFull] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (full) overlayRef.current?.focus();
  }, [full]);
  return (
    <>
      <img className={className} src={src} alt={alt} decoding="async" onClick={() => setFull(true)} />
      {full &&
        createPortal(
          <div
            className="chat-image-full"
            ref={overlayRef}
            tabIndex={-1}
            onClick={(ev) => {
              ev.stopPropagation();
              setFull(false);
            }}
            onKeyDown={(ev) => {
              if (ev.key !== 'Escape') return;
              ev.preventDefault();
              ev.stopPropagation();
              setFull(false);
            }}
          >
            <img src={src} alt={alt} />
          </div>,
          document.body,
        )}
    </>
  );
}

const dataUrl = (image: { mediaType: string; data: string }) => `data:${image.mediaType};base64,${image.data}`;

// M9 fix 717: an image result as a thumbnail row of its own under its
// tool step; nothing when the result carried no data.
export function ChatThumbRow({ step }: { step: Step }) {
  const image = step.kind === 'tool' ? step.result?.image : null;
  if (image == null || image.data === '') return null;
  return (
    <div className="chat-step chat-thumb-row" data-kind="image">
      <ChatImage className="chat-thumb" src={dataUrl(image)} alt={step.kind === 'tool' ? step.arg : ''} />
    </div>
  );
}

// M9 fix 718: the images pasted with a prompt, under its text.
export function PromptImages({ images }: { images: { mediaType: string; data: string }[] }) {
  if (images.length === 0) return null;
  return (
    <div className="chat-prompt-images">
      {images.map((image, i) => (
        <ChatImage key={i} className="chat-prompt-thumb" src={dataUrl(image)} alt="" />
      ))}
    </div>
  );
}

// M9 fix 717: the head and the hunk of an edit's ask, in place of the
// command card's heading and screen excerpt. The line numbers come from
// one read of the file when the card opens; a read that fails or does
// not find the old text leaves the gutter empty.
export function EditCardHead({ session, edit }: { session: SessionInfo; edit: PendingEdit }) {
  const [start, setStart] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setStart(null);
    void window.emerald.files
      .read(edit.path)
      .then((r) => {
        if (live && 'text' in r) setStart(lineOf(r.text, edit.oldString));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [edit.path, edit.oldString]);
  const path = normalizePath(edit.path);
  const rel = relativePath(session.cwd, path);
  const inside = rel !== path;
  const counts = editCounts(edit.oldString, edit.newString);
  const rows = editHunk(edit.oldString, edit.newString, start);
  return (
    <>
      <div className="chat-ask-head-row">
        <div className="chat-ask-heading">Claude wants to edit</div>
        <span className="chat-path chat-ask-file" data-path={path} title={path}>
          {rel}
        </span>
        <span className="chat-ask-counts">
          <span className="chat-added">+{counts.added}</span> <span className="chat-removed">{'−'}{counts.removed}</span>
        </span>
        <button
          type="button"
          className="chat-ask-diff"
          title="The file's changes so far in the session's review; this edit joins them once allowed"
          onClick={() => openReviewTab(session.id, inside ? rel.replace(/\\/g, '/') : undefined)}
        >
          Open as a diff
        </button>
      </div>
      <div className="chat-ask-hunk">
        {rows.map((row, i) => (
          <div key={i} className="chat-hunk-row" data-kind={row.kind}>
            <span className="chat-hunk-num">{row.line ?? ''}</span>
            <span className="chat-hunk-sign">{row.kind === 'removed' ? '−' : row.kind === 'added' ? '+' : ''}</span>
            <span className="chat-hunk-text">{row.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
