import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effortFold, effortState } from '@emerald/shared';
import type { Step, StepResult, StepTurn } from '@emerald/shared';
import { ARGUMENT_COMMANDS, EFFORT_LEVELS, IMAGE_PASTE_KEY, MENTION_ROWS, MODEL_CHOICES, MODE_CHOICES, PENDING_UNSEEN_MS, SENT_COMMANDS, TERMINAL_COMMANDS, agentChipText, askHeading, drawsPending, effortShown, landedCounts, pendingAfter, pendingItem, pendingKey, pendingWords, faceOf, fileHref, filterMention, filterSlash, foldText, hintText, imageMarkers, isImageName, mentionQuery, mentionText, modelChipText, modelItems, modeOf, nextChatMode, opensMenu, parseChatModes, parseChatPanes, pastedPath, promptRow, promptRowImages, quotedPath, relativeMention, serializeChatPanes, sessionDiff, slashQuery, slashRows, spinnerOf, stepModeTo, timelineItems, viewChipShown } from './chat-model.ts';
import type { ChatMode, TimelineItem } from './chat-model.ts';
import type { SlashRow } from './chat-model.ts';

test('chatPanes: the pairs round trip, and a corrupt entry reads as nothing', () => {
  const panes = new Map([
    ['p1', 's1'],
    ['p2', 's2'],
  ]);
  assert.deepEqual(parseChatPanes(serializeChatPanes(panes)), panes);
  assert.equal(parseChatPanes(null).size, 0);
  assert.equal(parseChatPanes('{not json').size, 0);
  assert.equal(parseChatPanes('{"p1":"s1"}').size, 0);
  assert.deepEqual([...parseChatPanes('[["p1","s1"],["p2"],[3,"s"],"x"]')], [['p1', 's1']]);
});

test('faceOf: the chat only while the pane holds the session it was turned on', () => {
  const panes = new Map([['p1', 's1']]);
  assert.equal(faceOf(panes, 'p1', 's1'), 'chat');
  assert.equal(faceOf(panes, 'p1', 's2'), 'terminal', 'another session in the pane');
  assert.equal(faceOf(panes, 'p2', 's1'), 'terminal');
  assert.equal(faceOf(panes, 'p1', null), 'terminal');
});

// Claim 8's rows, read off Claude Code 2.1.300 on 2026-10-15 (M9 fix
// 688's claims, recorded in docs/DONE.md at the close-out).
test('spinnerOf: the word and the tokens received off the spinner row', () => {
  assert.deepEqual(spinnerOf(['❯ run it', '', '✢ Proofing…', '', '────', '❯', '────']), { word: 'Proofing', down: null });
  assert.deepEqual(spinnerOf(['● Pinging localhost six times · 2s', '✶ Forging… (3s · ↓ 88 tokens)', '────']), { word: 'Forging', down: '88' });
  assert.deepEqual(spinnerOf(['✢ Forging… (running PreToolUse hooks… 0/3 · 2s · ↓ 8 tokens)']), { word: 'Forging', down: '8' });
  assert.deepEqual(spinnerOf(['* Forging… (1m 40s · ↓ 3.1k tokens)']), { word: 'Forging', down: '3.1k' });
});

test('spinnerOf: a screen with no spinner, and a tool row, read nothing', () => {
  assert.equal(spinnerOf(['● Running 1 shell command…', '  Running 1 shell command…', '❯', '  ⏸ manual mode on']), null);
  assert.equal(spinnerOf([]), null);
});

// M9 fix 690: the sidebar card's four strings, pinned here so the two
// files cannot drift apart.
test('askHeading: the four reasons and none', () => {
  assert.equal(askHeading('permission'), 'Claude is asking permission');
  assert.equal(askHeading('agent-permission'), 'A subagent is asking permission');
  assert.equal(askHeading('question'), 'Claude has a question');
  assert.equal(askHeading('elicitation'), 'Waiting on you');
  assert.equal(askHeading(null), 'Waiting on you');
});

// M9 fix 777: an AskUserQuestion comes as a permission_prompt; its dialog
// on the rows makes it a question (fails before 777, where the reason
// alone decided), and a tool permission's rows keep the permission
// heading (passes before and after).
test('askHeading: the rows tell a question from a permission', () => {
  const question = ['Which colour?', '❯ 1. A', '  2. Type something.', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel'];
  assert.equal(askHeading('permission', question), 'Claude has a question');
  const permission = ['Bash command', 'Do you want to proceed?', '❯ 1. Yes', '  2. No', '', 'Esc to cancel · Tab to amend'];
  assert.equal(askHeading('permission', permission), 'Claude is asking permission');
});

test('opensMenu: a picker command first in the box, case-sensitive', () => {
  assert.equal(opensMenu('/model'), true);
  // M9 fix 780: a model or an effort level named skips the dialog.
  assert.equal(opensMenu(' /model opus'), false);
  assert.equal(opensMenu('/effort low'), false);
  assert.equal(opensMenu('/effort'), true);
  assert.equal(opensMenu('/rename'), false);
  assert.equal(opensMenu('/rename x'), false);
  assert.equal(opensMenu('/add-dir C:/x'), true);
  assert.equal(opensMenu('/quit'), true);
  assert.equal(opensMenu('/rewind'), true);
  assert.equal(opensMenu('/compact'), false);
  assert.equal(opensMenu('model'), false);
  assert.equal(opensMenu('/Model'), false);
  // Claude Code 2.1.301's table (M9 fix 749).
  assert.equal(opensMenu('/usage'), true);
  assert.equal(opensMenu('/cost'), true);
  assert.equal(opensMenu('/stats'), true);
  assert.equal(opensMenu('/btw why?'), true);
  assert.equal(opensMenu('/agents'), false);
});

test('hintText: by the state', () => {
  assert.equal(hintText('working'), 'Sent when the turn ends');
  assert.equal(hintText('needs-input'), 'The ask takes the keys');
  assert.equal(hintText('idle'), '');
  assert.equal(hintText(undefined), '');
});

// M9 fix 713: the footer's chips. Claim 2's four rows verbatim.
test('modeOf: the four footer rows, the bottom one winning, and nothing else', () => {
  assert.equal(modeOf(['  ⏸ manual mode on · ← 1 agent']), 'Manual');
  assert.equal(modeOf(['  ⏵⏵ accept edits on (shift+tab to cycle) · ← 1 agent']), 'Accept edits');
  assert.equal(modeOf(['  ⏸ plan mode on (shift+tab to cycle) · ← 1 agent']), 'Plan');
  assert.equal(modeOf(['  ⏵⏵ auto mode on (shift+tab to cycle) · ← 1 agent']), 'Auto');
  assert.equal(modeOf(['  ⏸ manual mode on', 'text', '  ⏵⏵ accept edits on (shift+tab to cycle)']), 'Accept edits');
  assert.equal(modeOf([]), null);
  assert.equal(modeOf(['❯ run it', '', '✢ Proofing…', '', '────', '❯', '────']), null);
  assert.equal(modeOf(['● Pinging localhost six times · 2s', '✶ Forging… (3s · ↓ 88 tokens)', '────']), null);
  assert.equal(modeOf(['plan mode on']), null);
});

test('modelChipText: the model, with its effort when known', () => {
  assert.equal(modelChipText(null, 'high'), null);
  assert.equal(modelChipText('Opus 5', null), 'Opus 5');
  assert.equal(modelChipText('Opus 5', 'high'), 'Opus 5 · high');
});

test('agentChipText: agents out and returned, shells running, nothing for none', () => {
  const c = (out: number, returned: number, shells: number, shellsReturned = 0) => ({ out, returned, shells, shellsReturned });
  assert.equal(agentChipText(c(0, 0, 0)), null);
  assert.equal(agentChipText(c(1, 0, 0)), '1 agent');
  assert.equal(agentChipText(c(1, 1, 0)), '2 agents');
  assert.equal(agentChipText(c(0, 0, 2)), '2 shells');
  assert.equal(agentChipText(c(1, 0, 1)), '1 agent · 1 shell');
  assert.equal(agentChipText(c(0, 0, 0, 3)), null);
});

const res = (over: Partial<StepResult> = {}): StepResult => ({ error: false, exitCode: null, endAt: null, lines: null, added: null, removed: null, image: null, ...over });
const tool = (name: string, result: StepResult | null): Step => ({ kind: 'tool', id: name, name, arg: '', input: {}, at: null, result });
const turnOf = (steps: Step[]): StepTurn => ({ prompt: 'p', images: [], at: null, endAt: null, steps });

test('sessionDiff: the edits that came back, summed over the turns', () => {
  const turns = [turnOf([tool('Edit', res({ added: 6, removed: 2 })), tool('Bash', res({ exitCode: 0 }))]), turnOf([tool('Write', res({ added: 3, removed: 0 }))])];
  assert.deepEqual(sessionDiff(turns), { added: 9, removed: 2 });
  assert.deepEqual(sessionDiff([turnOf([tool('Edit', res({ error: true, added: 4, removed: 1 })), tool('Edit', null)])]), { added: 0, removed: 0 });
  assert.deepEqual(sessionDiff([turnOf([tool('Bash', res({ exitCode: 1 }))])]), { added: 0, removed: 0 });
  assert.deepEqual(sessionDiff([]), { added: 0, removed: 0 });
});

// M9 fix 790: the chip counts the edits the review can show.
test('sessionDiff with a folder: only the edits under it, case-blind, and a step with no path still counts', () => {
  const editAt = (p: string | null, added: number) => ({ ...tool('Edit', res({ added, removed: 0 })), input: p === null ? {} : { file_path: p } }) as Step;
  const steps = [
    editAt('C:/repo/a.ts', 2),
    editAt('c:\\REPO\\sub\\b.ts', 1),
    editAt('C:\\Users\\x\\.claude\\skills\\s.md', 5),
    editAt('C:/repository/c.ts', 7),
    editAt(null, 3),
  ];
  assert.deepEqual(sessionDiff([turnOf(steps)], 'C:\\repo'), { added: 6, removed: 0 });
  assert.deepEqual(sessionDiff([turnOf(steps)], null), { added: 18, removed: 0 });
});

// M9 fix 714: the view modes.
test('chatPanes: a pane off Normal stores a triple, Normal the pair, and both read back', () => {
  const panes = new Map([
    ['p1', 's1'],
    ['p2', 's2'],
  ]);
  const modes = new Map<string, ChatMode>([
    ['p1', 'thinking'],
    ['p2', 'normal'],
  ]);
  const raw = serializeChatPanes(panes, modes);
  assert.equal(raw, JSON.stringify([['p1', 's1', 'thinking'], ['p2', 's2']]));
  assert.deepEqual(parseChatPanes(raw), panes);
  assert.deepEqual([...parseChatModes(raw)], [['p1', 'thinking']]);
  const odd = '[["p1","s1","sideways"]]';
  assert.deepEqual([...parseChatPanes(odd)], [['p1', 's1']]);
  assert.equal(parseChatModes(odd).size, 0);
  assert.equal(serializeChatPanes(panes), JSON.stringify([['p1', 's1'], ['p2', 's2']]));
});

test('nextChatMode: Normal, Thinking, Verbose and back', () => {
  assert.equal(nextChatMode('normal'), 'thinking');
  assert.equal(nextChatMode('thinking'), 'verbose');
  assert.equal(nextChatMode('verbose'), 'normal');
});

const think = (ms: number): Step => ({ kind: 'thinking', text: '', ms, at: null });
const reply = (text: string): Step => ({ kind: 'text', text, at: null });
// The stub's turn in verify-m9-chat.mjs: thinking, Bash, Bash error, Edit +6 −2, the reply.
const stubSteps = (): Step[] => [think(6000), tool('Bash', res({ exitCode: 0 })), tool('Bash', res({ error: true, exitCode: 3 })), tool('Edit', res({ added: 6, removed: 2 })), reply('Done.')];
const shape = (items: TimelineItem[]) => items.map((i) => (i.kind === 'step' ? (i.step.kind === 'tool' ? i.step.name : i.step.kind) : i.kind === 'fold' ? (i.open ? 'fold(open)' : 'fold') : 'images'));

test('timelineItems: the stub turn in each mode', () => {
  const steps = stubSteps();
  const normal = timelineItems(steps, 'normal', false);
  assert.deepEqual(shape(normal), ['fold', 'text']);
  assert.deepEqual(normal[0], { kind: 'fold', count: 3, names: ['Bash', 'Bash', 'Edit'], added: 6, removed: 2, open: false, tone: 'done' });
  assert.deepEqual(shape(timelineItems(steps, 'thinking', false)), ['thinking', 'fold', 'text']);
  assert.deepEqual(shape(timelineItems(steps, 'verbose', false)), ['thinking', 'Bash', 'Bash', 'Edit', 'text']);
  assert.deepEqual(shape(timelineItems(steps, 'normal', true)), ['fold(open)', 'Bash', 'Bash', 'Edit', 'text']);
});

test('timelineItems: the thinking above the fold, no fold without tools, images after a closed fold', () => {
  const steps = [think(1000), tool('Bash', res({ exitCode: 0 })), think(2000), tool('Edit', res({ added: 1, removed: 0 })), reply('ok')];
  assert.deepEqual(shape(timelineItems(steps, 'thinking', false)), ['thinking', 'thinking', 'fold', 'text']);
  assert.deepEqual(shape(timelineItems([think(1000), reply('hi')], 'normal', false)), ['text']);
  const img = tool('Read', res({ image: { mediaType: 'image/png', bytes: 2048, data: '' } }));
  const items = timelineItems([img, tool('Bash', res({ exitCode: 0 })), reply('seen')], 'normal', false);
  assert.deepEqual(shape(items), ['fold', 'images', 'text']);
  assert.deepEqual((items[1] as { steps: Step[] }).steps, [img]);
  assert.deepEqual(shape(timelineItems([tool('Bash', null)], 'normal', false)), ['fold']);
});

test('foldText: the count and the names', () => {
  assert.equal(foldText({ count: 1, names: ['Bash'] }), '1 step · Bash');
  assert.equal(foldText({ count: 3, names: ['Bash', 'Bash', 'Edit'] }), '3 steps · Bash, Bash, Edit');
});

test('slashQuery: a `/` first and no space yet', () => {
  assert.equal(slashQuery('/'), '');
  assert.equal(slashQuery('/com'), 'com');
  assert.equal(slashQuery('/compact now'), null);
  assert.equal(slashQuery(' /x'), null);
  assert.equal(slashQuery('hi /x'), null);
});

test('filterSlash: contains, exact then starts-with then the rest, sections in order', () => {
  const sent = (name: string, skill = false): SlashRow => ({ name, description: '', section: 'sent', skill, hint: '', argument: false });
  const term = (name: string): SlashRow => ({ name, description: '', section: 'terminal', skill: false, hint: '', argument: false });
  const rows = [sent('/recap'), sent('/compact'), sent('/clear'), sent('/code-review', true), term('/config'), term('/model')];
  const names = (q: string) => filterSlash(rows, q).map((r) => `${r.section}:${r.name}`);
  assert.deepEqual(names(''), rows.map((r) => `${r.section}:${r.name}`));
  assert.deepEqual(names('c'), ['sent:/compact', 'sent:/clear', 'sent:/code-review', 'sent:/recap', 'terminal:/config']);
  assert.deepEqual(names('model'), ['terminal:/model']);
  assert.deepEqual(names('CO'), names('co'));
  assert.deepEqual(names('clear'), ['sent:/clear']);
});

test('SENT_COMMANDS: the five built-ins first, and slashRows puts the skills after them', () => {
  assert.deepEqual(
    SENT_COMMANDS.slice(0, 5).map((c) => c.name),
    ['/compact', '/clear', '/init', '/recap', '/reload-skills'],
  );
  const rows = slashRows([
    { name: 'alpha', description: 'a' },
    { name: 'compact', description: 'shadowed by the built-in' },
  ]);
  const builtIn = ['/compact', '/clear', '/init', '/recap', '/reload-skills', '/add-dir', '/cd', '/insights', '/install-slack-app', '/radio', '/reload-plugins', '/rename', '/statusline', '/stickers', '/team-onboarding'];
  assert.deepEqual(
    rows.filter((r) => r.section === 'sent').map((r) => [r.name, r.skill]),
    [...builtIn.map((n) => [n, false]), ['/alpha', true]],
  );
  assert.deepEqual(
    rows.filter((r) => r.section === 'terminal').map((r) => r.name),
    TERMINAL_COMMANDS.map((c) => c.name),
  );
  const terminal = rows.filter((r) => r.section === 'terminal').map((r) => r.name);
  assert.ok(terminal.includes('/usage'));
  assert.ok(!terminal.includes('/cost'));
  assert.ok(!terminal.includes('/agents'));
});

test('the built-ins carry their hints and kinds, and no name is listed twice (M9 fix 780)', () => {
  const rows = slashRows([]);
  const row = (name: string) => rows.find((r) => r.name === name);
  assert.equal(row('/rename')?.hint, '[name]');
  assert.equal(row('/rename')?.argument, false);
  assert.equal(row('/rename')?.section, 'sent');
  assert.equal(row('/add-dir')?.argument, true);
  assert.equal(row('/add-dir')?.hint, '<path>');
  assert.equal(row('/compact')?.hint, '<optional custom summarization instructions>');
  assert.equal(row('/compact')?.argument, false);
  assert.equal(row('/model')?.hint, '[model]');
  assert.equal(row('/init')?.hint, '');
  const names = [...SENT_COMMANDS, ...ARGUMENT_COMMANDS, ...TERMINAL_COMMANDS].map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(TERMINAL_COMMANDS.length, 41);
});

test('mentionQuery: the @ token before the caret, split at its last slash', () => {
  assert.deepEqual(mentionQuery('see @src/re', 11), { start: 4, dir: 'src/', needle: 're' });
  assert.equal(mentionQuery('a@b', 3), null);
  assert.deepEqual(mentionQuery('@', 1), { start: 0, dir: '', needle: '' });
  assert.deepEqual(mentionQuery('@src\\re', 7), { start: 0, dir: 'src/', needle: 're' });
  assert.deepEqual(mentionQuery('@ab cd', 3), { start: 0, dir: '', needle: 'ab' });
  assert.equal(mentionQuery('@ab cd', 6), null);
});

test('filterMention: exact, then starts-with, then the rest, twelve at most', () => {
  const entries = [
    { name: 'src', kind: 'dir' as const },
    { name: 'scripts', kind: 'dir' as const },
    { name: 'notes.md', kind: 'file' as const },
    { name: 'docs', kind: 'dir' as const },
  ];
  assert.deepEqual(
    filterMention(entries, 's').map((e) => e.name),
    ['src', 'scripts', 'docs', 'notes.md'],
  );
  assert.deepEqual(
    filterMention([{ name: 'srcs', kind: 'dir' as const }, ...entries], 'src').map((e) => e.name),
    ['src', 'srcs'],
  );
  const many = Array.from({ length: 14 }, (_, i) => ({ name: `f${i}.ts`, kind: 'file' as const }));
  assert.equal(filterMention(many, '').length, MENTION_ROWS);
  assert.equal(MENTION_ROWS, 12);
});

test('mentionText and relativeMention', () => {
  assert.equal(mentionText('a b/c.ts'), '@"a b/c.ts"');
  assert.equal(mentionText('src/a.ts'), '@src/a.ts');
  assert.equal(relativeMention('C:\\w\\zorca', 'C:\\W\\Zorca\\src\\a.ts'), 'src/a.ts');
  assert.equal(relativeMention('C:\\w\\zorca\\', 'C:\\w\\zorca'), '.');
  assert.equal(relativeMention('C:\\w\\zorca', 'D:\\x\\y.ts'), 'D:/x/y.ts');
  assert.equal(relativeMention('C:\\w\\zorca', 'C:\\w\\zorca-old\\y.ts'), 'C:/w/zorca-old/y.ts');
});

test('the image helpers: quotedPath, pastedPath, isImageName, fileHref, imageMarkers', () => {
  assert.equal(quotedPath('C:\\a b\\c.png'), '"C:\\a b\\c.png"');
  assert.equal(quotedPath('C:\\ab\\c.png'), 'C:\\ab\\c.png');
  assert.equal(pastedPath('C:\\a b\\c.png'), '\x1b[200~"C:\\a b\\c.png"\x1b[201~');
  for (const p of ['a.PNG', 'b.jpeg', 'c.webp', 'd.jpg', 'e.gif']) assert.equal(isImageName(p), true, p);
  for (const p of ['d.svg', 'e.png.txt']) assert.equal(isImageName(p), false, p);
  assert.equal(fileHref('C:\\a b\\#1.png'), 'file:///C:/a%20b/%231.png');
  assert.deepEqual(imageMarkers(['❯ [Image #1] [Image #3] hi']), [1, 3]);
  assert.deepEqual(imageMarkers(['❯ hi', '']), []);
  assert.equal(IMAGE_PASTE_KEY, null);
});

// M9 fix 753: the fold row's tone, from the folded calls. The import sits
// here so the three chat branches' imports do not meet on one line.
import { foldTone } from './chat-model.ts';
import type { ToolStep } from './chat-model.ts';

const foldOf = (steps: Step[]) => {
  const fold = timelineItems(steps, 'normal', false).find((i) => i.kind === 'fold');
  return fold?.kind === 'fold' ? fold.tone : null;
};

test('foldTone: the last call failed reads error', () => {
  assert.equal(foldOf([tool('Bash', res({ exitCode: 0 })), tool('Bash', res({ error: true, exitCode: 1 })), reply('broke')]), 'error');
});

test('foldTone: a failed Bash then a passing Edit reads done', () => {
  assert.equal(foldOf([tool('Bash', res({ error: true, exitCode: 1 })), tool('Edit', res({ added: 1, removed: 0 })), reply('fixed')]), 'done');
});

test('foldTone: a call with no result among passing ones reads pending', () => {
  const tools = [tool('Bash', res({ exitCode: 0 })), tool('Bash', null), tool('Edit', res({ added: 1, removed: 0 }))] as ToolStep[];
  assert.equal(foldTone(tools), 'pending');
  assert.equal(foldOf(tools), 'pending');
});

test('foldTone: the stub turn reads done', () => {
  assert.equal(foldOf(stubSteps()), 'done');
});

// M9 fix 754: the hint with messages queued, Claude Code's input read off
// its prompt row, and a queued step's place in a closed fold.
import { inputHolds, promptRowText } from './chat-model.ts';

test('hintText: the queued count while working, the ask still first', () => {
  assert.equal(hintText('working', 2), '2 queued · Up to edit');
  assert.equal(hintText('working', 1), '1 queued · Up to edit');
  assert.equal(hintText('needs-input', 1), 'The ask takes the keys');
  assert.equal(hintText('working', 0), 'Sent when the turn ends');
});

test('promptRowText: the last prompt row, and inputHolds reads text, not emptiness', () => {
  const rows = ['❯ an old line', 'some output', '──────', '❯ queued-a-77', '──────', '  ⏵⏵ accept edits on'];
  assert.equal(promptRowText(rows), 'queued-a-77');
  assert.equal(promptRowText(['no prompt here']), null);
  assert.equal(inputHolds(rows, 'queued-a-77'), true);
  assert.equal(inputHolds(rows, 'queued-b-77'), false);
  assert.equal(inputHolds(['❯ Press up to edit queued messages'], 'fix the footer'), false);
  assert.equal(inputHolds(['❯ '], ''), false);
});

test('timelineItems: a queued step stands after a closed fold like a reply', () => {
  const queuedStep: Step = { kind: 'queued', text: 'also this', at: null };
  const steps = [tool('Bash', res({ exitCode: 0 })), queuedStep, tool('Bash', res({ exitCode: 0 })), reply('done')];
  assert.deepEqual(
    timelineItems(steps, 'normal', false).map((i) => (i.kind === 'step' ? i.step.kind : i.kind)),
    ['fold', 'queued', 'text'],
  );
});

// M9 fix 743: the mode chip's menu and the stepping behind a pick.
test('MODE_CHOICES: the four modes in order, each with Claude Code 2.1.301 line', () => {
  assert.deepEqual(MODE_CHOICES.map((c) => c.word), ['Manual', 'Accept edits', 'Plan', 'Auto']);
  assert.deepEqual(MODE_CHOICES.map((c) => c.line), [
    'ask each time',
    'auto-approve file edits and common file commands',
    'research and propose changes without making them',
    'no routine prompts; a reviewer model screens actions',
  ]);
});

test('stepModeTo: presses until the footer reads the target, five at most, and stops when cancelled', async () => {
  const manual = ['  ⏸ manual mode on · ← 1 agent'];
  const accept = ['  ⏵⏵ accept edits on (shift+tab to cycle) · ← 1 agent'];
  const plan = ['  ⏸ plan mode on (shift+tab to cycle) · ← 1 agent'];
  const wait = () => Promise.resolve();
  let pressed = 0;
  const cycle = [manual, accept, plan];
  const got = await stepModeTo('Plan', { press: () => (pressed += 1), read: () => Promise.resolve(cycle[pressed]!), wait, cancelled: () => false });
  assert.deepEqual(got, { reached: true, presses: 2, cancelled: false });
  assert.equal(pressed, 2);
  const never = await stepModeTo('Auto', { press: () => {}, read: () => Promise.resolve(plan), wait, cancelled: () => false });
  assert.deepEqual(never, { reached: false, presses: 5, cancelled: false });
  const broken = await stepModeTo('Plan', { press: () => {}, read: () => Promise.reject(new Error('no pane')), wait, cancelled: () => false });
  assert.deepEqual(broken, { reached: false, presses: 5, cancelled: false });
  let n = 0;
  const gone = await stepModeTo('Plan', { press: () => (n += 1), read: () => Promise.resolve(manual), wait, cancelled: () => n >= 1 });
  assert.deepEqual(gone, { reached: false, presses: 1, cancelled: true });
});

// M9 fix 744: the model chip's menu and the effort it shows after a pick.
test('MODEL_CHOICES: the aliases in order, each one /model takes on Claude Code 2.1.301', () => {
  assert.deepEqual(MODEL_CHOICES.map((c) => c.alias), ['default', 'opus', 'opus[1m]', 'sonnet', 'sonnet[1m]', 'haiku', 'fable', 'fable[1m]', 'opusplan']);
  // The bundle's own list beside `/model`'s usage line, at 2.1.301.
  const t4 = ['sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan'];
  for (const c of MODEL_CHOICES) if (c.alias !== 'default') assert.ok(t4.includes(c.alias), c.alias);
  assert.deepEqual([...EFFORT_LEVELS], ['low', 'medium', 'high', 'xhigh', 'max']);
});

// M9 fix 786: the model menu ticks the session's model, or shows it first.
test('modelItems: a listed name ticks its row; an unlisted one comes first, ticked, as Current model', () => {
  const listed = modelItems('Sonnet 5.5', MODEL_CHOICES);
  assert.equal(listed.length, 9);
  assert.deepEqual(listed.filter((r) => r.checked).map((r) => r.name), ['Sonnet 5.5']);
  assert.ok(listed.every((r) => typeof r.alias === 'string'));
  const unlisted = modelItems('Opus 9.9', MODEL_CHOICES);
  assert.equal(unlisted.length, 10);
  assert.deepEqual(unlisted[0], { alias: null, name: 'Opus 9.9', line: 'Current model', checked: true });
  assert.ok(unlisted.slice(1).every((r) => !r.checked));
  assert.deepEqual(unlisted.slice(1).map((r) => r.name), MODEL_CHOICES.map((c) => c.name));
  // No family tick: a newer Opus is not Opus 5.5.
  const newer = modelItems('Opus 5.6', MODEL_CHOICES);
  assert.equal(newer[0]!.name, 'Opus 5.6');
  assert.equal(newer.find((r) => r.name === 'Opus 5.5')!.checked, false);
  const none = modelItems(null, MODEL_CHOICES);
  assert.equal(none.length, 9);
  assert.ok(none.every((r) => !r.checked));
});

// M9 fix 785: the view chip waits for a step the mode changes.
test('viewChipShown: a tool call or a thinking step, never prompts and replies alone', () => {
  assert.equal(viewChipShown([]), false);
  assert.equal(viewChipShown([turnOf([{ kind: 'text', text: 'Hello.', at: null }])]), false);
  assert.equal(viewChipShown([turnOf([{ kind: 'queued', text: 'x', at: null }, { kind: 'note', text: 'Interrupted', at: null }])]), false);
  assert.equal(viewChipShown([turnOf([{ kind: 'text', text: 'Hello.', at: null }]), turnOf([{ kind: 'thinking', text: '', ms: 6000, at: null }])]), true);
  assert.equal(viewChipShown([turnOf([tool('Bash', null)])]), true);
});

test('effortShown: the transcript effort, or a pick until a later assistant line says one (M9 fix 770: read against the fold)', () => {
  const asst = (extra: Record<string, unknown>) => JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [] }, ...extra });
  const folded = (text: string) => {
    const state = effortState();
    effortFold(state, text);
    return state;
  };
  const before = `${asst({ effort: 'high' })}\n`;
  const pick = { level: 'low', assistants: folded(before).assistants };
  assert.equal(effortShown(folded(before), null), 'high');
  assert.equal(effortShown(folded(before), pick), 'low');
  assert.equal(effortShown(folded(`${before}${asst({ effort: 'medium' })}\n`), pick), 'medium');
  assert.equal(effortShown(folded(`${before}${asst({})}\n`), pick), 'low');
});

test('promptRowImages: the markers on the prompt row alone (M9 fix 748)', () => {
  // The rows of chat-claims-713.raw.json's `around` reads, the folder row
  // renamed.
  const head = [' ▐▛███▛█   Claude Code v2.1.300', '▝▜██████▀  Opus 5.5 · Claude Max', ' ▝▝   ▝▝   ~\\code\\project'];
  const rule = '─'.repeat(82);
  const bare = [...head, rule, '❯ [Image #2]', rule, '  ⏸ manual mode on'];
  const cleared = [...head, rule, '❯ Try "how do I log an error?"', rule, '  ⏸ manual mode on · ← 1 agent'];
  assert.deepEqual(promptRowImages(bare), [2]);
  assert.equal(promptRow(bare), '❯ [Image #2]');
  assert.deepEqual(promptRowImages(cleared), []);
  // A sent prompt's marker in the scrollback is not the prompt's.
  const sentAbove = [...head, '❯ [Image #4] describe this image in one word', '⏺ Red', rule, '❯ Try "how do I log an error?"', rule, '  ⏸ manual mode on'];
  assert.deepEqual(promptRowImages(sentAbove), []);
  assert.deepEqual(imageMarkers(sentAbove), [4]);
  const freshBelow = [...head, '❯ [Image #4] describe this image in one word', '⏺ Red', rule, '❯ [Image #5]', rule, '  ⏸ manual mode on'];
  assert.deepEqual(promptRowImages(freshBelow), [5]);
  assert.deepEqual(promptRowImages(['', 'no prompt']), []);
  assert.equal(promptRow(['', 'no prompt']), null);
});

// M9 fix 782: the pending bubble's match and words.
const promptTurn = (prompt: string, steps: Step[] = []): StepTurn => ({ prompt, at: null, endAt: null, steps, images: [] });

test('pendingKey strips the image markers and collapses whitespace (M9 fix 782)', () => {
  assert.equal(pendingKey('[Image #2]  fix\n  it '), 'fix it');
  assert.equal(pendingKey('fix it'), 'fix it');
});

test('pendingAfter matches a message by its landed prompt, an image marker and all (M9 fix 782)', () => {
  const item = pendingItem(1, 'fix it', 0, [], new Map());
  assert.deepEqual(pendingAfter([item], landedCounts([promptTurn('[Image #1] fix it')], [])), []);
  assert.deepEqual(pendingAfter([item], landedCounts([promptTurn('something else')], [])), [item]);
});

test('two identical messages with one landed prompt: the first goes, the second stays (M9 fix 782)', () => {
  const first = pendingItem(1, 'again', 0, [], new Map());
  const second = pendingItem(2, 'again', 0, [first], new Map());
  assert.equal(second.seen, 1);
  assert.deepEqual(pendingAfter([first, second], landedCounts([promptTurn('again')], [])), [second]);
});

test('an item whose seen already counts an earlier identical prompt stays (M9 fix 782)', () => {
  const counts = landedCounts([promptTurn('again')], []);
  const item = pendingItem(1, 'again', 0, [], counts);
  assert.equal(item.seen, 1);
  assert.deepEqual(pendingAfter([item], counts), [item]);
  assert.deepEqual(pendingAfter([item], landedCounts([promptTurn('again'), promptTurn('again')], [])), []);
});

test('a queued message, and later a queued step, each match (M9 fix 782)', () => {
  const item = pendingItem(1, 'also this', 0, [], landedCounts([promptTurn('go')], []));
  assert.deepEqual(pendingAfter([item], landedCounts([promptTurn('go')], [{ text: 'also this' }])), []);
  assert.deepEqual(pendingAfter([item], landedCounts([promptTurn('go', [{ kind: 'queued', text: 'also this', at: null }])], [])), []);
});

test('drawsPending is false for a command, bash mode, the memory key and an empty text (M9 fix 782)', () => {
  for (const text of ['/compact', '!ls', '# note', '   ', '']) assert.equal(drawsPending(text), false, JSON.stringify(text));
  assert.equal(drawsPending('fix the bug'), true);
});

test('pendingWords: refused, Not seen yet at 15 s after the later of the send and the quiet, else Sending (M9 fix 782)', () => {
  const item = pendingItem(1, 'fix it', 1000, [], new Map());
  assert.deepEqual(pendingWords({ ...item, refusal: 'Resume it first' }, 1000, 0), { state: 'refused', words: 'Resume it first' });
  assert.equal(pendingWords(item, 1000 + PENDING_UNSEEN_MS - 1, 0).state, 'sending');
  assert.deepEqual(pendingWords(item, 1000 + PENDING_UNSEEN_MS, 0), { state: 'unseen', words: 'Not seen yet' });
  // Quiet since after the send: counted from the quiet.
  assert.equal(pendingWords(item, 5000 + PENDING_UNSEEN_MS - 1, 5000).state, 'sending');
  assert.equal(pendingWords(item, 5000 + PENDING_UNSEEN_MS, 5000).state, 'unseen');
  // While the session works or asks, never unseen.
  assert.equal(pendingWords(item, 1000 + 10 * PENDING_UNSEEN_MS, null).state, 'sending');
});

// M9 fix 778: the carry helper's read of Claude Code's input.
import { carryRead } from './chat-model.ts';

test('carryRead: none for no prompt row, an empty input and the four stock placeholders', () => {
  const rule = '─'.repeat(40);
  const at = (row: string) => ({ rows: ['● done', rule, row, rule, '  ⏵⏵ accept edits on'], cursor: { x: 2, y: 2 } });
  assert.deepEqual(carryRead({ rows: ['no prompt here'], cursor: { x: 0, y: 0 } }), { kind: 'none' });
  assert.deepEqual(carryRead(at('❯')), { kind: 'none' });
  assert.deepEqual(carryRead(at('❯ Try "how does session.ts work?"')), { kind: 'none' });
  assert.deepEqual(carryRead(at('❯ Press up to edit queued messages')), { kind: 'none' });
  assert.deepEqual(carryRead(at('❯ Press Enter to edit the selected message')), { kind: 'none' });
  assert.deepEqual(carryRead(at('❯ Message @agent…')), { kind: 'none' });
  const tryRow = '❯ Try "x"';
  assert.deepEqual(carryRead({ ...at(tryRow), ghost: { y: 2, x: tryRow.indexOf('Try'), text: 'Try "x"' } }), { kind: 'none' });
});

test('carryRead: text, blocked, and the ghost cut', () => {
  const rule = '─'.repeat(40);
  const at = (row: string, under = rule) => ({ rows: ['● done', rule, row, under, '  ⏵⏵ accept edits on'], cursor: { x: 2, y: 2 } });
  assert.deepEqual(carryRead(at('❯ fix the login')), { kind: 'text', text: 'fix the login' });
  assert.deepEqual(carryRead(at('❯ look at [Image #1]')), { kind: 'blocked' });
  assert.deepEqual(carryRead(at('❯ [Pasted text #1 +40 lines]')), { kind: 'blocked' });
  assert.deepEqual(carryRead(at('❯ fix the login and then', '  the logout too')), { kind: 'blocked' });
  const row = '❯ fix the login';
  assert.deepEqual(carryRead({ ...at(row), ghost: { y: 2, x: row.indexOf(' the login'), text: ' the login' } }), { kind: 'text', text: 'fix' });
  // A ghost on another row cuts nothing, and a present null strips nothing.
  assert.deepEqual(carryRead({ ...at(row), ghost: { y: 0, x: 1, text: 'x' } }), { kind: 'text', text: 'fix the login' });
  assert.deepEqual(carryRead({ ...at('❯ Try "x"'), ghost: null }), { kind: 'text', text: 'Try "x"' });
});

test('carryRead: with expect, the whole prompt over two rows, and never a placeholder', () => {
  const rule = '─'.repeat(40);
  const prompt = 'Count from 1 to 300, one number per line, slowly.';
  const held = { rows: ['● 1', rule, `❯ ${prompt.slice(0, 40)}`, prompt.slice(40), rule], cursor: { x: 2, y: 3 } };
  assert.deepEqual(carryRead(held, prompt), { kind: 'text', text: prompt });
  // Without the expect the same input runs past one row.
  assert.deepEqual(carryRead(held), { kind: 'blocked' });
  assert.deepEqual(carryRead({ rows: ['● 1', rule, '❯ Try "refactor x"', rule], cursor: { x: 2, y: 2 } }, prompt), { kind: 'none' });
  assert.deepEqual(carryRead({ rows: ['● 1', rule, '❯', rule], cursor: { x: 2, y: 2 } }, prompt), { kind: 'none' });
});

test('carryRead with no expect, the CLI face carry: text, the 2.1.301 placeholders, the ghost, the markers and two rows (M9 fix 784)', () => {
  const rule = '─'.repeat(60);
  const cliAt = (row: string, under = rule) => ({ rows: ['● Ready.', '', rule, row, under, '  ⏵⏵ accept edits on'], cursor: { x: 2, y: 3 } });
  assert.deepEqual(carryRead(cliAt('❯ hello from the cli')), { kind: 'text', text: 'hello from the cli' });
  assert.deepEqual(carryRead(cliAt('❯')), { kind: 'none' });
  for (const row of ['❯ Try "fix lint errors"', '❯ Try "how does <filepath> work?"', '❯ Press up to edit queued messages', '❯ Message @agent…']) assert.deepEqual(carryRead(cliAt(row)), { kind: 'none' }, row);
  assert.deepEqual(carryRead({ ...cliAt('❯ Try "fix lint errors"'), ghost: { y: 3, x: 2, text: 'Try "fix lint errors"' } }), { kind: 'none' });
  assert.deepEqual(carryRead(cliAt('❯ [Image #1] look')), { kind: 'blocked' });
  assert.deepEqual(carryRead(cliAt('❯ [Pasted text #1 +12 lines]')), { kind: 'blocked' });
  // Contract 2's x is the index where rows[y].slice(x) starts with the ghost's text (6 here; the plan's 7 would cut inside it).
  const suggested = '❯ fix run the tests';
  assert.deepEqual(carryRead({ ...cliAt(suggested), ghost: { y: 3, x: suggested.indexOf('run the tests'), text: 'run the tests' } }), { kind: 'text', text: 'fix' });
  // Decision 4 (b): an input past one row stays in the terminal.
  assert.deepEqual(carryRead(cliAt('❯ line one', '  line two')), { kind: 'blocked' });
});

// M9 fix 778: Stop's carry on both routes. A typed prompt comes back to
// the input and is carried out of it; a prompt the mod submitted never sat
// in the input, so an empty input after a turn that drew nothing takes the
// turn's prompt (fails before the close-out's fix: nothing moved).
import { stopCarry } from './chat-model.ts';

test('stopCarry: the input when it holds the prompt, the turn\'s prompt when it is empty and nothing came, else nothing', () => {
  const quiet = { steps: [] };
  const answered = { steps: [{ kind: 'text', text: '1\n2\n3', at: null }] };
  assert.equal(stopCarry({ kind: 'text', text: 'count to 300' }, quiet), 'input');
  assert.equal(stopCarry({ kind: 'text', text: 'count to 300' }, answered), 'input');
  assert.equal(stopCarry({ kind: 'none' }, quiet), 'prompt');
  assert.equal(stopCarry({ kind: 'none' }, answered), 'none');
  assert.equal(stopCarry({ kind: 'none' }, null), 'none');
  assert.equal(stopCarry({ kind: 'blocked' }, quiet), 'none');
});
