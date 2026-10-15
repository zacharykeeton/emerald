#!/usr/bin/env node
// emerald: command line client for emmerd. One command per file under
// commands/; this file only routes, prints usage, and turns errors into
// exit codes (see cli-error.ts for the table).
import fs from 'node:fs';
import module from 'node:module';
import { CliError, EXIT } from './cli-error.ts';
import { println, watchOutput, wroteAnything } from './command.ts';
import { commands, findCommand } from './commands/index.ts';

// Node's compile cache (M9 fix 736), in NODE_COMPILE_CACHE or os.tmpdir()'s
// node-compile-cache. ES imports are hoisted, so it covers what loads after
// this line, the command module and its graph (the bulk), not this file's
// own few static imports. A cache that cannot be written costs nothing but
// the speed.
if (typeof module.enableCompileCache === 'function') {
  try {
    module.enableCompileCache();
  } catch {
    // Run uncached.
  }
}

// Last resorts (M9 fix 379): an error thrown out of a socket callback or a
// promise nobody awaits is printed as one line and exits 1 rather than as
// a stack or, when the throw lands in a drained tick, as nothing; and a
// process about to exit 1 having written nothing says so, so the next
// silent failure names itself. Neither lands on a passing path (verify:cli
// reads exact stderr for several commands).
watchOutput();
const lastResort = (what: string) => (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.exitCode = EXIT.failure;
  process.stderr.write(`emmer: ${what}: ${message}\n`, () => process.exit(EXIT.failure));
};
process.on('uncaughtException', lastResort('uncaught error'));
process.on('unhandledRejection', lastResort('unhandled rejection'));
process.on('exit', (code) => {
  if (code === EXIT.failure && !wroteAnything()) process.stderr.write('emmer: exiting 1 with nothing to say\n');
});

// The version comes from the package.json one level above this file, which
// is true from src/ (tests), dist/ (built) and the staged resources/cli/.
function version(): string {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

function usage(): string {
  const width = Math.max(...commands.map((c) => c.name.length));
  const lines = commands.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`);
  return ['usage: emmer <command> [args]', '', 'commands:', ...lines, '', 'emmer help <command> shows a synopsis, emmer --version the version'].join('\n');
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === '--version' || name === '-v' || name === 'version') {
    println(version());
    return EXIT.ok;
  }
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    const topic = rest[0] !== undefined ? findCommand(rest[0]) : undefined;
    println(topic !== undefined ? (await topic.load()).usage : usage());
    return name === undefined ? EXIT.usage : EXIT.ok;
  }
  const entry = findCommand(name);
  if (entry === undefined) {
    process.stderr.write(`emmer: unknown command ${JSON.stringify(name)}\n${usage()}\n`);
    return EXIT.usage;
  }
  const command = await entry.load();
  try {
    return (await command.run(rest)) ?? EXIT.ok;
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`emmer: ${err.message}\n`);
      if (err.exitCode === EXIT.usage) process.stderr.write(`usage: ${command.usage}\n`);
      return err.exitCode;
    }
    // A daemon error reply carries a wire code; anything else is a bug and
    // deserves its stack.
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && err instanceof Error) {
      process.stderr.write(`emmer: ${err.message} (${code})\n`);
      return EXIT.failure;
    }
    throw err;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    // Let stdout drain before exiting; a piped `emmer ls --json | jq` would
    // otherwise lose the tail of a large listing.
    process.exitCode = code;
  },
  (err) => {
    console.error(err);
    process.exitCode = EXIT.failure;
  },
);
