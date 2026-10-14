import type { Command } from '../command.ts';
import { spawnCommand } from '../spawn.ts';

const command: Command = {
  name: 'shell',
  summary: 'start a plain shell session in a folder; --shell picks pwsh, powershell, gitbash or cmd',
  usage: 'emmer shell <dir> [--name <label>] [--shell pwsh|powershell|gitbash|cmd] [--json] [-- <shell args>]',
  run: (argv) => spawnCommand('shell', argv),
};

export default command;
