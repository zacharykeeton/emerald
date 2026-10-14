import { parse, positionals } from '../args.ts';
import { println } from '../command.ts';
import type { Command } from '../command.ts';
import { skillText } from '../hooks-install.ts';
import { hookOptions } from './hooks.ts';

// Prints the emmer-cli skill as shipped with this CLI, the way Orca's
// `skills get` does, so a session can read the guide that matches the
// commands it is running even when the installed copy is older or missing.
const command: Command = {
  name: 'skill',
  summary: 'print the emmer-cli skill, the guide a Claude session reads to drive emerald',
  usage: 'emmer skill',
  async run(argv) {
    positionals(parse(argv, {}), []);
    println(skillText(hookOptions(undefined)).trimEnd());
  },
};

export default command;
