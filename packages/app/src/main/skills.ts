import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from './history.ts';
import type { SkillEntry } from '../preload/api.ts';

// M9 fixes 719 and 755: the skills the chat box's `/` menu offers, read off
// disk as Claude Code finds them: every `.claude/skills` from the session
// folder up to its repository root (never the home folder, whose skills are
// the user's), the main checkout's when the folder is a git worktree, the
// user's `<claude home>/skills`, and each enabled plugin's `skills`, named
// `<plugin>:<skill>`. One SKILL.md per child folder, its name and
// description from the frontmatter. Nothing here writes. No electron import,
// so node:test covers it.

const MAX_ENTRIES = 200;
const MAX_DESCRIPTION = 200;
const BLOCK_MARKERS = new Set(['>', '>-', '|', '|-']);

// The frontmatter's top-level pairs: the lines between a first `---` and
// the next. A value of `>`, `|` and their `-` forms takes the indented
// lines under it; a value in one pair of matching quotes loses them.
export function frontmatter(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return out;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return out;
  for (let i = 1; i < end; i += 1) {
    const m = /^([A-Za-z_][\w-]*):(.*)$/.exec(lines[i]!);
    if (m === null) continue;
    let value = m[2]!.trim();
    if (BLOCK_MARKERS.has(value)) {
      const block: string[] = [];
      while (i + 1 < end && (/^\s/.test(lines[i + 1]!) || lines[i + 1]!.trim() === '')) {
        i += 1;
        block.push(lines[i]!.trim());
      }
      value = block.join(' ');
    } else if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
      value = value.slice(1, -1);
    }
    out.set(m[1]!, value);
  }
  return out;
}

async function readScope(dir: string, scope: SkillEntry['scope']): Promise<SkillEntry[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const out: SkillEntry[] = [];
  for (const child of names) {
    const folder = path.join(dir, child);
    let text: string;
    try {
      if (!(await fs.promises.stat(folder)).isDirectory()) continue;
      text = await fs.promises.readFile(path.join(folder, 'SKILL.md'), 'utf8');
    } catch {
      continue;
    }
    const fm = frontmatter(text);
    const name = fm.get('name')?.trim() || child;
    const description = (fm.get('description') ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION);
    out.push({ name, description, scope });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const samePath = (a: string, b: string): boolean => {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

// The folders whose .claude/skills the project scope reads, nearest first.
async function projectLevels(folder: string, home: string): Promise<string[]> {
  const root = await repoRoot(folder);
  const levels: string[] = [];
  let level = path.resolve(folder);
  for (;;) {
    if (samePath(level, home)) break;
    levels.push(level);
    if (root !== null && samePath(level, root)) break;
    const up = path.dirname(level);
    if (up === level) break;
    level = up;
  }
  if (root !== null) {
    const main = await mainCheckout(root);
    if (main !== null) levels.push(main);
  }
  return levels;
}

// A worktree's .git is a file naming <main>/.git/worktrees/<name>.
async function mainCheckout(root: string): Promise<string | null> {
  try {
    const text = await fs.promises.readFile(path.join(root, '.git'), 'utf8');
    const m = /^gitdir:\s*(.+)$/m.exec(text);
    if (m === null) return null;
    const gitdir = path.resolve(root, m[1]!.trim());
    const parent = path.dirname(gitdir);
    if (path.basename(parent) !== 'worktrees' || path.basename(path.dirname(parent)) !== '.git') return null;
    return path.dirname(path.dirname(parent));
  } catch {
    return null;
  }
}

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function readPlugins(claudeDir: string): Promise<SkillEntry[]> {
  const installed = await readJson(path.join(claudeDir, 'plugins', 'installed_plugins.json'));
  const settings = await readJson(path.join(claudeDir, 'settings.json'));
  const out: SkillEntry[] = [];
  for (const key of Object.keys(installed?.plugins ?? {})) {
    if (settings?.enabledPlugins?.[key] !== true) continue;
    const list = installed.plugins[key];
    if (!Array.isArray(list)) continue;
    const entry = list.find((e: any) => typeof e?.installPath === 'string');
    if (entry === undefined) continue;
    const at = key.lastIndexOf('@');
    const plugin = at < 0 ? key : key.slice(0, at);
    const skills = await readScope(path.join(entry.installPath, 'skills'), 'plugin');
    for (const s of skills) out.push({ ...s, name: plugin + ':' + s.name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// The project's skills (nearest level first, a name met again skipped) in
// name order, then the user's less any name the project has, then the
// plugins', each in name order; at most MAX_ENTRIES in all.
export async function readSkills(claudeDir: string, folder: string | null, home: string = os.homedir()): Promise<SkillEntry[]> {
  const found: SkillEntry[] = [];
  if (folder !== null) {
    const names = new Set<string>();
    for (const level of await projectLevels(folder, home)) {
      for (const s of await readScope(path.join(level, '.claude', 'skills'), 'project')) {
        if (names.has(s.name)) continue;
        names.add(s.name);
        found.push(s);
      }
    }
    found.sort((a, b) => a.name.localeCompare(b.name));
  }
  const user = await readScope(path.join(claudeDir, 'skills'), 'user');
  const plugins = await readPlugins(claudeDir);
  const seen = new Set<string>();
  const out: SkillEntry[] = [];
  for (const s of [...found, ...user, ...plugins]) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push(s);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}
