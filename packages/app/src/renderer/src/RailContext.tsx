import { memo, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { contextPercentText, formatTokens } from '@emerald/shared';
import type { ContextBreakdown, SessionInfo } from '@emerald/shared';
import { askSessionContext } from './actions.ts';
import { ContextBar } from './ContextPopover.tsx';
import { ContextSkills } from './ContextSkills.tsx';
import { contextSupported } from './daemon-model.ts';
import {
  CONTEXT_ASK_MS,
  CONTEXT_FOOTER,
  CONTEXT_FRESH_TEXT,
  RECOUNT_MS,
  agentRows,
  asOfText,
  compactLine,
  contextState,
  deferredRow,
  fillLine,
  gridCells,
  headHasItems,
  legendRows,
  memoryRows,
  overheadLine,
  restLine,
  sectionHeads,
  serverRows,
  serverSub,
  transcriptNames,
} from './context-model.ts';
import type { ContextAsk, ContextPart, ContextUse, SectionHead, TranscriptNames } from './context-model.ts';
import { useDaemonFor } from './store.ts';
import { openFileTab } from './ui.ts';

// M9 fix 1037: the rail's Context tab, what fills the focused session's
// context window: the model and size, how it was counted, a grid of a
// hundred squares after /context's with its legend beside it, and the
// compaction and overhead lines under them. The breakdown is the emerald
// mod's (fix 1036), asked for once as the tab opens on a session and
// again, counted, on Recount; it arrives as a session.changed.
// M9 fix 1038: the sections under the picture, sorted by tokens, the open
// one lighting its part, and the states: a session still being read, a
// Claude emerald did not start (the status line's bar and the names its
// transcript lists), no session, a plain shell.
// M9 fix 1102: a conversation with no reply yet reads fresh, with words of
// its own, once the mod was asked and has said nothing.

export const CONTEXT_OLD_TEXT = 'The context breakdown needs emmerd at level 79 or later; restart it from the banner.';

interface Props {
  session: SessionInfo | null;
  used: ContextUse | null;
  onOpenPane?: () => void;
}

export const RailContext = memo(function RailContext({ session, used, onOpenPane }: Props) {
  // M9 fix 1085: the context read is the session's own daemon's.
  const daemon = useDaemonFor(session?.host ?? undefined);
  // No daemon yet reads as supported, as the Stats tab does; the ask then
  // fails and resolves as nobody asked.
  const first = contextState({ session, supported: daemon === null || contextSupported(daemon), reply: null, askedAt: null, now: 0 });
  if (first === 'old') {
    return (
      <div className="rail-context" data-state="old">
        <div className="rail-context-body">
          <div className="rail-context-message">{CONTEXT_OLD_TEXT}</div>
        </div>
      </div>
    );
  }
  if (session === null || first === 'none') {
    return (
      <div className="rail-context" data-state="none">
        <div className="files-empty">No session in this pane</div>
      </div>
    );
  }
  if (first === 'shell') {
    return (
      <div className="rail-context" data-state="shell">
        <div className="files-empty">This pane runs a shell, not Claude</div>
      </div>
    );
  }
  // A /clear is a new conversation, asked afresh (M9 fix 1053).
  return <ContextBody key={`${session.id}:${session.claudeSessionId ?? ''}`} session={session} used={used} onOpenPane={onOpenPane} />;
});

function ContextBody({ session, used, onOpenPane }: { session: SessionInfo; used: ContextUse | null; onOpenPane: (() => void) | undefined }) {
  const [reply, setReply] = useState<ContextAsk | null>(null);
  const [askedAt, setAskedAt] = useState<number | null>(null);
  // Moved by a timer at CONTEXT_ASK_MS after the ask, so the state moves
  // on its own rather than on the next re-render.
  const [now, setNow] = useState(() => Date.now());
  // When Recount was clicked; null when it reads Recount.
  const [countingSince, setCountingSince] = useState<number | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [names, setNames] = useState<TranscriptNames | null | undefined>(undefined);
  const b = session.context ?? null;
  const state = contextState({ session, supported: true, reply, askedAt, now });
  useEffect(() => {
    let live = true;
    setAskedAt(Date.now());
    void askSessionContext(session.id, 'summary').then((r) => {
      if (live) setReply(r);
    });
    void window.emerald.info().then(
      (info) => {
        if (live) setHome(info.homeDir);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [session.id]);
  useEffect(() => {
    if (reply === null || !reply.asked || askedAt === null || b !== null) return;
    const left = askedAt + CONTEXT_ASK_MS - Date.now();
    if (left <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), left);
    return () => clearTimeout(timer);
  }, [reply, askedAt, b === null]);
  // A counted breakdown that arrived after the click ends the count; so
  // does RECOUNT_MS with none, after which Recount can be asked again.
  useEffect(() => {
    if (countingSince === null) return;
    if (b !== null && b.detail === 'full' && b.at >= countingSince) {
      setCountingSince(null);
      return;
    }
    const timer = setTimeout(() => setCountingSince(null), Math.max(0, countingSince + RECOUNT_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [countingSince, b]);
  // A Claude emerald did not start: the names its transcript lists, read
  // once (the 8 MB read cap; an error or a binary answer leaves them out).
  const transcript = session.transcriptPath;
  useEffect(() => {
    if (state !== 'outside' || names !== undefined) return;
    if (transcript === null) {
      setNames(null);
      return;
    }
    let live = true;
    window.emerald.files.read(transcript).then(
      (r) => {
        if (live) setNames('text' in r ? transcriptNames(r.text) : null);
      },
      () => {
        if (live) setNames(null);
      },
    );
    return () => {
      live = false;
    };
  }, [state, names, transcript]);

  const cw = session.contextWindow !== null && session.contextWindow.size > 0 ? session.contextWindow : null;
  if (state === 'loaded' && b !== null) {
    const noChannel = reply !== null && !reply.asked && reply.mod;
    const recount = () => {
      if (countingSince !== null || noChannel) return;
      setCountingSince(Date.now());
      void askSessionContext(session.id, 'full');
    };
    return <Loaded session={session} b={b} used={used} home={home} counting={countingSince !== null} noChannel={noChannel} onRecount={recount} onOpenPane={onOpenPane} />;
  }
  const percent = contextPercentText(session);
  const plain = (
    <>
      {percent !== null && (
        <div className="rail-context-fill">
          {percent} full{cw !== null && `, ${formatTokens(cw.used)} of ${formatTokens(cw.size)} tokens`}
        </div>
      )}
      {cw !== null && (
        <div className="rail-context-bar">
          <ContextBar cw={cw} />
        </div>
      )}
    </>
  );
  const heading = `${session.model ?? 'Model not reported'}${cw === null ? '' : ` · ${formatTokens(cw.size)}`}`;
  if (state === 'outside') {
    return (
      <div className="rail-context" data-state="outside">
        <div className="rail-context-scroll">
          <div className="rail-context-body">
            <div className="rail-context-head">
              <div className="rail-context-head-line">
                <span className="rail-context-model">{heading}</span>
                <span className="rail-context-spacer" />
                <span className="rail-context-asof">no breakdown</span>
              </div>
            </div>
            {plain}
            <div className="rail-context-outside">emerald did not start this Claude, so it cannot ask for the breakdown; the names below are what its transcript lists</div>
          </div>
          {names !== null && names !== undefined && <OutsideNames names={names} />}
        </div>
      </div>
    );
  }
  return (
    <div className="rail-context" data-state={state === 'fresh' ? 'fresh' : 'reading'}>
      <div className="rail-context-scroll">
        <div className="rail-context-body">
          <div className="rail-context-head">
            <div className="rail-context-head-line">
              <span className="rail-context-model">{heading}</span>
            </div>
          </div>
          {plain}
        </div>
        <div className="rail-context-sections">
          <div className="files-empty">{state === 'fresh' ? CONTEXT_FRESH_TEXT : 'reading the context'}</div>
        </div>
      </div>
    </div>
  );
}

// The names a transcript lists, as heads with a count and no tokens.
function OutsideNames({ names }: { names: TranscriptNames }) {
  const groups: Array<[string, string, string[]]> = [
    ['memory', 'Memory files', names.memoryFiles],
    ['mcp', 'MCP servers', names.mcpServers],
    ['skills', 'Skills', names.skills],
    ['agents', 'Custom agents', names.agents],
  ];
  return (
    <div className="rail-context-sections">
      {groups
        .filter(([, , list]) => list.length > 0)
        .map(([part, name, list]) => (
          <div key={part} className="rail-context-head-row" data-part={part} data-names="" title={list.join(', ')}>
            <span className="rail-context-head-name">{name}</span>
            <span className="history-group-count">{list.length}</span>
          </div>
        ))}
    </div>
  );
}

function Loaded({ session, b, used, home, counting, noChannel, onRecount, onOpenPane }: { session: SessionInfo; b: ContextBreakdown; used: ContextUse | null; home: string | null; counting: boolean; noChannel: boolean; onRecount: () => void; onOpenPane: (() => void) | undefined }) {
  // One section open at a time, keyed by part and name since two other
  // rows share a part; none at mount, and the body remounts per session.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const heads = sectionHeads(b, used);
  const openHead = heads.find((h) => headKey(h) === openKey) ?? null;
  const open: ContextPart | null = openHead?.part ?? null;
  const deferred = deferredRow(b);
  return (
    <div className="rail-context" data-state="loaded" data-detail={b.detail}>
      <div className="rail-context-scroll">
        <div className="rail-context-body">
          <ContextHead session={session} b={b} counting={counting} noChannel={noChannel} onRecount={onRecount} onOpenPane={onOpenPane} />
          <ContextPicture b={b} open={open} />
          <div className="rail-context-line">{compactLine(b)}</div>
          <div className="rail-context-line">{overheadLine(b)}</div>
        </div>
        <div className="rail-context-sections">
          {heads.map((h) => {
            const key = headKey(h);
            const isOpen = key === openKey;
            const items = headHasItems(b, h.part);
            return (
              <div key={key} className="rail-context-section" data-part={h.part} data-open={isOpen || undefined}>
                <button className="rail-context-head-row" data-part={h.part} aria-expanded={isOpen} title={h.title} onClick={() => setOpenKey(isOpen ? null : key)}>
                  <span className="rail-context-chevron">{items ? (isOpen ? '▾' : '▸') : ''}</span>
                  <span className="rail-context-swatch" data-part={h.part} />
                  <span className="rail-context-head-name">{h.name}</span>
                  {h.count !== null && <span className="history-group-count">{h.count}</span>}
                  {h.unused !== null && h.unused > 0 && <span className="rail-context-unused">{h.unused} unused</span>}
                  <span className="rail-context-spacer" />
                  <span className="rail-context-head-tokens">{formatTokens(h.tokens)}</span>
                </button>
                {isOpen && items && <SectionItems b={b} part={h.part} used={used} home={home} folder={session.groupCwd} />}
              </div>
            );
          })}
        </div>
        {deferred !== null && (
          <div className="rail-context-deferred">
            <div className="rail-context-deferred-heading">Not in the window</div>
            <div className="rail-context-deferred-row" title="Tool schemas Claude loads when it searches for them; they are outside the window until then">
              <span className="rail-context-chevron" />
              <span className="rail-context-head-name">Deferred tools</span>
              {deferred.count > 0 && <span className="history-group-count">{deferred.count}</span>}
              <span className="rail-context-spacer" />
              <span className="rail-context-head-tokens">{formatTokens(deferred.tokens)}</span>
            </div>
          </div>
        )}
        <div className="rail-context-footer">{CONTEXT_FOOTER}</div>
      </div>
    </div>
  );
}

function headKey(h: SectionHead): string {
  return `${h.part}:${h.name}`;
}

function Item({ children, title, onClick, className = 'rail-context-item', data }: { children: ReactNode; title?: string; onClick?: () => void; className?: string; data?: Record<string, string> }) {
  return (
    <div className={className} title={title} onClick={onClick} data-clickable={onClick === undefined ? undefined : ''} {...data}>
      {children}
    </div>
  );
}

function SectionItems({ b, part, used, home, folder }: { b: ContextBreakdown; part: ContextPart; used: ContextUse | null; home: string | null; folder: string }) {
  const [openServers, setOpenServers] = useState<ReadonlySet<string>>(new Set());
  if (part === 'memory') {
    return (
      <div className="rail-context-items">
        {memoryRows(b, home).map((m) => (
          <Item key={m.path} title={`Open ${m.path} in a file tab`} onClick={() => openFileTab(m.path)} data={{ 'data-path': m.path }}>
            <span className="rail-context-item-name">{m.name}</span>
            <span className="rail-context-item-sub">{m.where}</span>
            <span className="rail-context-spacer" />
            <span className="rail-context-item-tokens">{formatTokens(m.tokens)}</span>
          </Item>
        ))}
      </div>
    );
  }
  if (part === 'mcp') {
    return (
      <div className="rail-context-items">
        {serverRows(b, used).map((r) => {
          const isOpen = openServers.has(r.server);
          const toggle = () => {
            const next = new Set(openServers);
            if (isOpen) next.delete(r.server);
            else next.add(r.server);
            setOpenServers(next);
          };
          return (
            <div key={r.server} className="rail-context-server" data-server={r.server} data-open={isOpen || undefined}>
              <Item className="rail-context-item rail-context-server-row" onClick={toggle} data={{ 'aria-expanded': String(isOpen) }}>
                <span className="rail-context-chevron">{isOpen ? '▾' : '▸'}</span>
                <span className="rail-context-item-name">{r.server}</span>
                <span className="rail-context-item-sub">{serverSub(r)}</span>
                <span className="rail-context-spacer" />
                {r.unused && <span className="rail-context-item-unused">unused</span>}
                <span className="rail-context-item-tokens">{formatTokens(r.tokens)}</span>
              </Item>
              {isOpen && (
                <>
                  {r.top.map((t) => (
                    <Item key={t.name} className="rail-context-item rail-context-tool">
                      <span className="rail-context-item-name">{t.name}</span>
                      <span className="rail-context-spacer" />
                      <span className="rail-context-item-tokens">{formatTokens(t.tokens)}</span>
                    </Item>
                  ))}
                  {r.rest > 0 && (
                    <Item className="rail-context-item rail-context-tool rail-context-rest">
                      <span className="rail-context-item-sub">{restLine(r)}</span>
                    </Item>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  if (part === 'agents') {
    return (
      <div className="rail-context-items">
        {agentRows(b, used).map((a) => (
          <Item key={a.agentType} data={{ 'data-agent': a.agentType }}>
            <span className="rail-context-item-name">{a.agentType}</span>
            <span className="rail-context-item-sub">{a.source}</span>
            <span className="rail-context-spacer" />
            {a.unused && <span className="rail-context-item-unused">unused</span>}
            <span className="rail-context-item-tokens">{formatTokens(a.tokens)}</span>
          </Item>
        ))}
      </div>
    );
  }
  if (part === 'skills' && b.skills !== undefined) return <ContextSkills skills={b.skills} folder={folder} />;
  return null;
}

function ContextHead({ session, b, counting, noChannel, onRecount, onOpenPane }: { session: SessionInfo; b: ContextBreakdown; counting: boolean; noChannel: boolean; onRecount: () => void; onOpenPane: (() => void) | undefined }) {
  return (
    <div className="rail-context-head">
      <div className="rail-context-head-line">
        <span className="rail-context-model">{`${session.model ?? 'Model not reported'} · ${formatTokens(b.rawMaxTokens)}`}</span>
        <span className="rail-context-spacer" />
        <span className="rail-context-asof">{asOfText(b)}</span>
        <button
          className="rail-context-recount"
          aria-busy={counting || undefined}
          aria-disabled={noChannel || undefined}
          title={noChannel ? 'This Claude has no channel to ask on; the breakdown comes with its next measure' : 'Count each part again with the token-count API; costs a few requests'}
          onClick={onRecount}
        >
          {counting ? 'counting' : 'Recount'}
        </button>
        <button
          className="rail-context-pane"
          aria-label="Open the context in a pane"
          aria-disabled={onOpenPane === undefined || undefined}
          title="Open the context in a pane, every column of the skills table"
          onClick={() => onOpenPane?.()}
        >
          ⤢
        </button>
      </div>
      <div className="rail-context-fill">{fillLine(b)}</div>
    </div>
  );
}

function ContextPicture({ b, open }: { b: ContextBreakdown; open: ContextPart | null }) {
  const cells = gridCells(b, open);
  const legend = legendRows(b, open);
  return (
    <div className="rail-context-picture">
      <div className="rail-context-grid" aria-hidden="true">
        {cells.map((c, i) => (
          <span
            key={i}
            className="rail-context-square"
            data-part={c.part}
            data-fill={c.fill}
            data-dim={c.dim || undefined}
            style={c.fill === 'hollow' ? ({ '--fill': `${Math.round(c.fraction * 100)}%` } as CSSProperties) : undefined}
          />
        ))}
      </div>
      <div className="rail-context-legend">
        {legend.map((r) => (
          <div key={`${r.part}:${r.name}`} className="rail-context-key" data-part={r.part} data-dim={r.dim || undefined} title={r.title}>
            <span className="rail-context-swatch" data-part={r.part} />
            <span className="rail-context-key-name">{r.name}</span>
            <span className="rail-context-spacer" />
            <span className="rail-context-key-tokens">{r.tokens}</span>
            <span className="rail-context-key-percent">{r.percent}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
