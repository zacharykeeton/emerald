// M9 fix 672: the pure half of emmer browser's driver, no electron here
// so node:test reaches it. browser-driver.ts runs the verbs on a guest's
// debugger; this file turns what the debugger answers into the lines the
// CLI prints, and the CLI's words into what the debugger takes.

// The roles a snapshot gives a ref, the controls a click or a fill can
// act on; a heading is printed with no ref, as a landmark to read by.
// M9 fix 934: and the roles Chromium gives a date, time and colour input,
// which have no ARIA role of their own, so a fill reaches them.
export const ACTIONABLE_ROLES: ReadonlySet<string> = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider', 'spinbutton', 'treeitem',
  'Date', 'DateTime', 'InputTime', 'ColorWell',
]);
// M9 fix 875: the roles a snapshot lists as a region with a ref of its own (@r1), for --within alone; the verbs take @e refs only.
export const REGION_ROLES: ReadonlySet<string> = new Set(['dialog', 'alertdialog', 'menu', 'menubar', 'list', 'navigation', 'main', 'complementary', 'banner', 'contentinfo', 'form', 'search', 'region', 'toolbar', 'tablist', 'tree', 'grid', 'table']);

// A name or a value is cut at this many characters, and a snapshot lists
// this many rows at most, so one page cannot flood a Claude's context.
export const BROWSER_NAME_CHARS = 200;
export const BROWSER_SNAPSHOT_CAP = 500;
// How long the pane's driven mark stays after a command ends, and how
// often wait looks again, in ms.
export const BROWSER_MARK_LINGER_MS = 5000;
export const BROWSER_WAIT_POLL_MS = 100;
// M9 fix 876: how long a driven page stays held, its debugger attached and the page acting focused, after its last command, in ms; EMERALD_BROWSER_HOLD_MS names another for a harness.
export const BROWSER_HOLD_IDLE_MS = 60_000;
export function holdIdleMs(raw: string | undefined): number {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n > 0 ? n : BROWSER_HOLD_IDLE_MS;
}

// M9 fix 877: a fill's target as the page reads it, and what fill does with it; a refusal lists at most this many of a select's options.
export const BROWSER_OPTIONS_LISTED = 20;
export const FILL_TARGET_FN = "function () { if (this.localName === 'select') return this.multiple ? { kind: 'multiple' } : { kind: 'select', options: Array.from(this.options, (o) => ({ value: o.value, text: o.text.trim() })) }; if (this.localName === 'input' && (this.type === 'checkbox' || this.type === 'radio' || this.type === 'file')) return { kind: this.type }; return { kind: 'field' }; }";
export type FillTarget = { kind: 'field' | 'checkbox' | 'radio' | 'file' | 'multiple' } | { kind: 'select'; options: { value: string; text: string }[] };
export function fillPlan(target: FillTarget, text: string, ref: string, described: string): { type: 'field' } | { type: 'pick'; index: number; option: string } | { type: 'refuse'; text: string } {
  switch (target.kind) {
    case 'field':
      return { type: 'field' };
    case 'checkbox':
      return { type: 'refuse', text: `${ref} is a checkbox; click it to tick it` };
    case 'radio':
      return { type: 'refuse', text: `${ref} is a radio button; click it to pick it` };
    case 'file':
      return { type: 'refuse', text: `${ref} is a file input; emmer browser upload ${ref} <path> sets its file` };
    case 'multiple':
      return { type: 'refuse', text: 'fill takes a single select; a multiple select is not driven' };
    case 'select': {
      const { options } = target;
      if (options.length === 0) return { type: 'refuse', text: `${described} has no options` };
      let index = options.findIndex((o) => o.value === text);
      if (index < 0) index = options.findIndex((o) => o.text.trim() === text.trim());
      if (index >= 0) return { type: 'pick', index, option: options[index]!.text };
      const texts = options.map((o) => o.text);
      const listed = texts.length > BROWSER_OPTIONS_LISTED
        ? `its first ${BROWSER_OPTIONS_LISTED} options are ${texts.slice(0, BROWSER_OPTIONS_LISTED).join(', ')} and ${texts.length - BROWSER_OPTIONS_LISTED} more`
        : `its options are ${texts.join(', ')}`;
      return { type: 'refuse', text: `no option ${JSON.stringify(text)} in ${described}; ${listed}` };
    }
  }
}

// M9 fix 934: what a field holds after fill's setter fallback, read back.
// Null when it holds the text, line breaks counted alike and the case of
// ASCII letters aside (a colour input lowercases #FF0000); else the
// refusal's tail: the field's maxlength when the text is longer (a value
// set from script is not held to it, so the read-back alone would pass
// it), else the value the field holds, which says what its sanitization
// made of the text.
export const FILL_HELD_FN = 'function () { return { value: this.value, maxLength: this.maxLength }; }';
export function fillHeld(text: string, held: unknown): string | null {
  const read = (typeof held === 'object' && held !== null ? held : {}) as { value?: unknown; maxLength?: unknown };
  const same = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[A-Z]/g, (c) => c.toLowerCase());
  const max = read.maxLength;
  if (typeof max === 'number' && max >= 0 && same(text).length > max) return `the field takes at most ${max} character${max === 1 ? '' : 's'}`;
  const value = typeof read.value === 'string' ? read.value : '';
  return same(value) === same(text) ? null : `the field holds ${JSON.stringify(value)}`;
}

// What a Runtime.callFunctionOn or Runtime.evaluate reply says the page threw, as the first line of it, or null when it threw nothing.
export function pageThrew(reply: Record<string, unknown>): string | null {
  const ex = reply['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
  if (ex === undefined) return null;
  return (ex.exception?.description ?? ex.text ?? '').split('\n')[0]!;
}
// M9 fix 874: a drag's moves and the pause after the press and each move, in ms; some drag-and-drop libraries read the pointer once a frame.
export const BROWSER_DRAG_STEPS = 10;
export const BROWSER_DRAG_PAUSE_MS = 16;

// M9 fix 856: where wait finds a text: the page's own text, else a field's value (an app whose heading is an input), else an aria-label. One expression per poll, as the innerText read was.
export function waitExpression(text: string): string {
  return `(() => { const t = ${JSON.stringify(text)}; if (document.body !== null && document.body.innerText.includes(t)) return 'text'; for (const el of document.querySelectorAll('input, textarea, select')) { if (el.type === 'hidden' || el.type === 'password') continue; const v = el.tagName === 'SELECT' ? [...el.selectedOptions].map((o) => o.text).join('\\n') : el.value; if (typeof v === 'string' && v.includes(t)) return 'field'; } for (const el of document.querySelectorAll('[aria-label]')) if ((el.getAttribute('aria-label') ?? '').includes(t)) return 'label'; return null; })()`;
}

// The fields of Accessibility.getFullAXTree's nodes this reads.
interface AxValue {
  type?: string;
  value?: unknown;
}
export interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  properties?: Array<{ name: string; value: AxValue }>;
  childIds?: string[];
  backendDOMNodeId?: number;
}

export interface SnapshotRow {
  ref: string;
  role: string;
  name: string;
  value?: string;
  states: string[];
  // M9 fix 914: on a region's row alone, the rows --within would print under it.
  rows?: number;
}

function cut(s: string): string {
  return s.length > BROWSER_NAME_CHARS ? s.slice(0, BROWSER_NAME_CHARS) + '...' : s;
}

function text(v: AxValue | undefined): string {
  const x = v?.value;
  return typeof x === 'string' ? x : typeof x === 'number' || typeof x === 'boolean' ? String(x) : '';
}

// The states in the order a row prints them.
function statesOf(node: AxNode): string[] {
  const props = new Map((node.properties ?? []).map((p) => [p.name, p.value?.value]));
  const out: string[] = [];
  if (props.get('disabled') === true) out.push('disabled');
  const checked = props.get('checked');
  if (checked === true || checked === 'true') out.push('checked');
  if (checked === 'mixed') out.push('mixed');
  const expanded = props.get('expanded');
  if (expanded === true) out.push('expanded');
  if (expanded === false) out.push('collapsed');
  if (props.get('selected') === true) out.push('selected');
  if (props.get('focused') === true) out.push('focused');
  if (props.get('required') === true) out.push('required');
  if (props.get('readonly') === true) out.push('readonly');
  return out;
}

// M9 fix 875: what a filtered snapshot prints: the lines whose name or
// value holds name, any case, and the lines inside within, the node of a
// region's or a control's ref (its backendDOMNodeId and the ref with no @).
export interface SnapshotFilter {
  name?: string;
  within?: { id: number; ref: string };
}

// The page as lines a Claude reads: a first line with the title and the
// address, then each control in document order with a ref (@e1, @e2...)
// that click, fill and the rest take, and each heading without one.
// refs maps a ref to its backendDOMNodeId, which the verbs resolve.
// M9 fix 875: regions get @r refs of their own, every control is numbered whatever the cap or the filter, and a filter keeps only the printed lines.
// M9 fix 914: a region's line ends with the count of the rows under it, (3 rows), (1 row) or (no rows), whatever the filter and the cap.
export function snapshotOf(
  nodes: AxNode[],
  page: { title: string; url: string },
  filter: SnapshotFilter = {},
): { text: string; refs: Map<string, number>; regions: Map<string, number>; rows: SnapshotRow[]; shown: SnapshotRow[]; found: boolean } {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const children = new Set(nodes.flatMap((n) => n.childIds ?? []));
  const roots = nodes.filter((n) => !children.has(n.nodeId));
  const lines: string[] = [`page ${JSON.stringify(page.title)} ${page.url}`];
  const refs = new Map<string, number>();
  const regions = new Map<string, number>();
  const rows: SnapshotRow[] = [];
  const shown: SnapshotRow[] = [];
  const needle = filter.name?.toLowerCase();
  const within = filter.within;
  let found = within === undefined;
  let passed = 0;
  let listed = 0;
  let offered = 0;
  let more = 0;
  // A line passes when the walk is inside within's node and its uncut
  // name, or a control's value, holds the name; past the cap it is counted.
  const offer = (inside: boolean, texts: string[], line: () => string, row: SnapshotRow | null): number => {
    if (!inside) return -1;
    if (needle !== undefined && !texts.some((t) => t.toLowerCase().includes(needle))) return -1;
    passed += 1;
    if (listed >= BROWSER_SNAPSHOT_CAP) {
      more += 1;
      return -1;
    }
    lines.push(line());
    if (row !== null) shown.push(row);
    listed += 1;
    return lines.length - 1;
  };
  const seen = new Set<string>();
  const walk = (node: AxNode, outer: boolean): void => {
    if (seen.has(node.nodeId)) return;
    seen.add(node.nodeId);
    let inside = outer;
    let region: { at: number; row: SnapshotRow; before: number } | null = null;
    if (within !== undefined && node.backendDOMNodeId === within.id) {
      found = true;
      inside = true;
    }
    if (!node.ignored) {
      const role = text(node.role);
      const whole = text(node.name);
      const name = cut(whole);
      if (role === 'heading') {
        offered += 1;
        const level = (node.properties ?? []).find((p) => p.name === 'level')?.value?.value;
        offer(inside, [whole], () => `heading ${JSON.stringify(name)}${typeof level === 'number' ? ` level=${level}` : ''}`, null);
      } else if (ACTIONABLE_ROLES.has(role) && typeof node.backendDOMNodeId === 'number') {
        offered += 1;
        const ref = `e${refs.size + 1}`;
        refs.set(ref, node.backendDOMNodeId);
        const wholeValue = text(node.value);
        const value = cut(wholeValue);
        const states = statesOf(node);
        const row: SnapshotRow = { ref, role, name, ...(value !== '' ? { value } : {}), states };
        rows.push(row);
        offer(inside, [whole, wholeValue], () => `@${ref} ${role} ${JSON.stringify(name)}${value !== '' ? ` value=${JSON.stringify(value)}` : ''}${states.length > 0 ? ` [${states.join(' ')}]` : ''}`, row);
      } else if (REGION_ROLES.has(role) && typeof node.backendDOMNodeId === 'number') {
        offered += 1;
        const ref = `r${regions.size + 1}`;
        regions.set(ref, node.backendDOMNodeId);
        const row: SnapshotRow = { ref, role, name, states: [] };
        region = { at: offer(inside, [whole], () => `@${ref} ${role} ${JSON.stringify(name)}`, row), row, before: offered };
      }
    }
    for (const id of node.childIds ?? []) {
      const child = byId.get(id);
      if (child !== undefined) walk(child, inside);
    }
    if (region !== null) {
      const r: { at: number; row: SnapshotRow; before: number } = region;
      const n = offered - r.before;
      r.row.rows = n;
      if (r.at >= 0) lines[r.at] += n === 0 ? ' (no rows)' : n === 1 ? ' (1 row)' : ` (${n} rows)`;
    }
  };
  for (const root of roots) walk(root, within === undefined);
  if (more > 0) lines.push(`... ${more} more not listed`);
  if (passed === 0 && (needle !== undefined || within !== undefined)) {
    const under = within === undefined ? '' : `under @${within.ref}`;
    const matches = filter.name === undefined ? '' : `matches ${JSON.stringify(filter.name)}`;
    lines.push(`no row ${[under, matches].filter((s) => s !== '').join(' ')}`);
  }
  return { text: lines.join('\n'), refs, regions, rows, shown, found };
}

// @e3 or e3 to e3; anything else is not a ref.
export function parseRef(s: string): string | null {
  const m = /^@?(e\d+)$/.exec(s);
  return m === null ? null : m[1]!;
}

// M9 fix 875: @r2 or r2 to r2, a region's ref for --within alone.
export function parseRegion(s: string): string | null {
  const m = /^@?(r\d+)$/.exec(s);
  return m === null ? null : m[1]!;
}

export interface KeySpec {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
  text?: string;
}

const NAMED: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  tab: { key: 'Tab', code: 'Tab', vk: 9 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 },
  space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  home: { key: 'Home', code: 'Home', vk: 36 },
  end: { key: 'End', code: 'End', vk: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 },
};

// One key as Input.dispatchKeyEvent takes it: a named key, a letter or a
// digit, after any of Ctrl+, Shift+ and Alt+ in any order and case. text
// is set for a key that types something with no Ctrl or Alt held, so a
// keyDown with it puts the character in a field. null is a key not on
// the list.
export function keySpec(name: string): KeySpec | null {
  const parts = name.split('+');
  const last = parts.pop();
  if (last === undefined || last === '') return null;
  let modifiers = 0;
  for (const p of parts) {
    const m = p.toLowerCase();
    if (m === 'alt') modifiers |= 1;
    else if (m === 'ctrl' || m === 'control') modifiers |= 2;
    else if (m === 'shift') modifiers |= 8;
    else return null;
  }
  const typing = (modifiers & 3) === 0;
  const named = NAMED[last.toLowerCase()];
  if (named !== undefined) {
    return { key: named.key, code: named.code, windowsVirtualKeyCode: named.vk, modifiers, ...(typing && named.text !== undefined ? { text: named.text } : {}) };
  }
  if (!/^[A-Za-z0-9]$/.test(last)) return null;
  const upper = last.toUpperCase();
  const digit = /^\d$/.test(last);
  // Shift+a types A, as the keyboard would.
  const typed = (modifiers & 8) !== 0 && !digit ? upper : last;
  return {
    key: typed,
    code: digit ? `Digit${last}` : `Key${upper}`,
    windowsVirtualKeyCode: upper.charCodeAt(0),
    modifiers,
    ...(typing ? { text: typed } : {}),
  };
}

// The middle of DOM.getBoxModel's content quad, four x and y pairs.
export function centre(quad: number[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < 8; i += 2) {
    x += quad[i] ?? 0;
    y += quad[i + 1] ?? 0;
  }
  return { x: x / 4, y: y / 4 };
}

// M9 fix 915: a PNG's own size off its IHDR chunk (bytes 16 to 23, big-endian), null for anything that is not a PNG.
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  if (png.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((b, i) => png[i] !== b)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// The device pixels in one CSS pixel: the image's width over the page's, to two places; null when either is not above 0.
export function shotScale(imageWidth: number, cssWidth: number): number | null {
  if (!(imageWidth > 0) || !(cssWidth > 0)) return null;
  return Math.round((imageWidth / cssWidth) * 100) / 100;
}

export function screenshotLine(file: string, css: { width: number; height: number } | null, scale: number | null): string {
  if (css === null || scale === null) return `saved ${file} (its size in CSS pixels not read)`;
  return `saved ${file} (${css.width}x${css.height} CSS pixels, ${String(scale)} device pixel${scale === 1 ? '' : 's'} each)`;
}

// M9 fix 874: the points a drag moves through, steps of them evenly from
// one point to the other, the last the end itself.
export function dragPath(from: { x: number; y: number }, to: { x: number; y: number }, steps: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 1; i <= steps; i += 1) {
    out.push(i === steps ? { x: to.x, y: to.y } : { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  }
  return out;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

// browser-<yyyymmdd>-<hhmmss>-<mmm>.png in local time.
export function screenshotName(d: Date): string {
  return `browser-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}.png`;
}

// M9 fix 673: what a page did that a command does not answer, kept per
// guest from its registration until emmer browser events reads it.
export const BROWSER_EVENTS_CAP = 200;

export type BrowserEvent =
  | { at: number; kind: 'window'; url: string }
  | { at: number; kind: 'download'; path: string }
  | { at: number; kind: 'download-failed'; name: string; state: string }
  | { at: number; kind: 'console'; text: string; source: string; line: number };

function clock(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// M9 fix 857: a console line from Electron's own code. Its sandbox bundle can log two errors as a guest starts (the preloadScripts lines fix 620 kept out of the harness's FAIL dump, its section in docs/DONE.md); no page script carries a node:electron/ source, so events leaves them out.
export function fromElectron(sourceId: string): boolean {
  return sourceId.startsWith('node:electron/');
}

export function eventLine(e: BrowserEvent): string {
  switch (e.kind) {
    case 'window':
      return `${clock(e.at)} window ${e.url}`;
    case 'download':
      return `${clock(e.at)} download ${e.path}`;
    case 'download-failed':
      return `${clock(e.at)} download ${e.state} ${e.name}`;
    case 'console':
      return `${clock(e.at)} console error ${e.text} (${e.source}:${e.line})`;
  }
}

// The newest BROWSER_EVENTS_CAP entries, and how many older ones went;
// a read empties both.
export class EventLog {
  private entries: BrowserEvent[] = [];
  private dropped = 0;

  add(entry: BrowserEvent): void {
    this.entries.push(entry);
    if (this.entries.length > BROWSER_EVENTS_CAP) {
      this.entries.shift();
      this.dropped += 1;
    }
  }

  read(): { lines: string[]; entries: BrowserEvent[] } {
    const entries = this.entries;
    const lines = [...(this.dropped > 0 ? [`${this.dropped} older events dropped`] : []), ...entries.map(eventLine)];
    this.entries = [];
    this.dropped = 0;
    return { lines, entries };
  }
}

// A download's file name in the downloads folder: the characters Windows
// refuses as _, download for an empty name, and (2), (3) before the
// extension while the name is taken.
export function downloadName(taken: ReadonlySet<string> | readonly string[], name: string): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  let clean = name.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_');
  if (clean === '') clean = 'download';
  if (!used.has(clean.toLowerCase())) return clean;
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  for (let n = 2; ; n++) {
    const next = `${stem} (${n})${ext}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

// Whether a person's input on a driven pane pauses the driver, and as
// which kind: a mouse press or a key press that is not a modifier alone,
// on a pane a command has driven, not paused already, and outside the
// driver's own dispatches (synthetic counts those in flight).
export function pauseFor(state: { driven: boolean; paused: boolean; synthetic: number }, input: { kind: 'mouse'; type: string } | { kind: 'key'; type: string; key: string }): 'click' | 'key' | null {
  if (!state.driven || state.paused || state.synthetic > 0) return null;
  if (input.kind === 'mouse') return input.type === 'mouseDown' ? 'click' : null;
  if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return null;
  if (input.key === 'Control' || input.key === 'Shift' || input.key === 'Alt' || input.key === 'Meta') return null;
  return 'key';
}
