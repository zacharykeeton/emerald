import fs from 'node:fs';
import path from 'node:path';

// A variable read whatever case the block spells its key in (M9 fix 999):
// Windows names are case-blind, and a block copied from a parent that
// spelled a key its own way (a `path`, a `comspec`) is read as cmd.exe would
// read it. A key spelled exactly as asked wins whenever it is present, even
// empty, so a block holding two spellings reads the one asked for.
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (name in env) return env[name];
  const upper = name.toUpperCase();
  const key = Object.keys(env).find((k) => k.toUpperCase() === upper);
  return key === undefined ? undefined : env[key];
}

// Resolve an executable the way cmd.exe would, so the daemon spawns it
// directly instead of going through a shell (a shell in between would make
// PTY exit mean "shell exited", not "program exited").
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = (envValue(env, 'PATH') ?? '').split(path.delimiter).filter(Boolean);
  const exts = path.extname(name) ? [''] : (envValue(env, 'PATHEXT') ?? '.EXE;.CMD;.BAT').split(';');
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null;
}
