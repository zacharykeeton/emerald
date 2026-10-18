import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openFolder } from './folder-open-model.ts';
import type { FolderOpenDeps } from './folder-open-model.ts';

// M9 fix 853: the order a folder from Explorer opens in, every call
// recorded into one list.
function deps(over: { newTab?: { tabId: string; paneId: string } | null; opensOn?: 'terminal' | 'chat'; synced?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const d: FolderOpenDeps = {
    synced: async () => {
      calls.push('synced');
      if (over.synced !== undefined) await over.synced();
    },
    newTab: async () => {
      calls.push('newTab');
      return over.newTab === undefined ? { tabId: 't1', paneId: 'p1' } : over.newTab;
    },
    roomBesideFocused: async () => {
      calls.push('beside');
      return 'p9';
    },
    startClaudeIn: async (paneId, folder, opts) => {
      calls.push(`claude ${paneId} ${folder} ${opts.chat ? 'chat' : 'terminal'}`);
    },
    startShellIn: async (paneId, folder) => {
      calls.push(`shell ${paneId} ${folder}`);
    },
    opensOn: () => over.opensOn ?? 'terminal',
  };
  return { calls, d };
}

test('a shell open waits for the sync, makes a tab and starts the shell in its pane', async () => {
  const { calls, d } = deps();
  await openFolder('C:\\work', 'shell', d);
  assert.deepEqual(calls, ['synced', 'newTab', 'shell p1 C:\\work']);
});

test('a Claude open takes the face the opens-on pick says', async () => {
  const chat = deps({ opensOn: 'chat' });
  await openFolder('C:\\work', 'claude', chat.d);
  assert.deepEqual(chat.calls, ['synced', 'newTab', 'claude p1 C:\\work chat']);
  const term = deps({ opensOn: 'terminal' });
  await openFolder('C:\\work', 'claude', term.d);
  assert.deepEqual(term.calls, ['synced', 'newTab', 'claude p1 C:\\work terminal']);
});

test('with no new tab made the session goes beside the focused pane', async () => {
  const { calls, d } = deps({ newTab: null });
  await openFolder('C:\\work', 'shell', d);
  assert.deepEqual(calls, ['synced', 'newTab', 'beside', 'shell p9 C:\\work']);
});

test('a sync that never lands starts nothing', async () => {
  const { calls, d } = deps({ synced: () => Promise.reject(new Error('the daemon did not come up')) });
  await assert.rejects(openFolder('C:\\work', 'shell', d), /the daemon did not come up/);
  assert.deepEqual(calls, ['synced']);
});
