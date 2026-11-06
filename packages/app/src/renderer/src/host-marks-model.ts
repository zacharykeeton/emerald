// What the remote-host marks say (M9 fixes 1089 and 1090): the sidebar's
// sections per host, the chip's title, the Files tab's note and the lost
// line's band and row texts. Pure; types only.
import type { SessionGroup } from '@emerald/shared';

export const LOCAL_HOST_HEAD = 'this pc';

export function hostChipTitle(name: string, destination: string): string {
  return `Runs on ${name}, reached by ssh as ${destination}`;
}

// The on row's order for groupSessions: this PC first as '', then the
// hosts as the row lists them.
export function hostOrderOf(remoteHosts: readonly { name: string }[]): string[] {
  return ['', ...remoteHosts.map((h) => h.name)];
}

export interface HostSection {
  host: string;
  groups: SessionGroup[];
}

// The sidebar's list as sections per host. null while no remote group
// exists, so the list is today's markup. The Exited group stays apart,
// after every section. Groups arrive ordered by host, so a section is a
// run of consecutive groups on one host.
export function hostSections(groups: readonly SessionGroup[], anyRemote: boolean): { sections: HostSection[]; exited: SessionGroup | null } | null {
  if (!anyRemote) return null;
  const sections: HostSection[] = [];
  let exited: SessionGroup | null = null;
  for (const g of groups) {
    if (g.key === 'exited' && g.folder === '') {
      exited = g;
      continue;
    }
    const last = sections[sections.length - 1];
    if (last !== undefined && last.host === g.host) last.groups.push(g);
    else sections.push({ host: g.host, groups: [g] });
  }
  return { sections, exited };
}

export function filesRemoteText(name: string): string {
  return `This folder is on ${name}. The files, the commit graph and the review tab read this PC's disk, so they are not drawn for it yet.`;
}

export function filesRemoteMuted(name: string): string {
  return `The terminal, the chat view, the state on the row and the hooks all come from ${name} as they do from here.`;
}

export function filesRemoteShellLabel(name: string, folder: string): string {
  return `Shell on ${name} in ${folder}`;
}

// Local HH:MM, zero-padded, 24-hour.
export function lostClock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function lostRowLine(at: number): string {
  return `Lost at ${lostClock(at)}, trying again`;
}

// Seconds until the next try, counted down from the moment retryIn arrived.
export function retrySecondsLeft(retryIn: number | null, receivedAt: number, now: number): number | null {
  if (retryIn === null) return null;
  return Math.max(0, retryIn - Math.floor((now - receivedAt) / 1000));
}

export function lostBandText(name: string, since: number, left: number | null): string {
  const tail = left === null ? 'trying again.' : left === 0 ? 'trying again now.' : `trying again in ${left}s.`;
  return `Lost the line to ${name} at ${lostClock(since)}. The session runs on there; ${tail}`;
}
