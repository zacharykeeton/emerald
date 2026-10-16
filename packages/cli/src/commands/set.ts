import { SESSION_COLOR_NAMES, SESSION_PHASES, isSessionPhase, parseSessionColor } from '@emerald/shared';
import type { SessionPhase } from '@emerald/shared';
import { parse, positionals } from '../args.ts';
import { usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { findSession, withDaemon } from '../connect.ts';
import { shortId } from '../resolve.ts';

const options = {
  comment: { type: 'string' },
  'clear-comment': { type: 'boolean', default: false },
  phase: { type: 'string' },
  'clear-phase': { type: 'boolean', default: false },
  color: { type: 'string' },
  scheme: { type: 'string' },
  'clear-scheme': { type: 'boolean', default: false },
  'keep-whole': { type: 'string' },
  json: { type: 'boolean', default: false },
} as const;

// The checkpoint: what the session means to be doing, written by the
// Claude session itself (the skill tells it when) or by a person. It shows
// on the sidebar row in place of the last turn until it is replaced or
// cleared, and survives a resume and a daemon restart. The colour (M29)
// rides the same command: the bar on the row and the tint of the pane
// title, one of the palette names or any hex. The colour scheme (M9 fix
// 244) too: the terminal colours this one session wears, by the name the
// pane menu lists, cleared back to the window's pick with --clear-scheme.
// And the keep-whole mark (M9 fix 773): --keep-whole on has the emerald
// mod skip Claude Code's idle compaction for a Claude session.
//
// With no <session> the command is the session it runs in: the daemon
// stamps EMERALD_SESSION_ID on every pty it spawns, so a Claude writing its
// own checkpoint names nobody (M9 fix 351; the demo skills used to hand it
// a placeholder to fill in).
const COLOR_NAMES = Object.keys(SESSION_COLOR_NAMES).join('|');

export function sessionRefFor(ref: string | undefined, env: NodeJS.ProcessEnv): string {
  if (ref !== undefined) return ref;
  const own = env['EMERALD_SESSION_ID'];
  if (own === undefined || own.trim() === '') throw usageError('not inside emerald (EMERALD_SESSION_ID is not set); name a session');
  return own;
}

const command: Command = {
  name: 'set',
  summary: "write a session's checkpoint, a comment and a phase, or set its colour (no <session>: the one this runs in)",
  usage: `emmer set [<session>] [--comment <text> | --clear-comment] [--phase ${SESSION_PHASES.join('|')} | --clear-phase] [--color ${COLOR_NAMES}|#rrggbb] [--scheme <name> | --clear-scheme] [--keep-whole on|off] [--json]`,
  async run(argv) {
    const parsed = parse(argv, options);
    const ref = sessionRefFor(positionals(parsed, [], ['session']).session, process.env);
    const v = parsed.values;
    const fields: { comment?: string | null; phase?: SessionPhase | null; color?: string; scheme?: string | null; keepWhole?: boolean } = {};
    if (v.comment !== undefined && v['clear-comment']) throw usageError('--comment and --clear-comment together');
    if (v.comment !== undefined) fields.comment = v.comment;
    if (v['clear-comment']) fields.comment = null;
    if (v.phase !== undefined && v['clear-phase']) throw usageError('--phase and --clear-phase together');
    if (v.phase !== undefined) {
      if (!isSessionPhase(v.phase)) throw usageError(`--phase must be one of ${SESSION_PHASES.join(', ')}, got ${JSON.stringify(v.phase)}`);
      fields.phase = v.phase;
    }
    if (v['clear-phase']) fields.phase = null;
    if (v.color !== undefined) {
      const color = parseSessionColor(v.color);
      if (color === null) throw usageError(`--color must be one of ${Object.keys(SESSION_COLOR_NAMES).join(', ')} or a hex colour like #69ceaa, got ${JSON.stringify(v.color)}`);
      fields.color = color;
    }
    if (v.scheme !== undefined && v['clear-scheme']) throw usageError('--scheme and --clear-scheme together');
    if (v.scheme !== undefined) {
      if (v.scheme.trim() === '') throw usageError('--scheme needs a name, the one the pane menu lists');
      fields.scheme = v.scheme.trim();
    }
    if (v['clear-scheme']) fields.scheme = null;
    if (v['keep-whole'] !== undefined) {
      if (v['keep-whole'] === 'on') fields.keepWhole = true;
      else if (v['keep-whole'] === 'off') fields.keepWhole = false;
      else throw usageError(`--keep-whole must be on or off, got ${JSON.stringify(v['keep-whole'])}`);
    }
    if (fields.comment === undefined && fields.phase === undefined && fields.color === undefined && fields.scheme === undefined && fields.keepWhole === undefined) throw usageError('nothing to set: pass --comment, --clear-comment, --phase, --clear-phase, --color, --scheme, --clear-scheme or --keep-whole');

    await withDaemon(async (client) => {
      const found = await findSession(client, ref);
      await client.request('session.set', { sessionId: found.id, ...fields });
      // The reply carries nothing; the list is the truth after the write.
      const after = (await client.request('session.list', {})).sessions.find((s) => s.id === found.id) ?? found;
      if (v.json) {
        printJson({ sessionId: after.id, name: after.name, comment: after.comment, phase: after.phase, color: after.color, scheme: after.scheme ?? null, keepWhole: after.keepWhole === true });
        return;
      }
      const parts: string[] = [];
      if (fields.comment !== undefined) parts.push(after.comment === null ? 'comment cleared' : `comment ${JSON.stringify(after.comment)}`);
      if (fields.phase !== undefined) parts.push(after.phase === null ? 'phase cleared' : `phase ${after.phase}`);
      if (fields.color !== undefined) parts.push(`colour ${after.color ?? 'none'}`);
      if (fields.scheme !== undefined) parts.push(after.scheme === null || after.scheme === undefined ? "scheme cleared, the window's" : `scheme ${after.scheme}`);
      if (fields.keepWhole !== undefined) parts.push(after.keepWhole === true ? 'kept whole while idle' : 'no longer kept whole');
      println(`set ${shortId(after.id)} ${after.name}: ${parts.join(', ')}`);
    });
  },
};

export default command;
