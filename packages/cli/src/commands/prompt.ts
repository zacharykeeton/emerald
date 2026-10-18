import { describeState, MOD_CHANNEL_LEVEL, modRoutable } from '@emerald/shared';
import type { ServerMessage, SessionInfo } from '@emerald/shared';
import { integerOption, parse, readText } from '../args.ts';
import { CliError, EXIT, usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { connectHello } from '../connect.ts';
import { sleep } from '../daemon-process.ts';
import { refuseBusy } from '../mod-route.ts';
import type { PipeClient } from '@emerald/shared/pipe-client';
import { resolveSession, shortId } from '../resolve.ts';
import { CLAUDE_ENTER_DELAY_MS } from './send.ts';

// send --enter and wait in one command, with herdr's two gates: a session
// that is waiting on a person is refused (the text would answer its
// question), and a session that does not start working after the send is
// reported as stalled rather than waited on for ever, since the text may
// be sitting in its input box.

// How long the session has to go working after Enter. Claude Code posts
// UserPromptSubmit as soon as it takes the line, so a whole second of
// slack is plenty, and five covers a box under load.
export const STALL_MS = 5000;

// Still busy: working, and M30's waiting (a turn ended with background
// tasks running; the agent is re-invoked when one finishes). Compared by
// name so this file needs nothing from the branch that adds the state.
const BUSY = new Set<string>(['working', 'waiting']);
// Where the second wait ends.
const SETTLED = new Set<string>(['done', 'needs-input', 'errored', 'exited']);

export interface PromptOptions {
  ref: string;
  // The text, or the name of a saved prompt (M56) to take it from.
  text: string;
  saved?: boolean;
  force: boolean;
  // 0 waits for as long as it takes.
  timeoutMs: number;
  stallMs?: number;
  // Refuse a working session (M9 fix 741).
  ifIdle?: boolean;
}

// How the text went in (M9 fix 741): submitted by the emerald mod, or
// typed into the pty with the Enter pause.
type Via = 'mod' | 'typed';

export type PromptOutcome =
  | { kind: 'done'; session: SessionInfo; reply: string | null; waitedMs: number; via: Via }
  | { kind: 'needs-input'; session: SessionInfo; waitedMs: number; via: Via };

type Step = { kind: 'reached'; session: SessionInfo } | { kind: 'timeout' } | { kind: 'gone'; session: SessionInfo | null };

// The session's changes as the daemon pushes them, kept in order so a
// change that arrives while one step is still looking is there for the
// next step; the first wait consumes up to the working push, the second
// starts right after it.
class SessionWatch {
  private readonly queue: SessionInfo[] = [];
  private gone: SessionInfo | null | false = false;
  private wake: (() => void) | null = null;

  constructor(client: PipeClient, id: string) {
    const onMessage = (msg: ServerMessage) => {
      if (msg.type === 'session.changed' && msg.session.id === id) {
        this.queue.push(msg.session);
        if (msg.session.state === 'exited') this.gone = msg.session;
      } else if (msg.type === 'session.removed' && msg.sessionId === id) {
        this.gone = null;
      } else return;
      this.wake?.();
    };
    client.on('message', onMessage);
    client.on('close', () => {
      this.gone = null;
      this.wake?.();
    });
  }

  async until(pred: (s: SessionInfo) => boolean, timeoutMs: number): Promise<Step> {
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity;
    for (;;) {
      while (this.queue.length > 0) {
        const s = this.queue.shift()!;
        if (pred(s)) return { kind: 'reached', session: s };
        if (s.state === 'exited') return { kind: 'gone', session: s };
      }
      if (this.gone !== false) return { kind: 'gone', session: this.gone };
      const left = deadline - Date.now();
      if (left <= 0) return { kind: 'timeout' };
      await new Promise<void>((resolve) => {
        const timer = left === Infinity ? null : setTimeout(resolve, left);
        this.wake = () => {
          if (timer !== null) clearTimeout(timer);
          resolve();
        };
      });
      this.wake = null;
    }
  }
}

// M9 fix 778: the prompt Claude Code put back in its input after an
// interrupt, which a typed send would be joined onto. The text of the last
// `❯` row, read as the app's promptRowText reads it (chat-model.ts), and
// only when it starts with the session's last prompt cut to 20 characters:
// the CLI has neither the ghost field nor colour, so an input holding
// anything else (a placeholder, a suggestion) is never refused.
export function heldPrompt(rows: readonly string[], lastPrompt: string | null): string | null {
  if (lastPrompt === null) return null;
  const head = (lastPrompt.split('\n')[0] ?? '').trim().slice(0, 20);
  if (head === '') return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!.trimStart();
    if (!row.startsWith('❯')) continue;
    const text = row.slice(1).trim();
    return text.startsWith(head) ? text : null;
  }
  return null;
}

function goneError(step: Extract<Step, { kind: 'gone' }>): CliError {
  return new CliError(step.session === null ? `session was removed while waiting on the prompt` : `${shortId(step.session.id)} ${step.session.name} exited while waiting on the prompt`, EXIT.failure);
}

export async function runPrompt(opts: PromptOptions): Promise<PromptOutcome> {
  const stallMs = opts.stallMs ?? STALL_MS;
  const { client, hello } = await connectHello();
  try {
    // Subscribe before the list so no change can fall between the two.
    await client.request('subscribe', { topics: ['sessions'] });
    const { sessions } = await client.request('session.list', {});
    const found = resolveSession(sessions, opts.ref);
    let text = opts.text;
    if (opts.saved === true) {
      const { prompts } = await client.request('prompts.list', {});
      const saved = prompts.find((p) => p.name === opts.text);
      if (saved === undefined) throw new CliError(`no saved prompt named ${opts.text} (emmer prompts ls)`);
      text = saved.text;
    }
    if (found.state === 'exited') throw new CliError(`${shortId(found.id)} ${found.name} has exited; resume it first`);
    // Gate one: the session is asking a person something, and the text
    // would land as the answer.
    if (found.state === 'needs-input' && !opts.force) {
      throw new CliError(`${shortId(found.id)} ${found.name} ${describeState(found).text}; answer it first, or --force to send anyway`);
    }

    if (opts.ifIdle === true) refuseBusy(found);

    const watch = new SessionWatch(client, found.id);
    // Through the emerald mod when its channel is up (M9 fix 741), with no
    // pause; a forced answer to a dialog stays typed, since it is keys for
    // the dialog rather than a prompt.
    let via: Via = 'typed';
    if (found.kind === 'claude' && (hello.featureLevel ?? 1) >= MOD_CHANNEL_LEVEL && found.state !== 'needs-input' && modRoutable(text)) {
      via = (await client.request('session.submit', { sessionId: found.id, text })).via;
    }
    if (via === 'typed') {
      // M9 fix 778: an input holding the prompt given back after an
      // interrupt would take this text onto its end. Only a session Claude
      // runs in carries lastPrompt, so a plain shell is never read. The
      // mod route is not checked: whether $.prompt.submit joins onto the
      // input's text is not traced.
      if (!opts.force && found.lastPrompt !== null) {
        const reply = await client.request('pty.screen', { sessionId: found.id }).catch(() => null);
        const held = reply === null ? null : heldPrompt(reply.rows, found.lastPrompt);
        if (held !== null) {
          throw new CliError(`${shortId(found.id)} ${found.name}'s input holds the prompt Claude Code gave back after an interrupt (${JSON.stringify(held.slice(0, 40))}); clear it, or --force to send anyway`, EXIT.failure);
        }
      }
      client.send({ type: 'pty.input', sessionId: found.id, data: text });
      // The same pause send --enter takes, so Claude Code does not take the
      // line for a paste and turn the Enter into a newline.
      if (found.kind === 'claude') await sleep(CLAUDE_ENTER_DELAY_MS);
      client.send({ type: 'pty.input', sessionId: found.id, data: '\r' });
    }
    const started = Date.now();

    // Gate two: the session has to move. One already busy is taken as
    // moving; the text is queued behind its turn and the second wait
    // ends with whichever turn settles first.
    if (!BUSY.has(found.state)) {
      const moved = await watch.until((s) => BUSY.has(s.state), stallMs);
      if (moved.kind === 'timeout') {
        throw new CliError(`${shortId(found.id)} ${found.name} did not start working within ${stallMs} ms; the text may be sitting in its input box (emmer read ${shortId(found.id)} --screen)`, EXIT.stalled);
      }
      if (moved.kind === 'gone') throw goneError(moved);
    }

    const settled = await watch.until((s) => SETTLED.has(s.state), opts.timeoutMs);
    const waitedMs = Date.now() - started;
    if (settled.kind === 'timeout') throw new CliError(`timed out after ${opts.timeoutMs} ms waiting for the reply`, EXIT.timeout);
    if (settled.kind === 'gone') throw goneError(settled);
    const s = settled.session;
    if (s.state === 'done') return { kind: 'done', session: s, reply: s.lastReply, waitedMs, via };
    if (s.state === 'needs-input') return { kind: 'needs-input', session: s, waitedMs, via };
    throw new CliError(`${shortId(s.id)} ${s.name} ${describeState(s).text} after ${waitedMs} ms`);
  } finally {
    client.close();
  }
}

const options = {
  // Send even to a session that needs input, or whose input holds a prompt given back after an interrupt.
  force: { type: 'boolean', default: false },
  // The text is the name of a saved prompt (emmer prompts).
  saved: { type: 'boolean', default: false },
  // Milliseconds for the reply; 0 or absent waits for as long as it takes.
  timeout: { type: 'string' },
  json: { type: 'boolean', default: false },
  // Refuse a session that is working (M9 fix 741), exit 1.
  'if-idle': { type: 'boolean', default: false },
  // M9 fix 855: the text read verbatim from stdin or a file.
  stdin: { type: 'boolean', default: false },
  file: { type: 'string' },
} as const;

const command: Command = {
  name: 'prompt',
  summary: 'send a prompt and wait for the reply',
  usage: 'emmer prompt <session> <text...|--stdin|--file <path>> [--saved] [--force] [--if-idle] [--timeout ms] [--json]',
  async run(argv) {
    const parsed = parse(argv, options);
    const [ref, ...words] = parsed.positionals;
    if (ref === undefined) throw usageError('missing session');
    const v = parsed.values;
    if (v.saved && v.stdin) throw usageError('--saved and --stdin together');
    if (v.saved && v.file !== undefined) throw usageError('--saved and --file together');
    if (words.length > 0 && v.stdin) throw usageError('text and --stdin together');
    if (words.length > 0 && v.file !== undefined) throw usageError('text and --file together');
    const text = (await readText({ stdin: v.stdin, file: v.file }, { stdin: '--stdin', file: '--file' }, false)) ?? words.join(' ');
    if (text === '') throw usageError(parsed.values.saved ? 'missing the name of the saved prompt' : 'missing text');
    if (parsed.values.saved && words.length > 1) throw usageError('one saved prompt name');
    const timeoutMs = integerOption(parsed.values.timeout, 'timeout', 0);
    const outcome = await runPrompt({ ref, text, saved: parsed.values.saved, force: parsed.values.force, timeoutMs, ifIdle: parsed.values['if-idle'] });
    const s = outcome.session;
    if (parsed.values.json) {
      printJson({ session: s, state: s.state, reply: outcome.kind === 'done' ? outcome.reply : null, waitedMs: outcome.waitedMs, via: outcome.via });
      return EXIT.ok;
    }
    if (outcome.kind === 'done') println(outcome.reply ?? `${shortId(s.id)} ${s.name} is done with no reply text`);
    else println(`${shortId(s.id)} ${s.name} ${describeState(s).text} after ${outcome.waitedMs} ms`);
    return EXIT.ok;
  },
};

export default command;
