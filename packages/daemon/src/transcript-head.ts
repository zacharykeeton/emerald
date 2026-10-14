import fs from 'node:fs';
import { remoteSessionIdOf, remoteSessionIdOfLine } from '@emerald/shared';

export { remoteSessionIdOf };

// The claude.ai session a transcript belongs to (M58). A session run
// through claude.ai/code ends every commit it makes with a
// `Claude-Session: https://claude.ai/code/session_<id>` trailer, and the
// same URL sits in the transcript as a `remote_session_change`
// attachment near its head, which is how a commit's trailer is mapped
// back to the emerald session that made it. The id is the `session_<id>`
// token, the part the trailer and the attachment share. Only the first
// HEAD_BYTES are read, since the attachment lands within the first few
// lines when it lands at all; a transcript without one (a plain terminal
// session) gives null, and its commits carry no trailer either.
export const HEAD_BYTES = 256 * 1024;

export function findRemoteSessionId(text: string): string | null {
  for (const line of text.split('\n')) {
    if (!line.includes('remote_session_change')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const id = remoteSessionIdOfLine(parsed);
    if (id !== null) return id;
  }
  return null;
}

// Reads the head of the transcript; a file that is missing or unreadable
// is null, as is one with no attachment in its head.
export async function readRemoteSessionId(path: string): Promise<string | null> {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(path, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return findRemoteSessionId(buf.subarray(0, bytesRead).toString('utf8'));
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}
