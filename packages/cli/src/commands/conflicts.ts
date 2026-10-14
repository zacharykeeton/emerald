import fs from 'node:fs';
import { formatDuration } from '@emerald/shared';
import type { ConflictReport, SessionInfo } from '@emerald/shared';
import { parse, positionals } from '../args.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { withDaemon } from '../connect.ts';

const options = {
  // One repository's block alone: the sessions whose folder is under
  // this path.
  folder: { type: 'string' },
  json: { type: 'boolean', default: false },
} as const;

// The conflict forecast as text (M9 fix 320, docs/design/
// conflict-forecast.md section 10): per repository the head line
// (`emerald · 5 sessions on 5 branches · 3 pairs will conflict`), then
// the pairs with every conflicted file named in full (the terminal has
// the width; `and 2 more` belongs to the card alone), then the bases,
// one per session with a branch, `4 ahead,  0 behind main, forked 3h
// ago`, in that order and separately greppable. A session in no pair
// prints its base line and nothing else; a repository with no pair
// still prints its bases, since that is the reading. Columns are
// padded to the widest branch name and the widest figure. --json
// gives { conflicts, base } as the wire carries them.

export type ConflictSession = Pick<SessionInfo, 'id' | 'name' | 'branch' | 'cwd' | 'groupCwd' | 'state'>;

// The sessions the report knows, grouped by repository key, each
// group's lines; a session with no base (no branch, or a repository
// with no default branch) is listed under its pairs' repository, or
// on its own with the pairs alone.
export function renderConflicts(report: ConflictReport, sessions: readonly ConflictSession[], now: number): string[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const repoOf = (id: string): string => report.base[id]?.repo ?? byId.get(id)?.groupCwd ?? id;
  const repos = new Map<string, { ids: Set<string>; pairs: ConflictReport['conflicts'] }>();
  const into = (key: string) => {
    const r = repos.get(key) ?? { ids: new Set<string>(), pairs: [] };
    repos.set(key, r);
    return r;
  };
  for (const id of Object.keys(report.base)) into(repoOf(id)).ids.add(id);
  for (const p of report.conflicts) {
    const r = into(repoOf(p.a));
    r.ids.add(p.a);
    r.ids.add(p.b);
    r.pairs.push(p);
  }
  const lines: string[] = [];
  const branchOf = (id: string) => byId.get(id)?.branch ?? byId.get(id)?.name ?? id.slice(0, 8);
  for (const [, r] of [...repos].sort(([a], [b]) => a.localeCompare(b))) {
    if (lines.length > 0) lines.push('');
    const ids = [...r.ids].sort((a, b) => branchOf(a).localeCompare(branchOf(b)));
    const branches = new Set(ids.map(branchOf));
    const pairs = r.pairs.length;
    lines.push(`emerald · ${ids.length} ${ids.length === 1 ? 'session' : 'sessions'} on ${branches.size} ${branches.size === 1 ? 'branch' : 'branches'} · ${pairs === 0 ? 'no pairs' : pairs === 1 ? '1 pair' : `${pairs} pairs`} will conflict`);
    const wide = Math.max(...ids.map((id) => branchOf(id).length), 1);
    if (pairs > 0) {
      lines.push('');
      // The two names in one order whatever the ids' order was.
      for (const p of r.pairs) {
        const [first, second] = [branchOf(p.a), branchOf(p.b)].sort((x, y) => x.localeCompare(y));
        lines.push(`  ${first!.padEnd(wide)}  ${second!.padEnd(wide)}  ${p.files.join(', ')}`);
      }
    }
    const based = ids.filter((id) => report.base[id] !== undefined);
    if (based.length > 0) {
      lines.push('');
      const aheadW = Math.max(...based.map((id) => String(report.base[id]!.ahead).length));
      const behindW = Math.max(...based.map((id) => String(report.base[id]!.behind).length));
      for (const id of based) {
        const b = report.base[id]!;
        lines.push(`  ${branchOf(id).padEnd(wide)}  ${String(b.ahead).padStart(aheadW)} ahead, ${String(b.behind).padStart(behindW)} behind ${b.defaultBranch}, forked ${formatDuration(b.forkedAt, now)} ago`);
      }
    }
  }
  if (lines.length === 0) lines.push('emerald · no sessions on a branch · no pairs will conflict');
  return lines;
}

// The report cut to the sessions under a folder: their bases and the
// pairs both of whose sessions are among them.
export function scopeReport(report: ConflictReport, sessions: readonly ConflictSession[], folder: string): ConflictReport {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const root = norm(folder);
  const under = (p: string | null) => p !== null && (norm(p) === root || norm(p).startsWith(root + '/'));
  const keep = new Set(sessions.filter((s) => under(s.cwd) || under(s.groupCwd)).map((s) => s.id));
  return { conflicts: report.conflicts.filter((p) => keep.has(p.a) && keep.has(p.b)), base: Object.fromEntries(Object.entries(report.base).filter(([id]) => keep.has(id))) };
}

function realFolder(folder: string): string {
  try {
    return fs.realpathSync.native(folder);
  } catch {
    return folder;
  }
}

const command: Command = {
  name: 'conflicts',
  summary: 'the conflict forecast: which live sessions\' branches would conflict on a merge, on what, and how far each is behind the default',
  usage: 'emmer conflicts [--folder <path>] [--json]',
  async run(argv) {
    const parsed = parse(argv, options);
    positionals(parsed, []);
    const { report, sessions } = await withDaemon(async (client) => {
      const [report, { sessions }] = await Promise.all([client.request('conflicts.get', {}), client.request('session.list', {})]);
      return { report, sessions };
    });
    // The daemon spells a folder the real way (a worktree under an 8.3
    // temp path comes back long), so the given one is resolved the same
    // way when it exists.
    const scoped = parsed.values.folder === undefined ? report : scopeReport(report, sessions, realFolder(parsed.values.folder));
    if (parsed.values.json) {
      printJson(scoped);
      return;
    }
    for (const line of renderConflicts(scoped, sessions, Date.now())) println(line);
  },
};

export default command;
