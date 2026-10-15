// The app's chords while a page in a browser pane has the keyboard (M9
// fix 670). A guest page's keys never reach the renderer's window, where
// the key map listens (keys.ts), so the main process hears them first on
// the guest's before-input-event and decides here, from the chords and
// the prefix the renderer sent, whether a key is the app's or the page's.
// Pure, so guest-keys.test.ts reaches every rule.
//
// Ctrl+W and Ctrl+S are never in the list the renderer sends (they are
// cases of their own in keys.ts, meaningful only with a file tab up), so
// they stay with the page. Alt+Left and Alt+Right are app chords (Focus
// left and right), so they are no longer the page's Back and Forward;
// the toolbar's Back and Forward stay.

// The renderer's Chord (keys-model.ts), the same fields.
export interface GuestChord {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

// page: the page takes the key. window: the window takes it and the page
// does not. window-and-page: both (the prefix twice, which hands the page
// a literal prefix as tmux does and lets the window disarm). reload and
// reload-hard: the page reloads, never the whole window. swallow: nobody
// gets it, since main acted on it itself (Design Mode's C, S and Escape
// during a grab, M9 fix 674).
export type GuestVerdict = 'page' | 'window' | 'window-and-page' | 'reload' | 'reload-hard' | 'swallow';

// The slice of Electron's Input the rules read.
export interface GuestInput {
  type: string;
  code: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

const MODIFIER = /^(Shift|Control|Alt|Meta)(Left|Right)?$/;

function matches(c: GuestChord, input: GuestInput): boolean {
  return c.code === input.code && c.ctrl === input.control && c.shift === input.shift && c.alt === input.alt && c.meta === input.meta;
}

const DEFAULT_PREFIX: GuestChord = { code: 'KeyB', ctrl: true, shift: false, alt: false, meta: false };

export class GuestKeys {
  private chords: GuestChord[] = [];
  private prefix: GuestChord = DEFAULT_PREFIX;
  private armed = false;

  configure(chords: GuestChord[], prefix: GuestChord): void {
    this.chords = chords;
    this.prefix = prefix;
  }

  // The renderer's word: its prefix is armed or its cheat sheet is open,
  // so the next key in a page is the window's.
  setArmed(armed: boolean): void {
    this.armed = armed;
  }

  decide(input: GuestInput): GuestVerdict {
    if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return 'page';
    if (MODIFIER.test(input.code)) return 'page';
    if (this.armed) {
      this.armed = false;
      return matches(this.prefix, input) ? 'window-and-page' : 'window';
    }
    if (matches(this.prefix, input)) {
      // Armed here and not on the renderer's push, since preventDefault
      // cannot wait on the round trip; the push agrees a moment later.
      this.armed = true;
      return 'window';
    }
    if (this.chords.some((c) => matches(c, input))) return 'window';
    if (input.code === 'KeyR' && input.control && !input.alt && !input.meta) return input.shift ? 'reload-hard' : 'reload';
    return 'page';
  }
}
