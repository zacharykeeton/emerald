// M9 fix 672: the pure half of emmer browser's driver, no electron here
// so node:test reaches it. browser-driver.ts runs the verbs on a guest's
// debugger; this file turns what the debugger answers into the lines the
// CLI prints, and the CLI's words into what the debugger takes.

// The roles a snapshot gives a ref, the controls a click or a fill can
// act on; a heading is printed with no ref, as a landmark to read by.
export const ACTIONABLE_ROLES: ReadonlySet<string> = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider', 'spinbutton', 'treeitem',
]);

// A name or a value is cut at this many characters, and a snapshot lists
// this many rows at most, so one page cannot flood a Claude's context.
export const BROWSER_NAME_CHARS = 200;
export const BROWSER_SNAPSHOT_CAP = 500;
// How long the pane's driven mark stays after a command ends, and how
// often wait looks again, in ms.
export const BROWSER_MARK_LINGER_MS = 5000;
export const BROWSER_WAIT_POLL_MS = 100;

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

// The page as lines a Claude reads: a first line with the title and the
// address, then each control in document order with a ref (@e1, @e2...)
// that click, fill and the rest take, and each heading without one.
// refs maps a ref to its backendDOMNodeId, which the verbs resolve.
export function snapshotOf(nodes: AxNode[], page: { title: string; url: string }): { text: string; refs: Map<string, number>; rows: SnapshotRow[] } {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const children = new Set(nodes.flatMap((n) => n.childIds ?? []));
  const roots = nodes.filter((n) => !children.has(n.nodeId));
  const lines: string[] = [`page ${JSON.stringify(page.title)} ${page.url}`];
  const refs = new Map<string, number>();
  const rows: SnapshotRow[] = [];
  let listed = 0;
  let more = 0;
  const seen = new Set<string>();
  const walk = (node: AxNode): void => {
    if (seen.has(node.nodeId)) return;
    seen.add(node.nodeId);
    if (!node.ignored) {
      const role = text(node.role);
      const name = cut(text(node.name));
      if (role === 'heading') {
        if (listed < BROWSER_SNAPSHOT_CAP) {
          const level = (node.properties ?? []).find((p) => p.name === 'level')?.value?.value;
          lines.push(`heading ${JSON.stringify(name)}${typeof level === 'number' ? ` level=${level}` : ''}`);
          listed += 1;
        } else more += 1;
      } else if (ACTIONABLE_ROLES.has(role) && typeof node.backendDOMNodeId === 'number') {
        if (listed < BROWSER_SNAPSHOT_CAP) {
          const ref = `e${refs.size + 1}`;
          refs.set(ref, node.backendDOMNodeId);
          const value = cut(text(node.value));
          const states = statesOf(node);
          lines.push(`@${ref} ${role} ${JSON.stringify(name)}${value !== '' ? ` value=${JSON.stringify(value)}` : ''}${states.length > 0 ? ` [${states.join(' ')}]` : ''}`);
          rows.push({ ref, role, name, ...(value !== '' ? { value } : {}), states });
          listed += 1;
        } else more += 1;
      }
    }
    for (const id of node.childIds ?? []) {
      const child = byId.get(id);
      if (child !== undefined) walk(child);
    }
  };
  for (const root of roots) walk(root);
  if (more > 0) lines.push(`... ${more} more not listed`);
  return { text: lines.join('\n'), refs, rows };
}

// @e3 or e3 to e3; anything else is not a ref.
export function parseRef(s: string): string | null {
  const m = /^@?(e\d+)$/.exec(s);
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
