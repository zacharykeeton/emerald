import type { TerminalScheme } from './scheme-model.ts';

// A file's own colour scheme colours its syntax too, not just its ground
// (M9 fix 438): one Monaco theme per scheme, built off the scheme's
// sixteen ANSI colours the way a terminal already reads them, so a light
// scheme's strings and numbers do not keep the dark theme's colours.
// This file is the pure part (the token map, the light-or-dark call), so
// node:test covers it without touching monaco-editor; monaco.ts calls
// monaco.editor.defineTheme with what it returns.

export interface ThemeRule {
  token: string;
  foreground: string;
}

export interface SchemeThemeData {
  base: 'vs' | 'vs-dark';
  inherit: true;
  rules: ThemeRule[];
  colors: Record<string, string>;
}

export interface SchemeTheme {
  // The id monaco.editor.defineTheme and setTheme take; one per scheme
  // name, so a scheme picked again reuses the theme already defined.
  name: string;
  data: SchemeThemeData;
}

// Monaco's defineTheme refuses a name outside /^[a-z0-9-]+$/i (a scheme's
// own name is free text, and the shipped list alone has three with a
// space in them), so the name is hex-encoded rather than embedded: a
// distinct string always gives a distinct, legal id, and the same string
// always gives the same one back, which is what lets a scheme picked
// again reuse the theme already defined.
export function schemeThemeName(scheme: Pick<TerminalScheme, 'name'>): string {
  let hex = '';
  for (let i = 0; i < scheme.name.length; i++) hex += scheme.name.charCodeAt(i).toString(16).padStart(4, '0');
  return `emerald-file-${hex}`;
}

// Monaco's rule format wants the hex without the leading #.
function bare(hex: string): string {
  return hex.replace(/^#/, '');
}

// Perceived brightness (the usual broadcast weights), 0 to 1; under half
// is a dark ground, same threshold the terminal's own cursor glyph logic
// does not need but this one does, since vs and vs-dark disagree on
// every colour a rule does not name.
export function isDark(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

// The token map, pinned so no one dithers (M9 fix 438's plan): comment
// to bright black, string to green, number to magenta, keyword to blue,
// type and type.identifier to cyan, delimiter, variable and identifier
// to the foreground; JSON's own token names for its three shapes are
// distinct from the grammar's, so they get their own rules rather than
// inheriting the plain ones.
export function schemeTheme(scheme: TerminalScheme): SchemeTheme {
  const fg = bare(scheme.foreground);
  const rules: ThemeRule[] = [
    { token: 'comment', foreground: bare(scheme.brightBlack) },
    { token: 'string', foreground: bare(scheme.green) },
    { token: 'number', foreground: bare(scheme.magenta) },
    { token: 'keyword', foreground: bare(scheme.blue) },
    { token: 'type', foreground: bare(scheme.cyan) },
    { token: 'type.identifier', foreground: bare(scheme.cyan) },
    { token: 'delimiter', foreground: fg },
    { token: 'variable', foreground: fg },
    { token: 'identifier', foreground: fg },
    { token: 'string.key.json', foreground: bare(scheme.blue) },
    { token: 'string.value.json', foreground: bare(scheme.green) },
    { token: 'keyword.json', foreground: bare(scheme.magenta) },
  ];
  return {
    name: schemeThemeName(scheme),
    data: {
      base: isDark(scheme.background) ? 'vs-dark' : 'vs',
      inherit: true,
      rules,
      colors: {
        'editor.background': scheme.background,
        'editor.foreground': scheme.foreground,
      },
    },
  };
}
