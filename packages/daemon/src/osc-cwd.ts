// Finds OSC 9;9 sequences in PTY output: ESC ] 9 ; 9 ; <path> terminated by
// BEL or ESC \, which is how a shell prompt tells Windows Terminal (and us)
// where it is. The path may be quoted. The scanning itself, including a
// sequence cut between two chunks, is OscScanner's.
import { OscScanner } from './osc-scanner.ts';

export class CwdScanner {
  private readonly scanner = new OscScanner(['9;9;']);

  // Every complete path in this chunk (plus what was carried), in order.
  push(chunk: Buffer): string[] {
    const found: string[] = [];
    for (const { payload } of this.scanner.push(chunk)) {
      const path = payload.replace(/^"(.*)"$/, '$1').trim();
      if (path !== '') found.push(path);
    }
    return found;
  }
}
