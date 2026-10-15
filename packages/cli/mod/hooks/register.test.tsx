// The mod's own tests (M9 fix 725), run by `claude plugin test` against the
// engine. A .tsx on purpose: node's bare `node --test` in packages/cli (as
// tests.ps1 runs it) loads every *.test.ts under the package, where
// `claude-code/testing` does not resolve, and it does not match .tsx; the
// engine refuses a dynamic import of the kit, so no guard can live inside.
// stage.mjs copies the mod by name, so this never ships.
import type { On } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';

const VARS = { EMERALD_SESSION_ID: 'sess-725', EMERALD_HOOK_PORT: '7419', EMERALD_HOOK_TOKEN: 'tok' };

type Posted = { url: string; headers: Record<string, string>; body: string };

function recordFetches(on: On, fail = false): Posted[] {
  const posted: Posted[] = [];
  on('http.fetch', ($, e) => {
    posted.push({ url: e.url, headers: e.init?.headers ?? {}, body: e.init?.body ?? '' });
    if (fail) throw new Error('connection refused');
    return { value: { status: 204, ok: true, headers: {}, text: '' } };
  });
  // The engine's own Stop, beneath the plugin: an empty result.
  on('classic.Stop', () => ({}));
  return posted;
}

test('a Stop with the three variables set is posted once with the three headers', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on);
  await $.classic.Stop({ stop_hook_active: false });
  expect(posted.length).toBe(1);
  expect(posted[0]!.url).toBe('http://127.0.0.1:7419/hook');
  expect(posted[0]!.headers['X-Emerald-Hook']).toBe('emerald-mod');
  expect(posted[0]!.headers['X-Emerald-Token']).toBe('tok');
  expect(posted[0]!.headers['X-Emerald-Session']).toBe('sess-725');
  expect(JSON.parse(posted[0]!.body).hook_event_name).toBe('Stop');
});

test('with EMERALD_SESSION_ID unset nothing is posted', async ($, on) => {
  mock.env(on, { EMERALD_HOOK_PORT: '7419', EMERALD_HOOK_TOKEN: 'tok' });
  const posted = recordFetches(on);
  await $.classic.Stop({ stop_hook_active: false });
  expect(posted.length).toBe(0);
});

test('a Bash call, which raises PreToolUse, posts nothing', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on);
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }));
  await $.tool.call({ tool: 'Bash', command: 'echo hi' });
  expect(posted.length).toBe(0);
});

test('a fetch that rejects still lets the event through', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on, true);
  await $.classic.Stop({ stop_hook_active: false });
  expect(posted.length).toBe(1);
});
