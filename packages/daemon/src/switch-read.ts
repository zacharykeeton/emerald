import { switchDialog } from '@emerald/shared';
import { TRUST_READ_MS } from './trust-read.ts';

export interface SwitchReadOptions {
  read: () => Promise<{ rows: string[] }>;
  gate: () => 'rest' | 'switch' | null;
  apply: (shown: boolean) => void;
  delayMs?: number;
}

// M9 fix 976: Claude Code's switch confirmation, read off the screen of a
// Claude at rest, since no hook fires while it is up. Output at rest is rare
// (typing echo, a dialog), so a read per burst costs little. The gate says
// what the record is waiting to learn: `rest` whether the dialog is up,
// `switch` whether it has gone, null nothing. One read in flight at a time;
// output during a read schedules one more after it, as TrustRead does.
export class SwitchRead {
  private timer: NodeJS.Timeout | null = null;
  private reading = false;
  private again = false;
  private disposed = false;
  private readonly delayMs: number;
  private readonly opts: SwitchReadOptions;

  constructor(opts: SwitchReadOptions) {
    this.opts = opts;
    this.delayMs = opts.delayMs ?? TRUST_READ_MS;
  }

  poke(): void {
    if (this.disposed) return;
    if (this.reading) {
      this.again = true;
      return;
    }
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.delayMs);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    if (this.disposed) return;
    this.reading = true;
    try {
      const { rows } = await this.opts.read();
      if (this.disposed) return;
      const gate = this.opts.gate();
      const shown = switchDialog(rows) !== null;
      if (gate === 'rest' && shown) this.opts.apply(true);
      else if (gate === 'switch' && !shown) this.opts.apply(false);
    } catch {
      // A screen that could not be read says nothing either way.
    } finally {
      this.reading = false;
      if (this.again) {
        this.again = false;
        this.poke();
      }
    }
  }
}
