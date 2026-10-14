import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { listSchemes, windowsTerminalSettingsFiles } from './schemes.ts';

const shippedDir = path.resolve(import.meta.dirname, '..', '..', 'resources', 'schemes');

function tmp(): string {
  return mkTemp('emerald-schemes-');
}

test.after(removeTemps);

test('the shipped folder holds the six, emerald first under Classic and emerald gem first under Emerald, each a whole scheme', async () => {
  const list = await listSchemes({ shippedDir, settingsFiles: [] }, () => {}, 'classic');
  assert.deepEqual(
    list.map((s) => s.name),
    ['emerald', 'emerald gem', 'Dracula', 'One Dark', 'Solarized Dark', 'Tokyo Night'],
  );
  assert.ok(list.every((s) => s.source === 'shipped'));
  // The terminal's own palette as Pane.tsx had it (M38).
  const emerald = list[0];
  assert.equal(emerald?.background, '#1e1e1e');
  assert.equal(emerald?.cursor, '#e8a33d');
  assert.equal(emerald?.selection, '#4a90d9');
  assert.equal(emerald?.brightYellow, '#c4a36f');
  const flipped = await listSchemes({ shippedDir, settingsFiles: [] }, () => {}, 'emerald');
  assert.deepEqual(
    flipped.map((s) => s.name),
    ['emerald gem', 'emerald', 'Dracula', 'One Dark', 'Solarized Dark', 'Tokyo Night'],
  );
  const gem = flipped[0];
  assert.equal(gem?.background, '#1a1f1d');
  assert.equal(gem?.cursor, '#3ecf8e');
  assert.equal(gem?.green, '#3ecf8e');
  assert.equal(gem?.yellow, '#e8b949');
  assert.equal(gem?.magenta, '#c586c0');
  assert.equal(gem?.brightBlack, '#6b7571');
  assert.equal(gem?.brightWhite, '#ffffff');
});

test('the person’s settings.json adds theirs after the shipped ones; a missing file is no error', async () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      colorSchemes: [
        {
          name: 'Verify Teal',
          background: '#001F1F',
          foreground: '#C0FFEE',
          cursorColor: '#FFFFFF',
          selectionBackground: '#4A90D9',
          black: '#000000',
          red: '#AA0000',
          green: '#00AA00',
          yellow: '#AAAA00',
          blue: '#0000AA',
          purple: '#AA00AA',
          cyan: '#00AAAA',
          white: '#AAAAAA',
          brightBlack: '#555555',
          brightRed: '#FF5555',
          brightGreen: '#55FF55',
          brightYellow: '#FFFF55',
          brightBlue: '#5555FF',
          brightPurple: '#FF55FF',
          brightCyan: '#55FFFF',
          brightWhite: '#FFFFFF',
        },
      ],
    }),
  );
  const logs: string[] = [];
  const list = await listSchemes({ shippedDir, settingsFiles: [path.join(dir, 'missing.json'), file] }, (m) => logs.push(m), 'classic');
  assert.equal(list.length, 7);
  assert.equal(list[6]?.name, 'Verify Teal');
  assert.equal(list[6]?.source, 'windows-terminal');
  assert.equal(logs.join(' | '), '');
  assert.equal((await listSchemes({ shippedDir, settingsFiles: [path.join(dir, 'missing.json')] }, (m) => logs.push(m), 'classic')).length, 6);
  assert.equal(logs.join(' | '), '');
});

test('the settings files: the named one alone when the environment names it, else the Store, Preview and unpackaged places', async () => {
  assert.deepEqual(await windowsTerminalSettingsFiles('C:\\x', { EMERALD_WT_SETTINGS: 'D:\\wt.json' }), ['D:\\wt.json']);
  const local = tmp();
  fs.mkdirSync(path.join(local, 'Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState'), { recursive: true });
  fs.mkdirSync(path.join(local, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState'), { recursive: true });
  fs.mkdirSync(path.join(local, 'Packages', 'Microsoft.Other_1'), { recursive: true });
  assert.deepEqual(await windowsTerminalSettingsFiles(local, {}), [
    path.join(local, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(local, 'Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(local, 'Microsoft', 'Windows Terminal', 'settings.json'),
  ]);
  assert.deepEqual(await windowsTerminalSettingsFiles(undefined, {}), []);
});
