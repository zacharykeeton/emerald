// The keybinding table and the pure matching behind keys.ts, with no DOM
// types so node:test can cover it. One table feeds both the handler and the
// cheat sheet, so what the sheet says is what the keys do.

export type Action =
  | 'split-vertical'
  | 'split-horizontal'
  | 'close-pane'
  | 'focus-left'
  | 'focus-right'
  | 'focus-up'
  | 'focus-down'
  | 'focus-next'
  | 'focus-prev'
  | 'toggle-focus'
  | 'pick-session'
  | 'jump'
  | 'jump-waiting'
  | 'open-actions'
  | 'new-session'
  | 'toggle-sidebar'
  | 'toggle-files'
  | 'next-tab'
  | 'prev-tab'
  | 'new-layout-tab'
  | 'next-layout-tab'
  | 'prev-layout-tab'
  | 'cheat-sheet'
  | 'text-bigger'
  | 'text-smaller'
  | 'text-reset'
  | 'window-zoom-in'
  | 'window-zoom-out'
  | 'window-zoom-reset'
  | 'find'
  | 'review'
  | 'history-back'
  | 'history-forward'
  | 'whats-new'
  | 'open-file'
  | 'design-mode'
  // M9 fix 689: a Claude pane's chat view or its terminal.
  | 'toggle-chat'
  // M9 fix 844: the tab's shades and the focused pane's.
  | 'shade-all'
  | 'shade-pane';

// A key with its modifiers. `code` is KeyboardEvent.code so a binding does
// not depend on Shift changing the key name.
export interface Chord {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

// The slice of KeyboardEvent the matcher reads.
export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface Binding {
  action: Action;
  label: string;
  // The plain chord that works without the prefix; null when the action
  // is only reachable through the prefix.
  plain: Chord | null;
  // The key pressed after the prefix; null when there is none.
  prefixed: Chord | null;
  // A second plain chord for the same action, matched and forwarded from a browser guest like plain but never printed (M9 fix 900: Ctrl+Shift+= and Ctrl+Shift+-, the Ctrl++ and Ctrl+_ a US keyboard sends, zoom the window as VS Code's do).
  alias?: Chord | undefined;
}

export const DEFAULT_PREFIX = 'Ctrl+B';

// M9 fix 189: the keys that switch tabs are a look-first move, not a look
// at the focused pane, so the attention listener (which runs after the
// keys' one on the same keydown) must not acknowledge the focused session
// for them. The handler marks the event and attention.ts asks. The jump to
// the session waiting longest (fix 201) is the same kind of move: a
// press that acknowledged the pane it left would take the next waiting
// session out of the list it is walking. The shade chords too (M9 fix
// 873): shading panes is a look away, and a chord that acked the focused
// pane took its done badge with it.
export const LOOK_FIRST_ACTIONS: ReadonlySet<Action> = new Set(['next-tab', 'prev-tab', 'next-layout-tab', 'prev-layout-tab', 'jump-waiting', 'shade-all', 'shade-pane']);

const chord = (code: string, mods: Partial<Omit<Chord, 'code'>> = {}): Chord => ({
  code,
  ctrl: mods.ctrl ?? false,
  shift: mods.shift ?? false,
  alt: mods.alt ?? false,
  meta: mods.meta ?? false,
});
const cs = (code: string) => chord(code, { ctrl: true, shift: true });

// Chords follow Terminator because the brief names it as the layout model:
// a "vertical" split draws a vertical divider (panes side by side, tree
// direction 'row'); a "horizontal" split stacks them ('column'). The
// prefixed letters are the same letters without the modifiers, as in tmux.
export const BINDINGS: readonly Binding[] = [
  { action: 'split-vertical', label: 'Split right', plain: cs('KeyE'), prefixed: chord('KeyE') },
  { action: 'split-horizontal', label: 'Split down', plain: cs('KeyO'), prefixed: chord('KeyO') },
  // Hide, not close: the chord only takes the pane away, like the split
  // chords only split; the session stays. The title bar's × kills.
  { action: 'close-pane', label: 'Hide pane', plain: cs('KeyW'), prefixed: chord('KeyW') },
  { action: 'toggle-focus', label: 'Focus pane', plain: cs('KeyZ'), prefixed: chord('KeyZ') },
  { action: 'focus-left', label: 'Focus left', plain: chord('ArrowLeft', { alt: true }), prefixed: chord('ArrowLeft') },
  { action: 'focus-right', label: 'Focus right', plain: chord('ArrowRight', { alt: true }), prefixed: chord('ArrowRight') },
  { action: 'focus-up', label: 'Focus up', plain: chord('ArrowUp', { alt: true }), prefixed: chord('ArrowUp') },
  { action: 'focus-down', label: 'Focus down', plain: chord('ArrowDown', { alt: true }), prefixed: chord('ArrowDown') },
  { action: 'focus-next', label: 'Focus next pane', plain: chord('Tab', { ctrl: true }), prefixed: chord('Tab') },
  { action: 'focus-prev', label: 'Focus previous pane', plain: cs('Tab'), prefixed: chord('Tab', { shift: true }) },
  { action: 'pick-session', label: 'Show a session here', plain: cs('KeyS'), prefixed: chord('KeyS') },
  // The same picker under the name Orca gives it: type to filter every
  // session, Enter shows it here, Shift+Enter or Ctrl+Enter in a split.
  { action: 'jump', label: 'Jump to a session', plain: chord('KeyJ', { ctrl: true }), prefixed: chord('KeyJ') },
  // M9 fix 201: straight to the session that has waited longest for a
  // person (a question first, then a reply, then an error), and the next
  // one on a second press within a few seconds. A is free after the
  // prefix, and Ctrl+Shift+A is nothing in PowerShell or Claude Code.
  { action: 'jump-waiting', label: 'Jump to the session waiting longest', plain: cs('KeyA'), prefixed: chord('KeyA') },
  // M9 fix 202: the same picker in its action mode, every binding by its
  // label and the focused pane's menu; VS Code's Ctrl+Shift+P, and : after
  // the prefix as vim's command line (> typed first does the same).
  { action: 'open-actions', label: 'Run an action', plain: cs('KeyP'), prefixed: chord('Semicolon', { shift: true }) },
  // N after the prefix went to the layout tabs in M36 (tmux's n), so the
  // shell moved to Shift+N there; the plain chord is unchanged.
  { action: 'new-session', label: 'New shell here', plain: cs('KeyN'), prefixed: chord('KeyN', { shift: true }) },
  { action: 'toggle-sidebar', label: 'Toggle sidebar', plain: cs('KeyB'), prefixed: chord('KeyB') },
  { action: 'toggle-files', label: 'Toggle files', plain: cs('KeyF'), prefixed: chord('KeyF') },
  // The tab strip. Ctrl+W closes a file tab too, handled in keys.ts only
  // while one is showing so the shell keeps its Ctrl+W on the panes tab.
  { action: 'next-tab', label: 'Next tab', plain: chord('PageDown', { ctrl: true }), prefixed: chord('BracketRight') },
  { action: 'prev-tab', label: 'Previous tab', plain: chord('PageUp', { ctrl: true }), prefixed: chord('BracketLeft') },
  // The layout tabs (M36), with tmux's letters for its windows: c makes
  // one, n and p walk them. Prefix only, since the plain letters are typed.
  { action: 'new-layout-tab', label: 'New layout tab', plain: null, prefixed: chord('KeyC') },
  { action: 'next-layout-tab', label: 'Next layout tab', plain: null, prefixed: chord('KeyN') },
  { action: 'prev-layout-tab', label: 'Previous layout tab', plain: null, prefixed: chord('KeyP') },
  { action: 'cheat-sheet', label: 'Key cheat sheet', plain: cs('Slash'), prefixed: chord('Slash', { shift: true }) },
  // Text size of the focused pane or the file tab on show (M9 fix 899;
  // Ctrl+wheel and the pane menu's Reset text size do the same). Its plain
  // chords went to the window's zoom in M9 fix 900, so it has the prefix's
  // keys alone.
  { action: 'text-bigger', label: 'Bigger text', plain: null, prefixed: chord('Equal') },
  { action: 'text-smaller', label: 'Smaller text', plain: null, prefixed: chord('Minus') },
  { action: 'text-reset', label: 'Reset text size', plain: null, prefixed: chord('Digit0') },
  // The whole window's zoom, VS Code's Ctrl+= and Ctrl+- (M9 fix 900), with
  // Ctrl++ and Ctrl+_ (Shift on a US keyboard) as the same keys. Electron's
  // menu roles would take these in main; index.ts drops them.
  { action: 'window-zoom-in', label: 'Zoom in', plain: chord('Equal', { ctrl: true }), alias: cs('Equal'), prefixed: chord('Equal', { shift: true }) },
  { action: 'window-zoom-out', label: 'Zoom out', plain: chord('Minus', { ctrl: true }), alias: cs('Minus'), prefixed: chord('Minus', { shift: true }) },
  { action: 'window-zoom-reset', label: 'Reset zoom', plain: chord('Digit0', { ctrl: true }), prefixed: chord('Digit0', { shift: true }) },
  // Find in the scrollback (M26). Ctrl+F is the shell's history search and
  // Ctrl+Shift+F the rail toggle, so H, and / after the prefix (? is the
  // cheat sheet).
  { action: 'find', label: 'Find in scrollback', plain: cs('KeyH'), prefixed: chord('Slash') },
  // The focused pane's session's changes as a review tab (M64). R is free
  // after the prefix; Ctrl+Shift+R is Chromium's hard reload, which the
  // renderer never sees under the app's menu-less window.
  { action: 'review', label: 'Review changes', plain: cs('KeyR'), prefixed: chord('KeyR') },
  // The focus history (M9 fix 184), a browser's back and forward. Alt+Left
  // is focus-left, so Ctrl+Alt with the arrows; after the prefix , and .
  // read as < and > (- and = are the text size).
  { action: 'history-back', label: 'Back in the focus history', plain: chord('ArrowLeft', { ctrl: true, alt: true }), prefixed: chord('Comma') },
  { action: 'history-forward', label: 'Forward in the focus history', plain: chord('ArrowRight', { ctrl: true, alt: true }), prefixed: chord('Period') },
  // The release notes (M9 fix 227). No chord: the tab opens itself once
  // per build, and the palette (`> what`) and the cheat sheet list this
  // row for the reopen.
  { action: 'whats-new', label: "What's new", plain: null, prefixed: null },
  // A file from anywhere on disk (M9 fix 341), through the native chooser
  // into a pinned tab. O after the prefix is the split; Shift+O is free.
  // M9 fix 364: a plain chord too, so the chooser is one keystroke from
  // the terminal; Ctrl+Shift+O is already Split down (`split-horizontal`
  // above) and Ctrl+Shift+F is the rail toggle, so G, VS Code's own
  // mnemonic for "go to file" (Ctrl+G there opens the line-number box,
  // close enough in spirit and free here either way).
  { action: 'open-file', label: 'Open a file…', plain: cs('KeyG'), prefixed: chord('KeyO', { shift: true }) },
  // M9 fix 674: Design Mode on the browser pane. D was free both plain
  // and after the prefix; Ctrl+Shift+D used to reach a shell as ^D.
  { action: 'design-mode', label: 'Design Mode', plain: cs('KeyD'), prefixed: chord('KeyD') },
  // M9 fix 689: the focused Claude pane between its chat view and its
  // terminal. M was free both plain and after the prefix; Ctrl+Shift+I
  // is the View menu's devtools, in every build (index.ts's menu; M9 fix 862).
  { action: 'toggle-chat', label: 'Chat or terminal', plain: cs('KeyM'), prefixed: chord('KeyM') },
  // M9 fix 844: Shade all as a chord, lifting every shade when all are
  // down, and the focused pane's own shade. U and K were free both plain
  // and after the prefix; the plain chords reached a shell as ^U and ^K,
  // which Ctrl+U and Ctrl+K still send.
  { action: 'shade-all', label: 'Shade or lift all', plain: cs('KeyU'), prefixed: chord('KeyU') },
  { action: 'shade-pane', label: 'Shade or lift pane', plain: cs('KeyK'), prefixed: chord('KeyK') },
];

export function chordMatches(c: Chord, ev: KeyLike): boolean {
  return c.code === ev.code && c.ctrl === ev.ctrlKey && c.shift === ev.shiftKey && c.alt === ev.altKey && c.meta === ev.metaKey;
}

export function matchPlain(ev: KeyLike): Action | null {
  for (const b of BINDINGS) {
    if (b.plain !== null && chordMatches(b.plain, ev)) return b.action;
    if (b.alias !== undefined && chordMatches(b.alias, ev)) return b.action;
  }
  return null;
}

// The key after the prefix.
export function matchPrefixed(ev: KeyLike): Action | null {
  for (const b of BINDINGS) {
    if (b.prefixed !== null && chordMatches(b.prefixed, ev)) return b.action;
  }
  return null;
}

// A modifier on its own must not cancel an armed prefix: Shift+Tab starts
// with a Shift keydown.
export function isModifierKey(code: string): boolean {
  return /^(Shift|Control|Alt|Meta)(Left|Right)?$/.test(code);
}

// "Ctrl+B", "Ctrl+Space", "Alt+Backquote", "Ctrl+Shift+A". Modifiers are
// joined with '+', the last token is the key: a letter, a digit or a
// KeyboardEvent.code. Returns null for anything unusable, including a key
// with no Ctrl, Alt or Meta, which would swallow ordinary typing.
export function parseKeySpec(spec: string): Chord | null {
  const parts = spec
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0) return null;
  const keyPart = parts[parts.length - 1]!;
  const mods = { ctrl: false, shift: false, alt: false, meta: false };
  for (const p of parts.slice(0, -1)) {
    switch (p.toLowerCase()) {
      case 'ctrl':
      case 'control':
        mods.ctrl = true;
        break;
      case 'shift':
        mods.shift = true;
        break;
      case 'alt':
        mods.alt = true;
        break;
      case 'meta':
      case 'win':
      case 'super':
        mods.meta = true;
        break;
      default:
        return null;
    }
  }
  const code = keyToCode(keyPart);
  if (code === null) return null;
  if (!mods.ctrl && !mods.alt && !mods.meta) return null;
  return { code, ...mods };
}

function keyToCode(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  const named: Record<string, string> = { space: 'Space', tab: 'Tab', '`': 'Backquote', backquote: 'Backquote', escape: 'Escape', esc: 'Escape' };
  const lower = key.toLowerCase();
  if (lower in named) return named[lower]!;
  // Anything else is taken as a code verbatim (F1, Backslash, Semicolon).
  return /^[A-Za-z][A-Za-z0-9]*$/.test(key) ? key : null;
}

// The display form used by the cheat sheet and the prefix indicator.
export function formatChord(c: Chord): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push('Ctrl');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  if (c.meta) parts.push('Win');
  parts.push(codeToName(c.code, c.shift));
  return parts.join('+');
}

// Slash is the one key shown as what it types: ? with Shift, / without.
// The punctuation codes print their character (M9 fix 31: the sheet said
// BracketRight for the next-tab chord); anything else prints its code.
function codeToName(code: string, shift: boolean): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter !== null) return letter[1]!;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit !== null) return digit[1]!;
  const named: Record<string, string> = {
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    Slash: shift ? '?' : '/',
    Semicolon: shift ? ':' : ';',
    Backquote: '`',
    Equal: '=',
    Minus: '-',
    BracketLeft: '[',
    BracketRight: ']',
  };
  return named[code] ?? code;
}

// The plain chord for an action as the menus show it, or '' if it has none.
export function plainKeyFor(action: Action): string {
  const b = BINDINGS.find((x) => x.action === action);
  return b === undefined || b.plain === null ? '' : formatChord(b.plain);
}

// Shift+Enter in a Claude pane (M28). Claude Code takes a newline in its
// prompt box from the kitty keyboard protocol's Shift+Enter, CSI 13;2u,
// which is what its /terminal-setup teaches VS Code and iTerm to send;
// xterm sends a plain CR for it, which submits the prompt. The pane sends
// the kitty sequence only while Claude is what is running: PowerShell has
// no use for it and would echo it. Ctrl+Enter, Alt+Enter and plain Enter
// stay xterm's. Returns the bytes to send, or null to leave the key alone.
export const KITTY_SHIFT_ENTER = '\x1b[13;2u';

export function enterSequence(ev: KeyLike & { type: string }, kind: 'claude' | 'shell'): string | null {
  if (kind !== 'claude' || ev.type !== 'keydown' || ev.code !== 'Enter') return null;
  if (!ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  return KITTY_SHIFT_ENTER;
}

// Ctrl+V in any pane pastes (M9 fix 92), as it does in Windows Terminal,
// where a person moving between it and an emerald pane expects the same
// key; xterm would send it to the program as the byte 0x16, and only
// Ctrl+Shift+V, the browser's paste, pasted. The pane reads the clipboard
// itself (Pane.tsx): text is pasted, and an image with no text sends that
// byte after all, since Claude Code reads an image off the clipboard on
// it. Ctrl+Shift+V and any chord with Alt or Meta are left to xterm.
// A Ctrl+V with no code at all is a synthesised one, a dictation tool's
// paste (Wispr Flow sends it so, M9 fix 637), and goes by its key or its
// key code; a physical key still goes by code alone, so a layout where
// another key types v does not paste.
export function isPasteKey(ev: KeyLike & { key?: string; keyCode?: number }): boolean {
  if (!ev.ctrlKey || ev.shiftKey || ev.altKey || ev.metaKey) return false;
  if (ev.code === 'KeyV') return true;
  return ev.code === '' && (ev.key === 'v' || ev.key === 'V' || ev.keyCode === 86);
}

// The byte a terminal sends for Ctrl+V when nothing intercepts it.
export const CTRL_V = '\x16';

// Ctrl+Shift+C in any pane copies the terminal's selection (M9 fix 441),
// Windows Terminal's key, and does nothing when there is none. Ctrl+C
// stays the program's ^C: the app menu's Copy is bound to it, but xterm
// takes the key first and cancels it, so the accelerator never fires.
export function isCopyKey(ev: KeyLike): boolean {
  return ev.code === 'KeyC' && ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey;
}
