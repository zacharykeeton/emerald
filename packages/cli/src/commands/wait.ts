import { describeState } from '@emerald/shared';
import type { ServerMessage, SessionInfo, SessionState } from '@emerald/shared';
import { integerOption, parse, positionals } from '../args.ts';
import { CliError, EXIT, usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { connect } from '../connect.ts';
import { resolveSession, shortId } from '../resolve.ts';

const STATES: SessionState[] = ['starting', 'idle', 'working', 'waiting', 'needs-input', 'done', 'errored', 'exited'];

// Conditions on the PTY rather than the hook-derived state, so they work
// for a plain shell and for a Claude session before its hooks report in.
// tui-idle: nothing written for --quiet-ms. exit: the process ended.
const PTY_CONDITIONS = ['tui-idle', 'exit'] as const;
type PtyCondition = (typeof PTY_CONDITIONS)[number];
// stale (M9 fix 232): a working session flagged quiet by the daemon, no
// hook for three times its turn's median tool gap or the ten-minute
// floor; the trigger of a watchdog, so a supervising session acts before
// anyone hears the alarm.
const FLAGS = ['stale'] as const;
type Flag = (typeof FLAGS)[number];
type Target = SessionState | PtyCondition | Flag;
const TARGETS: readonly string[] = [...STATES, ...PTY_CONDITIONS, ...FLAGS];

// Whether a session is at the target: its state, or the stale flag.
export function atTarget(session: Pick<SessionInfo, 'state' | 'stale'>, target: SessionState | Flag): boolean {
  return target === 'stale' ? session.state === 'working' && session.stale : session.state === target;
}

export const DEFAULT_QUIET_MS = 1500;

const options = {
  for: { type: 'string' },
  // Milliseconds; 0 or absent waits for as long as it takes.
  timeout: { type: 'string' },
  // How long the output has to stay quiet for tui-idle.
  'quiet-ms': { type: 'string' },
  json: { type: 'boolean', default: false },
} as const;

type Outcome = { kind: 'reached'; session: SessionInfo } | { kind: 'timeout' } | { kind: 'gone'; session: SessionInfo | null };

// Waits on the sessions subscription rather than polling, so the state is
// seen even when the app acks a done session to idle a few milliseconds
// later (docs/PLAN.md, M5 gotcha 6): the daemon pushes every change.
async function waitFor(ref: string, target: SessionState | Flag, timeoutMs: number): Promise<Outcome> {
  const client = await connect();
  try {
    // Subscribe before the list so no change can fall between the two.
    await client.request('subscribe', { topics: ['sessions'] });
    const { sessions } = await client.request('session.list', {});
    const found = resolveSession(sessions, ref);
    if (atTarget(found, target)) return { kind: 'reached', session: found };
    if (found.state === 'exited') return { kind: 'gone', session: found };

    return await new Promise<Outcome>((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const finish = (outcome: Outcome) => {
        if (timer !== null) clearTimeout(timer);
        client.off('message', onMessage);
        client.off('close', onClose);
        resolve(outcome);
      };
      const onMessage = (msg: ServerMessage) => {
        if (msg.type === 'session.changed' && msg.session.id === found.id) {
          if (atTarget(msg.session, target)) finish({ kind: 'reached', session: msg.session });
          // A session that exits can never reach anything else.
          else if (msg.session.state === 'exited') finish({ kind: 'gone', session: msg.session });
        } else if (msg.type === 'session.removed' && msg.sessionId === found.id) {
          finish({ kind: 'gone', session: null });
        }
      };
      const onClose = () => finish({ kind: 'gone', session: null });
      client.on('message', onMessage);
      client.on('close', onClose);
      if (timeoutMs > 0) timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    });
  } finally {
    client.close();
  }
}

// The daemon pushes pty.activity while the session writes, at most every
// Limits.activityIntervalMs and once more after the last byte, so the idle
// clock restarts from each push and no polling is needed. An exited
// session is quiet for good, so it counts as idle.
async function waitQuiet(ref: string, quietMs: number, timeoutMs: number): Promise<Outcome> {
  const client = await connect();
  try {
    await client.request('subscribe', { topics: ['sessions', 'activity'] });
    const { sessions } = await client.request('session.list', {});
    const found = resolveSession(sessions, ref);
    if (found.state === 'exited') return { kind: 'reached', session: found };
    const { lastOutputAt } = await client.request('session.read', { sessionId: found.id, maxBytes: 0 });
    let quietSince = lastOutputAt ?? 0;
    let latest = found;

    return await new Promise<Outcome>((resolve) => {
      let quietTimer: NodeJS.Timeout | null = null;
      let timer: NodeJS.Timeout | null = null;
      const finish = (outcome: Outcome) => {
        if (timer !== null) clearTimeout(timer);
        if (quietTimer !== null) clearTimeout(quietTimer);
        client.off('message', onMessage);
        client.off('close', onClose);
        resolve(outcome);
      };
      const arm = () => {
        if (quietTimer !== null) clearTimeout(quietTimer);
        const wait = Math.max(0, quietSince + quietMs - Date.now());
        quietTimer = setTimeout(() => finish({ kind: 'reached', session: latest }), wait);
      };
      const onMessage = (msg: ServerMessage) => {
        if (msg.type === 'pty.activity' && msg.sessionId === found.id) {
          quietSince = Math.max(quietSince, msg.at);
          arm();
        } else if (msg.type === 'session.changed' && msg.session.id === found.id) {
          latest = msg.session;
          if (msg.session.state === 'exited') finish({ kind: 'reached', session: msg.session });
        } else if (msg.type === 'session.removed' && msg.sessionId === found.id) {
          finish({ kind: 'gone', session: null });
        }
      };
      const onClose = () => finish({ kind: 'gone', session: null });
      client.on('message', onMessage);
      client.on('close', onClose);
      arm();
      if (timeoutMs > 0) timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    });
  } finally {
    client.close();
  }
}

function isTarget(value: string): value is Target {
  return TARGETS.includes(value);
}

const command: Command = {
  name: 'wait',
  summary: 'block until a session reaches a state, goes quiet, stalls or exits',
  usage: `emmer wait <session> --for ${TARGETS.join('|')} [--timeout ms] [--quiet-ms ms] [--json]`,
  async run(argv) {
    const parsed = parse(argv, options);
    const { session } = positionals(parsed, ['session']);
    const target = parsed.values.for;
    if (target === undefined) throw usageError('missing --for');
    if (!isTarget(target)) throw usageError(`--for must be one of ${TARGETS.join(', ')}, got ${JSON.stringify(target)}`);
    const timeoutMs = integerOption(parsed.values.timeout, 'timeout', 0);
    const quietMs = integerOption(parsed.values['quiet-ms'], 'quiet-ms', DEFAULT_QUIET_MS);
    if (parsed.values['quiet-ms'] !== undefined && target !== 'tui-idle') throw usageError('--quiet-ms only goes with --for tui-idle');

    const started = Date.now();
    const outcome = target === 'tui-idle' ? await waitQuiet(session, quietMs, timeoutMs) : await waitFor(session, target === 'exit' ? 'exited' : target, timeoutMs);
    const waited = Date.now() - started;
    switch (outcome.kind) {
      case 'reached': {
        const s = outcome.session;
        if (parsed.values.json) printJson({ session: s, waitedMs: waited, ...(target === 'exit' ? { exitCode: s.exitCode } : {}) });
        else if (target === 'exit') println(`${shortId(s.id)} ${s.name} exited with code ${s.exitCode ?? 'unknown'} after ${waited} ms`);
        else if (target === 'tui-idle') println(`${shortId(s.id)} ${s.name} is quiet after ${waited} ms`);
        // The badge words (`quiet 12m`), so the line says how long the
        // silence is, not only that there is one.
        else if (target === 'stale') println(`${shortId(s.id)} ${s.name} is ${describeState(s).text} after ${waited} ms`);
        else println(`${shortId(s.id)} ${s.name} is ${s.state} after ${waited} ms`);
        return EXIT.ok;
      }
      case 'timeout':
        throw new CliError(`timed out after ${timeoutMs} ms waiting for ${target}`, EXIT.timeout);
      case 'gone':
        throw new CliError(
          outcome.session === null
            ? `session was removed while waiting for ${target}`
            : `${shortId(outcome.session.id)} ${outcome.session.name} exited before reaching ${target}`,
        );
      default:
        return EXIT.failure;
    }
  },
};

export default command;
