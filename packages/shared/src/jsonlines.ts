import { StringDecoder } from 'node:string_decoder';

// Wire format for the pipe: one JSON object per line, newline terminated.
// Kept deliberately dumb. The one copy (M9 fix 665): the daemon's server,
// the CLI, the app's main process and the daemon's test client all frame with it.
// A subpath export (@emerald/shared/jsonlines) rather than part of the barrel,
// since the renderer imports the barrel and this needs node:string_decoder.

export function encodeJsonLine(message: unknown): string {
  return JSON.stringify(message) + '\n';
}

export class JsonLinesDecoder {
  // StringDecoder buffers an incomplete multibyte UTF-8 sequence at the end of a
  // chunk instead of emitting a replacement character, so a session name with
  // non-ASCII text survives being split across two socket reads.
  private readonly utf8 = new StringDecoder('utf8');
  private pending = '';
  private readonly maxLineChars: number;

  // A single line larger than this is treated as a protocol error rather than
  // being buffered forever. A 2 MB replay is about 2.8 MB of base64, so 16 MB
  // leaves a wide margin.
  constructor(maxLineChars = 16 * 1024 * 1024) {
    this.maxLineChars = maxLineChars;
  }

  // Feed bytes in, get complete messages out. Throws on malformed JSON or an
  // oversized line; the caller is expected to drop the connection.
  push(chunk: Buffer): unknown[] {
    this.pending += this.utf8.write(chunk);

    const messages: unknown[] = [];
    let newline = this.pending.indexOf('\n');
    while (newline !== -1) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      // Windows clients may send \r\n; blank lines are tolerated as keepalives.
      const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (trimmed.length > 0) {
        messages.push(JSON.parse(trimmed));
      }
      newline = this.pending.indexOf('\n');
    }

    if (this.pending.length > this.maxLineChars) {
      throw new Error(`JSON line exceeds ${this.maxLineChars} characters without a newline`);
    }
    return messages;
  }
}
