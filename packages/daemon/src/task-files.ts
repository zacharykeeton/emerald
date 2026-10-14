import fs from 'node:fs/promises';
import path from 'node:path';
import { isSessionId, readTask, sortTasks } from '@emerald/shared';
import { claudeHome } from '@emerald/shared/claude-home';
import type { SessionTask } from '@emerald/shared';

// Claude Code's task list as it keeps it on disk (M9 fix 153): one JSON
// file per task under ~/.claude/tasks/<claude session id>/, written on
// every TaskCreate and TaskUpdate before the PostToolUse hook fires, so
// the folder is the truth about the list whenever the hooks did not
// build it: a conversation resumed into an emmer shell after its list was
// made, or a TaskUpdate naming a task the record lacks because the last
// prompt cleared the list and Claude carried on with it. A missing
// folder is no list; a file that is not a task is skipped.
// The home is shared's claudeHome (M9 fix 522), the same as the app's
// history scan: EMERALD_CLAUDE_HOME, so a verify script can seed a home of
// its own, else CLAUDE_CONFIG_DIR as Claude Code reads it, else ~/.claude.

export async function readTaskFiles(claudeSessionId: string, home: string = claudeHome()): Promise<SessionTask[]> {
  // The id is joined into the path, so a `..` in it would read any
  // folder's .json (M9 fix 508).
  if (!isSessionId(claudeSessionId)) return [];
  const dir = path.join(home, 'tasks', claudeSessionId);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const tasks: SessionTask[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const task = readTask(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')), path.basename(name, '.json'));
      if (task !== null) tasks.push(task);
    } catch {
      // A file mid-write or not JSON at all: the next read gets it.
    }
  }
  return sortTasks(tasks);
}
