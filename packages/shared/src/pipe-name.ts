// The daemon's pipe name (M9 fix 495, M75's M3 and M4).
//
// It was the fixed \\.\pipe\emmerd, one name for every user on the box,
// and it did not follow EMERALD_HOME: a daemon, window or CLI started with a
// private home and no EMERALD_PIPE met the user's own daemon and read and
// wrote the private home's files beside it. The name is now the user's,
// and the home's when a home is named, so a private home alone lands on a
// private pipe. EMERALD_PIPE still wins over both.
//
// A subpath export (@emerald/shared/pipe-name) rather than part of the
// barrel, since the renderer imports the barrel and this needs node:os.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function currentUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env['USERNAME'] ?? 'user';
  }
}

function sha1Hex8(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 8);
}

// The user's name as a pipe name takes it: lower-cased ASCII letters and
// digits, or a hash of the raw name when nothing of it is left.
export function pipeUser(name: string): string {
  const plain = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return plain !== '' ? plain : sha1Hex8(name);
}

// A home as the name hashes it. No realpath: every process inherits the
// same variable, and a home that does not exist yet (the app names the
// pipe before the daemon makes the folder) must hash the same as it will
// once it exists, where realpath would turn %TEMP%'s 8.3 form into the
// long one only after.
export function homeKey(home: string): string {
  return path.resolve(home).toLowerCase();
}

export function sameHome(a: string, b: string): boolean {
  return homeKey(a) === homeKey(b);
}

// EMERALD_HOME trimmed, or undefined when it is unset or empty, so an empty
// home gives the default home and the default pipe on every side (M9 fix
// 544) rather than the working folder.
function namedHome(env: NodeJS.ProcessEnv): string | undefined {
  const home = env['EMERALD_HOME']?.trim();
  return home ? home : undefined;
}

export function emeraldHomeOf(env: NodeJS.ProcessEnv): string {
  return namedHome(env) ?? path.join(os.homedir(), '.emerald');
}

export function pipePathOf(env: NodeJS.ProcessEnv = process.env, user: string = currentUser()): string {
  const named = env['EMERALD_PIPE'];
  if (named !== undefined) return named;
  const base = `\\\\.\\pipe\\emmerd-${pipeUser(user)}`;
  const home = namedHome(env);
  return home === undefined ? base : `${base}-${sha1Hex8(homeKey(home))}`;
}

// The pipe token (M9 fix 612): <home>/daemon.json's pipeToken when it is a
// non-empty string, else undefined (no file, not JSON, no field, a daemon
// from before the fix). Every client says it on its hello.
export function readPipeToken(home: string): string | undefined {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8')) as unknown;
    if (typeof info !== 'object' || info === null) return undefined;
    const token = (info as Record<string, unknown>)['pipeToken'];
    return typeof token === 'string' && token !== '' ? token : undefined;
  } catch {
    return undefined;
  }
}
