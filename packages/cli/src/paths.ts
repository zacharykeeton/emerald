import path from 'node:path';
import { pipePathOf, emeraldHomeOf } from '@emerald/shared/pipe-name';

// Same overrides the daemon honours, so a CLI pointed at a private home
// (EMERALD_HOME, with or without EMERALD_PIPE) never touches the real one.
export function emeraldHome(): string {
  return emeraldHomeOf(process.env);
}

export function daemonInfoPath(): string {
  return path.join(emeraldHome(), 'daemon.json');
}

export function pipePath(): string {
  return pipePathOf();
}
