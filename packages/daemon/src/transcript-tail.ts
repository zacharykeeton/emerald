import fs from 'node:fs';
import { Limits, assistantText } from '@emerald/shared';

// Follows a Claude Code transcript while a turn runs (M47) and reports
// the latest assistant text as each line lands. A poll on a timer rather
// than fs.watch: the projects folder holds hundreds of files, libuv has
// asserted on watched 8.3 paths, and one fstat every half second while a
// turn runs is nothing. Starting sets the offset at the file's end, so
// nothing written before the turn is read; a file that does not exist
// yet is size 0 and looked for again each tick. The file is append-only,
// so a size below the offset means a new file and the offset resets.
// Bytes are read from the offset to the size and split on newlines, the
// last piece kept until its newline arrives, since Claude Code can be
// mid-write when the tick lands. One tick runs at a time. The bytes are
// decoded as a stream (M9 fix 503), so a character cut at a tick's edge
// comes out whole on the next, and a partial line past
// transcriptPartialMaxChars is dropped and the rest of it skipped.
export class TranscriptTail {
  readonly path: string;
  private readonly onText: (text: string) => void;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private offset = 0;
  private partial = '';
  private decoder = new TextDecoder('utf-8');
  // Set when a partial line outgrew its cap: the text up to the next
  // newline is the rest of that line and is dropped.
  private skipping = false;
  private busy = false;
  private stopped = false;
  private tickCount = 0;

  constructor(path: string, onText: (text: string) => void, intervalMs: number = Limits.transcriptPollMs) {
    this.path = path;
    this.onText = onText;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer !== null || this.stopped) return;
    this.offset = this.sizeNow();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // A tail must not keep a daemon alive that is otherwise shutting down.
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  // How many ticks have run past the busy and stopped guard, so a test can
  // wait on the tail rather than on a clock.
  get ticks(): number {
    return this.tickCount;
  }

  private sizeNow(): number {
    try {
      return fs.statSync(this.path).size;
    } catch {
      return 0;
    }
  }

  private async tick(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const size = this.sizeNow();
      if (size < this.offset) {
        this.offset = size;
        this.partial = '';
        this.decoder = new TextDecoder('utf-8');
        this.skipping = false;
      }
      if (size === this.offset) return;
      const bytes = await this.read(this.offset, size);
      if (bytes === null || this.stopped) return;
      this.offset = size;
      let text = this.decoder.decode(bytes, { stream: true });
      if (this.skipping) {
        const nl = text.indexOf('\n');
        if (nl === -1) return;
        text = text.slice(nl + 1);
        this.skipping = false;
      }
      const pieces = (this.partial + text).split('\n');
      this.partial = pieces.pop() ?? '';
      if (this.partial.length > Limits.transcriptPartialMaxChars) {
        this.partial = '';
        this.skipping = true;
      }
      let latest: string | null = null;
      for (const line of pieces) latest = assistantText(line) ?? latest;
      if (latest !== null) this.onText(latest);
    } finally {
      this.tickCount++;
      this.busy = false;
    }
  }

  // The bytes between two offsets. The handle is opened per tick:
  // a Claude Code that rotates or removes the file must not find it held,
  // and a turn's worth of ticks is a few hundred opens at most.
  private async read(from: number, to: number): Promise<Buffer | null> {
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(this.path, 'r');
    } catch {
      return null;
    }
    try {
      const buffer = Buffer.alloc(to - from);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
      return buffer.subarray(0, bytesRead);
    } catch {
      return null;
    } finally {
      await handle.close();
    }
  }
}
