import type { EffortState, NeedsInputReason, SessionState, Step, StepTurn, TeamCounts } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import { unwrapPasted } from '@emerald/shared';
import { switchDialog } from '@emerald/shared';
import { normalizePath, relativePath } from './files-model.ts';
import { aboveBtwPanel, isQuestionDialog } from './screen-prompt-model.ts';
// M9 fix 973: Claude Code's command table lives in claude-commands.ts.
import { ARGUMENT_COMMANDS, SENT_COMMANDS, TERMINAL_ALIASES, TERMINAL_COMMANDS } from './claude-commands.ts';
export { ARGUMENT_COMMANDS, SENT_COMMANDS, TERMINAL_ALIASES, TERMINAL_COMMANDS } from './claude-commands.ts';

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

// M9 fix 785: the view chip shows only once the mode has something to
// change: a tool call (Normal folds it) or a thinking step (Normal hides
// it). A session with prompts and replies alone draws the same in all
// three modes. An update (fix 797) is a reply line, the same in every
// mode, so it brings no chip.
export function viewChipShown(turns: readonly StepTurn[]): boolean {
  return turns.some((t) => t.steps.some((s) => s.kind === 'tool' || s.kind === 'thinking'));
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

export function spinnerOf(allRows: readonly string[]): { word: string; down: string | null } | null {
  // M9 fix 1058: the /btw panel's own Answering row sits below the turn's spinner; only the rows above the panel are the turn's
  const rows = aboveBtwPanel(allRows);
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

// M9 fix 690: the ask card's heading. Since fix 777 the sidebar's answer
// card (AnswerPopover.tsx) calls it too, and an AskUserQuestion, which
// the daemon reports as a question since fix 802, is told apart by its
// dialog on the screen rows whatever the reason.
export function askHeading(reason: NeedsInputReason | null | undefined, rows?: readonly string[]): string {
  if (rows !== undefined && isQuestionDialog(rows)) return 'Claude has a question';
  if (reason === 'permission') return 'Claude is asking permission';
  if (reason === 'agent-permission') return 'A subagent is asking permission';
  if (reason === 'question') return 'Claude has a question';
  if (reason === 'trust') return 'Trust this folder?';
  // M9 fix 976: the switch confirmation's own title when its rows are read.
  if (reason === 'switch') return (rows === undefined ? null : switchDialog(rows)?.title) ?? 'Confirm a switch';
  return 'Waiting on you';
}

// M9 fix 801: whether an ask card opens its answer box: a question or an
// elicitation the card cannot draw as a dialog, or a read with no options,
// and never once the card has been pressed, since a dialog cleared by the
// press would otherwise read as nothing left but words to type.
export function askBoxShown(o: { reason: NeedsInputReason | null | undefined; recognised: boolean; options: number; pressed: boolean; askedFor: SessionInfo['askedFor'] }): boolean {
  // A select dialog the screen read could not parse: a typed answer would land in its Type something row only after a digit, so the excerpt and the buttons stand as for a permission (M9 fix 802).
  const unreadQuestion = o.askedFor?.words.split(':', 1)[0] === 'AskUserQuestion';
  return !o.pressed && !o.recognised && !unreadQuestion && (o.reason === 'question' || o.reason === 'elicitation' || o.options === 0);
}

// M9 fix 880: a read with no dialog after one in the same needs-input
// spell (the record's stateSince) is the ask answered somewhere else, the
// terminal face or the other card; the card then takes it as fix 801's
// press, dimmed on what was asked, with no box. A spell whose reads never
// drew a dialog is a dialog the reader cannot parse, which keeps fix
// 801's box.
export function answeredElsewhere(o: { key: string | null; pressed: boolean; spell: number; dialogSpell: number | null }): boolean {
  return o.key === null && !o.pressed && o.dialogSpell !== null && o.dialogSpell === o.spell;
}

// M9 fix 713: the view's one read of the session's screen, this often,
// feeding the live line's spinner, the mode chip and the ask card (the
// card read it on its own before, as the sidebar's card does).
export const SCREEN_READ_MS = 1000;

// M9 fix 1005: the side strip's waits. A /btw whose panel no screen read
// has drawn this long after the send says it did not open; a close's Esc
// waits this long for the panel to go before a send behind it gives up.
export const BTW_OPEN_MS = 5000;
export const SIDE_CLOSE_MS = 2000;
export const SIDE_STILL_OPEN = 'The side question is still open in the session';
// M9 fix 1134: whether closing the side strip sends Claude Code's panel its Escape: when the newest read draws the panel, and also when no read ever drew it and the session is not working, since a panel the reader missed (a footer it could not match) is still up and takes the next keys; an Escape to a working Claude would stop its turn, so a panel never read over a working turn is left as before.
export function sideCloseSends(drawn: boolean, seen: boolean, working: boolean): boolean {
  return drawn || (!seen && !working);
}

// M9 fix 780: the two commands whose argument skips their dialog (a model
// or an effort level picked by name); every other one keeps the bar.
export const ARGUMENT_SKIPS_DIALOG: readonly string[] = ['/model', '/effort'];

export function opensMenu(text: string): boolean {
  const words = text.trim().split(/\s+/);
  const first = words[0] ?? '';
  // M9 fixes 890 and 923: /remote-control (or its alias /rc) opens a dialog
  // of the terminal's in every state: the one-time Enable Remote Control on
  // an account that has not enabled it, Disconnect while connected. On an
  // account already enabled the connect line lands in the transcript and
  // the bar goes on growth (FALLBACK_ON_GROWTH), so it shows for a moment.
  if (first === '/remote-control' || first === '/rc') return true;
  // M9 fix 1005: /btw with a question opens the view's side strip; bare,
  // it reopens the TUI's own panel, which the view does not draw.
  if (first === '/btw') return words.length < 2;
  if (ARGUMENT_SKIPS_DIALOG.includes(first) && words.length > 1) return false;
  return TERMINAL_COMMANDS.some((c) => c.name === first) || TERMINAL_ALIASES.includes(first) || ARGUMENT_COMMANDS.some((c) => c.name === first);
}

// Whether the fallback bar goes when the transcript grows: claim 6 of M9
// fix 688's claims (docs/DONE.md) read Claude Code 2.1.300 writing a picker
// command's lines when the picker closes (Escape wrote `/model` and
// `Kept model as ...` together), so a later read that is longer means
// the menu is gone.
export const FALLBACK_ON_GROWTH = true;

// The words under the box, by the session's state and (M9 fix 754) the
// person's messages queued behind the turn.
export function hintText(state: SessionState | undefined, queued = 0): string {
  if (state === 'needs-input') return 'The ask takes the keys';
  if (queued > 0) return `${queued} queued · Up to edit`;
  if (state === 'working') return 'Sent when the turn ends';
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

// M9 fix 889: remote control's footer pill, Claude Code 2.1.303's own words (the bare /rc is /rc active after its fifth showing). It sits at the right end of the footer's last row, so only the last RC_ROWS non-blank rows are read, from the bottom, stopping at the prompt box's lower rule, and a reply or a typed prompt quoting the words never wins. The compact footer's bare rc, told apart only by colour, is not read.
export const RC_ROWS = 3;
export type RcState = 'active' | 'connecting' | 'reconnecting' | 'failed';
export interface RcMark { state: RcState; word: string }
const RC_PILL = /(?:^|\s)\/rc(?: (active|connecting…|reconnecting|failed))?(?=\s|$)/;
const RC_MARKS: Readonly<Record<string, RcMark>> = {
  active: { state: 'active', word: '/rc active' },
  'connecting…': { state: 'connecting', word: '/rc connecting…' },
  reconnecting: { state: 'reconnecting', word: '/rc reconnecting' },
  failed: { state: 'failed', word: '/rc failed' },
};

export function rcOf(rows: readonly string[]): RcMark | null {
  let tested = 0;
  for (let i = rows.length - 1; i >= 0 && tested < RC_ROWS; i -= 1) {
    const row = rows[i]!.trim();
    if (row === '') continue;
    if (row.startsWith('─')) return null;
    tested += 1;
    const m = RC_PILL.exec(row);
    if (m !== null) return RC_MARKS[m[1] ?? 'active'] ?? null;
  }
  return null;
}

// M9 fix 889: the link of the latest remote control line in the turns, the rc chip's title and its click.
export function rcUrlOf(turns: readonly StepTurn[]): string | null {
  for (let t = turns.length - 1; t >= 0; t -= 1) {
    const steps = turns[t]!.steps;
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const step = steps[i]!;
      if (step.kind === 'command' && step.url !== undefined) return step.url;
    }
  }
  return null;
}

// M9 fix 743: the mode chip's menu. The words modeOf reads, each with
// the line Claude Code's own mode list gives it (the parenthesis of its
// map in the 2.1.301 bundle, verbatim); kept by hand at each Claude Code
// update. All four are always listed: a mode the session's settings
// leave out of the cycle is never reached, and the press cap says so.
export const MODE_CHOICES: readonly { word: string; line: string }[] = [
  { word: 'Manual', line: 'ask each time' },
  { word: 'Accept edits', line: 'auto-approve file edits and common file commands' },
  { word: 'Plan', line: 'research and propose changes without making them' },
  { word: 'Auto', line: 'no routine prompts; a reviewer model screens actions' },
];

// Claude Code has no command that sets a mode by name, so a pick presses
// Shift+Tab and reads the footer every MODE_POLL_MS after each press until
// its mode changes, SCREEN_READ_MS at most, this many presses at most (M9
// fix 819: five presses took about six seconds at one read a second).
export const MODE_PICK_PRESSES = 5;
export const MODE_POLL_MS = 250;

export async function stepModeTo(
  target: string,
  io: { press: () => void; read: () => Promise<readonly string[]>; wait: (ms: number) => Promise<void>; cancelled: () => boolean },
): Promise<{ reached: boolean; presses: number; cancelled: boolean }> {
  // A failed read is a read of no mode.
  const readMode = async (): Promise<string | null> => {
    try {
      return modeOf(await io.read());
    } catch {
      return null;
    }
  };
  // The mode before a press, so a poll knows the press has landed when the
  // footer reads anything else; a read of no mode keeps polling.
  let before = await readMode();
  let presses = 0;
  while (presses < MODE_PICK_PRESSES) {
    if (io.cancelled()) return { reached: false, presses, cancelled: true };
    io.press();
    presses += 1;
    let now: string | null = null;
    for (let polls = 0; polls < SCREEN_READ_MS / MODE_POLL_MS; polls++) {
      await io.wait(MODE_POLL_MS);
      const word = await readMode();
      if (word !== null && word !== before) {
        now = word;
        break;
      }
    }
    if (now === target) return { reached: true, presses, cancelled: false };
    if (now !== null) before = now;
  }
  return { reached: false, presses, cancelled: false };
}

// M9 fix 744: the model chip's menu, read from Claude Code 2.1.301 (the
// aliases `/model` takes, the catalog's names and the `/model` picker's
// own lines) and kept by hand at each update. `best` is left out: it
// resolves to the account tier's default and has no name of its own. A
// model this list does not name gets a ticked row of its own (M9 fix 786,
// modelItems below), so the list going stale costs a missing pick, never
// a wrong tick.
//
// M9 fix 1100: no `[1m]` rows, read off Claude Code 2.1.319. Opus 5.5,
// Sonnet 5.5 and Fable 5.1 each have a native 1M window, and a
// `/model fable[1m]` answers "Set model to Fable 5.1": the status line
// names a 1M pick by its plain name, so a `[1m]` row could never tick.
// `/model` still takes the three aliases when typed by hand.
export const MODEL_CHOICES: readonly { alias: string; name: string; line: string }[] = [
  { alias: 'default', name: 'Default', line: 'Use the default model' },
  { alias: 'opus', name: 'Opus 5.5', line: 'Best for everyday, complex tasks' },
  { alias: 'sonnet', name: 'Sonnet 5.5', line: 'Efficient for routine tasks' },
  { alias: 'haiku', name: 'Haiku 5.5', line: 'Fastest for quick answers' },
  { alias: 'fable', name: 'Fable 5.1', line: 'Most capable for your hardest and longest-running tasks' },
  { alias: 'opusplan', name: 'Opus Plan', line: 'Opus in plan mode, else Sonnet' },
];

// M9 fix 786: the model menu's rows. The session's model ticks its row;
// a model the list does not name comes first as `Current model`, ticked,
// with no alias since nothing picks it. No row is ticked by family.
export const CURRENT_MODEL_LINE = 'Current model';
export interface ModelRow {
  alias: string | null;
  name: string;
  line: string;
  checked: boolean;
}
export function modelItems(model: string | null, choices: readonly { alias: string; name: string; line: string }[]): ModelRow[] {
  const rows: ModelRow[] = choices.map((c) => ({ alias: c.alias, name: c.name, line: c.line, checked: c.name === model }));
  if (model === null || rows.some((r) => r.checked)) return rows;
  return [{ alias: null, name: model, line: CURRENT_MODEL_LINE, checked: true }, ...rows];
}

// The levels `/effort` takes, with the bundle's own line for each. `auto`
// hands the choice back to Claude Code and is not a level in the row.
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export const EFFORT_LINES: Readonly<Record<EffortLevel, string>> = {
  low: 'Quick, straightforward implementation',
  medium: 'Balanced approach with standard testing',
  high: 'Comprehensive implementation with extensive testing',
  xhigh: 'Extended reasoning with thorough analysis (on supported models)',
  max: 'Maximum capability with deepest reasoning (on supported models)',
};

// The effort the chip shows (M9 fix 799): the status line's level, which
// Claude Code posts at the session's start and again at once after an
// /effort or a /model, else the last assistant line's (a daemon before
// level 67). A pick shows until the status line moves off the level it had
// at the pick, or an assistant line written after it (one past the count
// then, M9 fix 770) says one.
export function effortShown(live: string | null, state: EffortState, pick: { level: string; assistants: number; live: string | null } | null): string | null {
  const base = live ?? state.effort;
  if (pick === null) return base;
  if (live !== pick.live || state.assistants > pick.assistants) return base ?? pick.level;
  return pick.level;
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
//
// M9 fix 790: with a folder only the edits under it count, since the chip
// opens a review of that folder and a count for a file the review cannot
// show would not match it. A step with no path, or one that is not
// absolute, counts, since it cannot be placed. A fold row keeps the
// unfiltered sum (stepsDiff): a fold says what Claude did.
export function sessionDiff(turns: readonly StepTurn[], folder: string | null = null): { added: number; removed: number } {
  const steps = turns.flatMap((t) => t.steps);
  return stepsDiff(folder === null ? steps : steps.filter((s) => underFolder(s, folder)));
}

const ABSOLUTE = /^([A-Za-z]:|\\\\|\/\/)/;

function underFolder(step: Step, folder: string): boolean {
  if (step.kind !== 'tool') return true;
  const p = step.input['file_path'] ?? step.input['notebook_path'];
  if (typeof p !== 'string' || !ABSOLUTE.test(p)) return true;
  return relativePath(folder, p) !== normalizePath(p);
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
// every step. Normal and Thinking (Normal drops the thinking, Thinking
// keeps it in place) fold the tool calls per stretch (fix 797): a
// breaker (a reply, an update, a note, a queued message) ends a stretch,
// and each stretch that holds a call gets a fold row of its own, so the
// story reads update, fold, update, fold as Claude Code's does. Closed,
// a stretch's other steps are drawn in order and its fold row stands at
// the stretch's end, just before the breaker, so the thinking reads
// above it; open, the row stands at the stretch's first call with every
// step in place. A closed fold is followed by its calls that returned an
// image, which m9-chat-reply draws as thumbnails, since they stay in
// Normal. A turn with no breaker between its calls draws one row.
export type ToolStep = Extract<Step, { kind: 'tool' }>;
export interface FoldItem {
  kind: 'fold';
  count: number;
  // Claude Code's collapsed-group sentence for the stretch (foldText).
  text: string;
  added: number;
  removed: number;
  open: boolean;
  tone: FoldTone;
}
export type TimelineItem = { kind: 'step'; step: Step } | FoldItem | { kind: 'images'; steps: ToolStep[] };

// The steps that end a stretch of calls (fix 797; fix 798's command notes;
// fix 805's notifications; fix 920's compactions; fix 921's bash runs).
function breaksStretch(s: Step): boolean {
  return s.kind === 'text' || s.kind === 'update' || s.kind === 'note' || s.kind === 'queued' || s.kind === 'command' || s.kind === 'notification' || s.kind === 'compact' || s.kind === 'bash';
}

export function timelineItems(steps: readonly Step[], mode: ChatMode, open: boolean): TimelineItem[] {
  const one = (step: Step): TimelineItem => ({ kind: 'step', step });
  if (mode === 'verbose') return steps.map(one);
  const kept = steps.filter((s) => s.kind !== 'thinking' || mode === 'thinking');
  const out: TimelineItem[] = [];
  let stretch: Step[] = [];
  const flush = () => {
    const tools = stretch.filter((s): s is ToolStep => s.kind === 'tool');
    if (tools.length === 0) {
      out.push(...stretch.map(one));
    } else {
      const tone = foldTone(tools);
      const fold: FoldItem = { kind: 'fold', count: tools.length, text: foldText(tools, tone === 'pending'), ...stepsDiff(tools), open, tone };
      if (open) {
        let placed = false;
        for (const s of stretch) {
          if (s.kind === 'tool' && !placed) {
            out.push(fold);
            placed = true;
          }
          out.push(one(s));
        }
      } else {
        for (const s of stretch) if (s.kind !== 'tool') out.push(one(s));
        out.push(fold);
        const images = tools.filter((t) => t.result !== null && t.result.image !== null);
        if (images.length > 0) out.push({ kind: 'images', steps: images });
      }
    }
    stretch = [];
  };
  for (const s of kept) {
    if (breaksStretch(s)) {
      flush();
      out.push(one(s));
    } else {
      stretch.push(s);
    }
  }
  flush();
  return out;
}

// M9 fix 891: a prompt that is pictures alone (its text nothing but [Image #N] markers) is drawn as the pictures, with no bubble behind them.
export function imageOnlyPrompt(prompt: string, images: readonly unknown[]): boolean {
  return images.length > 0 && prompt.replace(/\[Image #\d+\]/g, '').trim() === '';
}

// M9 fix 921: a bash run's output cut as Claude Code cuts it (2.1.304's
// bash output view): the first three lines, all four when only one would
// be hidden, else three and the count of the rest. The chat view cuts
// source lines, since it does not wrap at a terminal's width.
export const BASH_SHOWN_LINES = 3;
export function bashCut(text: string): { shown: string[]; hidden: number } {
  if (text === '') return { shown: [], hidden: 0 };
  const lines = text.split('\n');
  if (lines.length <= BASH_SHOWN_LINES + 1) return { shown: lines, hidden: 0 };
  return { shown: lines.slice(0, BASH_SHOWN_LINES), hidden: lines.length - BASH_SHOWN_LINES };
}

// M9 fix 797: the plain words a shell call carries, which Claude Code
// draws on the row in place of the command; null for any other tool or
// a call with none. An agent's description already reaches stepArg.
export function shellWords(step: ToolStep): string | null {
  if (step.name !== 'Bash' && step.name !== 'PowerShell') return null;
  const d = step.input['description'];
  return typeof d === 'string' && d.trim() !== '' ? d.trim() : null;
}

// Claude Code 2.1.302's sets (bundle pcs: EYn, RYn, CYn, xYn).
export const SEARCH_WORDS: ReadonlySet<string> = new Set(['find', 'grep', 'rg', 'ag', 'ack', 'locate', 'which', 'whereis']);
export const READ_WORDS: ReadonlySet<string> = new Set(['cat', 'head', 'tail', 'less', 'more', 'wc', 'stat', 'file', 'strings', 'jq', 'awk', 'cut', 'sort', 'uniq', 'tr']);
export const LIST_WORDS: ReadonlySet<string> = new Set(['ls', 'tree', 'du']);
export const NEUTRAL_WORDS: ReadonlySet<string> = new Set(['echo', 'printf', 'true', 'false', ':']);

const knownWord = (w: string): boolean => SEARCH_WORDS.has(w) || READ_WORDS.has(w) || LIST_WORDS.has(w) || NEUTRAL_WORDS.has(w);

// How Claude Code sorts a Bash command for the sentence: every piece's
// first word one of the four sets (the neutral ones skipped), then a list
// before a search before a read, as its count tries isList, isSearch,
// then read. Null is a shell command. Quoting is not parsed, so
// `grep "a|b" x` is a shell command here.
function shellSort(command: string): 'search' | 'read' | 'list' | null {
  const first = /^\s*(?:(?:#[^\n]*|\\)\n\s*)*([^\s|&;<>()]+)/.exec(command)?.[1];
  if (first === undefined || !knownWord(first)) return null;
  const words: string[] = [];
  for (const piece of command.split(/\|\||&&|[|;\n]/)) {
    const word = piece.trim().split(/\s+/)[0] ?? '';
    if (word === '' || NEUTRAL_WORDS.has(word)) continue;
    if (!knownWord(word)) return null;
    words.push(word);
  }
  if (words.length === 0) return null;
  if (words.some((w) => LIST_WORDS.has(w))) return 'list';
  if (words.some((w) => SEARCH_WORDS.has(w))) return 'search';
  return 'read';
}

const EDIT_NAMES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// The calls Claude Code absorbs into a group without a word (its Vmr).
const SILENT_NAMES = new Set(['TodoWrite', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList']);

// M9 fix 797: a fold row's words, Claude Code 2.1.302's collapsed-group
// sentence for the calls of one stretch, done or (running) still going.
// Read off its grouped row's renderer with
// `node .claude/skills/batch/bundle-grep.mjs 'qe=d.bashCount??0' --window 7000`
// and `bundle-grep.mjs '"command":"commands"' --window 3000`, and the
// shell sort pcs with `bundle-grep.mjs '"ls","tree"' --window 1500`; read
// them again at the next update. Left out: its `Thought for Ns` head (the
// thinking is drawn on its own in Thinking), its commit, push and PR
// parts (a git command counts as a shell command here) and its hook
// timings. Claude Code counts a read's paths alone when it has any;
// this adds the shell reads to them.
export function foldText(tools: readonly ToolStep[], running: boolean): string {
  const edits = new Set<string>();
  let editsBare = 0;
  const reads = new Set<string>();
  let readsBare = 0;
  let searches = 0;
  let lists = 0;
  let shells = 0;
  let others = 0;
  let mcpCalls = 0;
  const servers: string[] = [];
  const agents: ToolStep[] = [];
  for (const t of tools) {
    const path = t.input['file_path'] ?? t.input['notebook_path'];
    if (EDIT_NAMES.has(t.name)) {
      if (typeof path === 'string') edits.add(path);
      else editsBare++;
    } else if (t.name === 'Read') {
      if (typeof t.input['file_path'] === 'string') reads.add(t.input['file_path']);
      else readsBare++;
    } else if (t.name === 'Grep' || t.name === 'Glob') {
      searches++;
    } else if (t.name.startsWith('mcp__')) {
      mcpCalls++;
      const server = t.name.slice('mcp__'.length).split('__')[0] ?? '';
      if (!servers.includes(server)) servers.push(server);
    } else if (t.name === 'Agent' || t.name === 'Task') {
      agents.push(t);
    } else if (SILENT_NAMES.has(t.name)) {
      continue;
    } else if (t.name === 'Bash' || t.name === 'PowerShell') {
      const command = t.input['command'];
      const sort = t.name === 'Bash' && typeof command === 'string' ? shellSort(command) : null;
      if (sort === 'search') searches++;
      else if (sort === 'read') readsBare++;
      else if (sort === 'list') lists++;
      else shells++;
    } else {
      others++;
    }
  }
  const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  const add = (done: string, going: string, rest: string) => parts.push(`${running ? going : done} ${rest}`);
  const editCount = edits.size + editsBare;
  const readCount = reads.size + readsBare;
  if (editCount > 0) add('edited', 'editing', counted(editCount, 'file', 'files'));
  if (searches > 0) add('searched for', 'searching for', counted(searches, 'pattern', 'patterns'));
  if (readCount > 0) add('read', 'reading', counted(readCount, 'file', 'files'));
  if (lists > 0) add('listed', 'listing', counted(lists, 'directory', 'directories'));
  if (mcpCalls > 0) add('called', 'calling', servers.join(', ') + (mcpCalls > 1 ? ` ${mcpCalls} times` : ''));
  if (agents.length > 0) {
    const d = agents.length === 1 ? agents[0]!.input['description'] : undefined;
    if (typeof d === 'string' && d.trim() !== '') add('ran', 'running', `agent · ${d.trim()}`);
    else add('ran', 'running', counted(agents.length, 'agent', 'agents'));
  }
  if (others > 0) add('called', 'calling', counted(others, 'tool', 'tools'));
  if (shells > 0) add('ran', 'running', counted(shells, 'shell command', 'shell commands'));
  if (parts.length === 0) add('called', 'calling', counted(tools.length, 'tool', 'tools'));
  const sentence = parts.join(', ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + (running ? '…' : '');
}

export interface SlashRow {
  name: string;
  description: string;
  section: 'sent' | 'terminal';
  skill: boolean;
  // M9 fix 780: the argument hint after the name, '' for none, and
  // whether a pick completes rather than sends.
  hint: string;
  argument: boolean;
}

// The first line of the chat box's placeholder (M9 fix 810): the session's
// name in quotes, cut with an ellipsis inside the quotes at the longest
// prefix that fits `room` when the whole line does not, so the hints keep
// their own second line. `measure` is the line's width in the box's font.
export function placeholderFirstLine(name: string, room: number, measure: (s: string) => number): string {
  const whole = `Message session: "${name}"`;
  if (measure(whole) <= room) return whole;
  const chars = Array.from(name);
  for (let n = chars.length - 1; n > 0; n--) {
    const line = `Message session: "${chars.slice(0, n).join('').trimEnd()}…"`;
    if (measure(line) <= room) return line;
  }
  return 'Message session: "…"';
}

// A menu row's tooltip: the hint and the description, since the hint is cut
// with an ellipsis on a narrow row and the tooltip is where it reads whole
// (M9 fix 811).
export function slashRowTitle(row: SlashRow): string | undefined {
  if (row.hint === '') return row.description === '' ? undefined : row.description;
  return row.description === '' ? row.hint : `${row.hint} · ${row.description}`;
}

// The menu's query: the whole box a `/` and no space yet, else none.
export function slashQuery(text: string): string | null {
  const m = /^\/(\S*)$/.exec(text);
  return m === null ? null : m[1]!;
}

// Every row the menu can show, in order: fix 719's five built-ins, the
// other sent and argument built-ins in name order (M9 fix 780), the
// skills as main lists them (the project's first, each scope in name
// order) with a name already listed skipped, then the commands only the
// terminal draws.
export function slashRows(skills: readonly { name: string; description: string }[]): SlashRow[] {
  const rest = [
    ...SENT_COMMANDS.slice(5).map((c) => ({ ...c, argument: false })),
    ...ARGUMENT_COMMANDS.map((c) => ({ ...c, argument: true })),
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const rows: SlashRow[] = [...SENT_COMMANDS.slice(0, 5).map((c) => ({ ...c, argument: false })), ...rest].map((c) => ({ ...c, section: 'sent', skill: false }));
  const seen = new Set(rows.map((r) => r.name));
  for (const s of skills) {
    const name = `/${s.name}`;
    if (seen.has(name)) continue;
    seen.add(name);
    rows.push({ name, description: s.description, section: 'sent', skill: true, hint: '', argument: false });
  }
  for (const c of TERMINAL_COMMANDS) rows.push({ ...c, section: 'terminal', skill: false, argument: false });
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

// M9 fix 753: a fold row's dot. Pending while any folded call still runs,
// else the last call's tone, so an error the turn recovered from does not
// paint the whole row red (that call still reads red inside the open fold).
export type FoldTone = 'done' | 'error' | 'pending';
export function foldTone(tools: readonly ToolStep[]): FoldTone {
  if (tools.some((t) => t.result === null)) return 'pending';
  return tools[tools.length - 1]?.result?.error ? 'error' : 'done';
}

// M9 fix 1059: the index of Claude Code's prompt row. The last row starting
// with ❯ (after its indent) whose row above starts with a rule (─), which is
// the prompt box's top rule; a dialog's or a notice's pointer row has text
// or a │ frame above it (auto mode's "Teach auto mode" notice draws its
// `  ❯ 1. Yes` under its body text). With no such row, the last row whose
// first character is ❯, since the notice's pointer is indented two and a
// stub shell's prompt has no box; else -1.
export function promptRowAt(rows: readonly string[]): number {
  for (let i = rows.length - 1; i >= 1; i--) if (rows[i]!.trimStart().startsWith('❯') && rows[i - 1]!.trimStart().startsWith('─')) return i;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.startsWith('❯')) return i;
  return -1;
}

// M9 fix 748, 1059: Claude Code's prompt row (promptRowAt's).
export function promptRow(rows: readonly string[]): string | null {
  const y = promptRowAt(rows);
  return y < 0 ? null : rows[y]!;
}

// M9 fix 1059: the title of a notice Claude Code draws under its prompt
// box with numbered choices, such as auto mode's "Teach auto mode about
// your environment?", which holds the keys while it is drawn: the first
// non-blank row after the last rule below the prompt row, when a `❯ n.`
// pointer row follows that rule; else null.
export function noticeOf(rows: readonly string[]): string | null {
  const y = promptRowAt(rows);
  if (y < 0) return null;
  let rule = -1;
  for (let i = y + 1; i < rows.length; i++) {
    const t = rows[i]!.trim();
    if (t.startsWith('─')) rule = i;
    else if (rule >= 0 && /^❯ \d+\. /.test(t)) {
      for (let j = rule + 1; j < i; j++) if (rows[j]!.trim() !== '') return rows[j]!.trim();
      return null;
    }
  }
  return null;
}
export function noticeRefusal(title: string): string {
  return `Claude Code is asking '${title}'; answer it in the terminal first`;
}

// The image numbers on the prompt row alone, so a sent prompt's marker in
// the scrollback above is never taken for a fresh one (M9 fix 748).
export function promptRowImages(rows: readonly string[]): number[] {
  const row = promptRow(rows);
  return row === null ? [] : imageMarkers([row]);
}

// The highest image number on the prompt row that no chip holds yet, else
// null (M9 fix 807).
export function freshImage(rows: readonly string[], held: ReadonlySet<number | null>): number | null {
  const fresh = promptRowImages(rows).filter((n) => !held.has(n));
  return fresh.length > 0 ? Math.max(...fresh) : null;
}

export interface PastedMarker {
  n: number;
  lines: number | null;
  truncated: boolean;
}

// M9 fix 1136: Claude Code's marker for a pasted text (2.1.322): its id, and the line breaks it counts as lines, none for a single-line paste; the truncated form always counts.
const PASTE_MARKER = /\[(?:Pasted text #(\d+)(?: \+(\d+) lines)?|\.\.\.Truncated text #(\d+) \+(\d+) lines\.\.\.)\]/g;

export function pastedMarkers(rows: readonly string[]): PastedMarker[] {
  const out: PastedMarker[] = [];
  for (const row of rows) {
    for (const m of row.matchAll(PASTE_MARKER)) {
      const truncated = m[3] !== undefined;
      const lines = truncated ? m[4] : m[2];
      out.push({ n: Number(truncated ? m[3] : m[1]), lines: lines === undefined ? null : Number(lines), truncated });
    }
  }
  return out;
}

export function promptRowPastes(rows: readonly string[]): PastedMarker[] {
  const row = promptRow(rows);
  return row === null ? [] : pastedMarkers([row]);
}

// The prompt-row paste of highest id that no chip holds yet, else null.
export function freshPaste(rows: readonly string[], held: ReadonlySet<number | null>): PastedMarker | null {
  const fresh = promptRowPastes(rows).filter((m) => !held.has(m.n));
  return fresh.length > 0 ? fresh.reduce((a, b) => (b.n > a.n ? b : a)) : null;
}

export function promptRowMarked(rows: readonly string[]): boolean {
  return promptRowImages(rows).length > 0 || promptRowPastes(rows).length > 0;
}

export function pasteChipLabel(m: PastedMarker): string {
  const head = `${m.truncated ? 'Truncated text' : 'Pasted text'} #${m.n}`;
  return m.lines === null ? head : `${head} · ${m.lines} ${m.lines === 1 ? 'line' : 'lines'}`;
}

// The paste markers of an input that holds nothing else, else null: words
// or an image beside a marker, a second input row, or an empty input all
// answer null (M9 fix 1136).
export function pastesOnly(rows: readonly string[]): PastedMarker[] | null {
  const y = promptRowAt(rows);
  if (y < 0) return null;
  const text = rows[y]!.replace(CARRY_FRAME, ' ').trimStart().replace(/^❯/, '');
  if (text.replace(PASTE_MARKER, '').trim() !== '') return null;
  const marks = promptRowPastes(rows);
  if (marks.length === 0) return null;
  const next = rows[y + 1];
  if (next !== undefined && next.replace(CARRY_FRAME, '').trim() !== '') return null;
  return marks;
}

// M9 fix 754: the text in Claude Code's input, after the `❯`, trimmed;
// null with no prompt row.
export function promptRowText(rows: readonly string[]): string | null {
  const row = promptRow(rows);
  if (row === null) return null;
  return row.trimStart().slice(1).trim();
}

// Whether Claude Code's input holds a queued message taken back: its text
// starts with the message's first line cut to 20 characters. It reads
// text, never emptiness, so a placeholder or a queue hint on the empty
// prompt never matches.
export function inputHolds(rows: readonly string[], text: string): boolean {
  const head = (text.split('\n')[0] ?? '').trim().slice(0, 20);
  const now = promptRowText(rows);
  return head !== '' && now !== null && now.startsWith(head);
}

// M9 fix 778: what Claude Code's input holds that the chat box could take
// over, read off a pty.screen reply whole. 'none' for no prompt row, an
// empty input or a placeholder; 'blocked' for a marker a Backspace cannot
// be trusted to clear as text, or an input running past one row, which a
// count of Backspaces would not empty; 'text' otherwise. The reply's ghost
// (fix 779, a level 66 daemon) is the dim run on the prompt row, a
// suggestion or a stock placeholder, and the row is cut where it starts;
// it is typed here so this compiles before the field reaches the protocol
// type. A reply without it has the four stock placeholders stripped by
// text instead. With `expect` (Stop's case, the interrupted turn's prompt)
// the text is known whole, so the answer is that text when the input
// starts with it, whatever its row count, and 'none' otherwise, which
// keeps a placeholder or a suggestion from ever being taken for it. Fix
// 784 calls this as is.
export type CarryRead = { kind: 'none' } | { kind: 'text'; text: string } | { kind: 'blocked' };
export const CARRY_MS = 2000;
export const CARRY_POLL_MS = 250;
const PLACEHOLDERS = [/Try ".*"$/, /Press up to .*$/, /Press Enter to edit .*$/, /Message @.*$/];
const CARRY_FRAME = /[─-╿▀-▟]/g;
// Every marker Claude Code draws (2.1.322's matcher), the truncated paste and the team guide among them since M9 fix 1136.
const CARRY_MARKER = /\[(?:Image #|Pasted text #|\u2726 Team setup guide #|\.\.\.Truncated text #)/;
export function carryRead(
  screen: { rows: readonly string[]; cursor: { x: number; y: number }; ghost?: { y: number; x: number; text: string } | null },
  expect: string | null = null,
): CarryRead {
  const { rows, ghost } = screen;
  const y = promptRowAt(rows);
  if (y < 0) return { kind: 'none' };
  // M9 fix 1059: the daemon computes the reply's ghost on its own row, the
  // last one starting with ❯ (pty-session.ts:335); a ghost taken off
  // another row is read as a reply without the field.
  let daemonRow = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.trimStart().startsWith('❯')) {
      daemonRow = i;
      break;
    }
  }
  const g = daemonRow === y ? ghost : undefined;
  let row = rows[y]!;
  if (g !== undefined && g !== null && g.y === y) row = row.slice(0, g.x);
  let text = row.trimStart().slice(1).trim();
  if (g === undefined) {
    for (const p of PLACEHOLDERS) {
      const m = p.exec(text);
      if (m !== null) {
        text = text.slice(0, m.index).trim();
        break;
      }
    }
  }
  const marker = CARRY_MARKER.test(text);
  if (expect !== null) {
    const head = (expect.split('\n')[0] ?? '').trim().slice(0, 20);
    return head !== '' && !marker && text.startsWith(head) ? { kind: 'text', text: expect } : { kind: 'none' };
  }
  if (text === '') return { kind: 'none' };
  if (marker) return { kind: 'blocked' };
  const under = rows[y + 1];
  if (under !== undefined && under.replace(CARRY_FRAME, ' ').trim() !== '') return { kind: 'blocked' };
  return { kind: 'text', text };
}

// M9 fix 778: what Stop moves into the box, from carryRead's answer once
// its wait is over and the turn Stop stopped. 'input' is the prompt Claude
// Code gave back to its input, carried out of it. 'prompt' is the turn's
// prompt with nothing in the input to clear: a prompt the mod submitted
// (fix 781's route for a plain prompt to an idle Claude) never sat in the
// input, so an interrupt has nothing to give back (read on 2.1.301), and
// the box takes the prompt off the turn instead, but only for a turn that
// drew no step, which is when Claude Code gives a typed prompt back too.
export type StopCarry = 'input' | 'prompt' | 'none';
export function stopCarry(read: CarryRead, turn: { steps: readonly unknown[] } | null): StopCarry {
  if (read.kind === 'text') return 'input';
  if (read.kind === 'none' && turn !== null && turn.steps.length === 0) return 'prompt';
  return 'none';
}

// M9 fix 972: a model or effort pick, or a `/` command sent from the box,
// is typed into Claude Code's input, and its Enter submits whatever already
// sits there with it. So the input is read first: empty, the command types
// as it is; holding text, that text moves into the box before the command
// types; blocked (a marker or an input past one row), nothing is typed.
export type PickRoute = 'type' | 'carry-then-type' | 'refuse';
export function pickRoute(read: CarryRead): PickRoute {
  if (read.kind === 'none') return 'type';
  if (read.kind === 'text') return 'carry-then-type';
  return 'refuse';
}

// M9 fix 1002: how a carry of Claude Code's input into the box ended.
// 'busy' another carry of the same pane and session was running, so this
// one never read; 'none' and 'blocked' the read's kinds, nothing moved;
// 'stuck' the input would not empty and was left with a refusal; 'failed'
// a read threw; 'moved' the text went into the box (or was parked, when
// the view had gone); 'prompt' Stop's turn prompt went in with the input
// left alone.
export type CarryOutcome = 'busy' | 'none' | 'blocked' | 'stuck' | 'failed' | 'moved' | 'prompt';

// M9 fix 1003: a pick or a box `/` command made while a carry runs waits
// for it, then routes on a fresh read of the input and the carry's
// outcome. Empty, the command types alone; blocked, it is refused; still
// holding text, a carry that was left stuck keeps its own refusal
// ('left', nothing more said), one that failed refuses, and after any
// other outcome the input changed since, so it carries again.
export function routeAfterCarry(read: CarryRead, outcome: CarryOutcome): PickRoute | 'left' {
  if (read.kind === 'none') return 'type';
  if (read.kind === 'blocked') return 'refuse';
  if (outcome === 'stuck') return 'left';
  if (outcome === 'failed') return 'refuse';
  return 'carry-then-type';
}

// Which way Claude Code takes a queued message back: 'one' when Up
// selects a message and Enter pulls that one alone (popEditableAt, a
// `popOne` line), 'all' when Up pulls the whole queue into the input
// (popAllEditable, a `popAll` line per message). Read on a real 2.1.301
// session on 2026-10-15 (verify:chat's real block): one Up wrote `popAll`
// for both queued messages, and an Enter after it sent them back as one.
export const QUEUE_PICK: 'one' | 'all' = 'all';

// M9 fix 782: a message sent from the box, drawn at the conversation's end
// until its prompt line or queued card takes its place. `key` is the text
// as the transcript will show it (pendingKey); `seen` is how many landed
// messages already had that key when it was sent, plus the items pending
// with it then, so a repeated message is matched once per item, in order,
// with no clock.
export interface PendingItem {
  id: number;
  text: string;
  key: string;
  at: number;
  seen: number;
  refusal: string | null;
  // M9 fix 1136: a send typed after a pasted chip; its prompt line holds the pasted block before the words (the transcript fold has already taken the tags off), so it is matched by the words at the end of a landed key.
  tail?: boolean;
}

// How many landed messages answer a pending key: the exact key, and for a send after a pasted chip any key that ends with its words after a space.
function landedFor(counts: ReadonlyMap<string, number>, key: string, tail: boolean | undefined): number {
  if (tail !== true || key === '') return counts.get(key) ?? 0;
  let n = 0;
  for (const [k, c] of counts) if (k === key || k.endsWith(` ${key}`)) n += c;
  return n;
}

// M9 fix 782: a sent message with no prompt line this long after the session last went quiet reads Not seen yet.
export const PENDING_UNSEEN_MS = 15000;

// M9 fix 782: whether a send draws a pending bubble. A slash command and
// the memory key write no prompt line of the same text (the texts
// modRoutable keeps typed), so neither draws one; the fallback bar is a
// picker's feedback. Chips with no words draw none either. Since fix 921 a
// bash-mode send draws one, matched by the run's bash step (landedCounts),
// since its input line lands only when the run ends.
export function drawsPending(prompt: string): boolean {
  if (prompt.trim() === '') return false;
  const first = prompt.trimStart()[0];
  return first !== '/' && first !== '#';
}

// The text a pending message and its landed line are matched on: Claude
// Code writes an image sent with words as the words with its [Image #N]
// marker before them, and trims the prompt. A bash-mode send keys as `!`
// and the command trimmed, so `! ls` and `!ls` match the same run (fix
// 921); a prompt never starts with `!`, since a typed `!` is bash mode.
export function pendingKey(text: string): string {
  const flat = unwrapPasted(text).replace(/\[Image #\d+\]/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.startsWith('!') ? `!${flat.slice(1).trim()}` : flat;
}

// How many landed messages carry each key: every turn's prompt, every
// queued step read mid-turn, and every message still queued. A message
// moves from the queue to a prompt or a queued step, so its count holds
// across the move. Read off the turns and the whole queue, never the
// state-gated list the view draws, so a count does not drop while the
// session idles between a dequeue and its prompt line.
export function landedCounts(turns: readonly StepTurn[], queued: readonly { text: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (text: string) => {
    const key = pendingKey(text);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const turn of turns) {
    add(turn.prompt);
    for (const step of turn.steps) {
      if (step.kind === 'queued') add(step.text);
      else if (step.kind === 'bash') add(`!${step.command}`);
    }
  }
  for (const m of queued) add(m.text);
  return counts;
}

// The items still pending: one is matched, and goes, once its key's count
// has grown past its `seen`.
export function pendingAfter(items: readonly PendingItem[], counts: ReadonlyMap<string, number>): PendingItem[] {
  return items.filter((item) => landedFor(counts, item.key, item.tail) <= item.seen);
}

// A new pending item for a send: its `seen` counts the landed messages and
// the items already pending with the same key.
export function pendingItem(id: number, text: string, at: number, items: readonly PendingItem[], counts: ReadonlyMap<string, number>, tail = false): PendingItem {
  const key = pendingKey(text);
  const seen = landedFor(counts, key, tail) + items.filter((p) => p.key === key).length;
  return tail ? { id, text, key, at, seen, refusal: null, tail } : { id, text, key, at, seen, refusal: null };
}

// The bubble's mark: the refusal's own words; Not seen yet once the session
// has been quiet PENDING_UNSEEN_MS since the later of the send and the
// moment it went quiet (`quietSince` is null while it works or asks, when a
// message may only be waiting its turn); else Sending.
export function pendingWords(item: PendingItem, now: number, quietSince: number | null): { state: 'sending' | 'unseen' | 'refused'; words: string } {
  if (item.refusal !== null) return { state: 'refused', words: item.refusal };
  // M9 fix 921: nothing of a bash run lands until it ends, so a long run
  // would read unseen; it reads Running instead, and stays a send.
  if (item.key.startsWith('!')) return { state: 'sending', words: 'Running' };
  if (quietSince !== null && now - Math.max(item.at, quietSince) >= PENDING_UNSEEN_MS) return { state: 'unseen', words: 'Not seen yet' };
  return { state: 'sending', words: 'Sending' };
}

// M9 fix 980: the keys a read brought that were never seen in this
// session, while a send waits (Sending, Running or Not seen yet), and
// that no pending item carries: the next wrapper Claude Code puts round a
// sent message, as <pasted_content> was on 2026-10-23, shows in the log
// rather than only as a bubble stuck beside its own words. A key with no
// bubble of its kind (an empty bare turn, a slash command, the memory
// key) is never one.
export function strayLanded(seen: ReadonlySet<string>, counts: ReadonlyMap<string, number>, items: readonly PendingItem[]): string[] {
  if (!items.some((p) => p.refusal === null)) return [];
  return [...counts.keys()].filter((key) => !seen.has(key) && drawsPending(key) && !items.some((p) => p.key === key));
}

// M9 fix 783: a Ctrl+C within about a second of a turn's Stop left the [Image #N] marker in Claude Code's prompt (fix 748's runs), so the × waits this long after the session leaves working or needs-input.
export const CHIP_SETTLE_MS = 1500;
