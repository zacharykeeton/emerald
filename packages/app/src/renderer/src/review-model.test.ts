import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_REVIEW, branchLine, commentCount, keepDraft, openDraft, removeComment, reviewFile, reviewFolder, reviewFolderKey, reviewFolderPath, reviewPath, reviewPrompt, reviewSessionId, sendGate } from './review-model.ts';

test('reviewPath: a document per session, read back to the id', () => {
  const p = reviewPath('abc-123');
  assert.equal(p, 'emerald://review/abc-123');
  assert.equal(reviewSessionId(p), 'abc-123');
  assert.equal(reviewSessionId('emerald://activity/2026-09-13'), null);
  assert.equal(reviewSessionId('C:/x/y.ts'), null);
});

test('reviewPath (M9 fix 199): the file to show rides as a query the key leaves out, and a folder review is keyed by its folder', () => {
  const p = reviewPath('abc-123', 'src/a b.ts');
  assert.equal(p, 'emerald://review/abc-123?file=src%2Fa%20b.ts');
  assert.equal(reviewSessionId(p), 'abc-123', 'the query is not part of the id');
  assert.equal(reviewFile(p), 'src/a b.ts', 'off the path');
  assert.equal(reviewFile('file=src%2Fa%20b.ts'), 'src/a b.ts', 'off the query alone, as tabQuery hands it back');
  assert.equal(reviewFile(reviewPath('abc-123')), null);
  assert.equal(reviewFile(null), null);
  assert.equal(reviewFolder(p), null, 'a session review has no folder of its own');
  const f = reviewFolderPath('C:/code/emerald', 'README.md');
  assert.equal(f, 'emerald://review/folder/C%3A%5Ccode%5Cemerald?file=README.md');
  assert.equal(reviewSessionId(f), null, 'a folder review names no session');
  assert.equal(reviewFolder(f), 'C:\\code\\emerald', 'the folder back, normalized');
  assert.equal(reviewFile(f), 'README.md');
  assert.equal(reviewFolderKey('C:/Code/Emerald/'), 'folder:c:\\code\\emerald', 'one key per folder whatever the spelling');
});

test('keepDraft: one comment per line, sorted by file and line, an empty draft keeps nothing', () => {
  let s = openDraft(EMPTY_REVIEW, 'src/b.ts', 9, 'const b = 1;');
  s = { ...s, draft: { ...s.draft!, text: 'why one' } };
  s = keepDraft(s);
  assert.equal(s.draft, null);
  s = keepDraft({ ...openDraft(s, 'src/a.ts', 3, 'let a;'), draft: { rel: 'src/a.ts', line: 3, code: 'let a;', text: 'unused' } });
  assert.deepEqual(
    s.comments.map((c) => `${c.rel}:${c.line} ${c.text}`),
    ['src/a.ts:3 unused', 'src/b.ts:9 why one'],
  );
  // Opening the box on a commented line edits it; keeping replaces.
  const edit = openDraft(s, 'src/b.ts', 9, 'const b = 1;');
  assert.equal(edit.draft?.text, 'why one');
  s = keepDraft({ ...edit, draft: { ...edit.draft!, text: 'why two' } });
  assert.equal(s.comments.length, 2);
  assert.equal(s.comments[1]?.text, 'why two');
  // An emptied draft on a commented line removes the comment.
  s = keepDraft({ ...openDraft(s, 'src/b.ts', 9, 'x'), draft: { rel: 'src/b.ts', line: 9, code: 'x', text: '  ' } });
  assert.equal(s.comments.length, 1);
  s = removeComment(s, 'src/a.ts', 3);
  assert.equal(s.comments.length, 0);
});

test('commentCount: the kept ones plus a draft with text in it', () => {
  const kept = keepDraft({ ...EMPTY_REVIEW, draft: { rel: 'a', line: 1, code: 'c', text: 't' } });
  assert.equal(commentCount(kept), 1);
  assert.equal(commentCount({ ...kept, draft: { rel: 'a', line: 2, code: 'c', text: '' } }), 1, 'an empty box is not a comment');
  assert.equal(commentCount({ ...kept, draft: { rel: 'a', line: 2, code: 'c', text: 'more' } }), 2);
});

test('reviewPrompt: a block per comment in file order, the quoted line, the general comment last', () => {
  const comments = [
    { rel: 'packages/app/src/renderer/src/TranscriptView.tsx', line: 120, code: '      <span className="transcript-facts">{facts}</span>', text: 'the facts line wants the branch when the transcript has it' },
    { rel: 'packages/shared/src/transcript.ts', line: 41, code: "  if (typeof line.message.content === 'string') {", text: 'a tool result line has string content too, this counts it as a prompt' },
  ];
  const text = reviewPrompt(comments, 'the tests do not cover the empty transcript', 'HEAD');
  assert.equal(
    text,
    [
      'Review of 2 files, against HEAD:',
      '',
      'packages/app/src/renderer/src/TranscriptView.tsx:120',
      '    <span className="transcript-facts">{facts}</span>',
      'the facts line wants the branch when the transcript has it',
      '',
      'packages/shared/src/transcript.ts:41',
      "    if (typeof line.message.content === 'string') {",
      'a tool result line has string content too, this counts it as a prompt',
      '',
      'Overall: the tests do not cover the empty transcript',
    ].join('\n'),
  );
  assert.equal(reviewPrompt([comments[1]!], '', 'main'), `Review of 1 file, against main:\n\npackages/shared/src/transcript.ts:41\n    if (typeof line.message.content === 'string') {\na tool result line has string content too, this counts it as a prompt`);
  assert.equal(reviewPrompt([], 'looks fine', 'HEAD'), 'Review, against HEAD:\n\nOverall: looks fine');
});

test('branchLine: the branch, the file count and the summed counts', () => {
  assert.equal(branchLine('m53', [{ added: 80, removed: 10 }, { added: 4, removed: 2 }, { added: null, removed: null }]), '⑂ m53 · 3 files, +84 −12');
  assert.equal(branchLine(null, [{ added: 1, removed: 0 }]), '1 file, +1 −0');
  assert.equal(branchLine('main', [{ added: null, removed: null }]), '⑂ main · 1 file', 'a binary alone has no counts');
  assert.equal(branchLine('main', []), '⑂ main · 0 files');
});

test('sendGate: off at needs-input and exited and with nothing to send, a note while working', () => {
  assert.deepEqual(sendGate({ state: 'needs-input' }, 2), { enabled: false, note: 'Answer what it is waiting on first' });
  assert.deepEqual(sendGate({ state: 'exited' }, 2), { enabled: false, note: 'Resume it first' });
  assert.deepEqual(sendGate({ state: 'idle' }, 0), { enabled: false, note: null });
  assert.deepEqual(sendGate({ state: 'idle' }, 1), { enabled: true, note: null });
  assert.deepEqual(sendGate({ state: 'working' }, 1), { enabled: true, note: 'queues behind this turn' });
  assert.deepEqual(sendGate({ state: 'done' }, 1), { enabled: true, note: null });
});
