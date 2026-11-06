import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import { RELAY_LOST, pumpRelay } from './relay.ts';

// A private pipe name so the test never meets a running emmerd.
const PIPE = `\\\\.\\pipe\\emmer-relay-test-${process.pid}`;

async function until(what: () => boolean, ms = 3000): Promise<boolean> {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (what()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return what();
}

// A server that keeps what it reads and hands its one socket to the test.
async function serve(): Promise<{ server: net.Server; got: () => string; ended: () => boolean; socket: Promise<net.Socket> }> {
  let buf = '';
  let ended = false;
  let take!: (s: net.Socket) => void;
  const socket = new Promise<net.Socket>((r) => (take = r));
  const server = net.createServer((s) => {
    s.setEncoding('utf8');
    s.on('data', (d: string) => (buf += d));
    s.on('end', () => (ended = true));
    s.on('error', () => {});
    take(s);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(PIPE, () => resolve());
  });
  return { server, got: () => buf, ended: () => ended, socket };
}

function connect(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(PIPE);
    s.once('error', reject);
    s.once('connect', () => resolve(s));
  });
}

test('the relay adds the token to the hello, passes the rest byte for byte both ways, and ends with the input (M9 fix 1079)', async () => {
  const { server, got, ended, socket: serverSide } = await serve();
  try {
    const client = await connect();
    const input = new PassThrough();
    const output = new PassThrough();
    const out: Buffer[] = [];
    output.on('data', (b: Buffer) => out.push(b));
    const pumped = pumpRelay({ input, output, socket: client, token: 'tok-1' });
    input.write('{"id":1,"type":"hello","client":"app","protocolVersion":7}\n');
    input.write('{"id":2,"type":"session.list"}\r\n');
    assert.ok(await until(() => got().split('\n').length >= 3), `server got ${JSON.stringify(got())}`);
    const lines = got().split('\n');
    assert.deepEqual(JSON.parse(lines[0]!), { id: 1, type: 'hello', client: 'app', protocolVersion: 7, token: 'tok-1' });
    assert.equal(lines[1], '{"id":2,"type":"session.list"}');
    // A frame from the daemon comes out unchanged, a multibyte name included.
    const s = await serverSide;
    s.write(Buffer.from('{"type":"x","name":"café"}\n', 'utf8'));
    assert.ok(await until(() => Buffer.concat(out).length > 0));
    const bytes = Buffer.concat(out);
    assert.equal(bytes.toString('utf8'), '{"type":"x","name":"café"}\n');
    assert.ok(bytes.includes(Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9])));
    input.end();
    assert.equal(await pumped, 0);
    assert.ok(await until(() => ended()), 'the server saw the end');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('the daemon going first resolves the pump with RELAY_LOST (M9 fix 1079)', async () => {
  const { server, socket: serverSide } = await serve();
  try {
    const client = await connect();
    const input = new PassThrough();
    const output = new PassThrough();
    const pumped = pumpRelay({ input, output, socket: client, token: 't' });
    (await serverSide).destroy();
    assert.equal(await pumped, RELAY_LOST);
    assert.equal(RELAY_LOST, 3);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
