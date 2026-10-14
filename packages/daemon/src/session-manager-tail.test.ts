import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import type { SessionInfo } from '@emerald/shared';
import { silentLogger } from './log.ts';
import { SessionManager } from './session-manager.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const assistant = (text: string) => JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\n';

test.after(removeTemps);

// M47: the manager tails the transcript a session's hooks name while a
// turn runs, and the latest assistant text lands on liveReply through a
// changed push with no store write; the Stop clears it and stops the tail.
test('a working session gets its transcript tailed into liveReply, and the Stop ends it', async () => {
  const dir = mkTemp('emerald-tail-manager-');
  const transcript = path.join(dir, 'conversation.jsonl');
  fs.writeFileSync(transcript, assistant('Before the turn.'));
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, transcriptPollMs: 20 });
  try {
    const s = manager.spawn({ kind: 'shell', cwd: dir, cols: 80, rows: 24 });
    const live: Array<string | null> = [];
    manager.on('changed', (info: SessionInfo) => {
      if (info.id === s.id && (live.length === 0 || live[live.length - 1] !== info.liveReply)) live.push(info.liveReply);
    });
    const until = (want: string | null, what: string) =>
      Promise.race([
        new Promise<void>((resolve) => {
          const seen = () => manager.get(s.id).info.liveReply === want;
          if (seen()) resolve();
          else manager.on('changed', () => { if (seen()) resolve(); });
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} within 5 s`)), 5000)),
      ]);
    const now = Date.now();
    manager.applyHook(s.id, { hook_event_name: 'SessionStart', session_id: 'c1', source: 'startup', cwd: dir, transcript_path: transcript }, now);
    assert.equal(manager.get(s.id).info.transcriptPath, transcript, 'the path binds from the SessionStart');
    assert.equal(manager.get(s.id).tail ?? null, null, 'no tail at the prompt');
    manager.applyHook(s.id, { hook_event_name: 'UserPromptSubmit', session_id: 'c1', prompt: 'read the log', transcript_path: transcript }, now + 1);
    assert.equal(manager.get(s.id).info.state, 'working');
    assert.ok(manager.get(s.id).tail?.running, 'the tail runs while the turn does');
    await sleep(100);
    assert.equal(manager.get(s.id).info.liveReply, null, 'what was in the file before the turn is not read');
    fs.appendFileSync(transcript, assistant('Reading the log.'));
    await until('Reading the log.', 'no live reply');
    fs.appendFileSync(transcript, assistant('Found the hash.'));
    await until('Found the hash.', 'no second live reply');
    assert.deepEqual(live.filter((t) => t !== null), ['Reading the log.', 'Found the hash.'], 'each text was pushed once');
    // A permission prompt keeps the tail and the text.
    manager.applyHook(s.id, { hook_event_name: 'PermissionRequest', session_id: 'c1', tool_name: 'Bash' }, now + 2);
    assert.equal(manager.get(s.id).info.state, 'needs-input');
    assert.ok(manager.get(s.id).tail?.running, 'the tail runs across a permission prompt');
    assert.equal(manager.get(s.id).info.liveReply, 'Found the hash.');
    // The Stop's reply takes over and the tail stops.
    manager.applyHook(s.id, { hook_event_name: 'Stop', session_id: 'c1', last_assistant_message: 'Found the hash.' }, now + 3);
    assert.equal(manager.get(s.id).info.state, 'done');
    assert.equal(manager.get(s.id).info.liveReply, null, 'the Stop clears the live text');
    assert.equal(manager.get(s.id).info.lastReply, 'Found the hash.');
    assert.equal(manager.get(s.id).tail ?? null, null, 'and the tail is gone');
    fs.appendFileSync(transcript, assistant('Too late.'));
    await sleep(100);
    assert.equal(manager.get(s.id).info.liveReply, null, 'a line after the Stop changes nothing');
    // The next turn starts a tail on the same file from its end.
    manager.applyHook(s.id, { hook_event_name: 'UserPromptSubmit', session_id: 'c1', prompt: 'and the diff' }, now + 4);
    assert.ok(manager.get(s.id).tail?.running);
    await sleep(100);
    assert.equal(manager.get(s.id).info.liveReply, null, 'the previous turn is not re-read');
    fs.appendFileSync(transcript, assistant('Diffing.'));
    await until('Diffing.', 'no live reply on the second turn');
    // Claude leaving the shell drops the path and the tail.
    manager.applyHook(s.id, { hook_event_name: 'SessionEnd', session_id: 'c1' }, now + 5);
    assert.equal(manager.get(s.id).info.transcriptPath, null);
    assert.equal(manager.get(s.id).tail ?? null, null);
  } finally {
    manager.killAll();
    manager.close();
  }
});
