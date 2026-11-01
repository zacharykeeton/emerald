// Claude Code's own theme, read the way Claude Code reads it (M9 fix 1035),
// so a Claude pane whose scheme and Claude Code's theme disagree can say so.
// Traced on Claude Code 2.1.316's bundle: the user settings' `theme` wins,
// then the legacy global config's when it is not the default `dark`, then
// `dark`. A `/theme` pick writes the user settings. Emerald never writes
// either file. No electron import, so `node --test` loads this file.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ClaudeThemeKind, ClaudeThemeRead } from '../preload/api.ts';

export type { ClaudeThemeKind };

// The six bases and `auto`, as Claude Code lists them (`hgs` and `C1e` in
// the bundle); anything else in the file is dropped by its schema's catch.
const BASES = ['dark', 'light', 'light-daltonized', 'dark-daltonized', 'light-ansi', 'dark-ansi'] as const;
const KNOWN: readonly string[] = ['auto', ...BASES];

// Claude Code may be mid-write when the window takes focus, so a file that
// does not parse is read once more after this long before it counts.
const RETRY_MS = 200;

export function claudeThemePaths(env: NodeJS.ProcessEnv, home: string, configDir: string): { settings: string; global: string } {
  const dir = env['CLAUDE_CONFIG_DIR']?.trim();
  return {
    settings: path.join(configDir, 'settings.json'),
    // Claude Code keeps .claude.json beside the config folder's contents when
    // CLAUDE_CONFIG_DIR is set, and in the home folder otherwise.
    global: dir ? path.join(dir, '.claude.json') : path.join(home, '.claude.json'),
  };
}

function kindOfBase(base: string): ClaudeThemeKind {
  if (base === 'dark' || base === 'dark-daltonized') return 'dark';
  if (base === 'light' || base === 'light-daltonized') return 'light';
  // The -ansi themes and auto draw in the terminal's own colours, which
  // follow the pane's scheme, so they never disagree with it.
  return 'none';
}

export function kindOfTheme(value: string, customBase: (slug: string) => string | null): ClaudeThemeKind {
  if (value.startsWith('custom:')) {
    const slug = value.slice('custom:'.length);
    if (!/^[A-Za-z0-9._-]+$/.test(slug) || slug === '..') return 'none';
    const base = customBase(slug);
    return base === null ? 'none' : kindOfBase(base);
  }
  return kindOfBase(value);
}

type FileRead = { state: 'missing' } | { state: 'bad' } | { state: 'ok'; json: Record<string, unknown> };

async function readOnce(file: string): Promise<FileRead> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { state: 'bad' };
    return { state: 'ok', json: parsed as Record<string, unknown> };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' };
    return { state: 'bad' };
  }
}

async function readJson(file: string): Promise<FileRead> {
  const first = await readOnce(file);
  if (first.state !== 'bad') return first;
  await new Promise((r) => setTimeout(r, RETRY_MS));
  return readOnce(file);
}

function themeValue(json: Record<string, unknown>): string | null {
  const t = json['theme'];
  if (typeof t !== 'string') return null;
  return KNOWN.includes(t) || t.startsWith('custom:') ? t : null;
}

// A custom theme's base: its file's `base` when it is one of the six, `dark`
// when the file is there but says nothing usable (as Claude Code does), and
// null when there is no file (a plugin's theme, which emerald does not read).
async function customBases(themes: string, value: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!value.startsWith('custom:')) return out;
  const slug = value.slice('custom:'.length);
  if (!/^[A-Za-z0-9._-]+$/.test(slug) || slug === '..') return out;
  const r = await readOnce(path.join(themes, slug + '.json'));
  if (r.state === 'missing') out.set(slug, null);
  else if (r.state === 'bad') out.set(slug, 'dark');
  else {
    const base = r.json['base'];
    out.set(slug, typeof base === 'string' && (BASES as readonly string[]).includes(base) ? base : 'dark');
  }
  return out;
}

async function answer(theme: string, source: 'settings' | 'global', themes: string): Promise<ClaudeThemeRead> {
  const bases = await customBases(themes, theme);
  return { theme, source, kind: kindOfTheme(theme, (slug) => bases.get(slug) ?? null) };
}

export async function readClaudeTheme(paths: { settings: string; global: string; themes: string }): Promise<ClaudeThemeRead> {
  const settings = await readJson(paths.settings);
  if (settings.state === 'bad') return { theme: '', source: 'settings', kind: 'unknown' };
  if (settings.state === 'ok') {
    const t = themeValue(settings.json);
    if (t !== null) return answer(t, 'settings', paths.themes);
  }
  const global = await readJson(paths.global);
  if (global.state === 'bad') return { theme: '', source: 'global', kind: 'unknown' };
  if (global.state === 'ok') {
    const t = themeValue(global.json);
    // The legacy copy counts only when it differs from the default.
    if (t !== null && t !== 'dark') return answer(t, 'global', paths.themes);
  }
  return { theme: 'dark', source: 'default', kind: 'dark' };
}
