import fs from 'node:fs';
import path from 'node:path';
import { movesHead } from '@emerald/shared';
import { findGitDir } from './git-branch.ts';
import { gitText } from './git-runner.ts';

// The rule for which Bash commands can move HEAD (M49) lives in shared
// since M53, where the transcript view counts a turn's commits by it;
// re-exported so the manager and the test keep their import.
export { movesHead };

const TIMEOUT_MS = 5000;

// A Bash command that only reads the repository (M9 fix 311): a gate
// poll (`git rev-list --count main..fix-x`) in a checkout another
// session is merging into found HEAD moved between its two reads and
// was credited the merge. Such a call is measured by nobody: every part
// of the command (split on the shell's joins and pipes, a leading `cd`
// and env assignments set aside) is one of the git reads named here, or
// a plain filter a git read is piped through. Anything else, a script,
// a `git branch -d`, a git read piped into something unknown, stays
// measured as fix 195 has it, since a false "read" here loses a commit
// and a false "measured" costs one rev-parse.
const GIT_READS = new Set(['rev-list', 'log', 'status', 'diff', 'show', 'rev-parse']);
const BRANCH_WRITES = new Set(['-d', '-D', '-m', '-M', '--delete', '--move', '-c', '-C', '--copy']);
const FILTERS = new Set(['head', 'tail', 'grep', 'wc', 'cat', 'sort', 'uniq', 'cut', 'tr', 'awk', 'sed', 'less', 'more', 'findstr', 'select-object', 'measure-object', 'select-string', 'out-string']);

export function readsOnly(command: string): boolean {
  if (movesHead(command)) return false;
  const parts = command.split(/&&|\|\||[;|\n]/).map((p) => p.trim()).filter((p) => p !== '');
  const rest = parts.filter((p) => !/^cd(\s|$)/.test(p));
  if (rest.length === 0) return false;
  let gits = 0;
  for (const part of rest) {
    const words = part.split(/\s+/);
    let i = 0;
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!)) i += 1;
    const name = words[i]?.toLowerCase();
    if (name === undefined) return false;
    if (name !== 'git') {
      if (gits === 0 || !FILTERS.has(name)) return false;
      continue;
    }
    i += 1;
    // git's own options before the subcommand: -C <dir>, -c k=v, --no-pager.
    while (i < words.length && words[i]!.startsWith('-')) i += words[i] === '-C' || words[i] === '-c' ? 2 : 1;
    const sub = words[i];
    const args = words.slice(i + 1);
    if (sub === undefined) return false;
    if (GIT_READS.has(sub)) gits += 1;
    else if (sub === 'branch' && !args.some((a) => BRANCH_WRITES.has(a))) gits += 1;
    else if (sub === 'worktree' && args[0] === 'list') gits += 1;
    else return false;
  }
  return gits > 0;
}

// The full hash HEAD points at, or null outside a repository, with no
// commits yet, or when git is missing or slow: the record is decoration
// and never something to fail a session over. --no-optional-locks keeps
// the read from touching the index while a commit may still be running.
// Run on the git worker thread (git-runner.ts, M9 fix 226), as every
// git here is, so the spawn never holds the daemon's loop.
export async function readHead(cwd: string): Promise<string | null> {
  const stdout = await gitText(['--no-optional-locks', 'rev-parse', 'HEAD'], cwd, TIMEOUT_MS);
  if (stdout === null) return null;
  const hash = stdout.trim();
  return /^[0-9a-f]{40}$/.test(hash) ? hash : null;
}

// The same hash off the files, no git process (M9 fix 195): .git/HEAD
// (a worktree's .git file followed to its gitdir, as readBranch does),
// then the branch's loose ref under the common dir, then its line in
// packed-refs. Since fix 195 HEAD is held and read around every Bash
// call in a repository, not only the ones whose text names a git
// write, so the read has to cost nothing. null when the files do not
// say (no repository, no commit yet, a ref spelling this does not
// know), and the caller falls back to readHead.
export function readHeadFile(dir: string): string | null {
  const gitDir = findGitDir(dir);
  if (gitDir === null) return null;
  const head = readText(path.join(gitDir, 'HEAD'))?.trim();
  if (head === undefined) return null;
  if (/^[0-9a-f]{40}$/i.test(head)) return head.toLowerCase();
  const ref = /^ref:\s*(refs\/\S+)$/.exec(head)?.[1];
  if (ref === undefined) return null;
  // A linked worktree keeps its own HEAD but shares the refs with the
  // repository, which its commondir file points at.
  const commonDir = readText(path.join(gitDir, 'commondir'))?.trim();
  const common = commonDir === undefined ? gitDir : path.resolve(gitDir, commonDir);
  const loose = readText(path.join(common, ...ref.split('/')))?.trim();
  if (loose !== undefined && /^[0-9a-f]{40}$/i.test(loose)) return loose.toLowerCase();
  const packed = readText(path.join(common, 'packed-refs'));
  if (packed === undefined) return null;
  for (const line of packed.split('\n')) {
    const m = /^([0-9a-f]{40})\s+(\S+)$/i.exec(line.trim());
    if (m !== null && m[2] === ref) return m[1]!.toLowerCase();
  }
  return null;
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

// The commits from before to after along the first parents (M58), oldest
// first: what a commit, a rebase or a merge added to the branch, without
// the merged branch's own commits. A null before (a repository with no
// commit yet) is the one commit after. Empty on any error, since the
// record is decoration.
//
// With a since (the call's PreToolUse time, M9 fix 470) only commits
// whose committer date is at or after it, less two seconds for git's
// whole-second stamps and a clock read on either side, are kept: a
// commit, a merge, a cherry-pick, an am and a rebase all write a fresh
// committer date, while a checkout, a reset or a fast-forward pull moves
// HEAD onto commits that already existed, which are not this call's work.
export async function revListFirstParent(cwd: string, before: string | null, after: string, since: number | null = null): Promise<string[]> {
  if (before === null) return [after];
  const format = since === null ? [] : ['--format=%H%x20%ct'];
  const stdout = await gitText(['--no-optional-locks', 'rev-list', '--first-parent', ...format, `${before}..${after}`], cwd, TIMEOUT_MS);
  if (stdout === null) return [];
  const lines = stdout.split('\n').map((l) => l.trim());
  if (since === null) return lines.filter((h) => /^[0-9a-f]{40}$/.test(h)).reverse();
  // --format prints a `commit <hash>` header above each formatted line;
  // only the formatted lines match.
  const hashes: string[] = [];
  for (const line of lines) {
    const m = /^([0-9a-f]{40}) (\d+)$/.exec(line);
    if (m !== null && Number(m[2]) * 1000 >= since - COMMIT_SLACK_MS) hashes.push(m[1]!);
  }
  return hashes.reverse();
}

const COMMIT_SLACK_MS = 2000;

// Which of the hashes are merges (M9 fix 218): one `rev-list --parents
// --no-walk` over the lot, a line per commit with its parents after it,
// so a claim of several commits costs one git, on the worker thread like
// the rest. The hashes go on stdin (M9 fix 476), since past about 780 of
// them the command line passed Windows' limit and every merge in the
// claim was recorded as a plain commit. Empty on any error; a hash not
// in the answer counts as a plain commit.
export async function readMerges(cwd: string, hashes: string[]): Promise<Set<string>> {
  const merges = new Set<string>();
  if (hashes.length === 0) return merges;
  const stdout = await gitText(['--no-optional-locks', 'rev-list', '--parents', '--no-walk', '--stdin'], cwd, TIMEOUT_MS, undefined, `${hashes.join('\n')}\n`);
  if (stdout === null) return merges;
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/).filter((h) => /^[0-9a-f]{40}$/.test(h));
    if (parts.length > 2) merges.add(parts[0]!);
  }
  return merges;
}

// The M61 name for the same walk, for a member's commits; before is never null there.
export function listFirstParent(cwd: string, before: string, after: string): Promise<string[]> {
  return revListFirstParent(cwd, before, after, null);
}
