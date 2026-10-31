import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { platformMark, TITLE_INSET_DARWIN } from './mac-window-model.ts';

// The Mac title row's inset (M9 fix 1023) read back out of style.css: the
// darwin rule starts the row past the traffic lights, and the row's own
// block keeps its Windows padding. Nobody here can see a Mac, so the rule
// is read; the runner's smoke (fix 1028) reads the computed 78px.
const css = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8');

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  assert.ok(m, `a rule for ${selector}`);
  return m[1]!;
}

test('the darwin title row starts past the traffic lights', () => {
  const body = block(':root[data-platform="darwin"] .title-bar');
  assert.match(body, new RegExp(`padding-left:\\s*${TITLE_INSET_DARWIN}px`));
});

test('the title row keeps its own padding everywhere else', () => {
  assert.match(block('.title-bar'), /padding-left:\s*11px/);
});

test('platformMark names darwin alone', () => {
  assert.equal(platformMark('darwin'), 'darwin');
  assert.equal(platformMark('win32'), null);
  assert.equal(platformMark('linux'), null);
});
