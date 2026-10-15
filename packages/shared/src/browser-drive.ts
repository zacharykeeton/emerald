// M9 fix 672: emmer browser, a page in a browser pane driven from the CLI
// through the daemon to the window's main process. The verbs, the answer
// the window gives back and the bounds every hop checks. No node here.
import { BROWSER_PARTITION } from './browser-url.ts';

// M9 fix 673 adds upload, events and resume.
export type BrowserVerb = 'snapshot' | 'click' | 'hover' | 'fill' | 'key' | 'eval' | 'screenshot' | 'wait' | 'navigate' | 'upload' | 'events' | 'resume';

// In the order emmer browser's usage lists them; the daemon's refusal
// joins them, so a verb added here is named there too.
export const BROWSER_VERBS: readonly BrowserVerb[] = ['snapshot', 'click', 'hover', 'fill', 'key', 'eval', 'screenshot', 'wait', 'navigate', 'upload', 'events', 'resume'];

// What the window answers for one command. reason is present exactly
// when ok is false: timeout is the verb's own budget spent, paused is the
// person having clicked or typed in the driven page (M9 fix 673), failed
// is anything else the page or the driver refused.
export interface BrowserAnswer {
  ok: boolean;
  text: string;
  reason?: 'paused' | 'timeout' | 'failed';
  data?: unknown;
}

const REASONS = new Set(['paused', 'timeout', 'failed']);

// M9 fix 673: a browser pane may hold its page under a named profile,
// cookies and storage of its own, on a partition of its own beside the
// shared one.
export const BROWSER_PROFILE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function browserPartition(profile?: string): string {
  return profile === undefined ? BROWSER_PARTITION : `${BROWSER_PARTITION}-${profile}`;
}

// The shared partition, or a profile's; the main process attaches a
// <webview> on these alone.
export function isBrowserPartition(p: string | undefined): boolean {
  if (p === undefined) return false;
  if (p === BROWSER_PARTITION) return true;
  const prefix = `${BROWSER_PARTITION}-`;
  return p.startsWith(prefix) && BROWSER_PROFILE.test(p.slice(prefix.length));
}

export function isBrowserAnswer(v: unknown): v is BrowserAnswer {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o['ok'] !== 'boolean' || typeof o['text'] !== 'string') return false;
  if (o['ok']) return o['reason'] === undefined;
  return typeof o['reason'] === 'string' && REASONS.has(o['reason']);
}

// Characters in one argument, the most an eval or a fill carries.
export const BROWSER_ARG_CHARS = 65536;
// A verb's own budget by default, and the range --timeout may set, in ms.
export const BROWSER_TIMEOUT_MS = 10000;
export const BROWSER_TIMEOUT_MIN_MS = 1000;
export const BROWSER_TIMEOUT_MAX_MS = 120000;
