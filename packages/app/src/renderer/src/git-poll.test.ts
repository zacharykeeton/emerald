import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGitPoll } from './git-poll.ts';
import type { GitPollEnv } from './git-poll.ts';
import { changesStamp } from './git-changes-hook.ts';
import type { GitChanges } from '../../preload/api.ts';

// The poll's stamp (M9 fix 354): a reply that reads the same as the
// last one handed on is dropped, so the value keeps its identity
// between polls; a changed one notifies. The environment is a fake
// window.emerald.files.onChanged whose callback the test fires, and the
// change's 300 ms debounce is what the test waits out.

interface Read {
  head: string;
  n: number;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const debounce = () => new Promise<void>((r) => setTimeout(r, 400));

function fakeEnv(): GitPollEnv & { change: () => void } {
  let fn: (() => void) | null = null;
  return {
    onChanged: (f) => {
      fn = f;
      return () => {
        fn = null;
      };
    },
    visible: () => true,
    change: () => fn?.(),
  };
}

test('a fetcher that answers the same stamp twice notifies once; a changed stamp notifies', async () => {
  const env = fakeEnv();
  const replies: Read[] = [
    { head: 'abc', n: 1 },
    { head: 'abc', n: 2 },
    { head: 'def', n: 3 },
  ];
  let fetches = 0;
  const seen: Read[] = [];
  const stop = startGitPoll('C:\\repo', async () => replies[Math.min(fetches++, replies.length - 1)]!, 'git test', (r) => r.head, (r) => seen.push(r), env);
  await tick();
  assert.equal(fetches, 1);
  assert.deepEqual(seen, [{ head: 'abc', n: 1 }], 'the first reply always goes through');
  env.change();
  await debounce();
  assert.equal(fetches, 2, 'a change fetched again');
  assert.equal(seen.length, 1, 'the same stamp did not notify');
  env.change();
  await debounce();
  assert.equal(fetches, 3);
  assert.deepEqual(seen.map((r) => r.n), [1, 3], 'the changed stamp notified');
  stop();
});

test('without a stamp every reply notifies, as before', async () => {
  const env = fakeEnv();
  const seen: Read[] = [];
  const stop = startGitPoll('C:\\repo', async () => ({ head: 'abc', n: 0 }), 'git test', null, (r) => seen.push(r), env);
  await tick();
  env.change();
  await debounce();
  assert.equal(seen.length, 2);
  stop();
});

test('a reply after the stop is dropped', async () => {
  const env = fakeEnv();
  const seen: Read[] = [];
  let release: (() => void) | null = null;
  const stop = startGitPoll(
    'C:\\repo',
    () =>
      new Promise<Read>((resolve) => {
        release = () => resolve({ head: 'abc', n: 0 });
      }),
    'git test',
    (r) => r.head,
    (r) => seen.push(r),
    env,
  );
  stop();
  release!();
  await tick();
  assert.equal(seen.length, 0);
});

test('changesStamp tells two replies apart when only a status code differs (fix 492)', () => {
  const reply = (code: string): GitChanges => ({ root: 'C:\\repo', files: [{ path: 'a.txt', rel: 'a.txt', code, status: 'modified', added: 1, removed: 1 }] });
  assert.notEqual(changesStamp(reply(' M')), changesStamp(reply('M ')));
  assert.equal(changesStamp(reply(' M')), changesStamp(reply(' M')));
});
