import type { SessionInfo } from '@emerald/shared';
import { CliError } from './cli-error.ts';

// Turns what the user typed into one session. Exact id wins, then an exact
// name, then a unique id prefix. Names are matched as typed; ids are UUIDs
// so their prefixes compare case-insensitively. Anything that matches more
// than one session is refused with the candidates listed, rather than
// guessed at, because most commands that take a session are not undoable.
// Typed on the three fields it reads, so explain can resolve against
// sessions.json entries when the daemon is down.
export type Resolvable = Pick<SessionInfo, 'id' | 'name' | 'state'>;

export function resolveSession<S extends Resolvable>(sessions: readonly S[], ref: string): S {
  const wanted = ref.trim();
  if (wanted === '') throw new CliError('empty session reference');

  const byId = sessions.find((s) => s.id === wanted);
  if (byId !== undefined) return byId;

  const byName = sessions.filter((s) => s.name === wanted);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) throw ambiguous(wanted, byName);

  const lower = wanted.toLowerCase();
  const byPrefix = sessions.filter((s) => s.id.toLowerCase().startsWith(lower));
  if (byPrefix.length === 1) return byPrefix[0]!;
  if (byPrefix.length > 1) throw ambiguous(wanted, byPrefix);

  throw new CliError(`no session matches ${JSON.stringify(wanted)} (see emmer ls)`);
}

function ambiguous(ref: string, matches: readonly Resolvable[]): CliError {
  const list = matches.map((s) => `${shortId(s.id)} ${s.name} (${s.state})`).join(', ');
  return new CliError(`${JSON.stringify(ref)} matches ${matches.length} sessions: ${list}`);
}

// The first UUID block: unique enough on one machine and short enough to type.
export function shortId(id: string): string {
  return id.slice(0, 8);
}
