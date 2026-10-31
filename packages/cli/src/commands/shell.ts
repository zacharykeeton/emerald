import type { Command } from '../command.ts';
import { shellSummary, shellUsage } from '../shell-words.ts';
import { spawnCommand } from '../spawn.ts';

const command: Command = {
  name: 'shell',
  summary: shellSummary(),
  usage: shellUsage(),
  run: (argv) => spawnCommand('shell', argv),
};

export default command;
