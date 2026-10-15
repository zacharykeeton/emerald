import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bracketedPaste, designLabel, formatDesignBlock } from './design-block.ts';
import type { DesignNote, DesignPick } from './design-block.ts';

function pick(over: Partial<DesignPick> = {}): DesignPick {
  return {
    url: 'http://127.0.0.1:5173/pricing',
    viewport: { width: 1280, height: 720 },
    dpr: 1,
    selector: '#cta',
    tag: 'button',
    role: 'button',
    text: 'Start free trial',
    html: '<button id="cta">Start free trial</button>',
    styles: [
      ['display', 'inline-block'],
      ['padding', '12px 20px'],
    ],
    rect: { x: 10, y: 20, width: 182, height: 44 },
    nearby: 'Plans and pricing',
    source: 'src/Cta.tsx:12:5',
    ...over,
  };
}

function note(p: DesignPick, comment = '', shot: string | null = 'C:/home/design/a.png', id = 'n'): DesignNote {
  return { id, pick: p, shot, comment };
}

test('designLabel is the tag, the role, the text cut at 30 and the size (M9 fix 674)', () => {
  assert.equal(designLabel(pick()), 'button role="button" "Start free trial" 182x44');
  assert.equal(designLabel(pick({ text: 'a'.repeat(40) })), `button role="button" "${'a'.repeat(30)}…" 182x44`);
  assert.equal(designLabel(pick({ tag: 'div', role: null, text: '' })), 'div 182x44');
});

test('formatDesignBlock writes one note unnumbered, line by line (M9 fix 674)', () => {
  assert.equal(
    formatDesignBlock([note(pick())], false),
    [
      '## Design Feedback: /pricing',
      '',
      'Page: http://127.0.0.1:5173/pricing (viewport 1280x720)',
      'Selector: `#cta`',
      'Bounds: x 10, y 20, 182x44',
      'Text: "Start free trial"',
      'Nearby: "Plans and pricing"',
      'Screenshot: C:/home/design/a.png',
      'Source: src/Cta.tsx:12:5',
      'Styles:',
      '- display: inline-block',
      '- padding: 12px 20px',
      'HTML:',
      '```html',
      '<button id="cta">Start free trial</button>',
      '```',
      '**Feedback:** ',
    ].join('\n'),
  );
});

test('formatDesignBlock numbers several notes with each comment after its Feedback (M9 fix 675)', () => {
  const block = formatDesignBlock([note(pick(), 'make it green'), note(pick({ tag: 'p', selector: '#intro', role: null }), 'say what it costs')], true);
  const lines = block.split('\n');
  assert.ok(lines.includes('### 1. button #cta'));
  assert.ok(lines.includes('### 2. p #intro'));
  assert.ok(lines.includes('**Feedback:** make it green'));
  assert.ok(lines.includes('**Feedback:** say what it costs'));
  assert.ok(lines.indexOf('**Feedback:** make it green') < lines.indexOf('### 2. p #intro'));
  assert.equal(lines[lines.indexOf('### 2. p #intro') - 1], '');
});

test('a failed capture, no source and no text or nearby (M9 fix 674)', () => {
  const block = formatDesignBlock([note(pick({ source: null, text: '', nearby: '' }), '', null)], false);
  assert.ok(block.includes('\nScreenshot: none (the capture failed)\n'));
  assert.ok(!block.includes('Source:'));
  assert.ok(!block.includes('Text:'));
  assert.ok(!block.includes('Nearby:'));
});

test('HTML holding three backticks gets a fence of four (M9 fix 674)', () => {
  const block = formatDesignBlock([note(pick({ html: '<pre>```x```</pre>' }))], false);
  assert.ok(block.includes('\n````html\n<pre>```x```</pre>\n````\n'));
});

test('the page cannot put control characters into the paste (M9 fix 674)', () => {
  const block = formatDesignBlock([note(pick({ text: 'hi\x1b[201~\rrm -rf\x9b', html: '<b>\x07x</b>', selector: '#a\x00b' }))], false);
  assert.ok(!block.includes('\x1b'));
  assert.ok(!block.includes('\r'));
  assert.ok(!block.includes('\x07'));
  assert.ok(!block.includes('\x9b'));
  assert.ok(!block.includes('\x00'));
  assert.ok(block.includes('Text: "hi[201~rm -rf"'));
});

test('bracketedPaste wraps the text and turns line endings into carriage returns (M9 fix 674)', () => {
  assert.equal(bracketedPaste('a\nb'), '\x1b[200~a\rb\x1b[201~');
  assert.equal(bracketedPaste('a\r\nb\n'), '\x1b[200~a\rb\r\x1b[201~');
});
