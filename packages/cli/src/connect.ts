import path from 'node:path';
import { PROTOCOL_VERSION } from '@emerald/shared';
import type { Requests, SessionInfo } from '@emerald/shared';
import { readPipeToken, sameHome } from '@emerald/shared/pipe-name';
import { CliError } from './cli-error.ts';
import { pipePath, emeraldHome } from './paths.ts';
import { PipeClient } from '@emerald/shared/pipe-client';
import { resolveSession } from './resolve.ts';

// A daemon that takes the connection and never answers hello (one dying
// on the pipe, its write side gone) held every command for good, since
// `request` settles only on a reply, on the socket's error or on its
// close (M9 fix 402). The app's client has raced its hello against a
// deadline since M9 fix 380; the CLI's does now too, on the hello alone,
// since every other request is answered by a daemon that got this far.
const HELLO_TIMEOUT_MS = 5000;

// The override is for a script that wants the line without waiting five
// seconds; anything unreadable or not positive falls back to the constant.
function helloTimeoutMs(): number {
  const raw = process.env.EMERALD_HELLO_TIMEOUT_MS;
  if (raw === undefined) return HELLO_TIMEOUT_MS;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : HELLO_TIMEOUT_MS;
}

const NOT_RUNNING = 'emmerd is not running (run emmer daemon start, or open the Emerald app)';

// A connected client and what its hello said, for a caller that wants
// the daemon's own answer (`emmer daemon status`) without a second
// round trip.
export interface Connected {
  client: PipeClient;
  hello: Requests['hello']['res'];
}

// Opens the pipe and says hello (M9 fix 403). null means nothing owns
// the pipe, which is not a failure to every caller; every other way of
// failing is a CliError in the CLI's own vocabulary, the hello's
// deadline and refusals included. `emmer daemon status` and `emerald
// daemon stop` used to build this by hand with a bare catch, so a pipe
// that was held but would not talk read as "emmerd is not running".
export async function tryConnect(): Promise<Connected | null> {
  // The pipe token (M9 fix 612) is read right before the hello. A client
  // that connects while the daemon starts reaches the pipe before
  // daemon.json is written and sends none, or a dead daemon's; the refusal
  // comes after the file is written, so a token that differs on a second
  // read is tried once more at once. The same token again is a real
  // refusal. The window logs this case as "hello sent before the daemon
  // wrote its token; retrying with it" (M9 fix 632); the CLI stays silent,
  // since verify:cli reads its stderr exactly, and never waits for the
  // file, since it never starts a daemon (connectOnce answers null on
  // ENOENT).
  let token = readPipeToken(emeraldHome());
  for (let attempt = 0; ; attempt++) {
    const outcome = await connectOnce(token);
    if (outcome === null || !('refused' in outcome)) return outcome;
    const again = readPipeToken(emeraldHome());
    if (attempt === 0 && (outcome.code === 'token-required' || outcome.code === 'bad-token') && again !== undefined && again !== token) {
      token = again;
      continue;
    }
    throw new CliError(`emmerd refused the connection: ${outcome.message}`);
  }
}

// One connect and hello. A refusal comes back as its code and message for
// tryConnect to judge; every other failure is a CliError at once.
async function connectOnce(token: string | undefined): Promise<Connected | null | { refused: true; code: string; message: string }> {
  let client: PipeClient;
  try {
    client = await PipeClient.connect(pipePath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new CliError(`could not connect to emmerd at ${pipePath()}: ${(err as Error).message}`);
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const ms = helloTimeoutMs();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`hello timed out after ${ms} ms`)), ms);
    });
    const hello = await Promise.race([client.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION, ...(token !== undefined ? { token } : {}) }), deadline]);
    warnOtherHome(hello.home);
    return { client, hello };
  } catch (err) {
    // Destroyed, not closed: a half-close leaves a silent daemon's socket
    // open for reading, so the command would sit past its own deadline.
    client.destroy();
    const code = (err as { code?: unknown }).code;
    return { refused: true, code: typeof code === 'string' ? code : '', message: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

// A daemon serving another home than this CLI's is said once on stderr
// and used anyway (M9 fix 495): EMERALD_PIPE named it on purpose.
let warnedHome = false;
function warnOtherHome(theirs: string | undefined): void {
  if (theirs === undefined || warnedHome) return;
  const mine = path.resolve(emeraldHome());
  if (sameHome(theirs, mine)) return;
  warnedHome = true;
  process.stderr.write(`emmer: connected to a daemon on another home: ${theirs} (mine ${mine})\n`);
}

// Connects and says hello, throwing the one not-running wording on a pipe
// nothing serves. `open` and `update` used to build their own connect and
// hello by hand (M9 fix 431); this is the one place that does it now.
export async function connectHello(): Promise<Connected> {
  const open = await tryConnect();
  if (open === null) throw new CliError(NOT_RUNNING);
  return open;
}

// Connects and says hello. Only `emmer daemon start` autostarts emmerd
// (docs/PLAN.md, daemon lifecycle); every other command tells the user to.
export async function connect(): Promise<PipeClient> {
  return (await connectHello()).client;
}

// One round trip to the list, then the resolver. Every command that takes a
// session goes through here so they all accept the same references.
export async function findSession(client: PipeClient, ref: string): Promise<SessionInfo> {
  const { sessions } = await client.request('session.list', {});
  return resolveSession(sessions, ref);
}

// Runs one command body against a connected daemon and always closes the
// pipe, so a thrown CliError still lets the process exit promptly.
export async function withDaemon<T>(body: (client: PipeClient) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    return await body(client);
  } finally {
    client.close();
  }
}
