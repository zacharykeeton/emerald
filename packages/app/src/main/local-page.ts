import fs from 'node:fs';
import path from 'node:path';
import { allPanes, localPageOf } from '@emerald/shared';
import type { Layout } from '@emerald/shared';

// M9 fix 896: a page from the disk in a browser pane, served on the
// emerald-file: scheme from the folder the Files rail showed when it was
// opened. Pure but for the file system, no electron import, so its test
// reaches it; index.ts registers the scheme and hands each request here.

// By lowercase extension; anything else is application/octet-stream.
export const LOCAL_PAGE_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};

// On every answer. no-store: a page an agent is writing is read fresh,
// and fix 898's reload needs it. CORP same-origin: a web page's <img> or
// <script> naming a local URL gets nothing, each root id being its own
// origin. no-referrer: a local page that links out does not hand its root
// id to that site. frame-ancestors 'self': a web page cannot frame one.
export const LOCAL_PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "frame-ancestors 'self'",
};

export type LocalAnswer =
  | { status: 200; type: string; file: string }
  | { status: 400 | 403 | 404 | 405; reason: string; body: string; type: string; log: boolean };

// The folder of the first browser view across every tab whose page is on
// this root id, or null.
export function localRootIn(layout: Layout | null, rootId: string): string | null {
  if (layout === null) return null;
  for (const pane of allPanes(layout)) {
    const view = pane.view;
    if (view === null || view.kind !== 'browser' || view.root === undefined) continue;
    if (localPageOf(view.url)?.rootId === rootId) return view.root;
  }
  return null;
}

// Whether a request for a page from the disk may go on (index.ts's
// webRequest hook): a frame's own load always, since the navigation guards
// hold those; any other (an image, a script, a fetch, a stylesheet) only
// from a frame on a page of the same root id, which is what CORP
// same-origin would have said had Chromium applied it to the scheme.
export function localRequestAllowed(url: string, resourceType: string, frameUrl: string): boolean {
  if (resourceType === 'mainFrame' || resourceType === 'subFrame') return true;
  const from = localPageOf(frameUrl);
  if (from === null) return false;
  // The host alone, not localPageOf: a bad path from the same folder goes
  // on to the handler, which answers it 400 rather than a failed fetch.
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  return host === from.rootId;
}

const TEXT = 'text/plain; charset=utf-8';

function refused(status: 400 | 403 | 405, reason: string): LocalAnswer {
  return { status, reason, body: `refused: ${reason}`, type: TEXT, log: true };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function notFound(rel: string): LocalAnswer {
  // No log line: a page's missing favicon would write one per load.
  const body = `<!doctype html><meta charset="utf-8"><title>Not found</title><p>${escapeHtml(rel)} is not there. This pane reloads when the file is back.</p>`;
  return { status: 404, reason: 'not found', body, type: 'text/html; charset=utf-8', log: false };
}

const NO_FOLDER: LocalAnswer = { status: 404, reason: 'no folder', body: 'No folder for this page; open it again from the Files rail.', type: TEXT, log: true };

// Whether the real path is the root or under it. Checked after realpath,
// which is where a junction or a symlink inside the folder pointing out of
// it is caught; path.relative compares case-blind on win32.
function inside(realRoot: string, real: string): boolean {
  const back = path.relative(realRoot, real);
  return !back.startsWith('..') && !path.isAbsolute(back);
}

async function realOrNull(p: string): Promise<string | null> {
  try {
    return await fs.promises.realpath(p);
  } catch {
    return null;
  }
}

export async function answerLocalPage(url: string, method: string, rootOf: (rootId: string) => string | null): Promise<LocalAnswer> {
  if (method !== 'GET' && method !== 'HEAD') return refused(405, 'GET only');
  const page = localPageOf(url);
  if (page === null) return refused(400, 'bad path');
  const root = rootOf(page.rootId);
  if (root === null) return NO_FOLDER;
  const realRoot = await realOrNull(root);
  if (realRoot === null) return NO_FOLDER;
  const target = path.resolve(root, ...(page.rel === '' ? [] : page.rel.split('/')));
  const realTarget = await realOrNull(target);
  if (realTarget === null) return notFound(page.rel);
  if (!inside(realRoot, realTarget)) return refused(403, 'outside the folder');
  let file = realTarget;
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(realTarget);
  } catch {
    return notFound(page.rel);
  }
  if (stat.isDirectory()) {
    const index = await realOrNull(path.join(realTarget, 'index.html'));
    if (index === null) return notFound(page.rel);
    if (!inside(realRoot, index)) return refused(403, 'outside the folder');
    file = index;
  }
  const ext = path.extname(file).toLowerCase();
  return { status: 200, type: LOCAL_PAGE_TYPES[ext] ?? 'application/octet-stream', file };
}
