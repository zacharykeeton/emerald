import type { SessionInfo, SessionTouched } from '@emerald/shared';
import type { GraphCommit } from '../../preload/api.ts';
import { agentLabel, agentRole, underFolder } from './commit-graph-model.ts';
import type { GraphSession } from './commit-graph-model.ts';

// The write graph (M9 fix 255): a folder that is no repository has no
// commits to draw, but every session keeps the files it wrote (M9 fix
// 198, SessionTouched), so the Commits tab draws the folder's sessions
// as lanes with one node per file written instead of one per commit.
// The lane layout is the commit graph's whole: each write is handed to
// sessionGraph as a commit-shaped item under a hash of its own, its
// subject the path relative to the folder, its author the session or
// the member that wrote it, and its first parent the write before it on
// the same chain (a session's own writes chain on its line; a member's
// chain among themselves and fork off the session's latest own write
// before the member's first, the way a worktree lane forks off the
// commit its branch was cut from), so the walk draws a member's writes
// on a lane of their own in the session's colour as M61 draws its
// worktree. A path written twice is one node at its last time, as the
// touched list keeps it. The sessions handed over claim their writes as
// their commits, so M58's owner rule credits every node without a
// trailer, and a session's real commits (of some other repository) are
// left out, since they are not in the list drawn.

export const WRITE_PREFIX = 'write:';

export interface GraphWrite {
  // The hash the node goes by, WRITE_PREFIX plus the session and the
  // write's place in its list.
  hash: string;
  path: string;
  // The path relative to the folder, forward slashes; the whole path for
  // a file written outside it.
  rel: string;
  at: number;
  sessionId: string;
  agentId: string | null;
  // Who wrote it, for the card and the sideways label: the session's
  // name, with the member's label after it for an agent's write.
  by: string;
}

export interface WriteGraphInput {
  commits: GraphCommit[];
  sessions: GraphSession[];
  writes: Map<string, GraphWrite>;
}

export function isWriteHash(hash: string): boolean {
  return hash.startsWith(WRITE_PREFIX);
}

// The path as the row shows it: relative to the folder when under it,
// forward slashes, else the whole path.
export function writeRel(file: string, folder: string): string {
  if (!underFolder(file, folder)) return file;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = norm(file).slice(norm(folder).length).replace(/^\/+/, '');
  return rel === '' ? norm(file) : rel;
}

// Whether a session is the folder's, by the commit graph's rule: the
// folder the sidebar groups it under, or its live folder, is at or
// under the folder.
export function inWriteFolder(s: Pick<SessionInfo, 'cwd' | 'spawnCwd' | 'groupCwd'>, folder: string): boolean {
  const group = s.groupCwd || s.spawnCwd;
  return underFolder(group, folder) || underFolder(s.cwd, folder);
}

// What the input needs of a record: the graph's fields and the touched
// list; a test hands in the graph's fixtures with a list added.
export type WriteSession = GraphSession & Partial<Pick<SessionInfo, 'touched'>>;

export function writeGraphInput(sessions: readonly WriteSession[], folder: string): WriteGraphInput {
  const commits: Array<GraphCommit & { seq: number }> = [];
  const writes = new Map<string, GraphWrite>();
  const out: GraphSession[] = [];
  for (const s of sessions) {
    if (!inWriteFolder(s, folder)) continue;
    const touched: readonly SessionTouched[] = s.touched ?? [];
    const claims: GraphSession['commits'] = [];
    // The chains: the session's own last write, and each member's.
    let ownLast: string | null = null;
    const memberLast = new Map<string, string>();
    touched.forEach((t, i) => {
      const hash = `${WRITE_PREFIX}${s.id}:${i}`;
      const member = t.agentId === null ? null : (s.team.find((m) => m.id === t.agentId && m.kind === 'agent') ?? null);
      const parent = t.agentId === null ? ownLast : (memberLast.get(t.agentId) ?? ownLast);
      const by = t.agentId === null ? s.name : `${s.name} · ${member === null ? t.agentId : `${agentRole(member)} · ${agentLabel(member)}`}`;
      const rel = writeRel(t.path, folder);
      commits.push({ hash, subject: rel, author: by, at: t.at, authoredAt: t.at, claudeSession: null, parents: parent === null ? [] : [parent], refs: [], seq: i });
      writes.set(hash, { hash, path: t.path, rel, at: t.at, sessionId: s.id, agentId: t.agentId, by });
      if (t.agentId === null) ownLast = hash;
      else memberLast.set(t.agentId, hash);
      claims.push(t.agentId === null ? { hash, at: t.at } : { hash, at: t.at, agent: { id: t.agentId, branch: member?.branch ?? null, type: member?.type ?? null, description: member?.description ?? null } });
    });
    // The record with its writes as its commits, and its members' real
    // commits dropped, so nothing of another repository is claimed.
    out.push({ ...s, commits: claims, team: s.team.map((m) => ({ ...m, commits: [] })) });
  }
  // Newest first, as git log gives it; a parent is always earlier in
  // its session's list, so on a tie the later place sits above.
  commits.sort((a, b) => b.at - a.at || b.seq - a.seq);
  return { commits: commits.map(({ seq: _seq, ...c }) => c), sessions: out, writes };
}
