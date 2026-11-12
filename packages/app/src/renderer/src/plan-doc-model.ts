import MarkdownIt from 'markdown-it';
import type { SessionInfo, StepTurn } from '@emerald/shared';
import type { ReviewComment } from './review-model.ts';
import { bare } from './screen-prompt-model.ts';

// M9 fix 1169: a plan waiting for approval, read off the transcript's
// pending ExitPlanMode (its plan text and its file), cut into the parts a
// comment hangs on, the comments' prompt and the field of the plan dialog
// Send comments types into. Pure, so node:test covers it. (Named
// plan-doc-model.ts since plan-model.ts is the Statistics tab's
// subscription plan, fix 838.)

export interface PendingPlan {
  toolUseId: string;
  text: string | null;
  path: string | null;
}

// The last step of the last turn, when it is an ExitPlanMode with no
// result: Claude Code writes the tool_use before its dialog shows. A
// transcript of 2.1.229 carried the plan's whole Markdown as `plan` and
// its file as `planFilePath` in that input; 2.1.322 writes the input
// empty (`{}`, read at the seat's real run) and hands both to the hooks
// alone, so with neither field the plan is the last file the conversation
// wrote or edited in a `plans` folder (`<config>/plans/<slug>.md`, or a
// project's `plansDirectory`), its text the Write's content when the last
// touch was a Write. Null when nothing is found, as for a plan kept in a
// Claude Doc, so the card stays today's.
export function pendingPlan(turns: StepTurn[]): PendingPlan | null {
  const turn = turns[turns.length - 1];
  const step = turn?.steps[turn.steps.length - 1];
  if (step === undefined || step.kind !== 'tool' || step.name !== 'ExitPlanMode' || step.result !== null) return null;
  const text = nonEmpty(step.input['plan']);
  const path = nonEmpty(step.input['planFilePath']);
  if (text !== null || path !== null) return { toolUseId: step.id, text, path };
  const written = lastPlanWrite(turns);
  return written === null ? null : { toolUseId: step.id, ...written };
}

function nonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

const PLAN_FILE = /[\\/]plans[\\/][^\\/]+\.md$/i;

function lastPlanWrite(turns: StepTurn[]): { text: string | null; path: string } | null {
  for (let t = turns.length - 1; t >= 0; t--) {
    const steps = turns[t]!.steps;
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i]!;
      if (s.kind !== 'tool' || (s.name !== 'Write' && s.name !== 'Edit' && s.name !== 'MultiEdit')) continue;
      const path = nonEmpty(s.input['file_path']);
      if (path === null || !PLAN_FILE.test(path)) continue;
      return { path, text: s.name === 'Write' ? nonEmpty(s.input['content']) : null };
    }
  }
  return null;
}

// The plan tab reads its file again on the review tab's rhythm, since
// ctrl+g edits it while the dialog is up.
export const PLAN_POLL_MS = 5000;

// The rel every plan comment carries, so keepDraft's sort is by line alone.
export const PLAN_REL = 'plan';

const TITLE_MAX = 80;

// The card's title: the first Markdown heading, else the first non-empty
// line, cut to 79 characters and an ellipsis past 80.
export function planTitle(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let title: string | undefined;
  for (const line of lines) {
    const m = /^#{1,6}\s+(.+)$/.exec(line);
    if (m !== null) {
      title = m[1]!.trim();
      break;
    }
  }
  title ??= lines.find((l) => l.trim() !== '')?.trim() ?? '';
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

export interface PlanBlock {
  // The 1-based source line the part starts on.
  line: number;
  // Its first non-blank source line, trimmed, quoted in the prompt so
  // Claude finds the part after the plan moves under it.
  code: string;
  html: string;
}

// The chat's setup (chat-markdown.ts) without its image rule: html off,
// so nothing in a plan reaches the DOM as a tag.
const md = new MarkdownIt({ html: false, linkify: true });

// The parts a comment hangs on: every top-level block, except that a
// top-level list is one part per item, so a numbered step takes its own
// comment while a nested list stays inside its item.
export function planBlocks(text: string): PlanBlock[] {
  const src = text.replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const blocks: PlanBlock[] = [];
  for (const t of md.parse(src, {})) {
    if (t.map === null || t.nesting === -1) continue;
    const top = t.level === 0 && t.type !== 'bullet_list_open' && t.type !== 'ordered_list_open';
    const item = t.level === 1 && t.type === 'list_item_open';
    if (!top && !item) continue;
    const [from, to] = t.map;
    const part = lines.slice(from, to);
    while (part.length > 0 && part[part.length - 1]!.trim() === '') part.pop();
    const source = part.join('\n');
    blocks.push({ line: from + 1, code: part.find((l) => l.trim() !== '')?.trim() ?? '', html: md.render(source) });
  }
  return blocks;
}

// What Claude receives as the dialog's feedback: a block per comment in
// line order, the general comment last.
export function planPrompt(comments: readonly ReviewComment[], general: string): string {
  const sorted = [...comments].sort((a, b) => a.line - b.line);
  return ['Comments on the plan:', ...sorted.map((c) => `Line ${c.line}: ${c.code.trim()}\n${c.text.trim()}`), ...(general.trim() === '' ? [] : [`Overall: ${general.trim()}`])].join('\n\n');
}

// Send comments answers the dialog, so it goes only while the session
// asks a permission (the plan's approval is one).
export function planSendGate(session: Pick<SessionInfo, 'state' | 'needsInputReason'> | undefined, count: number): { enabled: boolean; note: string | null } {
  if (session === undefined) return { enabled: false, note: 'No such session' };
  if (session.state !== 'needs-input' || session.needsInputReason !== 'permission') return { enabled: false, note: 'The plan is not waiting for an answer' };
  if (count === 0) return { enabled: false, note: null };
  return { enabled: true, note: null };
}

const NUMBERED = /^([❯>]\s*)?(\d)\.\s+(.+?)\s*$/;
const KEEP_PLANNING = 'No, keep planning';
const PLACEHOLDER = 'Tell Claude what to change';

// The plan dialog's No, keep planning row, read off the bare rows: the
// last row of the last numbered list. Off the pointer the bundle draws its
// label (and `, <text>` once something is typed), while the real 2.1.322
// dialog drew its placeholder there with nothing typed (the seat's real
// run: `3. Tell Claude what to change`, the pointer on 1); with the
// pointer on it the row is the field itself, its placeholder while empty,
// else the text, told from another dialog's last row by the dialog's
// question above.
export function planFeedback(rows: readonly string[]): { key: string; pointer: boolean; typed: string } | null {
  const list: { key: string; pointer: boolean; label: string }[] = [];
  for (const row of rows) {
    const m = NUMBERED.exec(bare(row));
    if (m === null) continue;
    const key = m[2]!;
    // A repeated digit is another dialog's leftover, so the later list wins.
    if (list.some((o) => o.key === key)) list.length = 0;
    list.push({ key, pointer: m[1] !== undefined, label: m[3]! });
  }
  const last = list[list.length - 1];
  if (last === undefined) return null;
  if (!last.pointer) {
    if (last.label === PLACEHOLDER) return { key: last.key, pointer: false, typed: '' };
    if (!last.label.startsWith(KEEP_PLANNING)) return null;
    const rest = last.label.slice(KEEP_PLANNING.length);
    return { key: last.key, pointer: false, typed: rest.startsWith(', ') ? rest.slice(2) : '' };
  }
  if (last.label === PLACEHOLDER) return { key: last.key, pointer: true, typed: '' };
  // The question wraps on a pane narrower than its line (the seat's real
  // run drew `Would you like to` and `proceed?` on two rows), so the rows
  // are read as one text.
  const all = rows.map(bare).join(' ').replace(/\s+/g, ' ');
  if (all.includes('Would you like to proceed?')) return { key: last.key, pointer: true, typed: last.label };
  return null;
}
