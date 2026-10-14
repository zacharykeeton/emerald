// Typings for install-check.mjs's exported parsers (M9 fix 383), so the
// unit test under src/main can import the script under tsconfig.node.json.
export interface Finding {
  level: 'ok' | 'look';
  text: string;
}
export interface CacheEntry {
  name: string;
  size: number;
  mtime: string;
  dir: '' | 'pending';
  isDir: boolean;
}
export const UPDATER_CACHE_DIR_NAME: string;
export const DAEMON_START_LOOK_S: number;
export function parseMainLog(text: string): Finding[];
export interface ProcessRead {
  commandLine: string;
  createdAt: number;
}
export function daemonProcessIs(proc: ProcessRead | null, startedAt: number | undefined): boolean;
export function parseStamps(installedText: string | null, daemonText: string | null, readProcess: (pid: number) => ProcessRead | null): Finding[];
export function parseCache(entries: CacheEntry[]): Finding[];
export interface WindowProcess {
  pid: number;
  commandLine: string;
}
export function posterForm(text: string): { form: 'worker' | 'plain' | 'none'; pid: string | null };
export function posterLogFindings(mainLog: string | null, installText: string | null, gapText: string | null, installPath: string, gapPath: string): Finding[];
export function parseWindowProcesses(procs: WindowProcess[], mainLog?: string | null): Finding[];
export function whatsNewHeading(text: string): string | null;
