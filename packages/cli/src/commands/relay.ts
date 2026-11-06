import net from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Duplex, Readable, Writable } from 'node:stream';
import { encodeJsonLine } from '@emerald/shared/jsonlines';
import { isNoDaemon, readPipeToken } from '@emerald/shared/pipe-name';
import { parse } from '../args.ts';
import { usageError } from '../cli-error.ts';
import type { Command } from '../command.ts';
import { resolveDaemonMain, sleep, startDaemonDetachedFromSession, waitForPipe } from '../daemon-process.ts';
import { emeraldHome, pipePath } from '../paths.ts';

// The relay's own exit codes (M9 fix 1079). EXIT.stalled is also 3 but
// means a prompt that never started, so these are named apart.
export const RELAY_LOST = 3;
export const RELAY_NO_DAEMON = 4;

const PIPE_WAIT_MS = 15_000;
const TOKEN_WAIT_MS = 30_000;

// Carries the app's pipe over ssh's stdio (M9 fix 1079): each stdin line is
// one message to this machine's emmerd, written as it came; each frame from
// emmerd goes to stdout as it comes. The app's hello carries no token, and
// the first line, when it is a hello, gets this daemon's own token: the one
// frame the relay rewrites, so no token ever crosses the line. It never says
// a hello of its own. Resolves 0 when the input ends (the socket is ended
// with it) and RELAY_LOST when the socket goes first.
export function pumpRelay(opts: { input: Readable; output: Writable; socket: Duplex; token: string | undefined }): Promise<number> {
  const { input, output, socket, token } = opts;
  return new Promise((resolve) => {
    let settled = false;
    const done = (code: number): void => {
      if (settled) return;
      settled = true;
      input.off('data', onData);
      input.off('end', onEnd);
      resolve(code);
    };
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let first = true;
    const writeLine = (raw: string): void => {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (line === '') return;
      if (first) {
        first = false;
        let msg: unknown = null;
        try {
          msg = JSON.parse(line);
        } catch {
          msg = null;
        }
        if (typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'hello') {
          socket.write(encodeJsonLine(token === undefined ? msg : { ...(msg as object), token }));
          return;
        }
      }
      socket.write(line + '\n');
    };
    const onData = (chunk: Buffer | string): void => {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      let nl = pending.indexOf('\n');
      while (nl !== -1) {
        writeLine(pending.slice(0, nl));
        pending = pending.slice(nl + 1);
        nl = pending.indexOf('\n');
      }
    };
    const onEnd = (): void => {
      pending += decoder.end();
      if (pending !== '') writeLine(pending);
      pending = '';
      socket.end();
      done(0);
    };
    socket.pipe(output, { end: false });
    socket.once('close', () => done(RELAY_LOST));
    socket.on('error', () => {
      socket.destroy();
      done(RELAY_LOST);
    });
    input.on('data', onData);
    input.once('end', onEnd);
  });
}

function connectOnce(pipe: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipe);
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.off('error', reject);
      resolve(socket);
    });
  });
}

class NoDaemon extends Error {}

// Connects to this machine's emmerd, starting it detached from the ssh
// session when none owns the pipe, then waits for its daemon.json token as
// the app's own connect does (fix 632).
async function reachDaemon(): Promise<{ socket: net.Socket; token: string | undefined }> {
  const pipe = pipePath();
  let socket: net.Socket;
  try {
    socket = await connectOnce(pipe);
  } catch (err) {
    if (!isNoDaemon((err as NodeJS.ErrnoException).code)) throw new NoDaemon((err as Error).message);
    try {
      await startDaemonDetachedFromSession(resolveDaemonMain(), emeraldHome(), pipe);
    } catch (startErr) {
      throw new NoDaemon((startErr as Error).message);
    }
    if (!(await waitForPipe(true, PIPE_WAIT_MS))) throw new NoDaemon(`no pipe after ${PIPE_WAIT_MS / 1000} s`);
    try {
      socket = await connectOnce(pipe);
    } catch (again) {
      throw new NoDaemon((again as Error).message);
    }
  }
  const deadline = Date.now() + TOKEN_WAIT_MS;
  let token = readPipeToken(emeraldHome());
  while (token === undefined && Date.now() < deadline) {
    await sleep(100);
    token = readPipeToken(emeraldHome());
  }
  if (token === undefined) {
    socket.destroy();
    throw new NoDaemon(`no daemon.json after ${TOKEN_WAIT_MS / 1000} s`);
  }
  return { socket, token };
}

const command: Command = {
  name: 'relay',
  summary: "carry the app's pipe over ssh: each stdin line to this machine's emmerd and each frame back on stdout; the app starts this itself",
  usage: 'emmer relay [--home <dir>] [--pipe <path>]',
  async run(argv) {
    const parsed = parse(argv, { home: { type: 'string' }, pipe: { type: 'string' } });
    const [extra] = parsed.positionals;
    if (extra !== undefined) throw usageError(`unexpected argument ${extra}`);
    // Before any paths.ts read, so the command line is shell-neutral: no
    // environment needs setting in PowerShell's or sh's own syntax.
    if (parsed.values.home !== undefined) process.env['EMERALD_HOME'] = path.resolve(parsed.values.home);
    if (parsed.values.pipe !== undefined) process.env['EMERALD_PIPE'] = parsed.values.pipe;
    let reached: { socket: net.Socket; token: string | undefined };
    try {
      reached = await reachDaemon();
    } catch (err) {
      if (!(err instanceof NoDaemon)) throw err;
      process.stderr.write(`emmer relay: the daemon did not start: ${err.message}\n`);
      return RELAY_NO_DAEMON;
    }
    const code = await pumpRelay({ input: process.stdin, output: process.stdout, socket: reached.socket, token: reached.token });
    if (code === RELAY_LOST) process.stderr.write('emmer relay: lost the daemon\n');
    // On stdin's end the socket was ended; give the daemon a moment to see
    // the FIN before the handle goes.
    if (code === 0 && !reached.socket.destroyed) {
      await Promise.race([new Promise((r) => reached.socket.once('close', r)), sleep(2000)]);
    }
    // stdin may still be open (the daemon went first); let go of it so the
    // process can exit with the code.
    process.stdin.destroy();
    reached.socket.destroy();
    return code;
  },
};

export default command;
