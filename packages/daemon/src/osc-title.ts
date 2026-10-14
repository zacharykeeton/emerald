// Finds the terminal title in PTY output: OSC 0 (icon and title) and OSC 2
// (title), ESC ] 0 ; <text> and ESC ] 2 ; <text>, terminated by BEL or
// ESC \. Claude Code writes OSC 0 with a glyph in front of the
// conversation's name and swaps the glyph as it works (M33); a shell that
// sets its window title writes one of the two. The latest one wins, so a
// reader keeps the last of what a push returns.
import { OscScanner } from './osc-scanner.ts';

export class TitleScanner {
  private readonly scanner = new OscScanner(['0;', '2;']);

  // Every complete title in this chunk (plus what was carried), in order.
  // An empty title is returned as such: Claude Code clears the title on
  // its way out, and a reader may want to know.
  push(chunk: Buffer): string[] {
    return this.scanner.push(chunk).map((m) => m.payload);
  }
}
