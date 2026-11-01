import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { editSettingsText, managedSettingsDir, overridePlaces, readSkillOverrides, undoSkillOverrides, writeSkillOverrides } from './skill-overrides.ts';
import type { OverridePlaces } from './skill-overrides.ts';

// Every test runs on temp folders: the places are passed in, so nothing
// here reads or writes ~/.claude or a real project's settings.
test.after(removeTemps);

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

function fixture(): { root: string; folder: string; places: OverridePlaces } {
  const root = mkTemp('emerald-skill-overrides-');
  const folder = path.join(root, 'work');
  fs.mkdirSync(folder, { recursive: true });
  return { root, folder, places: { configDir: path.join(root, 'config'), managedDir: path.join(root, 'managed') } };
}

test("readSkillOverrides reads the four scopes in Claude Code's order (fix 1041)", async () => {
  const { folder, places } = fixture();
  write(path.join(places.managedDir, 'managed-settings.json'), JSON.stringify({ skillOverrides: { a: 'off' } }));
  // Written out of name order: the drop-ins merge by name, 10 then 20, so a ends on.
  write(path.join(places.managedDir, 'managed-settings.d', '20-b.json'), JSON.stringify({ skillOverrides: { a: 'on' } }));
  write(path.join(places.managedDir, 'managed-settings.d', '10-a.json'), JSON.stringify({ skillOverrides: { b: 'name-only' } }));
  write(path.join(places.managedDir, 'managed-settings.d', '.hidden.json'), JSON.stringify({ skillOverrides: { a: 'off', h: 'off' } }));
  write(path.join(places.managedDir, 'managed-settings.d', 'notes.txt'), JSON.stringify({ skillOverrides: { n: 'off' } }));
  write(path.join(folder, '.claude', 'settings.local.json'), '{ "skillOverrides": { "l": "user-invocable-only", "c": "maybe", "__proto__": "off" } }');
  write(path.join(folder, '.claude', 'settings.json'), '{ "skillOverrides": { "p": "off", "c": "maybe" } }');
  write(path.join(places.configDir, 'settings.json'), '{ "model": "opus", "skillOverrides": { "u": "name-only", "c": 3 } }');
  const read = await readSkillOverrides(folder, places);
  assert.equal(read.folder, folder);
  assert.deepEqual(read.scopes.map((s) => s.scope), ['managed', 'local', 'project', 'user']);
  assert.deepEqual(read.scopes.map((s) => s.path), [
    path.join(places.managedDir, 'managed-settings.json'),
    path.join(folder, '.claude', 'settings.local.json'),
    path.join(folder, '.claude', 'settings.json'),
    path.join(places.configDir, 'settings.json'),
  ]);
  assert.deepEqual(read.scopes.map((s) => s.values), [{ a: 'on', b: 'name-only' }, { l: 'user-invocable-only' }, { p: 'off' }, { u: 'name-only' }]);
  assert.ok(read.scopes.every((s) => s.error === undefined));
  // The values are plain objects, so the IPC's clone carries them.
  assert.equal(Object.getPrototypeOf(read.scopes[1]!.values), Object.prototype);
});

test('a missing file is an empty scope; a file that does not parse names its path (fix 1041)', async () => {
  const { folder, places } = fixture();
  write(path.join(folder, '.claude', 'settings.local.json'), '{ not json');
  write(path.join(places.configDir, 'settings.json'), '{ "skillOverrides": ["a"] }');
  const read = await readSkillOverrides(folder, places);
  const [managed, local, project, user] = read.scopes;
  assert.deepEqual(managed, { scope: 'managed', path: path.join(places.managedDir, 'managed-settings.json'), values: {} });
  assert.deepEqual(project, { scope: 'project', path: path.join(folder, '.claude', 'settings.json'), values: {} });
  assert.deepEqual(local!.values, {});
  assert.equal(local!.error, `${path.join(folder, '.claude', 'settings.local.json')} does not parse as JSON`);
  assert.deepEqual(user!.values, {});
  assert.equal(user!.error, `${path.join(places.configDir, 'settings.json')} has a skillOverrides that is not an object`);
});

test('editSettingsText keeps every other key, the indent, the line ends and the BOM (fix 1041)', () => {
  const raw = '\uFEFF{\r\n\t"model": "opus",\r\n\t"env": {\r\n\t\t"A": "1"\r\n\t},\r\n\t"skillOverrides": {\r\n\t\t"x": "on"\r\n\t}\r\n}\r\n';
  const edited = editSettingsText(raw, [
    { name: 'x', value: 'off' },
    { name: 'y', value: 'name-only' },
  ]);
  assert.deepEqual(edited, { ok: true, text: '\uFEFF{\r\n\t"model": "opus",\r\n\t"env": {\r\n\t\t"A": "1"\r\n\t},\r\n\t"skillOverrides": {\r\n\t\t"x": "off",\r\n\t\t"y": "name-only"\r\n\t}\r\n}\r\n' });
  const removed = editSettingsText(raw, [
    { name: 'x', value: null },
    { name: 'y', value: null },
  ]);
  assert.deepEqual(removed, { ok: true, text: '\uFEFF{\r\n\t"model": "opus",\r\n\t"env": {\r\n\t\t"A": "1"\r\n\t}\r\n}\r\n' });
  // Four spaces stay four, a missing final newline stays missing, and a new skillOverrides goes at the end.
  const four = editSettingsText('{\n    "model": "opus"\n}', [{ name: 'z', value: 'off' }]);
  assert.deepEqual(four, { ok: true, text: '{\n    "model": "opus",\n    "skillOverrides": {\n        "z": "off"\n    }\n}' });
  assert.deepEqual(editSettingsText(null, [{ name: 'y', value: 'off' }]), { ok: true, text: '{\n  "skillOverrides": {\n    "y": "off"\n  }\n}\n' });
  assert.deepEqual(editSettingsText('  \n', [{ name: 'y', value: 'off' }]), { ok: true, text: '{\n  "skillOverrides": {\n    "y": "off"\n  }\n}\n' });
  // An existing key keeps its place when it changes.
  const kept = editSettingsText('{\n  "skillOverrides": {\n    "a": "on",\n    "b": "on"\n  }\n}\n', [{ name: 'a', value: 'off' }]);
  assert.deepEqual(kept, { ok: true, text: '{\n  "skillOverrides": {\n    "a": "off",\n    "b": "on"\n  }\n}\n' });
  assert.deepEqual(editSettingsText('{ // a comment\n}', [{ name: 'a', value: 'off' }]), { ok: false, error: 'does not parse as JSON' });
  assert.deepEqual(editSettingsText('{ "skillOverrides": 3 }', [{ name: 'a', value: 'off' }]), { ok: false, error: 'has a skillOverrides that is not an object' });
});

test('a file that does not parse is refused and its bytes are left alone (fix 1041)', async () => {
  const { folder, places } = fixture();
  const file = path.join(folder, '.claude', 'settings.local.json');
  write(file, '{ "skillOverrides": { "a": "on" }, // mine\n}');
  const before = fs.readFileSync(file);
  const result = await writeSkillOverrides(folder, 'local', [{ name: 'a', value: 'off' }], places);
  assert.deepEqual(result, { ok: false, error: `${file} does not parse as JSON; emerald does not rewrite it` });
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.existsSync(`${file}.emerald-tmp`), false);
});

test('writeSkillOverrides refuses a scope it does not write and an edit it does not know (fix 1041)', async () => {
  const { folder, places } = fixture();
  await assert.rejects(writeSkillOverrides(folder, 'project' as 'local', [{ name: 'a', value: 'off' }], places), /not a writable scope: project/);
  await assert.rejects(writeSkillOverrides('relative', 'local', [{ name: 'a', value: 'off' }], places), /not an absolute path/);
  for (const edits of [[], [{ name: '', value: 'off' }], [{ name: '__proto__', value: 'off' }], [{ name: 'a', value: 'maybe' }], Array.from({ length: 201 }, (_, i) => ({ name: `s${i}`, value: 'off' }))]) {
    assert.deepEqual(await writeSkillOverrides(folder, 'local', edits as never, places), { ok: false, error: 'not a skillOverrides edit' });
  }
  assert.equal(fs.existsSync(path.join(folder, '.claude')), false);
});

test('write then undo puts the exact bytes back, and Undo never overwrites an edit made since (fix 1041)', async () => {
  const { folder, places } = fixture();
  const user = path.join(places.configDir, 'settings.json');
  const original = '\uFEFF{\r\n    "model": "opus",\r\n    "skillOverrides": {\r\n        "a": "off"\r\n    }\r\n}\r\n';
  write(user, original);
  const w = await writeSkillOverrides(folder, 'user', [{ name: 'a', value: null }, { name: 'b', value: 'off' }], places);
  assert.ok(w.ok);
  assert.equal(w.change.scope, 'user');
  assert.deepEqual(w.change.edits, [{ name: 'a', value: null }, { name: 'b', value: 'off' }]);
  assert.deepEqual(w.change.read.scopes[3]!.values, { b: 'off' });
  assert.equal(fs.readFileSync(user, 'utf8'), '\uFEFF{\r\n    "model": "opus",\r\n    "skillOverrides": {\r\n        "b": "off"\r\n    }\r\n}\r\n');
  const u = await undoSkillOverrides(w.change.id, places);
  assert.ok(u.ok);
  assert.deepEqual(u.read.scopes[3]!.values, { a: 'off' });
  assert.equal(fs.readFileSync(user, 'utf8'), original);
  assert.deepEqual(await undoSkillOverrides(w.change.id, places), { ok: false, error: 'nothing to undo' });

  // A write that made settings.local.json is undone by removing it.
  const local = path.join(folder, '.claude', 'settings.local.json');
  const made = await writeSkillOverrides(folder, 'local', [{ name: 'c', value: 'off' }], places);
  assert.ok(made.ok);
  assert.equal(fs.readFileSync(local, 'utf8'), '{\n  "skillOverrides": {\n    "c": "off"\n  }\n}\n');
  assert.ok((await undoSkillOverrides(made.change.id, places)).ok);
  assert.equal(fs.existsSync(local), false);

  // An edit from outside between the write and the Undo is kept.
  const again = await writeSkillOverrides(folder, 'local', [{ name: 'd', value: 'name-only' }], places);
  assert.ok(again.ok);
  const outside = '{\n  "skillOverrides": {\n    "d": "off"\n  }\n}\n';
  fs.writeFileSync(local, outside);
  assert.deepEqual(await undoSkillOverrides(again.change.id, places), { ok: false, error: `${local} changed since that change; Undo leaves it as it is` });
  assert.equal(fs.readFileSync(local, 'utf8'), outside);

  // Only the last change can be undone: an older id is nothing to undo.
  const first = await writeSkillOverrides(folder, 'user', [{ name: 'e', value: 'off' }], places);
  const second = await writeSkillOverrides(folder, 'user', [{ name: 'f', value: 'off' }], places);
  assert.ok(first.ok && second.ok);
  assert.ok(second.change.id > first.change.id);
  assert.deepEqual(await undoSkillOverrides(first.change.id, places), { ok: false, error: 'nothing to undo' });
});

test('overridePlaces honours CLAUDE_CONFIG_DIR and names the managed folder per platform (fix 1041)', () => {
  const old = process.env['CLAUDE_CONFIG_DIR'];
  const { root } = fixture();
  try {
    process.env['CLAUDE_CONFIG_DIR'] = path.join(root, 'cfg');
    assert.deepEqual(overridePlaces(), { configDir: path.join(root, 'cfg'), managedDir: managedSettingsDir() });
  } finally {
    if (old === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
    else process.env['CLAUDE_CONFIG_DIR'] = old;
  }
  assert.equal(managedSettingsDir('win32'), 'C:\\Program Files\\ClaudeCode');
  assert.equal(managedSettingsDir('darwin'), '/Library/Application Support/ClaudeCode');
  assert.equal(managedSettingsDir('linux'), '/etc/claude-code');
});
