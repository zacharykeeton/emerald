import { parse, positionals } from '../args.ts';
import { EXIT, usageError } from '../cli-error.ts';
import { println } from '../command.ts';
import type { Command } from '../command.ts';
import { emeraldHome } from '../paths.ts';
import { buildUsageReport } from '../usage-report.ts';

const options = {
  // How many local days back, today among them.
  days: { type: 'string', default: '30' },
} as const;

// `emmer usage report` (M9 fix 677): the digest of the usage record and
// the hook log. It reads files only, so it answers with emerald closed and
// needs no daemon.
const command: Command = {
  name: 'usage',
  summary: 'a markdown digest of how emerald is used, from the usage record and the hook log',
  usage: 'emmer usage report [--days <n>]',
  async run(argv) {
    const parsed = parse(argv, options);
    const { action } = positionals(parsed, ['action']);
    if (action !== 'report') throw usageError(`unknown usage action ${JSON.stringify(action)}`);
    const value = parsed.values.days;
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 365) throw usageError(`--days wants a whole number from 1 to 365, got ${value}`);
    const report = await buildUsageReport(emeraldHome(), Date.now(), Number(value));
    println(report.trimEnd());
    return EXIT.ok;
  },
};

export default command;
