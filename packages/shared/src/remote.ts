// The remote host helpers (M9 fix 1080): the words of the relay's command
// line on a host, the host's folders, the kit's commands in the two shells
// sshd may run them in, and the merge of ~/.ssh/config's hosts with the
// record's. Pure string work, so the renderer can import it through the
// barrel.
import type { HostRecord } from './protocol.ts';

// What the renderer sees: main's merge of the config's hosts (first, in
// file order) and the record's (then, by addedAt), names unique with the
// config winning.
export type RemoteHost = HostRecord & { source: 'config' | 'added' };

export type RemoteShell = 'powershell' | 'sh';

// The shape every helper below needs of a host: where its home is and how
// its sshd runs a command.
export interface HostPlace {
  home: string;
  shell: RemoteShell;
}

// A path with a double quote in it cannot be quoted in either shell's form
// below; no home in practice has one, so it is refused rather than escaped.
function quoted(p: string): string {
  if (p.includes('"')) throw new Error(`a remote path cannot hold a double quote: ${p}`);
  return `"${p}"`;
}

function sepOf(h: HostPlace): string {
  return h.shell === 'powershell' ? '\\' : '/';
}

function join(h: HostPlace, ...parts: string[]): string {
  // Every part but the last drops its trailing separators and every part
  // but the first its leading ones, so a root (C:\ or /) joins to C:\x or /x.
  return parts
    .map((p, i) => {
      let s = p;
      if (i > 0) s = s.replace(/^[\\/]+/, '');
      if (i < parts.length - 1) s = s.replace(/[\\/]+$/, '');
      return s;
    })
    .join(sepOf(h));
}

// <home>/.emerald-remote, the remote daemon's EMERALD_HOME.
export function remoteHomeOf(h: HostPlace): string {
  return join(h, h.home, '.emerald-remote');
}

// <home>/.emerald-remote/<kitVersion>, holding daemon/, cli/ and node_modules/.
export function kitDirOf(h: HostPlace, kitVersion: string): string {
  return join(h, remoteHomeOf(h), kitVersion);
}

// <home>/.emerald-remote/node-<nodeVersion>, holding node.exe or bin/node.
export function nodeDirOf(h: HostPlace, nodeVersion: string): string {
  return join(h, remoteHomeOf(h), `node-${nodeVersion}`);
}

// The words after the destination on ssh's command line: the kit's node
// running the kit's CLI's relay against the remote home. The quotes are
// part of the words, since ssh joins them with spaces and the host's shell
// parses the line; & is PowerShell's call operator for a quoted path.
export function relayCommand(h: HostPlace & { nodeVersion: string; kitVersion: string }): string[] {
  const node = h.shell === 'powershell'
    ? join(h, nodeDirOf(h, h.nodeVersion), 'node.exe')
    : join(h, nodeDirOf(h, h.nodeVersion), 'bin', 'node');
  const cli = join(h, kitDirOf(h, h.kitVersion), 'cli', 'dist', 'main.js');
  const words = [quoted(node), quoted(cli), 'relay', '--home', quoted(remoteHomeOf(h))];
  return h.shell === 'powershell' ? ['&', ...words] : words;
}

export function mkdirCommand(h: HostPlace, dir: string): string {
  return h.shell === 'powershell'
    ? `New-Item -ItemType Directory -Force -Path ${quoted(dir)} | Out-Null`
    : `mkdir -p ${quoted(dir)}`;
}

export function removeCommand(h: HostPlace, dir: string): string {
  return h.shell === 'powershell'
    ? `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -Path ${quoted(dir)}`
    : `rm -rf ${quoted(dir)}`;
}

// The same in both shells: Windows ships bsdtar as tar.exe.
export function untarCommand(_h: HostPlace, archive: string, dir: string): string {
  return `tar -xzf ${quoted(archive)} -C ${quoted(dir)}`;
}

// The host part of an ssh destination, the name a host added by hand goes
// by: ssh://, a user@ and a :port dropped. zacha@192.0.2.7 gives 192.0.2.7.
export function hostNameOf(destination: string): string {
  let d = destination.trim();
  if (d.startsWith('ssh://')) d = d.slice('ssh://'.length);
  const at = d.lastIndexOf('@');
  if (at >= 0) d = d.slice(at + 1);
  d = d.replace(/:\d+$/, '');
  d = d.replace(/\/+$/, '');
  return d;
}

// M9 fix 1167: a folder named for a remote host from this PC's CLI. An
// absolute path in either spelling (/srv/app, C:\src, C:/src, \\box\share)
// or the host's home, ~ alone or ~ and a separator; a relative one is
// refused, since this PC's working folder means nothing there. hostFolder
// turns ~ into the record's home, joined in the host's spelling, and leaves
// any other folder as given.
export function isHostFolder(dir: string): boolean {
  return /^(~([\\/].*)?|\/.*|[A-Za-z]:[\\/].*|\\\\.+)$/s.test(dir);
}

export function hostFolder(dir: string, h: HostPlace): string {
  if (dir === '~' || dir === '~/' || dir === '~\\') return h.home;
  if (dir.startsWith('~/') || dir.startsWith('~\\')) return join(h, h.home, dir.slice(2));
  return dir;
}

// The config's hosts first, in file order, each carrying the facts first
// contact wrote into a record of the same name; then every record whose
// name no config host has, by addedAt.
export function mergeRemoteHosts(
  config: readonly { name: string; destination: string }[],
  records: readonly HostRecord[],
): RemoteHost[] {
  const byName = new Map(records.map((r) => [r.name, r]));
  const out: RemoteHost[] = [];
  const seen = new Set<string>();
  for (const c of config) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    const r = byName.get(c.name);
    out.push(r !== undefined
      ? { ...r, name: c.name, destination: c.destination, source: 'config' }
      : { name: c.name, destination: c.destination, addedAt: 0, source: 'config' });
  }
  const added = records.filter((r) => !seen.has(r.name)).slice().sort((a, b) => a.addedAt - b.addedAt);
  for (const r of added) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    out.push({ ...r, source: 'added' });
  }
  return out;
}

const OPTIONAL_STRINGS = ['arch', 'home', 'nodeVersion', 'kitVersion', 'kitStage'] as const;

// The first field of a would-be host record that fails, or null when it is
// one: name a non-empty single word, destination a non-empty word, os and
// shell from their lists, the optional strings non-empty, addedAt finite.
export function hostRecordProblem(x: unknown): string | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'not an object';
  const r = x as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name === '' || /\s/.test(r.name)) return 'name';
  if (typeof r.destination !== 'string' || r.destination === '' || /\s/.test(r.destination)) return 'destination';
  if (r.os !== undefined && r.os !== 'win32' && r.os !== 'darwin' && r.os !== 'linux') return 'os';
  if (r.shell !== undefined && r.shell !== 'powershell' && r.shell !== 'sh') return 'shell';
  for (const k of OPTIONAL_STRINGS) {
    if (r[k] !== undefined && (typeof r[k] !== 'string' || r[k] === '')) return k;
  }
  if (typeof r.addedAt !== 'number' || !Number.isFinite(r.addedAt)) return 'addedAt';
  return null;
}

export function isHostRecord(x: unknown): x is HostRecord {
  return hostRecordProblem(x) === null;
}

// A host record with only the fields the record keeps, so a stray key on a
// request or in the file is not carried along.
export function cleanHostRecord(r: HostRecord): HostRecord {
  const out: HostRecord = { name: r.name, destination: r.destination, addedAt: r.addedAt };
  if (r.os !== undefined) out.os = r.os;
  if (r.arch !== undefined) out.arch = r.arch;
  if (r.shell !== undefined) out.shell = r.shell;
  if (r.home !== undefined) out.home = r.home;
  if (r.nodeVersion !== undefined) out.nodeVersion = r.nodeVersion;
  if (r.kitVersion !== undefined) out.kitVersion = r.kitVersion;
  if (r.kitStage !== undefined) out.kitStage = r.kitStage;
  return out;
}
