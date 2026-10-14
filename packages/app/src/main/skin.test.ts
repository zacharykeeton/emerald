import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySkin, CHROME, currentSkin, defaultSkin, initSkin, parseSkin, readSkinFile } from './skin.ts';
import type { SkinWindow } from './skin.ts';

// Main's half of the skin (M9 fix 569): the file it keeps, the chrome it
// paints and the line it logs, which verify:skin reads.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-skin-test-'));
// The harness pins Classic through EMERALD_SKIN (M9 fix 628); a value from
// the shell that runs the suite must not reach the defaults read here.
delete process.env['EMERALD_SKIN'];
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function fakeWindow(destroyed = false): SkinWindow & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    setBackgroundColor: (c) => calls.push(`setBackgroundColor ${c}`),
    setTitleBarOverlay: (o) => calls.push(`setTitleBarOverlay ${JSON.stringify(o)}`),
  };
}

test('defaultSkin: Emerald, unless EMERALD_SKIN says classic (M9 fix 628)', () => {
  assert.equal(defaultSkin({}), 'emerald');
  assert.equal(defaultSkin({ EMERALD_SKIN: 'classic' }), 'classic');
  assert.equal(defaultSkin({ EMERALD_SKIN: 'emerald' }), 'emerald');
  assert.equal(defaultSkin({ EMERALD_SKIN: 'pink' }), 'emerald');
});

test('parseSkin: each skin by its exact name, the default (Emerald) otherwise', () => {
  assert.equal(parseSkin('emerald'), 'emerald');
  assert.equal(parseSkin('classic'), 'classic');
  for (const raw of [null, 3, 'EMERALD', undefined]) assert.equal(parseSkin(raw), 'emerald');
});

test('readSkinFile: a missing file, the Emerald file and bad JSON', () => {
  assert.equal(readSkinFile(path.join(dir, 'none.json')), 'emerald');
  const good = path.join(dir, 'good.json');
  fs.writeFileSync(good, '{"skin":"emerald"}\n');
  assert.equal(readSkinFile(good), 'emerald');
  const classic = path.join(dir, 'classic.json');
  fs.writeFileSync(classic, '{"skin":"classic"}\n');
  assert.equal(readSkinFile(classic), 'classic');
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, 'not json');
  assert.equal(readSkinFile(bad), 'emerald');
  // The harness's pin replaces only the fallback.
  process.env['EMERALD_SKIN'] = 'classic';
  try {
    assert.equal(readSkinFile(path.join(dir, 'none.json')), 'classic');
    assert.equal(readSkinFile(good), 'emerald', 'a file that names a skin wins over the pin');
  } finally {
    delete process.env['EMERALD_SKIN'];
  }
});

test('applySkin: keeps the skin in the file, repaints the chrome and logs the line', () => {
  const file = path.join(dir, 'skin.json');
  const lines: string[] = [];
  // A missing file is Emerald now (M9 fix 628), so the run starts from a
  // file naming Classic for the flip to be a change that writes.
  assert.equal(initSkin(path.join(dir, 'missing.json'), () => {}), 'emerald', 'a missing file is the default');
  fs.writeFileSync(file, '{"skin":"classic"}\n');
  assert.equal(initSkin(file, (m) => lines.push(m)), 'classic');
  const win = fakeWindow();
  applySkin(win, 'emerald');
  assert.deepEqual(win.calls, ['setBackgroundColor #1a1f1d', 'setTitleBarOverlay {"color":"#1c211f","symbolColor":"#9a9a9a","height":26}']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { skin: 'emerald' });
  assert.equal(currentSkin(), 'emerald');
  assert.deepEqual(lines, ['skin emerald: ground #1a1f1d, title bar overlay #1c211f, symbols #9a9a9a']);
  // The next start reads it back.
  assert.equal(initSkin(file, () => {}), 'emerald');

  // A destroyed window gets no calls while the state still moves.
  const gone = fakeWindow(true);
  applySkin(gone, 'classic');
  assert.deepEqual(gone.calls, []);
  assert.equal(currentSkin(), 'classic');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { skin: 'classic' });

  // Anything else is the default, Emerald (M9 fix 628).
  const other = fakeWindow();
  applySkin(other, 'pink');
  assert.equal(other.calls[0], 'setBackgroundColor #1a1f1d');
  assert.equal(currentSkin(), 'emerald');
});

test('CHROME equals the --chrome-* tokens of both blocks in style.css', () => {
  const raw = fs.readFileSync(fileURLToPath(new URL('../renderer/src/style.css', import.meta.url)), 'utf8');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const body = (head: string) => {
    const at = css.indexOf(`${head} {`);
    assert.ok(at >= 0, head);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };
  const read = (b: string, name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(b)![1];
  for (const [skin, head] of [['classic', ':root'], ['emerald', ':root[data-skin="emerald"]']] as const) {
    const b = body(head);
    assert.deepEqual({ bg: read(b, '--chrome-bg'), overlay: read(b, '--chrome-overlay'), symbol: read(b, '--chrome-symbol') }, CHROME[skin], skin);
  }
});
