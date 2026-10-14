import { parse } from '../args.ts';
import { CliError, EXIT, usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { withDaemon } from '../connect.ts';

// M56: the saved prompts the sidebar's box and emmer prompt --saved
// cycle, kept by the daemon so every window and the CLI see one list.

const options = {
  json: { type: 'boolean', default: false },
} as const;

const command: Command = {
  name: 'prompts',
  summary: 'list, add or remove saved prompts',
  usage: 'emmer prompts ls [--json] | add <name> <text...> | rm <name>',
  async run(argv) {
    const parsed = parse(argv, options);
    const [action, name, ...words] = parsed.positionals;
    switch (action ?? 'ls') {
      case 'ls': {
        if (name !== undefined) throw usageError(`unexpected argument ${JSON.stringify(name)}`);
        const { prompts } = await withDaemon((client) => client.request('prompts.list', {}));
        if (parsed.values.json) printJson({ prompts });
        else if (prompts.length === 0) println('no saved prompts (emmer prompts add <name> <text>)');
        else {
          const width = Math.max(...prompts.map((p) => p.name.length));
          for (const p of prompts) println(`${p.name.padEnd(width)}  ${p.text}`);
        }
        return EXIT.ok;
      }
      case 'add': {
        if (name === undefined) throw usageError('missing name');
        if (words.length === 0) throw usageError('missing text');
        await withDaemon((client) => client.request('prompts.set', { name, text: words.join(' ') }));
        println(`saved ${name}`);
        return EXIT.ok;
      }
      case 'rm': {
        if (name === undefined) throw usageError('missing name');
        if (words.length > 0) throw usageError(`unexpected argument ${JSON.stringify(words[0])}`);
        const { prompts } = await withDaemon(async (client) => {
          const before = await client.request('prompts.list', {});
          await client.request('prompts.set', { name, text: null });
          return before;
        });
        if (!prompts.some((p) => p.name === name)) throw new CliError(`no saved prompt named ${name}`);
        println(`removed ${name}`);
        return EXIT.ok;
      }
      default:
        throw usageError(`unknown action ${JSON.stringify(action)}; use ls, add or rm`);
    }
  },
};

export default command;
