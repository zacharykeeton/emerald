import type { NeedsInputReason, SessionState, Step, StepTurn, TeamCounts } from '@emerald/shared';

// The chat view's pure parts (M9 fix 689), kept out of the components so
// node:test can cover them: the face's stored set, the spinner read off
// the screen, and the hint under the box.

// M9 fix 714: what the timeline shows. Normal folds each turn's tool
// calls into one row and hides the thinking, Thinking keeps the thinking
// above the folded row, Verbose draws every step.
export type ChatMode = 'normal' | 'thinking' | 'verbose';
export const CHAT_MODES: readonly ChatMode[] = ['normal', 'thinking', 'verbose'];
export const CHAT_MODE_WORDS: Readonly<Record<ChatMode, string>> = { normal: 'Normal', thinking: 'Thinking', verbose: 'Verbose' };

export function nextChatMode(mode: ChatMode): ChatMode {
  return CHAT_MODES[(CHAT_MODES.indexOf(mode) + 1) % CHAT_MODES.length]!;
}

// The panes on the chat face, stored as [paneId, sessionId] pairs, with
// the view mode as a third element when it is not Normal (fix 714), so a
// pane on Normal stores what it did before. A corrupt entry, or one that
// is not two or three strings, reads as nothing.
function chatEntries(raw: string | null): string[][] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((e): e is string[] => Array.isArray(e) && (e.length === 2 || e.length === 3) && e.every((x) => typeof x === 'string'));
}

export function parseChatPanes(raw: string | null): Map<string, string> {
  return new Map(chatEntries(raw).map((e) => [e[0]!, e[1]!]));
}

export function parseChatModes(raw: string | null): Map<string, ChatMode> {
  const out = new Map<string, ChatMode>();
  for (const e of chatEntries(raw)) if (e[2] === 'thinking' || e[2] === 'verbose') out.set(e[0]!, e[2]);
  return out;
}

export function serializeChatPanes(chatPanes: ReadonlyMap<string, string>, chatModes: ReadonlyMap<string, ChatMode> = new Map()): string {
  return JSON.stringify(
    [...chatPanes.entries()].map(([paneId, sessionId]) => {
      const mode = chatModes.get(paneId);
      return mode === undefined || mode === 'normal' ? [paneId, sessionId] : [paneId, sessionId, mode];
    }),
  );
}

// The face a pane shows: the chat only while it holds the session it was
// turned to chat on, so a pane shown another session is on the terminal
// at once.
export function faceOf(chatPanes: ReadonlyMap<string, string>, paneId: string, sessionId: string | null): 'chat' | 'terminal' {
  return sessionId !== null && chatPanes.get(paneId) === sessionId ? 'chat' : 'terminal';
}

// Claude Code's spinner row while it works, as claim 8 of M9 fix 688's
// claims (docs/DONE.md) read it at 2.1.300: a glyph stepping
// through `· ✢ * ✶ ✻ ✽`, one word with an ellipsis, then in brackets the
// seconds and the tokens received (`✶ Forging… (3s · ↓ 88 tokens)`,
// `✢ Forging… (running PreToolUse hooks… 0/3 · 2s · ↓ 8 tokens)`, or
// the word alone early on). A tool row (`● Running 1 shell command…`)
// has more than one word and another glyph, so it never matches.
const SPINNER_ROW = /^\s*[·✢*✶✻✽✳⋆]\s+([A-Za-z][\w'-]*)…(?:\s+\((.*)\))?\s*$/;
const DOWN = /↓\s*([\d.,]+[kKmM]?)\s*tokens/;

export function spinnerOf(rows: readonly string[]): { word: string; down: string | null } | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const m = SPINNER_ROW.exec(rows[i]!);
    if (m === null) continue;
    const down = m[2] === undefined ? null : (DOWN.exec(m[2])?.[1] ?? null);
    return { word: m[1]!, down };
  }
  return null;
}

// A working session's transcript gets a dozen line writes a second, and
// every session in the same project folder writes beside it, so the view
// re-reads at most this often, with a trailing read.
export const CHAT_REREAD_MS = 500;

// M9 fix 690: the ask card's heading, the same four strings as the
// sidebar's answer card (AnswerPopover.tsx), which stays its own.
export function askHeading(reason: NeedsInputReason | null | undefined): string {
  if (reason === 'permission') return 'Claude is asking permission';
  if (reason === 'agent-permission') return 'A subagent is asking permission';
  if (reason === 'question') return 'Claude has a question';
  return 'Waiting on you';
}

// M9 fix 713: the view's one read of the session's screen, this often,
// feeding the live line's spinner, the mode chip and the ask card (the
// card read it on its own before, as the sidebar's card does).
export const SCREEN_READ_MS = 1000;

// The slash commands that open a picker or a dialog of their own in the
// TUI, which the chat view cannot draw: a send of one shows the fallback
// bar over the box.
export const TERMINAL_COMMANDS: readonly string[] = ['/model', '/permissions', '/mcp', '/config', '/agents', '/hooks', '/memory', '/resume', '/theme', '/login', '/status', '/doctor'];

export function opensMenu(text: string): boolean {
  const first = text.trim().split(/\s+/)[0] ?? '';
  return TERMINAL_COMMANDS.includes(first);
}

// Whether the fallback bar goes when the transcript grows: claim 6 of M9
// fix 688's claims (docs/DONE.md) read Claude Code 2.1.300 writing a picker
// command's lines when the picker closes (Escape wrote `/model` and
// `Kept model as ...` together), so a later read that is longer means
// the menu is gone.
export const FALLBACK_ON_GROWTH = true;

// The words under the box, by the session's state.
export function hintText(state: SessionState | undefined): string {
  if (state === 'working') return 'Sent when the turn ends';
  if (state === 'needs-input') return 'The ask takes the keys';
  return '';
}

// M9 fix 713: the footer's chips.

// The permission mode as Claude Code's own footer names it (claim 2 of
// the chat claims at 2.1.300: `⏸ manual mode on`, `⏵⏵ accept edits on
// (shift+tab to cycle)`, ...). The TUI's footer is its bottom row, so the
// rows are scanned from the last and a reply quoting the words higher up
// never wins.
const MODE_ROW = /^\s*(?:⏸|⏵⏵)\s+(manual mode|accept edits|plan mode|auto mode) on\b/;
const MODE_WORDS: Readonly<Record<string, string>> = {
  'manual mode': 'Manual',
  'accept edits': 'Accept edits',
  'plan mode': 'Plan',
  'auto mode': 'Auto',
};

export function modeOf(rows: readonly string[]): string | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const m = MODE_ROW.exec(rows[i]!);
    if (m !== null) return MODE_WORDS[m[1]!] ?? null;
  }
  return null;
}

// The model chip's words: the title's short model, with the effort when
// the transcript has said it.
export function modelChipText(model: string | null, effort: string | null): string | null {
  if (model === null) return null;
  return effort === null ? model : `${model} · ${effort}`;
}

// The agent count's words, the agents out and returned and the shells
// running; nothing when all three are none, the rule the roster keeps.
export function agentChipText(counts: TeamCounts): string | null {
  const agents = counts.out + counts.returned;
  const parts: string[] = [];
  if (agents > 0) parts.push(`${agents} agent${agents === 1 ? '' : 's'}`);
  if (counts.shells > 0) parts.push(`${counts.shells} shell${counts.shells === 1 ? '' : 's'}`);
  return parts.length === 0 ? null : parts.join(' · ');
}

// The session's lines added and removed: the sums over every edit step
// that came back with counts. A rejected edit is an error result and a
// pending one has none, so neither counts.
export function sessionDiff(turns: readonly StepTurn[]): { added: number; removed: number } {
  return stepsDiff(turns.flatMap((t) => t.steps));
}

function stepsDiff(steps: readonly Step[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const step of steps) {
    const r = step.kind === 'tool' ? step.result : null;
    if (r === null || r.error || r.added === null || r.removed === null) continue;
    added += r.added;
    removed += r.removed;
  }
  return { added, removed };
}

// M9 fix 714: a turn's steps as the view mode draws them. Verbose is
// every step. Normal and Thinking fold the tool calls into one row
// (Normal drops the thinking, Thinking keeps it in place): closed, the
// row stands just before the first reply or note after the first tool
// call, or at the end, so the thinking reads above it; open, it stands
// at the first tool call's place with every call after it. A closed
// fold is followed by the folded calls that returned an image, which
// m9-chat-reply draws as thumbnails, since they stay in Normal.
export type ToolStep = Extract<Step, { kind: 'tool' }>;
export interface FoldItem {
  kind: 'fold';
  count: number;
  names: string[];
  added: number;
  removed: number;
  open: boolean;
}
export type TimelineItem = { kind: 'step'; step: Step } | FoldItem | { kind: 'images'; steps: ToolStep[] };

export function timelineItems(steps: readonly Step[], mode: ChatMode, open: boolean): TimelineItem[] {
  const one = (step: Step): TimelineItem => ({ kind: 'step', step });
  if (mode === 'verbose') return steps.map(one);
  const kept = steps.filter((s) => s.kind !== 'thinking' || mode === 'thinking');
  const tools = kept.filter((s): s is ToolStep => s.kind === 'tool');
  if (tools.length === 0) return kept.map(one);
  const fold: FoldItem = { kind: 'fold', count: tools.length, names: tools.map((t) => t.name), ...stepsDiff(tools), open };
  const out: TimelineItem[] = [];
  let placed = false;
  if (open) {
    for (const s of kept) {
      if (s.kind === 'tool' && !placed) {
        out.push(fold);
        placed = true;
      }
      out.push(one(s));
    }
    return out;
  }
  const images = tools.filter((t) => t.result !== null && t.result.image !== null);
  const place = () => {
    out.push(fold);
    if (images.length > 0) out.push({ kind: 'images', steps: images });
    placed = true;
  };
  let seenTool = false;
  for (const s of kept) {
    if (s.kind === 'tool') {
      seenTool = true;
      continue;
    }
    if (seenTool && !placed && (s.kind === 'text' || s.kind === 'note')) place();
    out.push(one(s));
  }
  if (!placed) place();
  return out;
}

export function foldText(fold: Pick<FoldItem, 'count' | 'names'>): string {
  return `${fold.count} step${fold.count === 1 ? '' : 's'} · ${fold.names.join(', ')}`;
}

// M9 fix 719: the `/` menu over the box. The built-ins that run and leave
// nothing to answer, their descriptions verbatim from Claude Code
// 2.1.300's own command table (the bundle under
// ~/.local/share/claude/versions; `claude --help` lists no slash
// commands). /review, /cost and /btw stay out: 2.1.300 has no /review,
// /cost is /usage's alias and opens a dialog, and /btw answers in an
// overlay of its own.
export const SENT_COMMANDS: readonly { name: string; description: string }[] = [
  { name: '/compact', description: 'Free up context by summarizing the conversation so far' },
  { name: '/clear', description: 'Start a new session with empty context; previous session stays on disk (resumable with /resume)' },
  { name: '/init', description: 'Initialize a new CLAUDE.md file with codebase documentation' },
  { name: '/recap', description: 'Generate a one-line session recap now' },
  { name: '/reload-skills', description: 'Pick up skills added or changed on disk during this session' },
];

export interface SlashRow {
  name: string;
  description: string;
  section: 'sent' | 'terminal';
  skill: boolean;
}

// The menu's query: the whole box a `/` and no space yet, else none.
export function slashQuery(text: string): string | null {
  const m = /^\/(\S*)$/.exec(text);
  return m === null ? null : m[1]!;
}

// Every row the menu can show, in order: the built-ins, the skills as
// main lists them (the project's first, each scope in name order) with a
// name already listed skipped, then the commands only the terminal draws.
export function slashRows(skills: readonly { name: string; description: string }[]): SlashRow[] {
  const rows: SlashRow[] = SENT_COMMANDS.map((c) => ({ ...c, section: 'sent', skill: false }));
  const seen = new Set(rows.map((r) => r.name));
  for (const s of skills) {
    const name = `/${s.name}`;
    if (seen.has(name)) continue;
    seen.add(name);
    rows.push({ name, description: s.description, section: 'sent', skill: true });
  }
  for (const name of TERMINAL_COMMANDS) rows.push({ name, description: '', section: 'terminal', skill: false });
  return rows;
}

// The rows whose name, without its `/`, holds the query, any case: within
// each section an exact match first, then the names that start with it,
// then the rest, each group in its input order; the sections stay in
// order.
export function filterSlash(rows: readonly SlashRow[], query: string): SlashRow[] {
  const q = query.toLowerCase();
  const out: SlashRow[] = [];
  for (const section of ['sent', 'terminal'] as const) {
    const exact: SlashRow[] = [];
    const starts: SlashRow[] = [];
    const rest: SlashRow[] = [];
    for (const r of rows) {
      if (r.section !== section) continue;
      const n = r.name.replace(/^\//, '').toLowerCase();
      if (!n.includes(q)) continue;
      if (n === q) exact.push(r);
      else if (n.startsWith(q)) starts.push(r);
      else rest.push(r);
    }
    out.push(...exact, ...starts, ...rest);
  }
  return out;
}

// M9 fix 720: the `@` menu. The token before the caret: an `@` at the
// start or after a space, then no space, `@` or quote; `start` is the
// `@`'s index, and the path after it (backslashes made slashes) splits at
// its last slash into the folder it names and the name being typed. An
// `@` inside a word, an e-mail address, opens nothing.
export function mentionQuery(text: string, caret: number): { start: number; dir: string; needle: string } | null {
  const m = /(?:^|\s)@([^\s@"]*)$/.exec(text.slice(0, caret));
  if (m === null) return null;
  const typed = m[1]!.replace(/\\/g, '/');
  const cut = typed.lastIndexOf('/') + 1;
  return { start: caret - m[1]!.length - 1, dir: typed.slice(0, cut), needle: typed.slice(cut) };
}

// The rows the `@` menu shows at most; more are reached by typing.
export const MENTION_ROWS = 12;

// The listing's entries whose name holds the needle, any case: an exact
// name first, then the names that start with it, then the rest, each
// group in the listing's order with its folders before its files.
export function filterMention<T extends { name: string; kind: 'dir' | 'file' }>(entries: readonly T[], needle: string): T[] {
  const dirsFirst = (group: T[]) => [...group.filter((e) => e.kind === 'dir'), ...group.filter((e) => e.kind !== 'dir')];
  const q = needle.toLowerCase();
  const exact: T[] = [];
  const starts: T[] = [];
  const rest: T[] = [];
  for (const e of entries) {
    const n = e.name.toLowerCase();
    if (!n.includes(q)) continue;
    if (n === q) exact.push(e);
    else if (n.startsWith(q)) starts.push(e);
    else rest.push(e);
  }
  return [...dirsFirst(exact), ...dirsFirst(starts), ...dirsFirst(rest)].slice(0, MENTION_ROWS);
}

// A path as Claude Code takes a mention: `@path`, quoted when it holds a
// space.
export function mentionText(rel: string): string {
  return rel.includes(' ') ? `@"${rel}"` : `@${rel}`;
}

// An absolute path made relative to the session's folder, any case, with
// slashes; the folder itself is `.`, and a path outside it stays whole.
export function relativeMention(folder: string, abs: string): string {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const f = norm(folder);
  const a = norm(abs);
  if (a.toLowerCase() === f.toLowerCase()) return '.';
  if (a.toLowerCase().startsWith(`${f.toLowerCase()}/`)) return a.slice(f.length + 1);
  return a;
}

// M9 fix 721: an image into the session's own prompt. The key Claude Code
// reads its clipboard on is not sent: 2.1.300 binds its image paste to
// Alt+V on Windows and reads the real clipboard, a route left unprobed on
// purpose (a probe would replace the person's clipboard while a seat
// runs), so every paste, attach and drop takes the file route below. A
// later entry probes the key with the person's word.
export const IMAGE_PASTE_KEY: string | null = null;

// The probe's readings (chat-claims-713.md): a path typed into Claude
// Code 2.1.300 stays text, while the same path inside bracketed-paste
// marks, as a terminal pastes it, quoted or bare, turns into
// `[Image #N]`; so the file route pastes the path.
export function pastedPath(p: string): string {
  return `\x1b[200~${quotedPath(p)}\x1b[201~`;
}

// A path quoted when it holds a space, as a drop types it
// (explorer-drop.ts).
export function quotedPath(p: string): string {
  return p.includes(' ') ? `"${p}"` : p;
}

// The image names Claude Code turns into a marker, its own list.
export function isImageName(p: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(p);
}

// A file: URL for a thumbnail, each segment after the drive encoded.
export function fileHref(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  const drive = /^[A-Za-z]:$/.test(parts[0] ?? '') ? parts.shift()! : null;
  const rest = parts.map((s) => encodeURIComponent(s)).join('/');
  return drive === null ? `file:///${rest.replace(/^\/+/, '')}` : `file:///${drive}/${rest}`;
}

// The image numbers Claude Code's prompt shows, in the order the rows
// hold them.
export function imageMarkers(rows: readonly string[]): number[] {
  const out: number[] = [];
  for (const row of rows) for (const m of row.matchAll(/\[Image #(\d+)\]/g)) out.push(Number(m[1]));
  return out;
}
