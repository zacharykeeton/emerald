// The feed server (M9 fix 240): a static file server over the feed
// folder, with the Range requests a differential download makes. The
// daemon hosts it on start when the folder exists (fix 240, so a publish
// is seen the morning after with nothing else running), and `emmer feed
// serve` runs the same one on a box with no daemon or on a folder
// elsewhere. It lives here so there is one server; it is a subpath
// export (@emerald/shared/feed-server) rather than part of the barrel,
// since the renderer imports the barrel and this needs node:http.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { FEED_DIR_NAME, FEED_MANIFEST } from './feed.ts';

// The feed's three kinds of name (M9 fix 554): beside the manifest, an
// installer and its blockmap. Anything else, a publish's .tmp or a stray
// file, reads as missing, so the server says nothing about what else is
// in the folder.
const SERVED = /^[^/\\]+\.exe(\.blockmap)?$/i;

// %LOCALAPPDATA%\emerald-feed on Windows: beside the installed app, and not
// under ~/.emerald, whose files the verify scripts wipe by the folder.
export function defaultFeedDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env['LOCALAPPDATA'] ?? path.join(env['USERPROFILE'] ?? process.cwd(), 'AppData', 'Local');
  return path.join(base, FEED_DIR_NAME);
}

export interface FeedServer {
  port: number;
  url: string;
  close(): Promise<void>;
  // The read streams still open, for the tests (M9 fix 485).
  openStreams(): number;
}

// Serves the feed folder's files, and nothing above it. Port 0 lets the
// OS pick, for a test. `onRequest` gets one line per request.
export function serveFeed(dir: string, port: number, onRequest: (line: string) => void = () => {}): Promise<FeedServer> {
  const root = path.resolve(dir);
  // M9 fix 485: every file stream the server opens, so a request the
  // client drops and the server's own close() destroy theirs. `pipe` alone
  // never destroys its source when the response closes early, and each
  // such stream held the installer's handle for the daemon's life.
  const open = new Set<fs.ReadStream>();
  const track = (stream: fs.ReadStream): fs.ReadStream => {
    open.add(stream);
    stream.once('close', () => open.delete(stream));
    return stream;
  };
  // M9 fix 484: nothing a request carries may throw out of the listener,
  // since in the daemon that is the uncaughtException path and its shutdown
  // (a `GET /%E0` or an empty file took every pane down). A malformed
  // escape is the client's fault and reads 400; anything else is ours, 500.
  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      const status = err instanceof URIError ? 400 : 500;
      onRequest(`${req.method ?? 'GET'} ${req.url ?? '/'} ${status}`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(status === 400 ? 'bad request\n' : 'server error\n');
    }
  });
  const handle = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://feed');
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const servable = rel === FEED_MANIFEST || SERVED.test(rel);
    const file = path.resolve(root, rel);
    const inside = file === root || file.startsWith(root + path.sep);
    let stat: fs.Stats | null = null;
    try {
      stat = inside && servable ? fs.statSync(file) : null;
    } catch {
      stat = null;
    }
    if (stat === null || !stat.isFile()) {
      onRequest(`${req.method ?? 'GET'} /${rel} 404`);
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found\n');
      return;
    }
    const type = rel.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream';
    // An empty file (a copy caught at its first instant, a stray file) has
    // no byte to stream: `createReadStream({ end: -1 })` throws, so it is
    // answered whole here, before any range or stream.
    if (stat.size === 0) {
      onRequest(`${req.method ?? 'GET'} /${rel} 200`);
      res.writeHead(200, { 'content-type': type, 'content-length': '0', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
      res.end();
      return;
    }
    // A differential download asks for byte ranges; the full download
    // and the manifest read are plain GETs. electron-updater's generic
    // provider sends up to a thousand ranges in one request and expects
    // a multipart/byteranges body back (M9 fix 259: with one range per
    // request served it read `Content-Type "multipart/byteranges" is
    // expected` and fell back to the whole installer), so several ranges
    // are answered as parts between a boundary, one range as before.
    const ranges = parseRanges(req.headers.range ?? '', stat.size);
    if (ranges === 'unsatisfiable') {
      onRequest(`${req.method ?? 'GET'} /${rel} 416`);
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    const headers: Record<string, string> = {
      'content-type': type,
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
    };
    if (ranges.length > 1) {
      const boundary = `emerald-feed-${Date.now().toString(36)}`;
      const crlf = '\r\n';
      const parts = ranges.map(([start, end]) => ({
        start,
        end,
        head: Buffer.from(`${crlf}--${boundary}${crlf}content-type: ${type}${crlf}content-range: bytes ${start}-${end}/${stat.size}${crlf}${crlf}`),
      }));
      const tail = Buffer.from(`${crlf}--${boundary}--${crlf}`);
      headers['content-type'] = `multipart/byteranges; boundary=${boundary}`;
      // The first part's leading CRLF is left off, as the RFC's example has it.
      headers['content-length'] = String(parts.reduce((n, p, i) => n + p.head.length - (i === 0 ? 2 : 0) + (p.end - p.start + 1), 0) + tail.length);
      onRequest(`${req.method ?? 'GET'} /${rel} 206 ${ranges.length} ranges`);
      res.writeHead(206, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      let current: fs.ReadStream | null = null;
      res.once('close', () => current?.destroy());
      const writePart = (i: number) => {
        if (res.destroyed) return;
        if (i >= parts.length) {
          res.end(tail);
          return;
        }
        const part = parts[i]!;
        res.write(i === 0 ? part.head.subarray(2) : part.head);
        const stream = track(fs.createReadStream(file, { start: part.start, end: part.end }));
        current = stream;
        stream.on('error', () => res.destroy());
        stream.on('end', () => writePart(i + 1));
        stream.pipe(res, { end: false });
      };
      writePart(0);
      return;
    }
    const [start, end] = ranges.length === 1 ? ranges[0]! : [0, stat.size - 1];
    const status = ranges.length === 1 ? 206 : 200;
    headers['content-length'] = String(end - start + 1);
    if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
    onRequest(`${req.method ?? 'GET'} /${rel} ${status}${status === 206 ? ` ${start}-${end}` : ''}`);
    res.writeHead(status, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    // pipeline destroys the stream when the response closes early.
    pipeline(track(fs.createReadStream(file, { start, end })), res, () => {});
  };
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const bound = typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        port: bound,
        url: `http://127.0.0.1:${bound}/`,
        // A keep-alive connection the updater left open would hold
        // close() until it timed out; the daemon's stop waits on this.
        // A stream mid-answer is destroyed and waited for, so close()
        // resolves with no file handle left open (M9 fix 485).
        close: async () => {
          server.closeAllConnections();
          await Promise.all(
            [...open].map(
              (stream) =>
                new Promise<void>((r) => {
                  if (stream.closed) {
                    r();
                    return;
                  }
                  stream.once('close', () => r());
                  stream.destroy();
                }),
            ),
          );
          await new Promise<void>((r) => server.close(() => r()));
        },
        openStreams: () => open.size,
      });
    });
  });
}

// The Range header as [start, end] pairs within a file of `size` bytes:
// none for no header or a malformed one (the whole file is served), and
// 'unsatisfiable' when a range starts past the end or runs backwards.
// M9 fix 485: more than MAX_RANGES specs, or ranges that sum past the
// file's size (overlaps, `0-,0-,...`), are answered as the whole file, as
// RFC 9110 allows; before, each spec was answered, so a short header
// multiplied the answer without bound.
export const MAX_RANGES = 1000;
export function parseRanges(header: string, size: number): Array<[number, number]> | 'unsatisfiable' {
  const m = /^bytes=(.+)$/.exec(header.trim());
  if (m === null) return [];
  const specs = m[1]!.split(',');
  if (specs.length > MAX_RANGES) return [];
  const out: Array<[number, number]> = [];
  let total = 0;
  for (const spec of specs) {
    const r = /^\s*(\d*)-(\d*)\s*$/.exec(spec);
    if (r === null || (r[1] === '' && r[2] === '')) return [];
    let start: number;
    let end = size - 1;
    if (r[1] === '') {
      start = Math.max(0, size - Number(r[2]));
    } else {
      start = Number(r[1]);
      if (r[2] !== '') end = Math.min(end, Number(r[2]));
    }
    if (start > end || start >= size) return 'unsatisfiable';
    out.push([start, end]);
    total += end - start + 1;
  }
  return total > size ? [] : out;
}
