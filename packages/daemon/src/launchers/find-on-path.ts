import fs from 'node:fs';
import path from 'node:path';

// Resolve an executable the way cmd.exe would, so the daemon spawns it
// directly instead of going through a shell (a shell in between would make
// PTY exit mean "shell exited", not "program exited").
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(path.delimiter).filter(Boolean);
  const exts = path.extname(name) ? [''] : (env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';');
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
