import { parse } from '../args.ts';
import { CliError, usageError } from '../cli-error.ts';
import { println } from '../command.ts';
import type { Command } from '../command.ts';
import { findSession, withDaemon } from '../connect.ts';
import { sleep } from '../daemon-process.ts';
import { shortId } from '../resolve.ts';

const options = {
  // Press Enter after the text.
  enter: { type: 'boolean', default: false },
  // Press Ctrl+C first, before any text.
  interrupt: { type: 'boolean', default: false },
} as const;

// Claude Code's paste detection holds a line that arrived in one chunk open
// for a moment, and an Enter inside that window becomes a newline in the
// prompt instead of a submit (docs/PLAN.md, M5 gotcha 4). The verify
// scripts settled on 1.5 s; a shell has no such window.
export const CLAUDE_ENTER_DELAY_MS = 1500;

// What the terminal sends for Ctrl+C; ConPTY turns it into the console
// control event the way a keypress would.
const INTERRUPT = '\x03';

const command: Command = {
  name: 'send',
  summary: 'type text into a session',
  usage: 'emmer send <session> [text...] [--enter] [--interrupt]',
  async run(argv) {
    const parsed = parse(argv, options);
    const [ref, ...words] = parsed.positionals;
    if (ref === undefined) throw usageError('missing session');
    if (words.length === 0 && !parsed.values.enter && !parsed.values.interrupt) throw usageError('missing text (or pass --enter alone to press Enter, --interrupt for Ctrl+C)');
    const text = words.join(' ');
    await withDaemon(async (client) => {
      const found = await findSession(client, ref);
      if (found.state === 'exited') throw new CliError(`${shortId(found.id)} ${found.name} has exited; resume it first`);
      if (parsed.values.interrupt) client.send({ type: 'pty.input', sessionId: found.id, data: INTERRUPT });
      if (text !== '') client.send({ type: 'pty.input', sessionId: found.id, data: text });
      if (parsed.values.enter) {
        if (text !== '' && found.kind === 'claude') await sleep(CLAUDE_ENTER_DELAY_MS);
        client.send({ type: 'pty.input', sessionId: found.id, data: '\r' });
      }
      // pty.input has no reply, so a cheap request afterwards proves the
      // daemon read the input before the pipe closes.
      await client.request('session.list', {});
      const parts = [
        ...(parsed.values.interrupt ? ['Ctrl+C'] : []),
        ...(text !== '' ? [JSON.stringify(text)] : []),
        ...(parsed.values.enter ? ['Enter'] : []),
      ];
      println(`sent ${parts.join(' + ')} to ${shortId(found.id)} ${found.name}`);
    });
  },
};

export default command;
