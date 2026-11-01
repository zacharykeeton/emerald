import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeThemePaths, kindOfTheme, readClaudeTheme } from './claude-theme.ts';

// Claude Code's own theme (M9 fix 1035), read as Claude Code 2.1.316 reads
// it: user settings first, the legacy global config when not `dark`, else
// the default `dark`.
test('kindOfTheme for the seven values', () => {
  const none = () => null;
  assert.equal(kindOfTheme('dark', none), 'dark');
  assert.equal(kindOfTheme('dark-daltonized', none), 'dark');
  assert.equal(kindOfTheme('light', none), 'light');
  assert.equal(kindOfTheme('light-daltonized', none), 'light');
  assert.equal(kindOfTheme('dark-ansi', none), 'none');
  assert.equal(kindOfTheme('light-ansi', none), 'none');
  assert.equal(kindOfTheme('auto', none), 'none');
});

test('kindOfTheme for a custom theme takes its base, and a bad slug or a missing file reads none', () => {
  const asked: string[] = [];
  const bases = (slug: string) => {
    asked.push(slug);
    return slug === 'paper' ? 'light' : slug === 'odd' ? 'dark' : null;
  };
  assert.equal(kindOfTheme('custom:paper', bases), 'light');
  assert.equal(kindOfTheme('custom:odd', bases), 'dark');
  assert.equal(kindOfTheme('custom:gone', bases), 'none');
  assert.equal(kindOfTheme('custom:../x', bases), 'none');
  assert.equal(kindOfTheme('custom:..', bases), 'none');
  assert.deepEqual(asked, ['paper', 'odd', 'gone']);
});

test('claudeThemePaths with and without CLAUDE_CONFIG_DIR', () => {
  const home = path.join('C:', 'home');
  assert.deepEqual(claudeThemePaths({}, home, path.join(home, '.claude')), {
    settings: path.join(home, '.claude', 'settings.json'),
    global: path.join(home, '.claude.json'),
  });
  assert.deepEqual(claudeThemePaths({ CLAUDE_CONFIG_DIR: ' C:/cfg ' }, home, 'C:/cfg'), {
    settings: path.join('C:/cfg', 'settings.json'),
    global: path.join('C:/cfg', '.claude.json'),
  });
  assert.deepEqual(claudeThemePaths({ CLAUDE_CONFIG_DIR: '  ' }, home, path.join(home, '.claude')).global, path.join(home, '.claude.json'));
});

function folder(files: Record<string, string>): { settings: string; global: string; themes: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-theme-'));
  fs.mkdirSync(path.join(dir, 'themes'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return { settings: path.join(dir, 'settings.json'), global: path.join(dir, '.claude.json'), themes: path.join(dir, 'themes') };
}

test('readClaudeTheme: the user settings beat the global config', async () => {
  const p = folder({ 'settings.json': JSON.stringify({ theme: 'light' }), '.claude.json': JSON.stringify({ theme: 'dark-daltonized' }) });
  assert.deepEqual(await readClaudeTheme(p), { theme: 'light', source: 'settings', kind: 'light' });
});

test('readClaudeTheme: no settings file and a global light-daltonized read light from global', async () => {
  const p = folder({ '.claude.json': JSON.stringify({ theme: 'light-daltonized' }) });
  assert.deepEqual(await readClaudeTheme(p), { theme: 'light-daltonized', source: 'global', kind: 'light' });
});

test('readClaudeTheme: a global dark is the default, not the global', async () => {
  const p = folder({ 'settings.json': JSON.stringify({ model: 'opus' }), '.claude.json': JSON.stringify({ theme: 'dark' }) });
  assert.deepEqual(await readClaudeTheme(p), { theme: 'dark', source: 'default', kind: 'dark' });
});

test('readClaudeTheme: both files missing read the default dark', async () => {
  assert.deepEqual(await readClaudeTheme(folder({})), { theme: 'dark', source: 'default', kind: 'dark' });
});

test('readClaudeTheme: a theme that is not a known value falls through to the global', async () => {
  const p = folder({ 'settings.json': JSON.stringify({ theme: 7 }), '.claude.json': JSON.stringify({ theme: 'light' }) });
  assert.deepEqual(await readClaudeTheme(p), { theme: 'light', source: 'global', kind: 'light' });
  const q = folder({ 'settings.json': JSON.stringify({ theme: 'sepia' }) });
  assert.deepEqual(await readClaudeTheme(q), { theme: 'dark', source: 'default', kind: 'dark' });
});

test('readClaudeTheme: settings that do not parse, twice, read unknown', async () => {
  const p = folder({ 'settings.json': '{ "theme": "li', '.claude.json': JSON.stringify({ theme: 'light' }) });
  const started = Date.now();
  assert.deepEqual(await readClaudeTheme(p), { theme: '', source: 'settings', kind: 'unknown' });
  assert.ok(Date.now() - started >= 190, 'the retry waited');
});

test('readClaudeTheme: a file fixed between the two reads is read', async () => {
  const p = folder({ 'settings.json': '{ "theme": ' });
  setTimeout(() => fs.writeFileSync(p.settings, JSON.stringify({ theme: 'light' })), 50);
  assert.deepEqual(await readClaudeTheme(p), { theme: 'light', source: 'settings', kind: 'light' });
});

test('readClaudeTheme: a global that does not parse reads unknown from global', async () => {
  const p = folder({ '.claude.json': '[' });
  assert.deepEqual(await readClaudeTheme(p), { theme: '', source: 'global', kind: 'unknown' });
});

test('readClaudeTheme: a custom theme reads its base; a bad base reads dark; a missing file reads none', async () => {
  const p = folder({ 'settings.json': JSON.stringify({ theme: 'custom:paper' }) });
  fs.writeFileSync(path.join(p.themes, 'paper.json'), JSON.stringify({ base: 'light-daltonized', overrides: {} }));
  assert.deepEqual(await readClaudeTheme(p), { theme: 'custom:paper', source: 'settings', kind: 'light' });
  fs.writeFileSync(path.join(p.themes, 'paper.json'), JSON.stringify({ base: 'sepia' }));
  assert.equal((await readClaudeTheme(p)).kind, 'dark');
  fs.writeFileSync(path.join(p.themes, 'paper.json'), 'not json');
  assert.equal((await readClaudeTheme(p)).kind, 'dark');
  fs.rmSync(path.join(p.themes, 'paper.json'));
  assert.deepEqual(await readClaudeTheme(p), { theme: 'custom:paper', source: 'settings', kind: 'none' });
});
