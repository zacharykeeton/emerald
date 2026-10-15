import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawMermaid, renderThemed } from './mermaid-draw.ts';
import type { MermaidLike } from './mermaid-draw.ts';

// A fake mermaid whose render waits on a deferred and then records the
// theme the last initialize set, the way the real one reads its config
// when it gets to draw.
function fakeMermaid() {
  let theme = '';
  const drawn: string[] = [];
  const gates: Array<() => void> = [];
  const m = {
    initialize: (cfg: { theme?: string }) => {
      theme = cfg.theme ?? '';
    },
    render: async () => {
      await new Promise<void>((resolve) => gates.push(resolve));
      drawn.push(theme);
      return { svg: `<svg>${theme}</svg>`, diagramType: 'flowchart', bindFunctions: undefined };
    },
  } as unknown as MermaidLike;
  return { m, drawn, gates };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('renderThemed: two passes on two themes each draw on their own (M9 fix 687)', async () => {
  const { m, drawn, gates } = fakeMermaid();
  const first = renderThemed(m, 'dark', 'a', 'graph A');
  const second = renderThemed(m, 'default', 'b', 'graph B');
  // The second pass's initialize must not run while the first draws.
  await tick();
  assert.equal(gates.length, 1);
  gates[0]!();
  await first;
  await tick();
  assert.equal(gates.length, 2);
  gates[1]!();
  await second;
  assert.deepEqual(drawn, ['dark', 'default']);
});

test('renderThemed: a failed render does not stop the next one (M9 fix 687)', async () => {
  const m = {
    initialize: () => undefined,
    render: async (_id: string, source: string) => {
      if (source === 'bad') throw new Error('parse');
      return { svg: '<svg/>', diagramType: 'flowchart', bindFunctions: undefined };
    },
  } as unknown as MermaidLike;
  const bad = renderThemed(m, 'dark', 'x', 'bad');
  const good = renderThemed(m, 'dark', 'y', 'good');
  await assert.rejects(bad);
  assert.deepEqual(await good, { svg: '<svg/>', diagramType: 'flowchart', bindFunctions: undefined });
});

test('drawMermaid: a pass whose view re-rendered stops after the box in hand (M9 fix 687)', async () => {
  let renders = 0;
  let alive = true;
  const m = {
    initialize: () => undefined,
    render: async () => {
      renders++;
      alive = false;
      return { svg: '<svg/>', diagramType: 'flowchart', bindFunctions: undefined };
    },
  } as unknown as MermaidLike;
  // closest() answers null, so write() returns before touching the DOM.
  const diagram = (source: string) => ({
    parentElement: { querySelector: () => ({ textContent: source }) },
    isConnected: true,
    closest: () => null,
    getAttribute: () => 'pending',
  });
  const article = { querySelectorAll: () => [diagram('graph stops-one'), diagram('graph stops-two')] } as unknown as HTMLElement;
  await drawMermaid(article, 'dark', () => alive, async () => m);
  assert.equal(renders, 1);
});
