import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { CliError, EXIT } from '../cli-error.ts';
import command from './former.ts';

// M9 fix 1191: the usage errors are refused before the pipe, so no daemon
// is needed for them.
const refused = async (argv: string[], message: string) => {
  await assert.rejects(command.run(argv), (err: unknown) => err instanceof CliError && err.exitCode === EXIT.usage && err.message === message, `${argv.join(' ')}: ${message}`);
};

test('emmer former refuses a missing folder, a missing former folder, an unknown action and one inside the folder before the pipe (M9 fix 1191)', async () => {
  const here = path.resolve('C:\\code\\emerald');
  await refused(['add'], 'missing folder');
  await refused(['add', here], 'missing former folder');
  await refused(['rm', here], 'missing former folder');
  await refused(['move', here, 'x'], 'unknown action "move"; use ls, add or rm');
  await refused(['add', here, path.join(here, 'packages')], 'a former folder cannot be the folder, inside it or around it');
  await refused(['add', here, path.dirname(here)], 'a former folder cannot be the folder, inside it or around it');
  await refused(['add', here, here], 'a former folder cannot be the folder, inside it or around it');
  await refused(['add', here, 'C:\\code\\zorca', 'extra'], 'unexpected argument "extra"');
});
