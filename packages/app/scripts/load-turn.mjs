// The load one Claude Code turn puts on a pane, without Claude (M9 fix
// 226). A loaded shell in the typing-lag bench runs this: it lays a
// 40-line screen down once, then does what Ink does while a turn runs,
// a spinner line redrawn every 50 ms with cursor moves and colour
// sequences, a line of the answer landing once a second, and a whole
// screen repainted every ten seconds when a tool result lands. Ink
// redraws the lines that changed, not the screen, so a real turn is far
// lighter than a full repaint: read off a real turn's ring through
// `emmer read --raw --cursor` at 250 ms (Claude Code 2.1.273, a Bash
// call and a forty-line streamed answer, 80 columns), the PTY wrote
// 29,999 bytes over 15.25 busy seconds, 2 KB/s on average with one
// 3,412-byte window at the tool result. The constants below reproduce
// that shape and rate; LOAD_TURN_RATE multiplies the bytes per tick for
// a heavier round (8 is a shell cat-ing a file). Runs until killed, or
// for --seconds N.
import process from 'node:process';

// What the probe measured, kept beside the constants it sized.
export const REAL_BYTES_PER_SECOND = 2000;
export const REAL_PEAK_BYTES_PER_250MS = 3412;

const TICK_MS = 50;
const LINE_MS = 1000;
const SCREEN_MS = 10000;
const ROWS = 40;
const rate = Math.max(1, Number(process.env['LOAD_TURN_RATE']) || 1);
const seconds = (() => {
  const i = process.argv.indexOf('--seconds');
  return i === -1 ? null : Number(process.argv[i + 1]);
})();

const ESC = '\x1b';
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const WORDS = 'the daemon reads the transcript head at each turn boundary and credits the commits the session landed through its bash calls'.split(' ');
const out = (s) => process.stdout.write(s);

// A line of the conversation, coloured the way Claude Code colours its
// output: a dim gutter glyph, a run of plain text, one highlighted word.
const line = (i) => {
  const words = [];
  for (let k = 0; k < 12; k++) words.push(WORDS[(i + k) % WORDS.length]);
  return `${ESC}[2m⏺${ESC}[22m ${words.slice(0, 5).join(' ')} ${ESC}[36m${words[5]}${ESC}[39m ${words.slice(6).join(' ')}`;
};

// Padding for a heavier rate: extra colour runs on the spinner line, the
// kind of bytes a wider status line costs, never a longer visible line.
const pad = (n) => (n <= 0 ? '' : `${ESC}[2m${ESC}[22m`.repeat(Math.ceil(n / 8)));

const t0 = Date.now();
let tick = 0;
// The screen: clear, home, the conversation so far, the spinner row last.
const screen = () => {
  out(`${ESC}[2J${ESC}[H`);
  for (let i = 0; i < ROWS - 1; i++) out(`${line(i + tick)}${ESC}[K\r\n`);
};
const spinner = () => {
  const s = Math.floor((Date.now() - t0) / 1000);
  const glyph = SPINNER[tick % SPINNER.length];
  const base = `${ESC}[?25l${ESC}[${ROWS};1H${ESC}[38;5;208m${glyph}${ESC}[39m Thinking… ${ESC}[2m(${s}s · ↓ ${(s * 0.4).toFixed(1)}k tokens · esc to interrupt)${ESC}[22m${ESC}[K`;
  // A tick is about 90 bytes at rate 1; the padding adds (rate - 1) more.
  return base + pad((rate - 1) * 90);
};
const streamed = () => {
  // One line of the answer lands above the spinner: scroll the region up.
  return `${ESC}[${ROWS - 1};1H${ESC}[K${line(tick)}${ESC}[K\r\n${ESC}[K`;
};

screen();
const timer = setInterval(() => {
  tick += 1;
  const elapsed = tick * TICK_MS;
  if (elapsed % SCREEN_MS === 0) screen();
  else if (elapsed % LINE_MS === 0) out(streamed());
  out(spinner());
  if (seconds !== null && elapsed >= seconds * 1000) {
    clearInterval(timer);
    out(`${ESC}[?25h\r\n`);
  }
}, TICK_MS);
