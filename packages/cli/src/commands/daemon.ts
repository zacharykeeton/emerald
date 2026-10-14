import fs from 'node:fs';
import { parse, positionals } from '../args.ts';
import { CliError, EXIT, usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { tryConnect } from '../connect.ts';
import type { Connected } from '../connect.ts';
import { processIdentity } from '@emerald/shared/process-identity';
import {
  killProcessTree,
  pipeIsUp,
  readDaemonInfo,
  removeDaemonInfo,
  resolveDaemonMain,
  spawnDaemon,
  waitForPipe,
} from '../daemon-process.ts';
import { pipePath, emeraldHome } from '../paths.ts';

const options = {
  json: { type: 'boolean', default: false },
  // Where emmerd's dist/main.js lives, for a CLI installed away from the repo.
  'daemon-path': { type: 'string' },
} as const;

interface Status {
  running: boolean;
  pid: number | null;
  version: string | null;
  pipe: string;
  hookPort: number | null;
  startedAt: number | null;
  // The update feed the daemon serves (M9 fix 240); null when it serves
  // none, or when the daemon is older than the field.
  feed: { dir: string; port: number } | null;
  // Why something that owns the pipe would not talk (M9 fix 403), in
  // connect()'s own wording; null when nothing owns it at all, which is
  // what "emmerd is not running" says and is not a failure to name.
  error: string | null;
  // The store files the daemon moved out of the way as unreadable (M9 fix
  // 457), by name; found by a read of the home folder (M9 fix 556), so it
  // answers with the daemon down too.
  setAside: string[];
}

// Every `<store>.bad-<stamp>` in the home, sorted by name; an unreadable
// home reads as none.
function setAsideFiles(): string[] {
  const home = emeraldHome();
  try {
    return fs
      .readdirSync(home, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.bad-/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// The pipe is the truth; daemon.json only adds detail. A stale daemon.json
// from a daemon that was killed without cleanup is reported as not running.
// A bare catch here used to read every failure as "not running", a refused
// hello and a held-but-silent pipe included (M9 fix 403); the connect is
// tryConnect()'s now, so a named failure keeps its name.
async function status(): Promise<Status> {
  const pipe = pipePath();
  const info = readDaemonInfo();
  const setAside = setAsideFiles();
  const none: Status = { running: false, pid: null, version: null, pipe, hookPort: null, startedAt: null, feed: null, error: null, setAside };
  let open: Connected | null;
  try {
    open = await tryConnect();
  } catch (err) {
    return { ...none, error: err instanceof CliError ? err.message : (err as Error).message };
  }
  if (open === null) return none;
  try {
    const { hello } = open;
    return {
      running: true,
      pid: hello.daemonPid,
      version: hello.daemonVersion,
      pipe,
      hookPort: info?.pid === hello.daemonPid ? info.hookPort : null,
      startedAt: hello.daemonStartedAt ?? (info?.pid === hello.daemonPid ? info.startedAt : null),
      feed: hello.feed ?? null,
      error: null,
      setAside,
    };
  } finally {
    open.client.close();
  }
}

// Who answered the hello, and how many screens it kept on the way out
// (kept null when it does not know the request). The pid is the hello's,
// not daemon.json's (M9 fix 494): the file can name a daemon long gone
// whose number something else holds now. A pipe that is held but will
// not take the connection throws out of here in connect()'s vocabulary
// (M9 fix 403); null is the pipe nobody owns.
interface Asked {
  kept: number | null;
  pid: number;
  startedAt: number | null;
}

async function askStop(): Promise<Asked | null> {
  const open = await tryConnect();
  if (open === null) return null;
  const { hello } = open;
  const who = { pid: hello.daemonPid, startedAt: hello.daemonStartedAt ?? null };
  try {
    const { kept } = await open.client.request('daemon.stop', {});
    return { kept, ...who };
  } catch {
    return { kept: null, ...who };
  } finally {
    open.client.close();
  }
}

// Kills the tree of the daemon the hello named, and only while the pid is
// still that process (M9 fix 494); a pid that has gone is nothing to kill.
function killIfSame(pid: number, startedAt: number | null): void {
  if (startedAt === null) throw new CliError(`not killing pid ${pid}: emmerd did not say when it started; stop it by hand`);
  const identity = processIdentity(pid, startedAt);
  if (identity === 'other') throw new CliError(`not killing pid ${pid}: it is not the daemon that was started at ${new Date(startedAt).toISOString()}`);
  if (identity === 'same') killProcessTree(pid);
}

function report(s: Status, json: boolean): number {
  if (json) {
    printJson(s);
  } else if (s.running) {
    println(`emmerd ${s.version ?? '?'} running, pid ${s.pid ?? '?'}, pipe ${s.pipe}${s.hookPort !== null ? `, hook port ${s.hookPort}` : ''}`);
    println(s.feed === null ? 'feed: none' : `feed: serving ${s.feed.dir} on ${s.feed.port}`);
  } else {
    println('emmerd is not running');
  }
  if (!json) for (const name of s.setAside) println(`set aside: ${name}`);
  return s.running ? EXIT.ok : EXIT.failure;
}

// How long `emmer daemon start` waits for the daemon's hello, and when it
// says it is still waiting (M9 fix 453).
const START_WAIT_MS = 15_000;
const START_SLOW_MS = 5000;

async function start(json: boolean, daemonPath: string | undefined): Promise<number> {
  const before = await status();
  if (before.running) {
    if (json) printJson(before);
    else println(`emmerd already running, pid ${before.pid ?? '?'}`);
    return EXIT.ok;
  }
  spawnDaemon(resolveDaemonMain(daemonPath));
  // Waited on until the daemon answers hello, not until the pipe is up:
  // the daemon claims the pipe before it loads anything (M9 fix 454) and
  // answers once its start is done, which can take seconds under the
  // antivirus hold on its first spawn and a large hook log (M9 fix 453;
  // 5 s used to report a daemon up a second later as failed). The app
  // retries its own autostart for as long as nothing owns the pipe. A
  // daemon that has not answered by the deadline is failing to start or
  // fighting another instance; the log in ~/.emerald/logs says which.
  const began = Date.now();
  const slow = setTimeout(() => process.stderr.write('emmerd still starting\n'), START_SLOW_MS);
  let after = await status();
  try {
    while (!after.running && Date.now() - began < START_WAIT_MS) {
      await new Promise((r) => setTimeout(r, 100));
      after = await status();
    }
  } finally {
    clearTimeout(slow);
  }
  if (!after.running) throw new CliError(`emmerd did not start within ${START_WAIT_MS / 1000} s (see ~/.emerald/logs/emmerd.log)`);
  if (json) return report(after, true);
  println(`started emmerd ${after.version ?? '?'}, pid ${after.pid ?? '?'}`);
  return EXIT.ok;
}

async function stop(json: boolean): Promise<number> {
  const up = await pipeIsUp();
  if (!up) {
    // Nothing owns the pipe; a leftover daemon.json is just litter.
    removeDaemonInfo();
    if (json) printJson({ stopped: false, pid: null });
    else println('emmerd is not running');
    return EXIT.ok;
  }
  // Asked first (M9 fix 159), so the daemon keeps every live session's
  // screen and exits on its own; a daemon from before the request, or one
  // that does not go, is killed as before.
  const asked = await askStop();
  if (asked === null) {
    // The pipe went between the two looks.
    removeDaemonInfo();
    if (json) printJson({ stopped: false, pid: null });
    else println('emmerd is not running');
    return EXIT.ok;
  }
  const { kept, pid } = asked;
  if (kept === null || !(await waitForPipe(false, 5000))) {
    killIfSame(pid, asked.startedAt);
    if (!(await waitForPipe(false, 5000))) {
      throw new CliError(`killed pid ${pid} but the pipe is still open after 5 s`);
    }
  }
  removeDaemonInfo();
  if (json) printJson({ stopped: true, pid, kept });
  else println(`stopped emmerd, pid ${pid}${kept === null ? '' : `, ${kept} screen${kept === 1 ? '' : 's'} kept`}`);
  return EXIT.ok;
}

const command: Command = {
  name: 'daemon',
  summary: 'start, stop or show emmerd',
  usage: 'emmer daemon start|stop|status [--json] [--daemon-path <main.js>]',
  async run(argv) {
    const parsed = parse(argv, options);
    const { action } = positionals(parsed, ['action']);
    const json = parsed.values.json;
    switch (action) {
      case 'status': {
        const s = await status();
        // A named failure reads like every other error the CLI prints,
        // one line on stderr and exit 1 (M9 fix 403); --json carries it
        // on the record instead, beside running: false.
        if (!json && s.error !== null) throw new CliError(s.error);
        return report(s, json);
      }
      case 'start':
        return start(json, parsed.values['daemon-path']);
      case 'stop':
        return stop(json);
      default:
        throw usageError(`unknown daemon action ${JSON.stringify(action)}`);
    }
  },
};

export default command;
