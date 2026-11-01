import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeThemeNote, keepDismissals, parseDismissals } from './claude-theme-model.ts';
import type { ThemePairing } from './claude-theme-model.ts';

// The note on Claude Code's own theme under a Claude pane's title (M9 fix 1035).
const LIGHT = '#ffffff';
const DARK = '#1e1e1e';

test('claudeThemeNote: the three notes and their words', () => {
  assert.deepEqual(claudeThemeNote('dark', LIGHT, []), {
    pairing: 'dark-on-light',
    words: 'Claude Code is drawing in its dark theme on this light scheme. Type /theme in the session and pick Light.',
    dismissTitle: "Hide this note until Claude Code's theme changes",
  });
  assert.deepEqual(claudeThemeNote('light', DARK, []), {
    pairing: 'light-on-dark',
    words: 'Claude Code is drawing in its light theme on this dark scheme. Type /theme in the session and pick Dark.',
    dismissTitle: "Hide this note until Claude Code's theme changes",
  });
  assert.deepEqual(claudeThemeNote('unknown', LIGHT, []), {
    pairing: 'unknown-on-light',
    words: 'Claude Code draws in its own theme, which emerald could not read. If this pane is hard to read on a light scheme, type /theme in the session and pick Light.',
    dismissTitle: 'Hide this note for good',
  });
});

test('claudeThemeNote: nothing when the two agree, for none, for no answer, and for an unknown on a dark ground', () => {
  assert.equal(claudeThemeNote('dark', DARK, []), null);
  assert.equal(claudeThemeNote('light', LIGHT, []), null);
  assert.equal(claudeThemeNote('none', LIGHT, []), null);
  assert.equal(claudeThemeNote('none', DARK, []), null);
  assert.equal(claudeThemeNote(null, LIGHT, []), null);
  assert.equal(claudeThemeNote('unknown', DARK, []), null);
});

test('claudeThemeNote: a dismissed pairing gives nothing, another pairing still shows', () => {
  assert.equal(claudeThemeNote('dark', LIGHT, ['dark-on-light']), null);
  assert.equal(claudeThemeNote('unknown', LIGHT, ['unknown-on-light']), null);
  assert.equal(claudeThemeNote('light', DARK, ['dark-on-light'])?.pairing, 'light-on-dark');
});

test('keepDismissals drops what the read no longer gives, and keeps the same array otherwise', () => {
  const all: readonly ThemePairing[] = ['dark-on-light', 'light-on-dark', 'unknown-on-light'];
  assert.deepEqual(keepDismissals(all, 'light'), ['light-on-dark', 'unknown-on-light']);
  assert.deepEqual(keepDismissals(all, 'dark'), ['dark-on-light', 'unknown-on-light']);
  assert.deepEqual(keepDismissals(all, 'none'), ['unknown-on-light']);
  assert.equal(keepDismissals(all, 'unknown'), all);
  const one: readonly ThemePairing[] = ['unknown-on-light'];
  assert.equal(keepDismissals(one, 'light'), one);
  assert.equal(keepDismissals(one, 'dark'), one);
  assert.equal(keepDismissals(one, 'none'), one);
  const dark: readonly ThemePairing[] = ['dark-on-light'];
  assert.equal(keepDismissals(dark, 'dark'), dark);
});

test('parseDismissals keeps only the three known strings', () => {
  assert.deepEqual(parseDismissals(null), []);
  assert.deepEqual(parseDismissals('not json'), []);
  assert.deepEqual(parseDismissals('{"a":1}'), []);
  assert.deepEqual(parseDismissals('["dark-on-light", 3, "sepia", "unknown-on-light", "dark-on-light"]'), ['dark-on-light', 'unknown-on-light']);
});
