import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { PROTOCOL_VERSION } from '@emerald/shared';
import { connect } from './connect.ts';
import { PipeClient } from '@emerald/shared/pipe-client';

// M9 fix 379: a server that takes the connection and drops it mid-request
// used to surface as an 'error' emitted on an emitter nobody listens to,
// which throws out of the socket callback; now the pending request is
// rejected with an error naming the pipe and the client closes.

// A private pipe name so the test never collides with a running emmerd.
const PIPE = `\\\\.\\pipe\\emmer-cli-client-test-${process.pid}`;

function serve(onConnection: (socket: net.Socket) => void): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(onConnection);
    server.once('error', reject);
    server.listen(PIPE, () => resolve(server));
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// Polls a condition rather than sleeping a fixed span, so a loaded box
// does not fail on the wait alone.
async function until(what: () => boolean, ms = 2000): Promise<boolean> {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (what()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return what();
}

// M9 fix 402: a server that takes the connection and never answers the
// hello held every command for good. connect() races the hello against
// EMERALD_HELLO_TIMEOUT_MS (5 s by default) and destroys the socket, so
// the command prints one line and the process can exit.
test('a hello nobody answers is refused at the deadline, and the socket is destroyed', async () => {
  const sockets: net.Socket[] = [];
  let closedOnTheServer = false;
  // Accepts and never answers: it reads the hello (a paused socket would
  // not notice the client going either) and writes nothing back.
  const server = await serve((socket) => {
    sockets.push(socket);
    socket.resume();
    socket.once('close', () => (closedOnTheServer = true));
  });
  const pipeBefore = process.env['EMERALD_PIPE'];
  const msBefore = process.env['EMERALD_HELLO_TIMEOUT_MS'];
  process.env['EMERALD_PIPE'] = PIPE;
  process.env['EMERALD_HELLO_TIMEOUT_MS'] = '300';
  const started = Date.now();
  try {
    await assert.rejects(connect(), (err: Error) => {
      assert.equal(err.message, 'emmerd refused the connection: hello timed out after 300 ms');
      return true;
    });
    const took = Date.now() - started;
    assert.ok(took < 5000, `the override was the deadline, not the 5 s constant (${took} ms)`);
    assert.ok(await until(() => closedOnTheServer), 'the server saw the client drop the socket');
  } finally {
    if (pipeBefore === undefined) delete process.env['EMERALD_PIPE'];
    else process.env['EMERALD_PIPE'] = pipeBefore;
    if (msBefore === undefined) delete process.env['EMERALD_HELLO_TIMEOUT_MS'];
    else process.env['EMERALD_HELLO_TIMEOUT_MS'] = msBefore;
    for (const s of sockets) s.destroy();
    await closeServer(server);
  }
});

test('a request the server drops mid-flight rejects naming the pipe, and the client closes', async () => {
  const sockets: net.Socket[] = [];
  const server = await serve((socket) => {
    sockets.push(socket);
    socket.once('data', () => socket.destroy());
  });
  try {
    const client = await PipeClient.connect(PIPE);
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    await assert.rejects(
      client.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION }),
      (err: Error) => {
        assert.ok(err.message.includes(PIPE), `the error names the pipe: ${err.message}`);
        return true;
      },
    );
    await closed;
  } finally {
    for (const s of sockets) s.destroy();
    await closeServer(server);
  }
});

test('a socket error still reaches a caller that listens for it', async () => {
  const server = await serve((socket) => {
    socket.once('data', () => socket.destroy());
  });
  try {
    const client = await PipeClient.connect(PIPE);
    const seen: Error[] = [];
    client.on('error', (err: Error) => seen.push(err));
    // Subscribed before the request: 'close' is emitted in the same tick
    // as the rejection and a listener added after the await misses it.
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    await client.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION }).catch(() => undefined);
    await closed;
    // A dropped pipe reaches the client as a reset or as a plain close,
    // depending on what the other side had read; either way the listener
    // saw nothing thrown and, when there was an error, saw the error.
    for (const err of seen) assert.ok(err instanceof Error);
  } finally {
    await closeServer(server);
  }
});
