import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { TranscriptTail } from './transcript-tail.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const assistant = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] }, ...extra });
const toolUse = () => JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } });

function tempTranscript(): string {
  return path.join(mkTemp('emerald-tail-'), 'conv.jsonl');
}

test.after(removeTemps);

// The waits count the tail's own ticks rather than a clock (M9 fix 503):
// a fixed 120 ms was a few ticks on a quiet box and none under a batch's
// load, where a positive read then failed.
async function ticksPast(tail: TranscriptTail, n: number): Promise<void> {
  const target = tail.ticks + n;
  const deadline = Date.now() + 5000;
  while (tail.ticks < target) {
    if (Date.now() > deadline) throw new Error(`the tail did not tick ${n} times in 5 s`);
    await sleep(5);
  }
}

async function until(cond: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`condition not met in ${ms} ms`);
    await sleep(5);
  }
}

const seenIs = (seen: string[], want: string[]) => () => JSON.stringify(seen) === JSON.stringify(want);

test('existing content is not reported; a line is reported once its newline lands', async () => {
  const file = tempTranscript();
  fs.writeFileSync(file, assistant('Before the turn.') + '\n');
  const seen: string[] = [];
  const tail = new TranscriptTail(file, (t) => seen.push(t), 20);
  tail.start();
  await ticksPast(tail, 2);
  assert.deepEqual(seen, [], 'nothing from before the turn');
  // Written in two pieces: the first half sits until the newline arrives.
  const line = assistant('Reading the log.');
  fs.appendFileSync(file, line.slice(0, 30));
  await ticksPast(tail, 2);
  assert.deepEqual(seen, [], 'a half line is not a line');
  fs.appendFileSync(file, line.slice(30) + '\n');
  await until(seenIs(seen, ['Reading the log.']), 5000);
  await ticksPast(tail, 2);
  assert.deepEqual(seen, ['Reading the log.'], 'reported once');
  tail.stop();
});

test('a batch reports its last text; a tool_use line and a side chain line report nothing', async () => {
  const file = tempTranscript();
  fs.writeFileSync(file, '');
  const seen: string[] = [];
  const tail = new TranscriptTail(file, (t) => seen.push(t), 20);
  tail.start();
  fs.appendFileSync(file, assistant('First.') + '\n' + toolUse() + '\n' + assistant('Second.') + '\n');
  await until(seenIs(seen, ['Second.']), 5000);
  fs.appendFileSync(file, toolUse() + '\n');
  fs.appendFileSync(file, assistant('From a subagent.', { isSidechain: true }) + '\n');
  await ticksPast(tail, 2);
  assert.deepEqual(seen, ['Second.']);
  tail.stop();
});

test('a file that does not exist yet is picked up when it appears, and nothing after stop', async () => {
  const file = tempTranscript();
  const seen: string[] = [];
  const tail = new TranscriptTail(file, (t) => seen.push(t), 20);
  tail.start();
  await ticksPast(tail, 2);
  fs.writeFileSync(file, assistant('Now it exists.') + '\n');
  await until(seenIs(seen, ['Now it exists.']), 5000);
  tail.stop();
  assert.equal(tail.running, false);
  const ticks = tail.ticks;
  fs.appendFileSync(file, assistant('Too late.') + '\n');
  // Nothing may tick after the stop, so a fixed sleep is the read here.
  await sleep(100);
  assert.deepEqual(seen, ['Now it exists.']);
  assert.equal(tail.ticks, ticks, 'no tick after stop');
});

test('a file that shrank is a new file: what it holds is before the turn, what follows is reported', async () => {
  const file = tempTranscript();
  fs.writeFileSync(file, 'x'.repeat(500) + '\n');
  const seen: string[] = [];
  const tail = new TranscriptTail(file, (t) => seen.push(t), 20);
  tail.start();
  fs.writeFileSync(file, assistant('Fresh file.') + '\n');
  // A tick must see the rewrite on its own: with the append in the same
  // tick the file is still under the old offset and the append is lost.
  await ticksPast(tail, 2);
  assert.deepEqual(seen, [], 'the rewrite is not read');
  fs.appendFileSync(file, assistant('After it.') + '\n');
  await until(seenIs(seen, ['After it.']), 5000);
  tail.stop();
});

test('a character cut at a tick edge is decoded whole (fix 503)', async () => {
  const file = tempTranscript();
  fs.writeFileSync(file, '');
  const seen: string[] = [];
  const tail = new TranscriptTail(file, (t) => seen.push(t), 20);
  tail.start();
  await ticksPast(tail, 1);
  const bytes = Buffer.from(assistant('日本語の返事') + '\n', 'utf8');
  // One byte into the three bytes of 本.
  const cut = bytes.indexOf(Buffer.from('本', 'utf8')) + 1;
  fs.appendFileSync(file, bytes.subarray(0, cut));
  await ticksPast(tail, 2);
  fs.appendFileSync(file, bytes.subarray(cut));
  await until(() => seen.length > 0, 5000);
  assert.deepEqual(seen, ['日本語の返事']);
  assert.ok(!seen[0]!.includes('�'));
  tail.stop();
});

test('a partial line past the cap is dropped and skipped to its end (fix 503)', async () => {
  const file = tempTranscript();
  fs.writeFileSync(file, '');
  const seen: string[] = [];
  const tail = new TranscriptTail(file, (t) => seen.push(t), 20);
  tail.start();
  await ticksPast(tail, 1);
  const long = assistant('z'.repeat(100_000));
  fs.appendFileSync(file, long.slice(0, 80_000));
  await ticksPast(tail, 2);
  // The line's end in a tick of its own, so an uncapped tail would report
  // it rather than have the next line's text win the batch.
  fs.appendFileSync(file, long.slice(80_000) + '\n');
  await ticksPast(tail, 2);
  assert.deepEqual(seen, [], 'the over-long line is never reported');
  fs.appendFileSync(file, assistant('Short.') + '\n');
  await until(() => seen.length > 0, 5000);
  await ticksPast(tail, 2);
  assert.deepEqual(seen, ['Short.']);
  tail.stop();
});
