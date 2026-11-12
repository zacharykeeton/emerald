import type { Command } from '../command.ts';
import { spawnCommand } from '../spawn.ts';

const command: Command = {
  name: 'new',
  summary: 'start a Claude session in a folder',
  usage: 'emmer new <dir> [--host <name>] [--name <label>] [--json] [-- <claude args>]\n--host <name> starts it on that remote host through the window, which must be open; <dir> is then an absolute path there or ~',
  run: (argv) => spawnCommand('claude', argv),
};

export default command;
