import fs from 'node:fs';
import path from 'node:path';
import type { SkillEntry } from '../preload/api.ts';

// M9 fix 719: the skills the chat box's `/` menu offers, read off disk as
// Claude Code finds them: the session folder's `.claude/skills` and the
// user's `<claude home>/skills`, one SKILL.md per child folder, its name
// and description from the frontmatter. Only that one folder is read for
// the project (no walk up to the repository root), and plugin skills are
// left out of this cut. No electron import, so node:test covers it.

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

// The project's skills first, then the user's, each in name order; a
// user skill of a name the project has is skipped, as the project's
// shadows it. At most MAX_ENTRIES in all.
export async function readSkills(claudeDir: string, folder: string | null): Promise<SkillEntry[]> {
  const project = folder === null ? [] : await readScope(path.join(folder, '.claude', 'skills'), 'project');
  const user = await readScope(path.join(claudeDir, 'skills'), 'user');
  const seen = new Set<string>();
  const out: SkillEntry[] = [];
  for (const s of [...project, ...user]) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    out.push(s);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}
