// Finds Claude Code's spinner word in PTY output (M9 fix 158): the
// `Grinding`, `Finagling`, `Whatchamacalliting` its working line shows.
// On the wire, read off a real turn through node-pty and ConPTY, each
// repaint is a cursor move to column one of the spinner's row (or a
// newline when the screen scrolls), a colour, one glyph outside ASCII
// (✢ ✳ ✶ ✻ ✽ and the rest of its set, which is Claude Code's to change),
// a cursor-forward of one in place of the space (or the space itself),
// the capitalised word and the ellipsis:
//
//   ESC[34;1H ESC[38;2;215;119;87m ✶ ESC[1C Finagling…
//
// What follows the ellipsis (the grey `(esc to interrupt · 12s ...)`) is
// not read. The latest word wins, so a reader keeps the last of a push.
import { StringDecoder } from 'node:string_decoder';

const SPINNER = /(?:\x1b\[\d+;1H|\r?\n)(?:\x1b\[[0-9;]*m)*[^\x00-\x7f\s](?:\x1b\[1C| )([A-Z][A-Za-z'-]*)…/gu;
// A repaint is a few dozen characters; a tail longer than this holds no
// cut one worth keeping.
const MAX_CARRY = 256;

export class SpinnerScanner {
  private readonly decoder = new StringDecoder('utf8');
  private carry = '';

  // Every complete spinner word in this chunk (plus what was carried), in
  // order. A word cut between two chunks is completed by the next push.
  push(chunk: Buffer): string[] {
    const text = this.carry + this.decoder.write(chunk);
    const found: string[] = [];
    let last = 0;
    for (const m of text.matchAll(SPINNER)) {
      found.push(m[1]!);
      last = m.index + m[0].length;
    }
    // Keep the tail after the last match, short enough to hold one cut
    // repaint; a match ends on the ellipsis, so nothing of it is needed.
    const rest = text.slice(last);
    this.carry = rest.length > MAX_CARRY ? rest.slice(rest.length - MAX_CARRY) : rest;
    return found;
  }
}
