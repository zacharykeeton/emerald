// The terminal's colour schemes (M9 fix 225). A scheme is the sixteen
// ANSI colours plus the background, the foreground, the cursor and the
// selection, in the shape Windows Terminal keeps them under
// `colorSchemes` in its settings.json, since that is the file people
// already have: the app ships a few in packages/app/resources/schemes
// and reads the person's own out of their settings.json (main/schemes.ts).
// This file is the pure part: one entry read into the xterm theme, the
// list's fallback, and the localStorage key. No DOM, so node:test
// covers it.

export interface TerminalScheme {
  name: string;
  // Where the scheme came from: the app's own folder or the person's
  // Windows Terminal settings. The menu lists the shipped ones first.
  source: 'shipped' | 'windows-terminal';
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

// The scheme each skin falls back to (M9 fix 572), Classic's the one the
// terminal has always had (M38); a missing or unknown pick falls back to
// the skin's.
export const CLASSIC_SCHEME = 'emerald';
export const EMERALD_SCHEME = 'emerald gem';
// skin.ts's Skin, spelled here because this file is shared with main and
// skin.ts touches the DOM; every caller passes its Skin, the same union.
export type SchemeSkin = 'classic' | 'emerald';
export function defaultScheme(skin: SchemeSkin): string {
  return skin === 'emerald' ? EMERALD_SCHEME : CLASSIC_SCHEME;
}
// A pick of the skin's own default is "follow the skin" and stores
// nothing, so it moves with a flip; any other pick, the other skin's
// default included, is stored and holds across every flip. So on Classic,
// picking emerald follows the skin; to keep Classic's palette under
// Emerald, pick emerald while on Emerald.
export function storedPick(name: string, skin: SchemeSkin): string | null {
  return name === defaultScheme(skin) ? null : name;
}
export const SCHEME_KEY = 'emerald.scheme';
// Windows Terminal's field for each of ours where the names differ.
const WT_FIELDS: ReadonlyArray<[keyof Omit<TerminalScheme, 'name' | 'source'>, string]> = [
  ['background', 'background'],
  ['foreground', 'foreground'],
  ['cursor', 'cursorColor'],
  ['selection', 'selectionBackground'],
  ['black', 'black'],
  ['red', 'red'],
  ['green', 'green'],
  ['yellow', 'yellow'],
  ['blue', 'blue'],
  ['magenta', 'purple'],
  ['cyan', 'cyan'],
  ['white', 'white'],
  ['brightBlack', 'brightBlack'],
  ['brightRed', 'brightRed'],
  ['brightGreen', 'brightGreen'],
  ['brightYellow', 'brightYellow'],
  ['brightBlue', 'brightBlue'],
  ['brightMagenta', 'brightPurple'],
  ['brightCyan', 'brightCyan'],
  ['brightWhite', 'brightWhite'],
];

const HEX = /^#[0-9a-f]{6}$/i;

// One `colorSchemes` entry as a scheme, or null when it is not one: no
// name, or any of the twenty colours missing or not a six-digit hex
// (Windows Terminal writes nothing else). The cursor and the selection
// fall back to the foreground, since a hand-written entry often leaves
// them out.
export function schemeFromWindowsTerminal(entry: unknown, source: TerminalScheme['source'] = 'windows-terminal'): TerminalScheme | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  const name = raw['name'];
  if (typeof name !== 'string' || name.trim() === '') return null;
  const out: Record<string, string> = { name: name.trim(), source };
  for (const [ours, theirs] of WT_FIELDS) {
    let value = raw[theirs];
    if (value === undefined && (ours === 'cursor' || ours === 'selection')) value = raw['foreground'];
    if (typeof value !== 'string' || !HEX.test(value)) return null;
    out[ours] = value.toLowerCase();
  }
  return out as unknown as TerminalScheme;
}

// Every scheme in a Windows Terminal settings.json, in the file's order,
// skipping entries that are not schemes; an empty list for a file with
// none or one that will not parse. The file may carry // comments and
// trailing commas (Windows Terminal writes JSONC), so a plain parse that
// fails is tried again with those taken out.
export function schemesFromWindowsTerminal(text: string, source: TerminalScheme['source'] = 'windows-terminal'): TerminalScheme[] {
  const parsed = parseJsonc(text);
  if (typeof parsed !== 'object' || parsed === null) return [];
  const list = (parsed as Record<string, unknown>)['colorSchemes'];
  if (!Array.isArray(list)) return [];
  const out: TerminalScheme[] = [];
  for (const entry of list) {
    const scheme = schemeFromWindowsTerminal(entry, source);
    if (scheme !== null) out.push(scheme);
  }
  return out;
}

function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Comments out (line and block, outside strings), then trailing
    // commas before a closing bracket.
    const stripped = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str: string | undefined) => str ?? '').replace(/,(\s*[}\]])/g, '$1');
    try {
      return JSON.parse(stripped);
    } catch {
      return null;
    }
  }
}

// The skin's default first, the other skin's second, the rest as given.
// A stable sort keeps a person's schemes after the shipped ones.
export function orderSchemes(list: readonly TerminalScheme[], skin: SchemeSkin): TerminalScheme[] {
  const first = defaultScheme(skin);
  const second = defaultScheme(skin === 'emerald' ? 'classic' : 'emerald');
  const rank = (s: TerminalScheme): number => (s.name === first ? 0 : s.name === second ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

// The shipped list first (the skin's default at its head, the other
// skin's second, the rest as given), then the person's under their names,
// a person's scheme with a shipped scheme's name dropped so the menu
// never lists a name twice.
export function mergeSchemes(shipped: readonly TerminalScheme[], own: readonly TerminalScheme[], skin: SchemeSkin): TerminalScheme[] {
  const out = orderSchemes(shipped, skin);
  const names = new Set(out.map((s) => s.name.toLowerCase()));
  for (const s of own) {
    if (names.has(s.name.toLowerCase())) continue;
    names.add(s.name.toLowerCase());
    out.push(s);
  }
  return out;
}

// The scheme a pick names, else the default, else the first; null on an
// empty list (the handler has not answered yet).
export function pickScheme(schemes: readonly TerminalScheme[], name: string | null, skin: SchemeSkin): TerminalScheme | null {
  if (name !== null) {
    const hit = schemes.find((s) => s.name === name);
    if (hit !== undefined) return hit;
  }
  return schemes.find((s) => s.name === defaultScheme(skin)) ?? schemes[0] ?? null;
}

// The scheme a pane's terminal wears (M9 fix 244): the session's own
// when it names one on the list, else the window's pick through
// pickScheme. `own` says which, for the menu's checkmark and the
// heading's tooltip; a session naming a scheme the box lacks (picked on
// another machine, or a Windows Terminal scheme since deleted) wears
// the window's and reads as not its own, and comes back when the list
// does, since the name stays on the record.
export function resolveScheme(schemes: readonly TerminalScheme[], sessionScheme: string | null | undefined, windowPicked: string | null, skin: SchemeSkin): { scheme: TerminalScheme | null; own: boolean } {
  if (sessionScheme !== null && sessionScheme !== undefined) {
    const hit = schemes.find((s) => s.name === sessionScheme);
    if (hit !== undefined) return { scheme: hit, own: true };
  }
  return { scheme: pickScheme(schemes, windowPicked, skin), own: false };
}

// The selection as xterm draws it: the scheme's colour at the alpha the
// terminal has always used, since an opaque selection (which is what a
// Windows Terminal entry holds; it applies its own opacity) would hide
// the glyphs under it.
export const SELECTION_ALPHA = 0.3;

export function selectionColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${SELECTION_ALPHA})`;
}

// xterm's ITheme, the fields the terminal sets. Typed structurally so
// this file needs nothing from @xterm.
export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export function themeOf(s: TerminalScheme): XtermTheme {
  return {
    background: s.background,
    foreground: s.foreground,
    cursor: s.cursor,
    // The glyph under a block cursor reads in the ground's colour.
    cursorAccent: s.background,
    selectionBackground: selectionColor(s.selection),
    black: s.black,
    red: s.red,
    green: s.green,
    yellow: s.yellow,
    blue: s.blue,
    magenta: s.magenta,
    cyan: s.cyan,
    white: s.white,
    brightBlack: s.brightBlack,
    brightRed: s.brightRed,
    brightGreen: s.brightGreen,
    brightYellow: s.brightYellow,
    brightBlue: s.brightBlue,
    brightMagenta: s.brightMagenta,
    brightCyan: s.brightCyan,
    brightWhite: s.brightWhite,
  };
}
