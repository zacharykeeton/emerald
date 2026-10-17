import { trustDialog } from '@emerald/shared';

// How long after the latest output the screen is read, so a dialog drawn in
// several chunks is read once it is whole.
export const TRUST_READ_MS = 200;

export interface TrustReadOptions {
  read: () => Promise<{ rows: string[] }>;
  gate: () => 'starting' | 'trust' | null;
  apply: (shown: boolean) => void;
  delayMs?: number;
}

// M9 fix 808: Claude Code's folder trust dialog, read off a starting
// session's screen, since no hook fires until it is answered. The gate says
// what the record is waiting to learn: `starting` whether the dialog is up,
// `trust` whether it has gone, null nothing (a session past its start pays
// nothing). One read in flight at a time; output during a read schedules
// one more after it.
export class TrustRead {
  private timer: NodeJS.Timeout | null = null;
  private reading = false;
  private again = false;
  private disposed = false;
  private readonly delayMs: number;
  private readonly opts: TrustReadOptions;

  constructor(opts: TrustReadOptions) {
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
      const shown = trustDialog(rows) !== null;
      if (gate === 'starting' && shown) this.opts.apply(true);
      else if (gate === 'trust' && !shown) this.opts.apply(false);
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
