import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import type { HooksStatus } from '../preload/api.ts';
import { HOOKS_WATCH_DEBOUNCE_MS, HooksWatch, ownSha256, parseHooksStatus } from './hooks-watch.ts';
import type { HooksReply } from './hooks-watch.ts';

// M9 fix 606: the settings watcher behind the hooks banner.

test.after(() => removeTemps());

// Under the long name, as history.test.ts does: a short-named temp folder
// is what watchFolder resolves first.
function folder(): string {
  return fs.realpathSync.native(mkTemp('emerald-hooks-watch-'));
}

function status(over: Partial<HooksStatus>): HooksStatus {
  return { complete: false, installed: [], missing: [], scriptPresent: true, scriptStale: false, statusLine: true, skill: true, settings: '', fighting: false, ...over };
}

const sha = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

// A watch on <dir>/settings.json whose check counts its calls and answers
// with the reply given; the record sits in a folder of its own.
function harness(opts: { complete: boolean; record?: string }) {
  const dir = folder();
  const settings = path.join(dir, 'settings.json');
  const written = path.join(folder(), 'settings-written.json');
  if (opts.record !== undefined) fs.writeFileSync(written, JSON.stringify({ [path.resolve(settings).toLowerCase()]: { sha256: sha(opts.record), writes: [] } }));
  const reply: HooksReply = { status: status({ complete: opts.complete, settings }), written };
  let checks = 0;
  const pushed: HooksStatus[] = [];
  const logs: string[] = [];
  const watch = new HooksWatch(
    async () => {
      checks++;
      return reply;
    },
    (s) => pushed.push(s),
    (m) => logs.push(m),
  );
  return { dir, settings, written, reply, watch, pushed, logs, checks: () => checks };
}

// Past the debounce, with room for fs.watch's own delay.
const SETTLE_MS = HOOKS_WATCH_DEBOUNCE_MS + 700;

test('parseHooksStatus carries fighting and the record path', () => {
  const r = parseHooksStatus({ complete: false, installed: ['Stop'], missing: [], fighting: true, written: 'C:\\h\\settings-written.json', settings: 'C:\\s.json' });
  assert.equal(r.status.fighting, true);
  assert.equal(r.written, 'C:\\h\\settings-written.json');
  assert.equal(parseHooksStatus({}).status.fighting, false);
});

test('ownSha256 reads the record by a key of other case, and is null with no record', () => {
  const dir = folder();
  const settings = path.join(dir, 'Settings.json');
  const record = path.join(dir, 'settings-written.json');
  fs.writeFileSync(record, JSON.stringify({ [path.resolve(settings).toLowerCase()]: { sha256: 'abc', writes: [] } }));
  assert.equal(ownSha256(record, settings.toUpperCase()), 'abc');
  assert.equal(ownSha256(path.join(dir, 'none.json'), settings), null);
});

test('two writes close together are one check, pushed after the debounce', async () => {
  const h = harness({ complete: false });
  fs.writeFileSync(h.settings, '{}');
  h.watch.follow(h.reply);
  try {
    fs.writeFileSync(h.settings, '{"a":1}');
    await sleep(50);
    fs.writeFileSync(h.settings, '{"a":2}');
    await sleep(SETTLE_MS);
    assert.equal(h.checks(), 1);
    assert.equal(h.pushed.length, 1);
    assert.ok(h.logs.some((l) => l.startsWith('hooks watch on ')), h.logs.join(' | '));
    assert.ok(h.logs.some((l) => l === 'settings change: hooks incomplete'), h.logs.join(' | '));
  } finally {
    h.watch.close();
  }
});

test('a write to a sibling file is no check', async () => {
  const h = harness({ complete: false });
  fs.writeFileSync(h.settings, '{}');
  h.watch.follow(h.reply);
  try {
    fs.writeFileSync(`${h.settings}.emerald-tmp`, '{}');
    fs.writeFileSync(path.join(h.dir, 'other.json'), '{}');
    await sleep(SETTLE_MS);
    assert.equal(h.checks(), 0);
  } finally {
    h.watch.close();
  }
});

test("emerald's own bytes are no check while complete, and one while incomplete", async () => {
  const ours = '{"ours":true}\n';
  const complete = harness({ complete: true, record: ours });
  fs.writeFileSync(complete.settings, '{}');
  complete.watch.follow(complete.reply);
  try {
    fs.writeFileSync(complete.settings, ours);
    await sleep(SETTLE_MS);
    assert.equal(complete.checks(), 0, 'our own write to a complete install');
  } finally {
    complete.watch.close();
  }
  const incomplete = harness({ complete: false, record: ours });
  fs.writeFileSync(incomplete.settings, '{}');
  incomplete.watch.follow(incomplete.reply);
  try {
    fs.writeFileSync(incomplete.settings, ours);
    await sleep(SETTLE_MS);
    assert.equal(incomplete.checks(), 1, 'the same bytes put back while incomplete');
  } finally {
    incomplete.watch.close();
  }
});

test('a settings file created after follow is seen', async () => {
  const h = harness({ complete: false });
  h.watch.follow(h.reply);
  try {
    fs.writeFileSync(h.settings, '{}');
    await sleep(SETTLE_MS);
    assert.equal(h.checks(), 1);
  } finally {
    h.watch.close();
  }
});

test('a follow on a file in a missing folder throws nothing and says so', () => {
  const h = harness({ complete: false });
  const missing = path.join(h.dir, 'gone', 'settings.json');
  h.watch.follow({ status: status({ settings: missing }), written: h.written });
  assert.ok(h.logs.some((l) => l.startsWith('hooks watch not started on ')), h.logs.join(' | '));
  h.watch.close();
});
