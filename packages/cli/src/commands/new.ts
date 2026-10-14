import type { Command } from '../command.ts';
import { spawnCommand } from '../spawn.ts';

const command: Command = {
  name: 'new',
  summary: 'start a Claude session in a folder',
  usage: 'emmer new <dir> [--name <label>] [--json] [-- <claude args>]',
  run: (argv) => spawnCommand('claude', argv),
};

export default command;
