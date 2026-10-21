// M9 fix 672: emmer browser, a page in a browser pane driven from the CLI
// through the daemon to the window's main process. The verbs, the answer
// the window gives back and the bounds every hop checks. No node here.
import { BROWSER_PARTITION } from './browser-url.ts';

// M9 fix 673 adds upload, events and resume; fix 874 adds drag.
export type BrowserVerb = 'snapshot' | 'click' | 'hover' | 'drag' | 'fill' | 'key' | 'eval' | 'screenshot' | 'wait' | 'navigate' | 'upload' | 'events' | 'resume';

// In the order emmer browser's usage lists them; the daemon's refusal
// joins them, so a verb added here is named there too.
export const BROWSER_VERBS: readonly BrowserVerb[] = ['snapshot', 'click', 'hover', 'drag', 'fill', 'key', 'eval', 'screenshot', 'wait', 'navigate', 'upload', 'events', 'resume'];

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

// M9 fix 969: a browser view's openedBy, a session id as the daemon makes them (a UUID), held to a safe shape.
export const BROWSER_OPENER = /^[A-Za-z0-9-]{1,64}$/;

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

// M9 fix 874: drag's target as dx,dy, CSS pixels from the source's centre, a sign and a decimal point allowed; null for anything else.
export function dragOffset(s: string): { dx: number; dy: number } | null {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(s);
  return m === null ? null : { dx: Number(m[1]), dy: Number(m[2]) };
}

// M9 fix 915: a point on the page as x,y, CSS pixels from the viewport's top left, a decimal point allowed and no sign; null for anything else. Drag's start, and since fix 935 click's and hover's point.
export function pagePoint(s: string): { x: number; y: number } | null {
  const m = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(s);
  return m === null ? null : { x: Number(m[1]), y: Number(m[2]) };
}

// M9 fix 875: what a snapshot prints: rows whose name or value holds name, any case, and rows inside within, a region's ref (@r1) or a control's (@e3); the refs stay the whole page's.
export interface BrowserFilter {
  name?: string;
  within?: string;
}
export const BROWSER_FILTER_CHARS = 200;
export const BROWSER_FILTER_REF = /^@?[er]\d{1,9}$/;
// M9 fix 970: a control's ref as the driver's parseRef takes it; upload's first argument is a CSS selector when it is not this shape.
export const BROWSER_ELEMENT_REF = /^@?e\d+$/;
