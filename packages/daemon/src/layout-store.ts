import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { LayoutError, currentTab, defaultLayout, isSingleTree, listPanes, replaceTab, setPaneSession, validateLayout, validateSingleTree, wrapSingleTree } from '@emerald/shared';
import type { Layout } from '@emerald/shared';
import { RequestError } from './errors.ts';
import type { Logger } from './log.ts';
import { setAsideBadFile, writeFileAtomic } from './store-file.ts';

// On-disk shape of ~/.emerald/state.json. M5 adds session metadata next to the
// layout, so the file is an object with a version rather than a bare layout.
// The version stays 1 through M36: a layout is told from a single tree by
// its shape, so a file from before is read as one tab and written back
// with tabs.
interface StateFile {
  version: 1;
  layout: Layout;
}

// The daemon's copy of the split tree, which is the only authoritative one.
// Clients propose a whole Layout carrying the revision they started from; the
// store accepts it only if that revision is current, stamps the next revision
// and writes it to disk. Emits 'changed' (Layout) after every accepted set.
export class LayoutStore extends EventEmitter {
  private readonly filePath: string;
  private readonly log: Logger;
  private layout: Layout;

  constructor(filePath: string, log: Logger) {
    super();
    this.filePath = filePath;
    this.log = log;
    this.layout = defaultLayout();
  }

  // Reads the saved layout. A missing file is the first run; a corrupt file is
  // logged and replaced by the default rather than keeping the daemon down.
  load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn('could not read state file', err);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StateFile>;
      if (parsed.version !== 1) throw new LayoutError(`unknown state file version ${String(parsed.version)}`);
      if (isSingleTree(parsed.layout)) {
        this.layout = wrapSingleTree(validateSingleTree(parsed.layout));
        this.log.info('layout from before M36 read as one tab', { revision: this.layout.revision, file: this.filePath });
      } else {
        this.layout = validateLayout(parsed.layout);
        this.log.info('layout loaded', { revision: this.layout.revision, tabs: this.layout.tabs.length, file: this.filePath });
      }
    } catch (err) {
      this.log.warn(`state file ${this.filePath} is unusable, starting with the default layout`, err);
      setAsideBadFile(this.filePath, this.log);
      this.layout = defaultLayout();
    }
  }

  get(): Layout {
    return this.layout;
  }

  // A single tree, the shape before M36, is an edit to the tab on show:
  // the tree replaces that tab's and the tab keeps its id and name, so a
  // script or CLI written against one tree still works.
  set(proposed: unknown): Layout {
    let next: Layout;
    try {
      if (isSingleTree(proposed)) {
        const tree = validateSingleTree(proposed);
        const tab = currentTab(this.layout);
        next = validateLayout({ ...replaceTab(this.layout, { ...tab, root: tree.root, focusedPaneId: tree.focusedPaneId }), revision: tree.revision });
      } else {
        next = validateLayout(proposed);
      }
    } catch (err) {
      throw new RequestError('bad-request', err instanceof Error ? err.message : String(err));
    }
    if (next.revision !== this.layout.revision) {
      throw new RequestError(
        'stale-revision',
        `layout edit was based on revision ${next.revision} but the current revision is ${this.layout.revision}`,
      );
    }
    this.layout = { ...next, revision: next.revision + 1 };
    this.persist();
    this.emit('changed', this.layout);
    return this.layout;
  }

  // Empties every pane showing the session. A daemon-side edit rather than a
  // client one because the session is being removed and every client must
  // see the same layout whether or not it is connected right now. No-op
  // when nothing shows the session, so the revision only moves for a change.
  clearSession(sessionId: string): boolean {
    let next = this.layout;
    for (const tab of this.layout.tabs) {
      let edited = tab;
      for (const pane of listPanes(tab)) {
        if (pane.sessionId === sessionId) edited = setPaneSession(edited, pane.id, null);
      }
      next = replaceTab(next, edited);
    }
    if (next === this.layout) return false;
    this.layout = { ...next, revision: this.layout.revision + 1 };
    this.persist();
    this.emit('changed', this.layout);
    return true;
  }

  // Empties every pane on a session id the daemon holds no record of,
  // listed or removed (M9 fix 456, M75's L13): a record lost with a torn
  // sessions.json, or dropped at load, left its panes on an id every
  // session request answers not-found for, since panes are otherwise
  // emptied only on a removal. One revision for the lot; the ids cleared
  // are returned for the start's log line.
  clearUnknown(known: Set<string>): string[] {
    const cleared = new Set<string>();
    let next = this.layout;
    for (const tab of this.layout.tabs) {
      let edited = tab;
      for (const pane of listPanes(tab)) {
        if (pane.sessionId === null || known.has(pane.sessionId)) continue;
        cleared.add(pane.sessionId);
        edited = setPaneSession(edited, pane.id, null);
      }
      next = replaceTab(next, edited);
    }
    if (cleared.size === 0) return [];
    this.layout = { ...next, revision: this.layout.revision + 1 };
    this.persist();
    this.emit('changed', this.layout);
    return [...cleared];
  }

  private persist(): void {
    const file: StateFile = { version: 1, layout: this.layout };
    // Write to a sibling, flush and rename so a crash mid-write cannot
    // leave a half-written state.json behind.
    try {
      writeFileAtomic(this.filePath, JSON.stringify(file, null, 2) + '\n', this.log);
    } catch (err) {
      // Losing persistence is bad but losing the live layout would be worse.
      this.log.error('could not persist layout', err);
    }
  }
}
