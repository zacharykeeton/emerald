import { lastLines } from '../ansi.ts';
import { integerOption, parse, positionals } from '../args.ts';
import { usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { findSession, withDaemon } from '../connect.ts';

const options = {
  // Only the last N lines that carry text.
  lines: { type: 'string' },
  // The bytes as the terminal received them, escapes and all.
  raw: { type: 'boolean', default: false },
  // The rendered screen rather than the stream of output.
  screen: { type: 'boolean', default: false },
  // Only what was written after this point in the stream; a previous
  // read's nextCursor.
  cursor: { type: 'string' },
  json: { type: 'boolean', default: false },
} as const;

// The stream is what the session emitted over time, escapes stripped, so a
// program that repaints a line (a shell's prompt, a progress bar, a TUI)
// reads as the sequence of things drawn. The screen is what a terminal
// shows now. A supervisor checking on a TUI wants the screen.
const command: Command = {
  name: 'read',
  summary: 'print what a session has written to its terminal',
  usage: 'emmer read <session> [--lines N] [--raw] [--cursor N] [--json]\nemerald read <session> --screen [--json]',
  async run(argv) {
    const parsed = parse(argv, options);
    const { session } = positionals(parsed, ['session']);
    const lines = integerOption(parsed.values.lines, 'lines', 0) || undefined;
    const since = parsed.values.cursor === undefined ? undefined : integerOption(parsed.values.cursor, 'cursor', 0);
    if (parsed.values.screen && since !== undefined) throw usageError('--screen is the current frame and has no history to page with --cursor');
    if (parsed.values.screen && (parsed.values.raw || lines !== undefined)) throw usageError('--screen takes neither --raw nor --lines');

    if (parsed.values.screen) {
      const { found, screen } = await withDaemon(async (client) => {
        const found = await findSession(client, session);
        return { found, screen: await client.request('pty.screen', { sessionId: found.id }) };
      });
      // kept (M9 fix 159): the frame is the one kept when the PTY ended,
      // not a live one.
      if (parsed.values.json) printJson({ sessionId: found.id, source: 'screen', rows: screen.rows, cursor: screen.cursor, nextCursor: screen.seq, ...(screen.kept === true ? { kept: true } : {}) });
      else if (screen.rows.length > 0) process.stdout.write(screen.rows.join('\n') + '\n');
      return;
    }

    const { found, data, next, oldest } = await withDaemon(async (client) => {
      const found = await findSession(client, session);
      const read = await client.request('session.read', since === undefined ? { sessionId: found.id } : { sessionId: found.id, since });
      return { found, data: Buffer.from(read.data, 'base64').toString('utf8'), next: read.next, oldest: read.oldest };
    });
    // The cursor line is only printed when the caller is paging, so a plain
    // read stays what it was.
    const trailer = since === undefined ? null : `nextCursor: ${next}${oldest !== undefined ? ` (output before ${oldest} is gone from the scrollback)` : ''}`;
    if (parsed.values.raw) {
      // The scrollback of a session restored from disk is empty (docs/
      // PLAN.md, M5): nothing to print is the truthful answer.
      if (parsed.values.json) printJson({ sessionId: found.id, source: 'stream', raw: data, nextCursor: next, ...(oldest !== undefined ? { oldest } : {}) });
      else {
        process.stdout.write(data);
        if (trailer !== null) println((data.endsWith('\n') || data === '' ? '' : '\n') + trailer);
      }
      return;
    }
    const kept = lastLines(data, lines);
    if (parsed.values.json) printJson({ sessionId: found.id, source: 'stream', lines: kept, nextCursor: next, ...(oldest !== undefined ? { oldest } : {}) });
    else {
      if (kept.length > 0) process.stdout.write(kept.join('\n') + '\n');
      if (trailer !== null) println(trailer);
    }
  },
};

export default command;
