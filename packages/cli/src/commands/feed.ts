import path from 'node:path';
import { FEED_PORT } from '@emerald/shared';
import { integerOption, parse, positionals } from '../args.ts';
import { CliError, usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { publishFeed, resolveFeedDir, serveFeed } from '../feed.ts';

// The update feed (M9 fix 239). `publish` copies a release's latest.yml,
// installer and .blockmap into the feed folder; `serve` serves that folder
// over http on the port the app checks, until Ctrl+C. A second machine
// runs `serve` on its own copy, or the linux box hosts the folder; the
// app's EMERALD_UPDATE_URL is the one setting that changes.
const options = {
  json: { type: 'boolean', default: false },
  dir: { type: 'string' },
  port: { type: 'string' },
} as const;

const command: Command = {
  name: 'feed',
  summary: 'publish a build into the update feed, or serve the feed',
  usage: 'emmer feed publish <release dir> [--dir <feed dir>] [--json]\n       emmer feed serve [--dir <feed dir>] [--port <n>] [--json]',
  async run(argv) {
    const parsed = parse(argv, options);
    const action = parsed.positionals[0];
    const json = parsed.values.json;
    // The folder is worked out inside each action, after that action's own
    // argument checks (M9 fix 1069), so a missing release or a bad --port
    // reads its own line off Windows too, before the no-default-folder one.
    if (action === 'publish') {
      const { release } = positionals(parsed, ['action', 'release']);
      const dir = resolveFeedDir(parsed.values.dir);
      const releaseDir = path.resolve(release);
      let published;
      try {
        published = publishFeed(releaseDir, dir);
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
      if (json) {
        printJson({ dir, version: published.manifest.version, files: published.files, missing: published.missing });
      } else {
        println(`published emerald ${published.manifest.version} to ${dir}: ${published.files.join(', ')}${published.missing.length > 0 ? ` (not in the release: ${published.missing.join(', ')})` : ''}`);
      }
      return;
    }
    if (action === 'serve') {
      positionals(parsed, ['action']);
      const port = integerOption(parsed.values.port, 'port', FEED_PORT);
      const dir = resolveFeedDir(parsed.values.dir);
      let server;
      try {
        server = await serveFeed(dir, port, (line) => {
          if (!json) println(line);
        });
      } catch (err) {
        throw new CliError(`could not serve ${dir} on port ${port}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (json) printJson({ dir, port: server.port, url: server.url });
      else println(`serving ${dir} at ${server.url} (Ctrl+C stops it)`);
      // Serves until the process is told to stop; the listener keeps the
      // loop alive.
      await new Promise<void>((resolve) => {
        const stop = () => void server.close().then(resolve);
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      return;
    }
    throw usageError(`unknown feed action ${JSON.stringify(action ?? '')}`);
  },
};

export default command;
