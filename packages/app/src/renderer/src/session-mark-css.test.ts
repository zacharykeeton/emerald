import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The session mark's rules (M46, fix 86) read back out of style.css: the
// four frames are switched in place by one opacity keyframe (fix 535; it
// was visibility, and an infinite animation is opacity or transform only) with a
// delay a quarter cycle apart per frame, and nothing on the mark is
// transformed or slid, since a composited move under the cell's clip is
// what one GPU presented once and never redrew (fix 86). A stack that
// slid or drifted would show in no screenshot, so the rules are read.
const css = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8');

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(m, `a rule for ${selector}`);
  return m[1]!;
}

function px(body: string, prop: string): number {
  const m = new RegExp(`(?:^|;|\\s)${prop}:\\s*(-?[\\d.]+)px`).exec(body);
  assert.ok(m, `${prop} in px in ${body.trim()}`);
  return Number(m[1]);
}

for (const size of ['row', 'unit', 'heading', 'title', 'face']) {
  test(`session mark, ${size} size: a square cell, the glyph frames nudged, the star not`, () => {
    const cellRule = block(`.session-mark[data-size="${size}"]`);
    assert.equal(px(cellRule, 'width'), px(cellRule, 'height'), 'a square cell');
    // Cascadia draws the asterisk high in its em box, so the text frames
    // carry a top padding; the still star centres itself and the cell
    // carries no nudge (M9 fix 80).
    const frames = block(`.session-mark[data-size="${size}"] .session-mark-frames > span`);
    assert.ok(px(frames, 'padding-top') >= 2, 'the glyph frames are nudged down');
    assert.ok(px(frames, 'font-size') < px(cellRule, 'height'), 'the glyph is smaller than the cell');
    assert.ok(!/(?:^|;|\s)top:/.test(cellRule), 'no top nudge on the cell');
  });
}

test('the frames switch in place: one keyframe, four delays a quarter apart, no transform', () => {
  const kf = /@keyframes session-mark-frame\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(kf, 'the frame keyframe');
  assert.ok(/0%\s*\{\s*opacity:\s*1/.test(kf![1]!), 'visible at the start');
  assert.ok(/25%\s*\{\s*opacity:\s*0/.test(kf![1]!), 'hidden from a quarter');
  assert.ok(/\.session-mark\[data-working\] \.session-mark-frames > span\s*\{\s*animation:\s*session-mark-frame 1s step-end infinite/.test(css), 'each frame runs the keyframe for one second, stepped');
  for (const [n, delay] of [[2, -750], [3, -500], [4, -250]] as const) {
    const m = new RegExp(`\\.session-mark\\[data-working\\] \\.session-mark-frames > span:nth-child\\(${n}\\)\\s*\\{\\s*animation-delay:\\s*(-?\\d+)ms`).exec(css);
    assert.ok(m, `frame ${n} has a delay`);
    assert.equal(Number(m![1]), delay, `frame ${n} starts ${delay}ms in`);
  }
  // The still star hides only while the frames run, so reduced motion
  // keeps it.
  assert.ok(/\.session-mark\[data-working\] \.session-mark-still\s*\{\s*visibility:\s*hidden/.test(css), 'the still frame gives way while working');
  const markRules = [...css.matchAll(/\.session-mark[^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
  for (const body of markRules) assert.ok(!/transform:/.test(body), `no transform on a mark rule: ${body.trim()}`);
  assert.ok(!/session-mark-step/.test(css), 'the slid stack is gone');
});

test('the shell mark holds one 20px slot on a row in both states', () => {
  assert.equal(px(block('.shell-mark[data-size="row"]'), 'width'), 20);
  // No rule keyed on data-running sets a width: the name column must not
  // shift when a command starts.
  const running = [...css.matchAll(/\.shell-mark\[data-running\][^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
  assert.ok(running.length > 0, 'a data-running rule exists');
  for (const body of running) assert.ok(!/width:/.test(body), `no width under data-running: ${body.trim()}`);
  const idle = [...css.matchAll(/\.shell-mark:not\(\[data-running\]\)[^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
  for (const body of idle) assert.ok(!/width:/.test(body), `no width under the idle rule: ${body.trim()}`);
});

test('a needs-input mark breathes on needs-pulse, never the step', () => {
  const m = /\.session-mark\[data-tone="needs-input"\]\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, 'the needs-input rule');
  assert.ok(/animation:\s*needs-pulse/.test(m![1]!), 'needs-pulse');
  assert.ok(!/session-mark-frame/.test(m![1]!), 'not the frame cycle');
  // The cycle is keyed on data-working alone, which a needs-input session never sets.
  assert.ok(!/\[data-tone="needs-input"\][^{]*session-mark-frame/.test(css));
});

// The Emerald skin's mark (M9 fix 570).
test('every mark cell size sets --mark-cell to its height', () => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let count = 0;
  for (const m of plain.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (!/\.session-mark\[data-size="[a-z]+"\]/.test(m[1]!)) continue;
    if (!/(?:^|;|\s)height:\s*[\d.]+px/.test(m[2]!)) continue;
    count++;
    assert.equal(px(m[2]!, '--mark-cell'), px(m[2]!, 'height'), `--mark-cell in ${m[1]!.trim()}`);
  }
  assert.equal(count, 9);
});

test('the Emerald gem frames: Segoe UI Symbol at 90 percent of the cell, centred, no padding nudge', () => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const gem = block(':root[data-skin="emerald"] .session-mark[data-glyphs="gem"] .session-mark-frames > span');
  assert.match(gem, /font-family:\s*"Segoe UI Symbol"/);
  assert.match(gem, /font-size:\s*calc\(var\(--mark-cell\) \* 0\.9\)/);
  assert.match(gem, /line-height:\s*1;/);
  assert.match(gem, /(?:^|;|\s)padding-top:\s*0;/);
  assert.match(gem, /display:\s*flex/);
  assert.ok(!/transform:/.test(gem));
  assert.ok(/:root\[data-skin="emerald"\] \.session-mark\[data-glyphs="gem"\] \.session-mark-still,/.test(plain));
});

test("the Emerald mark's per-place offset (M9 fixes 593 and 626): a top with an equal and opposite bottom, never a transform", () => {
  // The places that read off their text's whole word when fix 626
  // re-measured them (all three, at 1px), each named by its frames
  // selector, the second of its pair.
  for (const place of ['.pane-mark[data-glyphs="gem"]', '.tab-mark[data-glyphs="gem"]', '.sidebar-row-main > .session-mark[data-glyphs="gem"]']) {
    const body = block(`:root[data-skin="emerald"] ${place} > .session-mark-frames > span`);
    const top = /(?:^|;|\s)top:\s*([^;]+);/.exec(body);
    const bottom = /(?:^|;|\s)bottom:\s*([^;]+);/.exec(body);
    assert.ok(top && bottom, `a top and a bottom for ${place}`);
    // A px value or a calc on the cell; either way the bottom is the top
    // with one minus sign more, before the number.
    const negated = /-(?=[\d.]+(?:px)?\)?$)/;
    assert.ok(negated.test(bottom[1]!.trim()) && !negated.test(top[1]!.trim()), `the top moves down for ${place}`);
    assert.equal(bottom[1]!.trim().replace(negated, ''), top[1]!.trim(), `the bottom is the top negated for ${place}`);
    assert.ok(!/transform|translate|padding-top/.test(body), `no transform, translate or padding-top for ${place}`);
  }
});

test('the other Emerald stills share the face: the history icons, the kind tile and the review note', () => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const still = block(':root[data-skin="emerald"] .gem-still[data-glyphs="gem"]');
  assert.match(still, /font-family:\s*"Segoe UI Symbol"/);
  assert.match(still, /width:\s*var\(--mark-cell\)/);
  assert.match(still, /height:\s*var\(--mark-cell\)/);
  assert.match(still, /font-size:\s*calc\(var\(--mark-cell\) \* 0\.9\)/);
  const m = /\.empty-kind-glyph\[data-glyphs="gem"\],\s*:root\[data-skin="emerald"\] \.review-note-glyph\[data-glyphs="gem"\]\s*\{([^}]*)\}/.exec(plain);
  assert.ok(m, 'the kind tile and review note rule');
  assert.match(m[1]!, /font-family:\s*"Segoe UI Symbol"/);
});

// WCAG relative luminance and contrast, enough for a floor check.
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test("the heading's inactive counts read at 4.5:1 or better on the sidebar", () => {
  const sidebar = /--sidebar-bg:\s*(#[0-9a-f]{6})/.exec(css)![1]!;
  assert.equal(sidebar, '#202020');
  for (const unit of ['agents-inactive', 'shells-idle']) {
    // The rule names a token (M9 fix 569); the first declaration of it is
    // the Classic :root's, since the Emerald block comes after it.
    const name = /color:\s*var\((--[a-z-]+)\)/.exec(block(`.roster-unit[data-unit="${unit}"]`))![1]!;
    const color = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(css)![1]!;
    const ratio = contrast(color, sidebar);
    assert.ok(ratio >= 4.5, `${unit} ${color} on ${sidebar} is ${ratio.toFixed(2)}:1`);
  }
  // The dimming is on the glyph alone, so the count keeps that contrast.
  const dim = /\.roster-unit\[data-unit="agents-inactive"\] \.session-mark,\s*\.roster-unit\[data-unit="shells-idle"\] \.shell-mark\s*\{([^}]*)\}/.exec(css);
  assert.ok(dim && /opacity:\s*0\.7/.test(dim[1]!), 'the glyph at .7');
  assert.ok(!/\.roster-count[^{]*\{[^}]*opacity/.test(css), 'no opacity on a count');
});

test('the frame cycle and the caret run only under prefers-reduced-motion: no-preference', () => {
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: no-preference\)\s*\{/g)].map((m) => {
    // The block's body, brace-matched.
    let depth = 1;
    let i = m.index! + m[0].length;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    return css.slice(m.index! + m[0].length, i);
  });
  const inside = (re: RegExp) => blocks.some((b) => re.test(b));
  assert.ok(inside(/animation:\s*session-mark-frame/), 'the frame cycle is inside the media query');
  assert.ok(inside(/\.session-mark\[data-working\] \.session-mark-still/), 'the still frame hides only inside it');
  assert.ok(inside(/animation:\s*shell-caret/), 'the caret');
  // And nowhere outside it.
  const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}/g, '');
  assert.ok(!/animation:\s*(session-mark-frame|shell-caret)/.test(outside), 'no frame or caret animation outside the media query');
  assert.ok(!/\.session-mark\[data-working\] \.session-mark-still/.test(outside), 'the still frame stays under reduced motion');
});
