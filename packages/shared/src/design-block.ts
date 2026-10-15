// Design Mode's note (M9 fixes 674 and 675): one element of the browser
// pane's page, picked by the person, written as a markdown block that is
// pasted into a Claude session. Pure, so the app's main process, the
// renderer and node:test all reach it; no node in it.

// What the injected picker reads off one element. Every length is in CSS
// pixels, rounded to whole numbers; the url has no query or hash.
export interface DesignPick {
  url: string;
  viewport: { width: number; height: number };
  dpr: number;
  selector: string;
  tag: string;
  role: string | null;
  text: string;
  html: string;
  styles: Array<[string, string]>;
  rect: { x: number; y: number; width: number; height: number };
  nearby: string;
  source: string | null;
}

// A pick in the tray (fix 675): the crop's path, or null when the capture
// failed, and the person's comment. A direct send carries an empty one.
export interface DesignNote {
  id: string;
  pick: DesignPick;
  shot: string | null;
  comment: string;
}

// Every string the page supplies goes into a paste typed into Claude, so
// a page could put the bracketed paste's end marker and a carriage return
// in its text and type a line of its own. Every C0 control but newline
// and tab goes, with DEL and every C1 character.
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

export function stripControl(s: string): string {
  return s.replace(CONTROL, '');
}

const LABEL_TEXT_CAP = 30;

// The pill's text over the hovered element, and the tray's title words:
// the tag, the role, the text cut short, and the size.
export function designLabel(p: DesignPick): string {
  let label = stripControl(p.tag);
  if (p.role !== null) label += ` role="${stripControl(p.role)}"`;
  const text = stripControl(p.text);
  if (text !== '') label += ` "${text.length > LABEL_TEXT_CAP ? text.slice(0, LABEL_TEXT_CAP) + '…' : text}"`;
  return `${label} ${p.rect.width}x${p.rect.height}`;
}

// A fence the HTML cannot close: three backticks, or one more than the
// longest run of backticks inside it when that run is three or more.
function fenceFor(html: string): string {
  let longest = 0;
  for (const run of html.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(longest >= 3 ? longest + 1 : 3);
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function noteLines(note: DesignNote, n: number | null): string[] {
  const p = note.pick;
  const lines: string[] = [];
  if (n !== null) lines.push(`### ${n}. ${stripControl(p.tag)} ${stripControl(p.selector)}`);
  lines.push(`Page: ${stripControl(p.url)} (viewport ${p.viewport.width}x${p.viewport.height})`);
  lines.push(`Selector: \`${stripControl(p.selector)}\``);
  lines.push(`Bounds: x ${p.rect.x}, y ${p.rect.y}, ${p.rect.width}x${p.rect.height}`);
  const text = stripControl(p.text);
  if (text !== '') lines.push(`Text: "${text}"`);
  const nearby = stripControl(p.nearby);
  if (nearby !== '') lines.push(`Nearby: "${nearby}"`);
  lines.push(note.shot === null ? 'Screenshot: none (the capture failed)' : `Screenshot: ${note.shot}`);
  if (p.source !== null) lines.push(`Source: ${stripControl(p.source)}`);
  lines.push('Styles:');
  for (const [name, value] of p.styles) lines.push(`- ${stripControl(name)}: ${stripControl(value)}`);
  lines.push('HTML:');
  const html = stripControl(p.html);
  const fence = fenceFor(html);
  lines.push(fence + 'html', html, fence);
  lines.push(`**Feedback:** ${note.comment}`);
  return lines;
}

// The block pasted into Claude: a heading on the first note's path, then
// each note's lines, numbered when the tray sends several.
export function formatDesignBlock(notes: readonly DesignNote[], numbered: boolean): string {
  const first = notes[0];
  const lines = [`## Design Feedback: ${first === undefined ? '' : stripControl(pathnameOf(first.pick.url))}`, ''];
  notes.forEach((note, i) => {
    if (i > 0) lines.push('');
    lines.push(...noteLines(note, numbered ? i + 1 : null));
  });
  return lines.join('\n');
}

// What xterm's own paste sends into a pty that asked for bracketed paste:
// the markers around the text, every line ending a carriage return, and
// no Enter after it, so the person reads and adds to it before sending.
export function bracketedPaste(text: string): string {
  return '\x1b[200~' + text.replace(/\r?\n/g, '\r') + '\x1b[201~';
}
