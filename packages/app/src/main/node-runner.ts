import fs from 'node:fs';
import path from 'node:path';

// How the app runs a script as plain Node: the daemon it autostarts and the
// CLI it calls for hooks. 'self' runs it under this process's own executable
// as Node, which is what an installed app does so it never depends on the
// machine's Node. 'node' prefers node.exe on PATH (development) and falls
// back to self; node-pty's N-API prebuild accepts either.
export type Runner = 'node' | 'self';

export interface NodeCommand {
  exe: string;
  env: NodeJS.ProcessEnv;
}

export function nodeCommand(runner: Runner): NodeCommand {
  const node = runner === 'self' ? null : findNode();
  const env = { ...process.env };
  if (node === null) env['ELECTRON_RUN_AS_NODE'] = '1';
  return { exe: node ?? process.execPath, env };
}

// The first node on the PATH: node.exe on Windows, node elsewhere (M9 fix
// 1025; a dev build off Windows fell back to self before).
export function findNode(pathVar: string = process.env['PATH'] ?? '', platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = fs.existsSync): string | null {
  const name = platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of pathVar.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}
