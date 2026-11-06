import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { cleanHostRecord, hostRecordProblem } from '@emerald/shared';
import type { HostRecord } from '@emerald/shared';
import { RequestError } from './errors.ts';
import type { Logger } from './log.ts';
import { setAsideBadFile, writeFileAtomic } from './store-file.ts';

// The remote hosts record (M9 fix 1080), ~/.emerald/hosts.json as a bare
// array of host records, the shape of the folder labels' file: the hosts
// added by hand, and what first contact read of each (a Host of
// ~/.ssh/config gets a record once first contact writes its facts). The
// local daemon keeps it so every window shares it. Read once at start; an
// entry that is not a record is dropped with a note. Emits 'changed' with
// the whole list after a write, for the hosts.changed push.
export class HostsStore extends EventEmitter {
  private readonly filePath: string;
  private readonly log: Logger;
  private hosts = new Map<string, HostRecord>();

  constructor(filePath: string, log: Logger) {
    super();
    this.filePath = filePath;
    this.log = log;
  }

  load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn('could not read hosts file', err);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.log.warn(`hosts file ${this.filePath} is not JSON, starting with none`, err);
      setAsideBadFile(this.filePath, this.log);
      return;
    }
    if (!Array.isArray(parsed)) {
      this.log.warn(`hosts file ${this.filePath} is not a list, starting with none`);
      setAsideBadFile(this.filePath, this.log);
      return;
    }
    for (const entry of parsed) {
      const problem = hostRecordProblem(entry);
      if (problem === null) {
        const host = cleanHostRecord(entry as HostRecord);
        if (!this.hosts.has(host.name)) this.hosts.set(host.name, host);
      } else {
        this.log.warn('hosts file entry dropped', { entry, problem });
      }
    }
  }

  // In addedAt order, the order the on row lists the added hosts in.
  list(): HostRecord[] {
    return [...this.hosts.values()].sort((a, b) => a.addedAt - b.addedAt || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  // Upsert by name. Returns whether anything changed, so an unchanged set
  // writes and pushes nothing.
  set(given: unknown): boolean {
    const problem = hostRecordProblem(given);
    if (problem !== null) throw new RequestError('bad-request', `host must be a host record: ${problem}`);
    const host = cleanHostRecord(given as HostRecord);
    const before = this.hosts.get(host.name);
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(host)) return false;
    this.hosts.set(host.name, host);
    this.persist();
    this.emit('changed', this.list());
    return true;
  }

  // An unknown name changes nothing and is not an error.
  remove(name: string): boolean {
    if (!this.hosts.delete(name)) return false;
    this.persist();
    this.emit('changed', this.list());
    return true;
  }

  private persist(): void {
    // A store with no file (a server under test) lives in memory; writing
    // '' would leave a temp file in the working folder.
    if (this.filePath === '') return;
    try {
      writeFileAtomic(this.filePath, JSON.stringify(this.list(), null, 2) + '\n', this.log);
    } catch (err) {
      this.log.error('could not persist hosts', err);
    }
  }
}
