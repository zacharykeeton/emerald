import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { folderName, formatDuration, parseTurns } from '@emerald/shared';
import type { Turn } from '@emerald/shared';
import { resumeSession, resumeTranscript, showSession } from './actions.ts';
import { parseTranscriptHead, parseTranscriptTail, promptsText } from './history-model.ts';
import { useStore } from './store.ts';
import { setTabTitle } from './ui.ts';

// A conversation's transcript read as its turns (M53), the tab the
// Sessions rail's Expand opens: the row's facts and Resume at the top,
// then every turn in a reading column, the whole prompt with its time and
// length at the right, the reply clamped to two lines until clicked (the
// last one whole, as in the rail), and under it a muted line of what the
// turn did. The text is the file tab's own read, so a change on disk
// lands here as it lands in the editor; the parsing is shared's, the
// same the rail's rows use. Read-only, closes like any file tab.

const scrollTops = new Map<string, number>();

export function TranscriptView({ path, text }: { path: string; text: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { sessions } = useStore('sessions');
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const read = useMemo(() => ({ head: parseTranscriptHead(text, true), tail: parseTranscriptTail(text, true), turns: parseTurns(text) }), [text]);
  const id = folderName(path).replace(/\.jsonl$/i, '');
  // emerald's own session on this conversation, if it has one, for Resume
  // to show it rather than start a second Claude on the same id.
  const own = [...sessions.values()].find((s) => s.kind === 'claude' && s.claudeSessionId === id);
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);
  const resume = () => {
    if (own !== undefined && own.state !== 'exited') void showSession(own.id).catch(warn('show'));
    else if (own !== undefined) void resumeSession(own.id).catch(warn('resume'));
    else if (read.head.cwd !== null) void resumeTranscript(read.head.cwd, id, false).catch(warn('resume'));
  };

  // The place is kept per file while the app runs, as the markdown view
  // keeps its own; see MarkdownView.tsx for why the cleanup notes it.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    host.scrollTop = scrollTops.get(path) ?? 0;
    return () => {
      scrollTops.set(path, host.scrollTop);
    };
  }, [path]);

  // The keyboard comes here on open, as a rendered markdown's does (MarkdownView.tsx), so a first Ctrl+F finds; fix 619 left it in the rail on purpose, but neither rail has keys of its own that this takes over (M9 fix 636). A live transcript re-renders on every growth but keeps its path, so the focus is not taken again.
  useLayoutEffect(() => {
    hostRef.current?.focus();
  }, [path]);

  const { head, tail, turns } = read;
  // The tab is named by the conversation (M9 fix 96): Claude's title, or
  // the first prompt's opening while there is none yet.
  useEffect(() => {
    const title = head.title ?? (head.firstPrompt === null ? null : head.firstPrompt.replace(/\s+/g, ' ').trim().slice(0, 48));
    if (title !== null && title !== '') setTabTitle(path, title);
  }, [path, head.title, head.firstPrompt]);
  const facts = [
    head.cwd === null ? null : folderName(head.cwd),
    head.branch,
    tail.model,
    spanText(head.startedAt, tail.lastAt),
    promptsText(turns),
  ].filter((x): x is string => x !== null);
  const resumeTitle = own !== undefined && own.state !== 'exited' ? `Show ${own.name} in the focused pane` : own !== undefined ? `Start ${own.name} again with its conversation` : head.cwd === null ? 'The transcript names no folder' : `claude --resume in ${head.cwd}, in the focused pane`;
  return (
    <div className="transcript-view" ref={hostRef} tabIndex={-1} data-turns={turns.length}>
      <div className="transcript-header">
        <span className="transcript-facts">{facts.join(' · ')}</span>
        <button className="transcript-resume" title={resumeTitle} disabled={own === undefined && head.cwd === null} onClick={resume}>
          {own !== undefined && own.state !== 'exited' ? 'Show' : 'Resume'}
        </button>
      </div>
      <div className="transcript-turns">
        {turns.length === 0 && <div className="files-empty">No prompts in this transcript</div>}
        {turns.map((t, i) => (
          <TurnBlock
            key={i}
            turn={t}
            whole={open.has(i) || i === turns.length - 1}
            onOpen={() =>
              setOpen((o) => {
                const next = new Set(o);
                next.add(i);
                return next;
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function TurnBlock({ turn, whole, onOpen }: { turn: Turn; whole: boolean; onOpen: () => void }) {
  const when = turn.at === null ? null : new Date(turn.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const length = turn.at !== null && turn.endAt !== null ? formatDuration(turn.at, turn.endAt) : null;
  const did = didText(turn);
  return (
    <div className="transcript-turn">
      <div className="transcript-prompt">
        <span className="transcript-mark">›</span>
        <span className="transcript-prompt-text">{turn.prompt.trim()}</span>
        {(when !== null || length !== null) && <span className="transcript-when">{[when, length].filter((x) => x !== null).join(' · ')}</span>}
      </div>
      {turn.reply !== null && (
        <div className="transcript-reply" data-whole={whole || undefined} title={whole ? undefined : 'Click for the whole reply'} onClick={whole ? undefined : onOpen}>
          <span className="transcript-mark">✓</span>
          <span className="transcript-reply-text">{turn.reply.trim()}</span>
        </div>
      )}
      {did.map((line, i) => (
        <div key={i} className="transcript-did" title={line.title}>
          {line.text}
        </div>
      ))}
    </div>
  );
}

// The muted lines under a turn: the counts, then the files read by name
// (the full paths in the tooltip). A turn that did nothing has no line.
function didText(turn: Turn): Array<{ text: string; title: string | undefined }> {
  const lines: Array<{ text: string; title: string | undefined }> = [];
  const counts = [
    turn.toolCalls === 0 ? null : `${turn.toolCalls} tool ${turn.toolCalls === 1 ? 'call' : 'calls'}`,
    turn.filesEdited.length === 0 ? null : `${turn.filesEdited.length} ${turn.filesEdited.length === 1 ? 'file' : 'files'} edited`,
    turn.commits === 0 ? null : `${turn.commits} ${turn.commits === 1 ? 'commit' : 'commits'}`,
  ].filter((x): x is string => x !== null);
  if (counts.length > 0) lines.push({ text: counts.join(' · '), title: turn.filesEdited.length === 0 ? undefined : turn.filesEdited.join('\n') });
  if (turn.filesRead.length > 0) {
    lines.push({ text: `${turn.filesRead.length} ${turn.filesRead.length === 1 ? 'file' : 'files'} read · ${turn.filesRead.map(folderName).join(', ')}`, title: turn.filesRead.join('\n') });
  }
  return lines;
}

// 2026-09-13 09:12 to 11:48, the day once, since a conversation rarely
// crosses one; null with no start.
function spanText(from: number | null, to: number | null): string | null {
  if (from === null) return null;
  const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const d = new Date(from);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return to === null || to <= from ? `${day} ${clock(from)}` : `${day} ${clock(from)} to ${clock(to)}`;
}
