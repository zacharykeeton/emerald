import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyThemePick, attachNativeTheme, currentTheme, defaultThemePick, fileNativeTheme, initTheme, readThemeFile, themeUpdated } from './theme.ts';
import type { NativeThemeLike, ThemePick } from './theme.ts';

// Main's half of the theme (M9 fix 1032): the pick it keeps in theme.json,
// what that resolves to, and the harness's stand-in for Windows' answer.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-theme-test-'));
// The harness pins dark through EMERALD_THEME; a value from the shell that
// runs the suite must not reach the defaults read here.
delete process.env['EMERALD_THEME'];
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Electron's nativeTheme as the probe of fix 1032 measured it at 44.3.0: a
// forced source decides the flag, system reads the OS's own answer.
function fakeNative(osDark: boolean): NativeThemeLike & { osDark: boolean; fire(): void } {
  const listeners: Array<() => void> = [];
  return {
    osDark,
    themeSource: 'system' as ThemePick,
    get shouldUseDarkColors() {
      if (this.themeSource === 'light') return false;
      if (this.themeSource === 'dark') return true;
      return this.osDark;
    },
    on(_event: 'updated', listener: () => void) {
      listeners.push(listener);
      return this;
    },
    fire() {
      for (const l of listeners) l();
    },
  };
}

test('defaultThemePick: Follow Windows, unless EMERALD_THEME names light or dark (M9 fix 1032)', () => {
  assert.equal(defaultThemePick({}), 'system');
  assert.equal(defaultThemePick({ EMERALD_THEME: 'dark' }), 'dark');
  assert.equal(defaultThemePick({ EMERALD_THEME: 'light' }), 'light');
  assert.equal(defaultThemePick({ EMERALD_THEME: 'pink' }), 'system');
});

test('readThemeFile: a missing file, a light file, bad JSON, and the pin replacing only the fallback (M9 fix 1032)', () => {
  assert.equal(readThemeFile(path.join(dir, 'none.json')), 'system');
  const light = path.join(dir, 'light.json');
  fs.writeFileSync(light, '{"pick":"light"}\n');
  assert.equal(readThemeFile(light), 'light');
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, 'not json');
  assert.equal(readThemeFile(bad), 'system');
  const system = path.join(dir, 'system.json');
  fs.writeFileSync(system, '{"pick":"system"}\n');
  process.env['EMERALD_THEME'] = 'dark';
  try {
    assert.equal(readThemeFile(path.join(dir, 'none.json')), 'dark');
    assert.equal(readThemeFile(system), 'system', 'a file that names a pick wins over the pin');
  } finally {
    delete process.env['EMERALD_THEME'];
  }
});

test('attachNativeTheme, applyThemePick and themeUpdated resolve the pick against the OS (M9 fix 1032)', () => {
  const file = path.join(dir, 'theme.json');
  const lines: string[] = [];
  assert.deepEqual(initTheme(file, (m) => lines.push(m)), { pick: 'system', theme: 'dark' }, 'dark until a native theme is attached');
  const n = fakeNative(false);
  n.themeSource = 'dark';
  assert.deepEqual(attachNativeTheme(n), { pick: 'system', theme: 'light' });
  assert.equal(n.themeSource, 'system', 'attach sets themeSource to the pick');

  // A pick writes theme.json once and resolves whatever the OS says.
  n.osDark = true;
  assert.deepEqual(applyThemePick('light'), { pick: 'light', theme: 'light' });
  assert.equal(n.themeSource, 'light');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { pick: 'light' });
  fs.writeFileSync(file, 'sentinel');
  applyThemePick('light');
  assert.equal(fs.readFileSync(file, 'utf8'), 'sentinel', 'the same pick again writes nothing');

  // Under a forced pick a flip of the OS moves nothing.
  n.osDark = false;
  assert.equal(themeUpdated(), null);
  n.osDark = true;
  assert.equal(themeUpdated(), null);

  // Follow Windows resolves by the OS's flag, and a flip is reported once.
  assert.deepEqual(applyThemePick('system'), { pick: 'system', theme: 'dark' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { pick: 'system' });
  n.osDark = false;
  assert.deepEqual(themeUpdated(), { pick: 'system', theme: 'light' });
  assert.equal(themeUpdated(), null, 'the second event with nothing moved is nothing');
  assert.deepEqual(currentTheme(), { pick: 'system', theme: 'light' });

  // Anything else is the default pick.
  assert.deepEqual(applyThemePick('pink'), { pick: 'system', theme: 'light' });
  assert.deepEqual(lines, []);

  // The next start reads the file back.
  applyThemePick('dark');
  assert.deepEqual(initTheme(file, () => {}), { pick: 'dark', theme: 'dark' });
  assert.equal(n.themeSource, 'dark');
  // Back to a missing file for the tests after this one.
  initTheme(path.join(dir, 'gone.json'), () => {});
});

test('fileNativeTheme: the harness stub reads a text file for the OS and calls its listeners on a write (M9 fix 1032)', async () => {
  const file = path.join(dir, 'system-theme.txt');
  const stub = fileNativeTheme(file, 50);
  try {
    assert.equal(stub.shouldUseDarkColors, true, 'a missing file is dark');
    fs.writeFileSync(file, 'light\n');
    assert.equal(stub.shouldUseDarkColors, false, 'light after a trim is light');
    stub.themeSource = 'dark';
    assert.equal(stub.shouldUseDarkColors, true, 'a forced source decides, as Electron does');
    stub.themeSource = 'system';
    let calls = 0;
    stub.on('updated', () => {
      calls += 1;
    });
    // fs.watchFile compares mtimes, so the write must land past the last one.
    await new Promise((r) => setTimeout(r, 120));
    fs.writeFileSync(file, 'dark');
    const deadline = Date.now() + 3000;
    while (calls === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.ok(calls > 0, 'a write calls the listener within 3 s');
    assert.equal(stub.shouldUseDarkColors, true);
  } finally {
    stub.close();
  }
});
