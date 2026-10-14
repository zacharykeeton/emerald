import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolPhrase } from './tool-phrase.ts';

test('toolPhrase: Bash reads its description as it is, else the first line of the command', () => {
  assert.equal(toolPhrase('Bash', { command: 'cat docs/BACKLOG.md', description: 'Reading the backlog file' }), 'Reading the backlog file');
  assert.equal(toolPhrase('Bash', { command: '\n  git status\ngit log' }), 'git status');
  assert.equal(toolPhrase('PowerShell', { description: 'List the folder' }), 'List the folder');
  assert.equal(toolPhrase('Bash', {}), 'Running Bash');
});

test('toolPhrase: the file tools name the file, either slash', () => {
  assert.equal(toolPhrase('Read', { file_path: 'C:\\Users\\me\\code\\emerald\\docs\\BACKLOG.md' }), 'Reading BACKLOG.md');
  assert.equal(toolPhrase('Edit', { file_path: '/home/me/src/app.ts', old_string: 'a', new_string: 'b' }), 'Editing app.ts');
  assert.equal(toolPhrase('MultiEdit', { file_path: 'src/x.ts' }), 'Editing x.ts');
  assert.equal(toolPhrase('Write', { file_path: 'notes.md', content: '# hi' }), 'Writing notes.md');
  assert.equal(toolPhrase('NotebookEdit', { notebook_path: 'lab/run.ipynb' }), 'Editing run.ipynb');
  assert.equal(toolPhrase('Read', { file_path: '' }), 'Running Read');
});

test('toolPhrase: the search tools name the pattern, the web tools the host and the query', () => {
  assert.equal(toolPhrase('Grep', { pattern: 'liveReply', path: 'packages' }), 'Searching for liveReply');
  assert.equal(toolPhrase('Glob', { pattern: '**/*.test.ts' }), 'Finding **/*.test.ts');
  assert.equal(toolPhrase('WebFetch', { url: 'https://docs.example.com/a/b?c=1' }), 'Fetching docs.example.com');
  assert.equal(toolPhrase('WebFetch', { url: 'not a url' }), 'Fetching not a url');
  assert.equal(toolPhrase('WebSearch', { query: 'node fs.watch windows' }), 'Searching the web for node fs.watch windows');
});

test('toolPhrase: an agent, a skill, an unknown tool and no tool', () => {
  assert.equal(toolPhrase('Agent', { description: 'Explore the rail', subagent_type: 'Explore', prompt: '...' }), 'Sending out an agent: Explore the rail');
  assert.equal(toolPhrase('Agent', {}), 'Sending out an agent');
  assert.equal(toolPhrase('Skill', { skill: 'design' }), 'Running /design');
  assert.equal(toolPhrase('Skill', { skill: '/run' }), 'Running /run');
  assert.equal(toolPhrase('AskUserQuestion', { questions: [] }), 'Running AskUserQuestion');
  assert.equal(toolPhrase('Read', null), 'Running Read');
  assert.equal(toolPhrase('', {}), null);
  assert.equal(toolPhrase(undefined, {}), null);
});

test('toolPhrase: a long description is cut the way a prompt is', () => {
  const long = 'x'.repeat(300);
  const phrase = toolPhrase('Bash', { description: long });
  assert.equal(phrase?.length, 200);
  assert.ok(phrase?.endsWith('…'));
});
