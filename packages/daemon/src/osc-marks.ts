// Finds the FinalTerm marks in PTY output (M9 fix 196): ESC ] 133 ; A
// (before the prompt text), ESC ] 133 ; C (a command starts) and
// ESC ] 133 ; D [; code] (a command ended, with its exit code when the
// prompt followed one), terminated by BEL or ESC \, the sequences Windows
// Terminal's shell integration reads and the daemon's prompt wrapper
// writes (launchers/shell.ts). The scanning itself, including a sequence
// cut between two chunks, is OscScanner's.
import { OscScanner } from './osc-scanner.ts';

export interface ShellMark {
  mark: 'A' | 'C' | 'D';
  // The exit code a D carried, null on A, C and a bare D.
  code: number | null;
}

export class MarkScanner {
  private readonly scanner = new OscScanner(['133;']);

  // Every complete mark in this chunk (plus what was carried), in order.
  // The B mark (after the prompt, before the input) and anything else
  // under 133 is skipped.
  push(chunk: Buffer): ShellMark[] {
    const found: ShellMark[] = [];
    for (const { payload } of this.scanner.push(chunk)) {
      const [letter, rest] = payload.split(';', 2);
      if (letter === 'A' || letter === 'C') found.push({ mark: letter, code: null });
      else if (letter === 'D') {
        const code = rest === undefined || rest.trim() === '' ? null : Number(rest.trim());
        found.push({ mark: 'D', code: code !== null && Number.isInteger(code) ? code : null });
      }
    }
    return found;
  }
}
