import { MOD_CHANNEL_LEVEL, modRoutable } from '@emerald/shared';
import { parse, readText } from '../args.ts';
import { CliError, usageError } from '../cli-error.ts';
import { println } from '../command.ts';
import type { Command } from '../command.ts';
import { connectHello, findSession } from '../connect.ts';
import { sleep } from '../daemon-process.ts';
import { refuseBusy } from '../mod-route.ts';
import { shortId } from '../resolve.ts';

const options = {
  // Press Enter after the text.
  enter: { type: 'boolean', default: false },
  // Press Ctrl+C first, before any text.
  interrupt: { type: 'boolean', default: false },
  // Refuse a session that is working (M9 fix 741), exit 1.
  'if-idle': { type: 'boolean', default: false },
  // M9 fix 855: the text read verbatim from stdin or a file.
  stdin: { type: 'boolean', default: false },
  file: { type: 'string' },
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
  usage: 'emmer send <session> [text...|--stdin|--file <path>] [--enter] [--interrupt] [--if-idle]\nraw keys, typed whatever the input already holds; emmer prompt refuses an input holding a prompt given back after an interrupt\n--stdin or --file <path> reads the text verbatim, for text holding a newline, a % or a double quote, which emmer.cmd and Windows PowerShell 5.1 change on the command line, and for a slash command from Git Bash, which turns a word beginning with / into a Windows path unless MSYS_NO_PATHCONV=1 is set on the call',
  async run(argv) {
    const parsed = parse(argv, options);
    const [ref, ...words] = parsed.positionals;
    if (ref === undefined) throw usageError('missing session');
    const v = parsed.values;
    if (words.length > 0 && v.stdin) throw usageError('text and --stdin together');
    if (words.length > 0 && v.file !== undefined) throw usageError('text and --file together');
    const text = (await readText({ stdin: v.stdin, file: v.file }, { stdin: '--stdin', file: '--file' }, false)) ?? words.join(' ');
    if (text === '' && !v.enter && !v.interrupt) throw usageError('missing text (or pass --enter alone to press Enter, --interrupt for Ctrl+C)');
    const { client, hello } = await connectHello();
    try {
      const found = await findSession(client, ref);
      if (found.state === 'exited') throw new CliError(`${shortId(found.id)} ${found.name} has exited; resume it first`);
      if (parsed.values['if-idle']) refuseBusy(found);
      // The interrupt stays a typed Ctrl+C: the mod's $.turn.abort ended
      // a turn ten seconds late in fix 741's probe, where Ctrl+C ended it
      // at once and left the row in the same state.
      if (parsed.values.interrupt) client.send({ type: 'pty.input', sessionId: found.id, data: INTERRUPT });
      let viaMod = false;
      if (parsed.values.enter && text !== '' && found.kind === 'claude' && (hello.featureLevel ?? 1) >= MOD_CHANNEL_LEVEL && modRoutable(text)) {
        viaMod = (await client.request('session.submit', { sessionId: found.id, text })).via === 'mod';
      }
      if (!viaMod) {
        if (text !== '') client.send({ type: 'pty.input', sessionId: found.id, data: text });
        if (parsed.values.enter) {
          if (text !== '' && found.kind === 'claude') await sleep(CLAUDE_ENTER_DELAY_MS);
          client.send({ type: 'pty.input', sessionId: found.id, data: '\r' });
        }
      }
      // pty.input has no reply, so a cheap request afterwards proves the
      // daemon read the input before the pipe closes.
      await client.request('session.list', {});
      const parts = [
        ...(parsed.values.interrupt ? ['Ctrl+C'] : []),
        ...(text !== '' ? [JSON.stringify(text)] : []),
        ...(parsed.values.enter ? ['Enter'] : []),
      ];
      println(`sent ${parts.join(' + ')} to ${shortId(found.id)} ${found.name}${viaMod ? ' through the emerald mod' : ''}`);
    } finally {
      client.close();
    }
  },
};

export default command;
