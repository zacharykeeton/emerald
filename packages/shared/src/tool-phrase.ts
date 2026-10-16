import { summarize } from './state-machine.ts';

// The current tool call as a verb phrase for the row's agent line (M9 fix
// 79): while a turn runs and no assistant text has landed yet, the line
// reads what the pane reads, Claude Code's own line for the call it is
// making. The Bash tool's description is that line as it is; the other
// tools get one phrase each from the input that names their subject, and
// a call whose input names nothing, or a tool this table does not know,
// reads as `Running <tool>`, which is still more than a bare dot.

// What a PreToolUse hook's tool_input can carry that the phrases read.
export interface ToolInput {
  description?: unknown;
  command?: unknown;
  file_path?: unknown;
  notebook_path?: unknown;
  pattern?: unknown;
  url?: unknown;
  query?: unknown;
  skill?: unknown;
  subagent_type?: unknown;
  prompt?: unknown;
}

// The last segment of a path, either slash, so a phrase names the file
// and not the folder it sits in.
function baseName(value: unknown): string | null {
  const line = summarize(value);
  if (line === null) return null;
  const trimmed = line.replace(/[\\/]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const base = i === -1 ? trimmed : trimmed.slice(i + 1);
  return base === '' ? null : base;
}

// The host of a URL; the text itself when it does not read as one. A
// regex rather than the URL class, since shared code has no DOM lib.
function hostOf(value: unknown): string | null {
  const line = summarize(value);
  if (line === null) return null;
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(line);
  return m === null ? line : m[1]!;
}

const named = (verb: string, subject: string | null): string | null => (subject === null ? null : `${verb} ${subject}`);

function phraseFor(toolName: string, input: ToolInput): string | null {
  switch (toolName) {
    case 'Bash':
    case 'PowerShell':
      return summarize(input.description) ?? summarize(input.command);
    case 'Read':
      return named('Reading', baseName(input.file_path));
    case 'Edit':
    case 'MultiEdit':
      return named('Editing', baseName(input.file_path));
    case 'Write':
      return named('Writing', baseName(input.file_path));
    case 'NotebookEdit':
      return named('Editing', baseName(input.notebook_path));
    case 'Grep':
      return named('Searching for', summarize(input.pattern));
    case 'Glob':
      return named('Finding', summarize(input.pattern));
    case 'Agent':
    case 'Task':
      return named('Sending out an agent:', summarize(input.description)) ?? 'Sending out an agent';
    case 'WebFetch':
      return named('Fetching', hostOf(input.url));
    case 'WebSearch':
      return named('Searching the web for', summarize(input.query));
    case 'Skill': {
      const skill = summarize(input.skill);
      return skill === null ? null : `Running /${skill.replace(/^\//, '')}`;
    }
    default:
      return null;
  }
}

// The words of a permission ask (M9 fix 742), `<tool>: <subject>`, from
// the mod's ToolAsk: the tool's name as the dialog shows it and the first
// field of its input that names what it acts on, a file by its base name;
// the bare name when the input names nothing. Null for no name.
export function askWords(toolName: unknown, toolInput: unknown): string | null {
  if (typeof toolName !== 'string' || toolName.trim() === '') return null;
  const input: ToolInput = typeof toolInput === 'object' && toolInput !== null ? (toolInput as ToolInput) : {};
  const subject =
    summarize(input.command) ??
    baseName(input.file_path) ??
    baseName(input.notebook_path) ??
    summarize(input.url) ??
    summarize(input.pattern) ??
    summarize(input.query) ??
    summarize(input.skill) ??
    summarize(input.description);
  return subject === null ? toolName : `${toolName}: ${subject}`;
}

export function toolPhrase(toolName: unknown, toolInput: unknown): string | null {
  if (typeof toolName !== 'string' || toolName.trim() === '') return null;
  const input: ToolInput = typeof toolInput === 'object' && toolInput !== null ? (toolInput as ToolInput) : {};
  return phraseFor(toolName, input) ?? `Running ${toolName}`;
}
