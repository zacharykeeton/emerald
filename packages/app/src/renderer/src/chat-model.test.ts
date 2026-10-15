import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Step, StepResult, StepTurn } from '@emerald/shared';
import { IMAGE_PASTE_KEY, MENTION_ROWS, SENT_COMMANDS, TERMINAL_COMMANDS, agentChipText, askHeading, faceOf, fileHref, filterMention, filterSlash, foldText, hintText, imageMarkers, isImageName, mentionQuery, mentionText, modeOf, modelChipText, nextChatMode, opensMenu, parseChatModes, parseChatPanes, pastedPath, quotedPath, relativeMention, serializeChatPanes, sessionDiff, slashQuery, slashRows, spinnerOf, timelineItems } from './chat-model.ts';
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

test('opensMenu: a picker command first in the box, case-sensitive', () => {
  assert.equal(opensMenu('/model'), true);
  assert.equal(opensMenu(' /model opus'), true);
  assert.equal(opensMenu('/compact'), false);
  assert.equal(opensMenu('model'), false);
  assert.equal(opensMenu('/Model'), false);
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
const turnOf = (steps: Step[]): StepTurn => ({ prompt: 'p', at: null, endAt: null, steps });

test('sessionDiff: the edits that came back, summed over the turns', () => {
  const turns = [turnOf([tool('Edit', res({ added: 6, removed: 2 })), tool('Bash', res({ exitCode: 0 }))]), turnOf([tool('Write', res({ added: 3, removed: 0 }))])];
  assert.deepEqual(sessionDiff(turns), { added: 9, removed: 2 });
  assert.deepEqual(sessionDiff([turnOf([tool('Edit', res({ error: true, added: 4, removed: 1 })), tool('Edit', null)])]), { added: 0, removed: 0 });
  assert.deepEqual(sessionDiff([turnOf([tool('Bash', res({ exitCode: 1 }))])]), { added: 0, removed: 0 });
  assert.deepEqual(sessionDiff([]), { added: 0, removed: 0 });
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
  assert.deepEqual(normal[0], { kind: 'fold', count: 3, names: ['Bash', 'Bash', 'Edit'], added: 6, removed: 2, open: false });
  assert.deepEqual(shape(timelineItems(steps, 'thinking', false)), ['thinking', 'fold', 'text']);
  assert.deepEqual(shape(timelineItems(steps, 'verbose', false)), ['thinking', 'Bash', 'Bash', 'Edit', 'text']);
  assert.deepEqual(shape(timelineItems(steps, 'normal', true)), ['fold(open)', 'Bash', 'Bash', 'Edit', 'text']);
});

test('timelineItems: the thinking above the fold, no fold without tools, images after a closed fold', () => {
  const steps = [think(1000), tool('Bash', res({ exitCode: 0 })), think(2000), tool('Edit', res({ added: 1, removed: 0 })), reply('ok')];
  assert.deepEqual(shape(timelineItems(steps, 'thinking', false)), ['thinking', 'thinking', 'fold', 'text']);
  assert.deepEqual(shape(timelineItems([think(1000), reply('hi')], 'normal', false)), ['text']);
  const img = tool('Read', res({ image: { mediaType: 'image/png', bytes: 2048 } }));
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
  const sent = (name: string, skill = false): SlashRow => ({ name, description: '', section: 'sent', skill });
  const term = (name: string): SlashRow => ({ name, description: '', section: 'terminal', skill: false });
  const rows = [sent('/recap'), sent('/compact'), sent('/clear'), sent('/code-review', true), term('/config'), term('/model')];
  const names = (q: string) => filterSlash(rows, q).map((r) => `${r.section}:${r.name}`);
  assert.deepEqual(names(''), rows.map((r) => `${r.section}:${r.name}`));
  assert.deepEqual(names('c'), ['sent:/compact', 'sent:/clear', 'sent:/code-review', 'sent:/recap', 'terminal:/config']);
  assert.deepEqual(names('model'), ['terminal:/model']);
  assert.deepEqual(names('CO'), names('co'));
  assert.deepEqual(names('clear'), ['sent:/clear']);
});

test('SENT_COMMANDS: the five built-ins in order, and slashRows puts the skills after them', () => {
  assert.deepEqual(
    SENT_COMMANDS.map((c) => c.name),
    ['/compact', '/clear', '/init', '/recap', '/reload-skills'],
  );
  const rows = slashRows([
    { name: 'alpha', description: 'a' },
    { name: 'compact', description: 'shadowed by the built-in' },
  ]);
  assert.deepEqual(
    rows.filter((r) => r.section === 'sent').map((r) => [r.name, r.skill]),
    [['/compact', false], ['/clear', false], ['/init', false], ['/recap', false], ['/reload-skills', false], ['/alpha', true]],
  );
  assert.deepEqual(
    rows.filter((r) => r.section === 'terminal').map((r) => r.name),
    [...TERMINAL_COMMANDS],
  );
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
