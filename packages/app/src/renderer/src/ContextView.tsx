import { useEffect, useState } from 'react';
import type { ContextBreakdown, ContextSkill, SessionInfo } from '@emerald/shared';
import { askSessionContext } from './actions.ts';
import { useContextHistory } from './context-history-store.ts';
import type { ContextHistoryView } from './context-history-store.ts';
import { agentRows, asOfText, callsText, fillLine, serverRows } from './context-model.ts';
import type { ContextAsk } from './context-model.ts';
import { LISTING_COLUMN_TITLE, listingNameClass } from './listing-model.ts';
import { ListingSwitch, useListing } from './ListingSwitch.tsx';
import { contextUse, lastUsedWords, listingTokensText, mcpServerKey, neverSummary, skillGroups, skillHistoryOf, skillSourceLabel, tokens7dText } from './skill-history-model.ts';
import { useStore } from './store.ts';
import { openFileTab } from './ui.ts';

// M9 fix 1040: the context of one session in a pane (A10 of
// docs/design/context-tab.md), opened from the rail's ⤢: the rail's
// Context tab with every column, four picks over skills, MCP servers,
// custom agents and memory files. The title bar carries the session's
// name, the fill line, how it was counted and Recount (ContextViewTitle,
// drawn by ViewPane.tsx).

type Pick = 'skills' | 'servers' | 'agents' | 'memory';

const SKILL_NOTES = [
  "context: the skill's one-line listing, sent with every request; a dash is a skill not in the listing now, which costs nothing. The whole SKILL.md loads only when it runs.",
  '7d tokens: the tokens of the turns the skill ran in, over the last 7 days of sessions on this machine.',
];

function isShell(s: SessionInfo): boolean {
  return s.kind === 'shell' && s.claudeSessionId === null;
}

export function ContextViewTitle({ sessionId }: { sessionId: string }) {
  const { sessions } = useStore('sessions');
  const session = sessions.get(sessionId) ?? null;
  const [countingSince, setCountingSince] = useState<number | null>(null);
  const b = session?.context ?? null;
  // A counted breakdown after the click ends the count, as on the rail.
  useEffect(() => {
    if (countingSince === null) return;
    if (b !== null && b.detail === 'full' && b.at >= countingSince) setCountingSince(null);
    else {
      const timer = setTimeout(() => setCountingSince(null), 30_000);
      return () => clearTimeout(timer);
    }
  }, [countingSince, b]);
  const name = session?.name ?? 'a session that is gone';
  return (
    <>
      <span className="pane-name" title={`The context of ${name}`}>
        Context of {name}
      </span>
      {b !== null && <span className="pane-cwd">{`${session?.model ?? 'Model not reported'} · ${fillLine(b)}`}</span>}
      {b !== null && <span className="context-view-asof">{asOfText(b)}</span>}
      {session !== null && !isShell(session) && (
        <button
          className="context-view-recount"
          aria-busy={countingSince !== null || undefined}
          title="Count each part again with the token-count API; costs a few requests"
          onMouseDown={(ev) => {
            // A press on a pane title starts a drag and focuses the pane.
            ev.stopPropagation();
          }}
          onClick={() => {
            if (countingSince !== null) return;
            setCountingSince(Date.now());
            void askSessionContext(sessionId, 'full');
          }}
        >
          {countingSince !== null ? 'counting' : 'Recount'}
        </button>
      )}
    </>
  );
}

export function ContextView({ sessionId }: { sessionId: string }) {
  const { sessions } = useStore('sessions');
  const session = sessions.get(sessionId) ?? null;
  const [reply, setReply] = useState<ContextAsk | null>(null);
  // The pane asks for its own breakdown, since the rail's tab may be on
  // another tab or another session.
  useEffect(() => {
    let live = true;
    void askSessionContext(sessionId, 'summary').then((r) => {
      if (live) setReply(r);
    });
    return () => {
      live = false;
    };
  }, [sessionId]);
  if (session === null) return <div className="files-empty">This session is gone</div>;
  if (isShell(session)) return <div className="files-empty">This pane's session runs a shell, not Claude</div>;
  const b = session.context ?? null;
  if (b === null) {
    if (reply !== null && !reply.mod) return <div className="files-empty">emerald did not start this Claude, so it cannot ask for the breakdown</div>;
    return <div className="files-empty">No breakdown yet; Recount asks for one</div>;
  }
  return <Loaded session={session} b={b} />;
}

function Loaded({ session, b }: { session: SessionInfo; b: ContextBreakdown }) {
  const history = useContextHistory({ transcript: session.transcriptPath, at: b.at });
  const [pick, setPick] = useState<Pick>('skills');
  const used = contextUse(history.session, b);
  const skills = b.skills?.skillFrontmatter ?? [];
  const servers = serverRows(b, used);
  const picks: Array<[Pick, string, number]> = [
    ['skills', 'Skills', skills.length],
    ['servers', 'MCP servers', servers.length],
    ['agents', 'Custom agents', b.agents.length],
    ['memory', 'Memory files', b.memoryFiles.length],
  ];
  return (
    <div className="context-view" data-pick={pick}>
      <div className="context-view-picks">
        {picks.map(([p, word, n]) => (
          <button key={p} type="button" className="context-view-pick" data-pick={p} data-active={p === pick || undefined} onClick={() => setPick(p)}>
            {word} {n}
          </button>
        ))}
        <span className="context-view-spacer" />
        <span className="context-view-sort">{pick === 'skills' ? 'sorted by last used, never first' : 'sorted by tokens'}</span>
      </div>
      {pick === 'skills' && <SkillsTable skills={skills} folder={session.groupCwd} history={history} />}
      {pick === 'servers' && (
        <table className="context-view-table">
          <thead>
            <tr>
              <th>server</th>
              <th>tools</th>
              <th>context</th>
              <th>this session</th>
              <th>calls</th>
              <th>last used</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((r) => {
              const key = serverKeyOf(b, r.server);
              const machine = key === null ? undefined : history.servers[key];
              return (
                <tr key={r.server} data-row={r.server}>
                  <td>{r.server}</td>
                  <td className="context-view-figure">{r.tools}</td>
                  <td className="context-view-figure">{listingTokensText(r.tokens)}</td>
                  <td>{r.calls === null ? (history.reading ? '…' : '-') : r.calls > 0 ? callsText(r.calls) : 'unused'}</td>
                  <td className="context-view-figure">{history.reading ? '…' : String(machine?.calls ?? 0)}</td>
                  <td>{history.reading ? '…' : lastUsedWords(machine?.lastUsedAt, Date.now())}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {pick === 'agents' && (
        <table className="context-view-table">
          <thead>
            <tr>
              <th>agent</th>
              <th>source</th>
              <th>context</th>
              <th>this session</th>
            </tr>
          </thead>
          <tbody>
            {agentRows(b, used).map((a) => {
              const calls = used?.agentCalls.get(a.agentType) ?? 0;
              return (
                <tr key={a.agentType} data-row={a.agentType}>
                  <td>{a.agentType}</td>
                  <td>{a.source}</td>
                  <td className="context-view-figure">{listingTokensText(a.tokens)}</td>
                  <td>{used === null ? (history.reading ? '…' : '-') : calls > 0 ? callsText(calls) : 'unused'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {pick === 'memory' && (
        <table className="context-view-table">
          <thead>
            <tr>
              <th>file</th>
              <th>where</th>
              <th>context</th>
            </tr>
          </thead>
          <tbody>
            {[...b.memoryFiles]
              .sort((x, z) => z.tokens - x.tokens)
              .map((f) => (
                <tr key={f.path} data-row={f.path} data-clickable="" title={`Open ${f.path} in a file tab`} onClick={() => openFileTab(f.path)}>
                  <td title={f.path}>{baseName(f.path)}</td>
                  <td>{f.type}</td>
                  <td className="context-view-figure">{listingTokensText(f.tokens)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SkillsTable({ skills, folder, history }: { skills: readonly ContextSkill[]; folder: string; history: ContextHistoryView }) {
  const { effective } = useListing(folder);
  const now = Date.now();
  const groups = skillGroups(skills, history);
  // The never used first (the settings group then the synced, each by
  // name), then the used from the longest ago to the most recent, as A10
  // draws it.
  const rows = history.reading ? [...skills].sort((a, z) => z.tokens - a.tokens) : [...groups.never.settings, ...groups.never.synced, ...[...groups.used].reverse()];
  return (
    <>
      {!history.reading && (
        <div className="context-view-summary">
          {neverSummary(groups).map((line, i) => (
            <div key={i} className={i === 0 ? 'context-view-summary-lead' : undefined}>
              {line}
            </div>
          ))}
        </div>
      )}
      <table className="context-view-table">
        <thead>
          <tr>
            <th>skill</th>
            <th>source</th>
            <th title="The skill's line in the listing, sent with every request">context</th>
            <th title="Tokens in the turns the skill ran, over the last 7 days of sessions on this machine">7d tokens</th>
            <th>uses</th>
            <th>last used</th>
            <th title={LISTING_COLUMN_TITLE}>in the listing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const h = skillHistoryOf(history, s);
            const value = effective(s.name);
            const reading = history.reading;
            return (
              <tr key={s.name} data-row={s.name}>
                <td className={listingNameClass(value) || undefined}>{s.name}</td>
                <td>{skillSourceLabel(s)}</td>
                <td className="context-view-figure">{listingTokensText(s.tokens)}</td>
                <td className="context-view-figure" title={reading ? 'Reading every transcript on this machine' : undefined}>
                  {reading ? '…' : tokens7dText(h?.tokens7d ?? 0)}
                </td>
                <td className="context-view-figure">{reading ? '…' : `${h?.uses ?? 0}×`}</td>
                <td data-never={!reading && h === undefined && value !== 'off' ? '' : undefined}>{value === 'off' ? 'off' : reading ? '…' : lastUsedWords(h?.lastUsedAt, now)}</td>
                <td>
                  <ListingSwitch name={s.name} folder={folder} source={s.source} {...(s.pluginName === undefined ? {} : { pluginName: s.pluginName })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="context-view-notes">
        {SKILL_NOTES.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
    </>
  );
}

// The wire prefix the history keys a server by: its tools' own names.
function serverKeyOf(b: ContextBreakdown, server: string): string | null {
  for (const t of b.mcpTools) if (t.serverName === server) return mcpServerKey(t.name);
  return null;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}
