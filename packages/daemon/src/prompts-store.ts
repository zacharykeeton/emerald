import fs from 'node:fs';
import { Limits, isPromptName, isSavedPrompt } from '@emerald/shared';
import type { SavedPrompt } from '@emerald/shared';
import { RequestError } from './errors.ts';
import type { Logger } from './log.ts';
import { setAsideBadFile, writeFileAtomic } from './store-file.ts';

// The saved prompts (M56), ~/.emerald/prompts.json as a bare array of
// { name, text }, the daemon's so every window and the CLI cycle one
// list. Read once at start; an entry that is not a prompt is dropped
// with a note rather than taking the file down.
export class PromptsStore {
  private readonly filePath: string;
  private readonly log: Logger;
  private prompts = new Map<string, string>();

  constructor(filePath: string, log: Logger) {
    this.filePath = filePath;
    this.log = log;
  }

  load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn('could not read prompts file', err);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.log.warn(`prompts file ${this.filePath} is not JSON, starting with none`, err);
      setAsideBadFile(this.filePath, this.log);
      return;
    }
    if (!Array.isArray(parsed)) {
      this.log.warn(`prompts file ${this.filePath} is not a list, starting with none`);
      setAsideBadFile(this.filePath, this.log);
      return;
    }
    for (const entry of parsed) {
      if (isSavedPrompt(entry)) this.prompts.set(entry.name, entry.text);
      else this.log.warn('prompts file entry dropped', { entry });
    }
  }

  list(): SavedPrompt[] {
    return [...this.prompts.entries()].map(([name, text]) => ({ name, text })).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): SavedPrompt | null {
    const text = this.prompts.get(name);
    return text === undefined ? null : { name, text };
  }

  // text null removes; a name already taken is replaced. Returns whether
  // anything changed, so a caller can skip the write.
  set(name: string, text: string | null): boolean {
    if (!isPromptName(name)) throw new RequestError('bad-request', 'name must be one short line, trimmed');
    if (text === null) {
      if (!this.prompts.delete(name)) return false;
    } else {
      if (text.length === 0) throw new RequestError('bad-request', 'text must not be empty');
      // A saved prompt is something typed, not a file (M9 fix 511).
      if (text.length > Limits.promptTextMaxChars) throw new RequestError('bad-request', `text must be at most ${Limits.promptTextMaxChars} characters`);
      if (this.prompts.get(name) === text) return false;
      this.prompts.set(name, text);
    }
    this.persist();
    return true;
  }

  private persist(): void {
    // Write to a sibling, flush and rename so a crash mid-write cannot
    // leave a half-written file behind, as the other stores do.
    try {
      writeFileAtomic(this.filePath, JSON.stringify(this.list(), null, 2) + '\n', this.log);
    } catch (err) {
      this.log.error('could not persist prompts', err);
    }
  }
}
