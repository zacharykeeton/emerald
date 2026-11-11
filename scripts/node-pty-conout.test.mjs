// M9 fix 1156: the shared conout worker, on the repo's own two files laid
// over a temp copy of the installed node-pty lib (so it tests these copies
// whatever the postinstall did), against fake conout pipes this test serves.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const win = process.platform === 'win32';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let mod = null;
let tmp = null;
if (win) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-conout-test-'));
  fs.cpSync(path.join(root, 'node_modules', 'node-pty', 'lib'), path.join(tmp, 'lib'), { recursive: true });
  for (const rel of ['windowsConoutConnection.js', 'worker/conoutSocketWorker.js']) {
    fs.copyFileSync(path.join(root, 'scripts', 'node-pty', 'lib', rel), path.join(tmp, 'lib', rel));
  }
  mod = createRequire(import.meta.url)(path.join(tmp, 'lib', 'windowsConoutConnection.js'));
}

const PIPE_PREFIX = '\\\\.\\pipe\\emerald-conout-test-' + process.pid + '-';
let n = 0;
const servers = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fake conout pipe: resolves its accepted socket once the worker connects.
async function fakeConout() {
  const name = PIPE_PREFIX + n++;
  let accept;
  const accepted = new Promise((r) => (accept = r));
  const server = net.createServer((sock) => accept(sock));
  servers.push(server);
  await new Promise((r) => server.listen(name, r));
  return { name, accepted };
}

// A connection whose out socket is connected; collects what reaches it.
async function connect(name) {
  const conn = new mod.ConoutConnection(name, false);
  await new Promise((r) => conn.onReady(r));
  const out = new net.Socket();
  out.setEncoding('utf8');
  let text = '';
  out.on('data', (d) => (text += d));
  out.on('error', () => {});
  await new Promise((r) => { out.once('connect', r); conn.connectSocket(out); });
  return { conn, out, text: () => text };
}

async function until(fn, ms, what) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms: ${what}`);
    await sleep(20);
  }
  return Date.now() - t0;
}

async function carries(fake, c, word) {
  const sock = await fake.accepted;
  sock.write(word);
  await until(() => c.text().includes(word), 3000, `${word} reaches its socket`);
}

after(async () => {
  for (const s of servers) s.close();
  if (tmp !== null) fs.rmSync(tmp, { recursive: true, force: true });
});

const opts = { skip: !win };

test('two connections share one worker, and text reaches only its own socket', opts, async () => {
  const fa = await fakeConout();
  const fb = await fakeConout();
  const a = await connect(fa.name);
  const b = await connect(fb.name);
  const st = mod.conoutWorkerState();
  assert.equal(st.live, true);
  assert.ok(st.names.includes(fa.name) && st.names.includes(fb.name), JSON.stringify(st));
  await carries(fa, a, 'alpha-1');
  await sleep(200);
  assert.ok(!b.text().includes('alpha-1'));
  await carries(fb, b, 'beta-1');
  assert.ok(!a.text().includes('beta-1'));

  // A name with no pipe behind it: a warning, the name leaves, A and B carry on.
  const warned = new Promise((r) => {
    const on = (w) => { if (w.name === 'EmeraldConoutWarning') { process.off('warning', on); r(w); } };
    process.on('warning', on);
  });
  const missing = PIPE_PREFIX + 'nobody-' + n++;
  new mod.ConoutConnection(missing, false);
  const w = await warned;
  assert.ok(w.message.startsWith(`conout worker: ${missing}: `), w.message);
  await until(() => !mod.conoutWorkerState().names.includes(missing), 2000, 'the failed name leaves');
  await carries(fa, a, 'alpha-2');
  await carries(fb, b, 'beta-2');

  // A's dispose leaves A after the drain, and B still carries.
  const t0 = Date.now();
  a.conn.dispose();
  await until(() => !mod.conoutWorkerState().names.includes(fa.name), 2000, 'A leaves');
  const took = Date.now() - t0;
  assert.ok(took >= 900, `A left after ${took} ms, before the drain`);
  await carries(fb, b, 'beta-3');
  assert.equal(mod.conoutWorkerState().live, true);

  // The last one terminates the worker.
  b.conn.dispose();
  await until(() => !mod.conoutWorkerState().live, 2000 + 1000, 'the worker ends with its last connection');
  a.out.destroy();
  b.out.destroy();
});

test('a connection after the last one left starts a fresh worker', opts, async () => {
  const fc = await fakeConout();
  assert.equal(mod.conoutWorkerState().live, false);
  const c = await connect(fc.name);
  assert.equal(mod.conoutWorkerState().live, true);
  await carries(fc, c, 'gamma-1');
  c.conn.dispose();
  await until(() => !mod.conoutWorkerState().live, 3000, 'the fresh worker ends');
  c.out.destroy();
});

test('destroying the out socket disposes its connection (a pty that exits on its own)', opts, async () => {
  const fd = await fakeConout();
  const fe = await fakeConout();
  const d = await connect(fd.name);
  const e = await connect(fe.name);
  d.out.destroy();
  // The close disposes; the drain then runs its second.
  await until(() => !mod.conoutWorkerState().names.includes(fd.name), 2000, 'D leaves on its socket close');
  await carries(fe, e, 'eps-1');
  e.out.destroy();
  await until(() => !mod.conoutWorkerState().live, 3000, 'the worker ends after E closes');
});
