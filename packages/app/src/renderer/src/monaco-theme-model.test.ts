import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schemeTheme, schemeThemeName } from './monaco-theme-model.ts';
import { schemeFromWindowsTerminal } from './scheme-model.ts';
import type { TerminalScheme } from './scheme-model.ts';

const dark: TerminalScheme = {
  name: 'emerald',
  source: 'shipped',
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#e8a33d',
  selection: '#4a90d9',
  black: '#1e1e1e',
  red: '#e06c75',
  green: '#6ac47e',
  yellow: '#e8a33d',
  blue: '#4a90d9',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#d4d4d4',
  brightBlack: '#6f6f6f',
  brightRed: '#e06c75',
  brightGreen: '#6ac47e',
  brightYellow: '#c4a36f',
  brightBlue: '#6f8fa8',
  brightMagenta: '#c586c0',
  brightCyan: '#4ec9b0',
  brightWhite: '#ffffff',
};

const light: TerminalScheme = { ...dark, name: 'Verify Light', source: 'windows-terminal', background: '#ffffff', foreground: '#101010' };

test('schemeThemeName is one legal Monaco id per scheme name, spaces included (a shipped scheme can have one)', () => {
  const emeraldName = schemeThemeName(dark);
  const lightName = schemeThemeName(light);
  assert.match(emeraldName, /^[a-z0-9-]+$/i);
  assert.match(lightName, /^[a-z0-9-]+$/i);
  assert.notEqual(emeraldName, lightName);
  // Deterministic: the same name always encodes the same.
  assert.equal(schemeThemeName(dark), emeraldName);
  assert.equal(schemeThemeName({ name: 'Verify Light' }), lightName);
});

test('the base follows the ground: under half brightness is vs-dark, at or past half is vs', () => {
  assert.equal(schemeTheme(dark).data.base, 'vs-dark');
  assert.equal(schemeTheme(light).data.base, 'vs');
});

test('the rule per token: comment bright black, string green, number magenta, keyword blue, type and type.identifier cyan, delimiter/variable/identifier the foreground', () => {
  const { rules } = schemeTheme(dark).data;
  const of = (token: string) => rules.find((r) => r.token === token)?.foreground;
  assert.equal(of('comment'), '6f6f6f');
  assert.equal(of('string'), '6ac47e');
  assert.equal(of('number'), 'c586c0');
  assert.equal(of('keyword'), '4a90d9');
  assert.equal(of('type'), '4ec9b0');
  assert.equal(of('type.identifier'), '4ec9b0');
  for (const token of ['delimiter', 'variable', 'identifier']) assert.equal(of(token), 'd4d4d4', token);
});

test("JSON's own tokens: string.key.json blue, string.value.json green, keyword.json magenta", () => {
  const { rules } = schemeTheme(dark).data;
  const of = (token: string) => rules.find((r) => r.token === token)?.foreground;
  assert.equal(of('string.key.json'), '4a90d9');
  assert.equal(of('string.value.json'), '6ac47e');
  assert.equal(of('keyword.json'), 'c586c0');
});

test("the theme's colors carry the scheme's own background and foreground, with the #", () => {
  const { colors } = schemeTheme(dark).data;
  assert.equal(colors['editor.background'], '#1e1e1e');
  assert.equal(colors['editor.foreground'], '#d4d4d4');
});

test('the shipped emerald gem derives its editor rules from its own colours', () => {
  const json = JSON.parse(readFileSync(new URL('../../../resources/schemes/emerald-gem.json', import.meta.url), 'utf8')) as unknown;
  const gem = schemeFromWindowsTerminal(json, 'shipped');
  assert.ok(gem !== null);
  const { base, rules, colors } = schemeTheme(gem).data;
  const of = (token: string) => rules.find((r) => r.token === token)?.foreground;
  assert.equal(base, 'vs-dark');
  assert.equal(of('comment'), '6b7571');
  assert.equal(of('string'), '3ecf8e');
  assert.equal(of('number'), 'c586c0');
  assert.equal(of('keyword'), '4a90d9');
  assert.equal(of('type'), '62c3cf');
  assert.equal(of('type.identifier'), '62c3cf');
  assert.equal(of('delimiter'), 'd4d4d4');
  assert.equal(of('string.value.json'), '3ecf8e');
  assert.equal(colors['editor.background'], '#1a1f1d');
});
