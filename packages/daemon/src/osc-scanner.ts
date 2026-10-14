// Finds OSC sequences with given prefixes in PTY output: ESC ] <prefix> <payload>
// terminated by BEL or ESC \. The cwd scanner (OSC 9;9) and the title
// scanner (OSC 0 and 2) are both this with a different prefix list.
// Sequences can be cut between two chunks, so an unfinished one is carried
// into the next push.
// As xterm does, any other ESC, and CAN or SUB, aborts a sequence: it is
// dropped, and scanning resumes at the aborting byte, since that ESC may
// open the next real sequence. Without the abort an unterminated title or
// folder swallowed every screenful up to the next BEL (M9 fix 500).

const BEL = 0x07;
const ESC = 0x1b;
const BACKSLASH = 0x5c;
const CAN = 0x18;
const SUB = 0x1a;
// A sequence longer than this is not a path or a title; drop it rather than
// carry it forever.
const MAX_CARRY = 4096;

export interface OscMatch {
  // The prefix as given, so a caller with several can tell them apart.
  prefix: string;
  payload: string;
}

export class OscScanner {
  private readonly prefixes: Array<{ text: string; bytes: Buffer }>;
  private readonly longest: number;
  private carry: Buffer = Buffer.alloc(0);

  constructor(prefixes: string[]) {
    this.prefixes = prefixes.map((p) => ({ text: p, bytes: Buffer.from(`\x1b]${p}`, 'latin1') }));
    this.longest = Math.max(...this.prefixes.map((p) => p.bytes.length));
  }

  // Every complete sequence in this chunk (plus what was carried), in order.
  push(chunk: Buffer): OscMatch[] {
    const buf = this.carry.length === 0 ? chunk : Buffer.concat([this.carry, chunk]);
    const found: OscMatch[] = [];
    let pos = 0;
    for (;;) {
      const hit = this.next(buf, pos);
      if (hit === null) {
        // Keep a tail short enough to hold a cut prefix and nothing more.
        const keep = Math.min(this.longest - 1, buf.length - pos);
        this.carry = Buffer.from(buf.subarray(buf.length - keep));
        return found;
      }
      const payloadStart = hit.at + hit.prefix.bytes.length;
      const end = findTerminator(buf, payloadStart);
      if (end === null) {
        const rest = buf.subarray(hit.at);
        this.carry = rest.length > MAX_CARRY ? Buffer.alloc(0) : Buffer.from(rest);
        return found;
      }
      if (end.kind === 'abort') {
        pos = end.at;
        continue;
      }
      // The same bound the carry uses: a payload this long is not a title
      // or a path, whether or not it was cut.
      if (end.at - payloadStart <= MAX_CARRY) {
        found.push({ prefix: hit.prefix.text, payload: buf.subarray(payloadStart, end.at).toString('utf8') });
      }
      pos = end.at + end.length;
    }
  }

  // The earliest prefix at or after pos.
  private next(buf: Buffer, pos: number): { at: number; prefix: { text: string; bytes: Buffer } } | null {
    let best: { at: number; prefix: { text: string; bytes: Buffer } } | null = null;
    for (const prefix of this.prefixes) {
      const at = buf.indexOf(prefix.bytes, pos);
      if (at !== -1 && (best === null || at < best.at)) best = { at, prefix };
    }
    return best;
  }
}

type Terminator = { kind: 'end'; at: number; length: number } | { kind: 'abort'; at: number };

// BEL or ESC \ ends the sequence; any other ESC, CAN or SUB aborts it. An
// ESC as the buffer's last byte may be the first half of ESC \, so it
// answers unfinished and the sequence is carried.
function findTerminator(buf: Buffer, from: number): Terminator | null {
  for (let i = from; i < buf.length; i++) {
    const b = buf[i];
    if (b === BEL) return { kind: 'end', at: i, length: 1 };
    if (b === CAN || b === SUB) return { kind: 'abort', at: i };
    if (b === ESC) {
      if (i + 1 >= buf.length) return null;
      if (buf[i + 1] === BACKSLASH) return { kind: 'end', at: i, length: 2 };
      return { kind: 'abort', at: i };
    }
  }
  return null;
}
