import path from 'node:path';
import { overlapsFolder, underFolder } from '@emerald/shared';
import { parse } from '../args.ts';
import { CliError, EXIT, usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { connectHello } from '../connect.ts';

// M9 fix 1191: a folder's former folders, where a renamed or moved
// checkout lived before, kept by the daemon so its Statistics count the old
// folder's history with it. scripts/rename.mjs --former runs `add` once the
// checkout has moved.

// The first daemon that keeps them.
const FORMER_LEVEL = 85;

const INSIDE = 'a former folder cannot be the folder, inside it or around it';

const options = {
  json: { type: 'boolean', default: false },
} as const;

const command: Command = {
  name: 'former',
  summary: 'list, add or remove a folder\'s former folders, whose activity its Statistics count with it',
  usage: 'emmer former ls [<folder>] [--json] | add <folder> <former> | rm <folder> <former>',
  async run(argv) {
    const parsed = parse(argv, options);
    const [action, folderArg, formerArg, ...rest] = parsed.positionals;
    const verb = action ?? 'ls';
    if (verb !== 'ls' && verb !== 'add' && verb !== 'rm') throw usageError(`unknown action ${JSON.stringify(action)}; use ls, add or rm`);
    if (verb === 'ls') {
      if (formerArg !== undefined) throw usageError(`unexpected argument ${JSON.stringify(formerArg)}`);
    } else {
      if (folderArg === undefined) throw usageError('missing folder');
      if (formerArg === undefined) throw usageError('missing former folder');
      if (rest.length > 0) throw usageError(`unexpected argument ${JSON.stringify(rest[0])}`);
    }
    const folder = folderArg === undefined ? null : path.resolve(folderArg);
    const former = formerArg === undefined ? null : path.resolve(formerArg);
    if (folder !== null && former !== null && overlapsFolder(former, folder)) throw usageError(INSIDE);
    const { client, hello } = await connectHello();
    try {
      const level = hello.featureLevel ?? 1;
      if (level < FORMER_LEVEL) throw new CliError(`emmerd ${hello.daemonVersion} is older than emmer former (level ${level}, needs ${FORMER_LEVEL}); restart it from the app's banner`);
      if (verb === 'ls') {
        const { former: all } = await client.request('former.list', {});
        const shown = folder === null ? all : all.filter((e) => sameFolder(e.folder, folder));
        if (parsed.values.json) printJson({ former: shown });
        else if (folder !== null && shown.length === 0) println(`${folder} has no former folders`);
        else if (shown.length === 0) println('no former folders (emmer former add <folder> <former>)');
        else for (const e of shown) println(`${e.folder}  ${e.former.join(', ')}`);
        return EXIT.ok;
      }
      const { changed } = await client.request('former.set', { folder: folder!, former: former!, on: verb === 'add' });
      if (verb === 'add') println(changed ? `added ${former} as a former folder of ${folder}` : `${former} is already a former folder of ${folder}`);
      else if (changed) println(`removed ${former} from the former folders of ${folder}`);
      else throw new CliError(`${former} is not a former folder of ${folder}`);
      return EXIT.ok;
    } finally {
      client.close();
    }
  },
};

// The same folder by underFolder's fold, either spelling.
function sameFolder(a: string, b: string): boolean {
  return underFolder(a, b) && underFolder(b, a);
}

export default command;
