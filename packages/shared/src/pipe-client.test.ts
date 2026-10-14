import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { PipeClient } from './pipe-client.ts';

// M9 fix 665: the one pipe client core. A bad frame from the daemon threw
// out of the socket's data handler as an uncaught SyntaxError (M75's L2);
// now it drops the connection and every pending request is rejected with
// PIPE_CLOSED.

// A private pipe name so the test never collides with a running emmerd.
const PIPE = `\\\\.\\pipe\\emerald-shared-client-test-${process.pid}`;

function serve(onLine: (socket: net.Socket, line: string) => void): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let at: number;
        while ((at = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, at);
          buf = buf.slice(at + 1);
          onLine(socket, line);
        }
      });
      socket.on('error', () => {});
    });
    server.once('error', reject);
    server.listen(PIPE, () => resolve(server));
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('a bad frame rejects the pending request with PIPE_CLOSED, tells a bad-frame listener and closes', async () => {
  const server = await serve((socket) => socket.write('{not json}\n'));
  try {
    const client = await PipeClient.connect(PIPE);
    const badFrames: unknown[] = [];
    client.on('bad-frame', (err) => badFrames.push(err));
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    await assert.rejects(client.request('layout.get', {}), (err: Error & { code?: string }) => err.code === 'PIPE_CLOSED');
    await closed;
    assert.equal(badFrames.length, 1);
    assert.ok(badFrames[0] instanceof SyntaxError);
  } finally {
    await closeServer(server);
  }
});

test('a bad frame with no bad-frame listener still rejects with PIPE_CLOSED and throws nothing', async () => {
  const server = await serve((socket) => socket.write('{not json}\n'));
  try {
    const client = await PipeClient.connect(PIPE);
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    await assert.rejects(client.request('layout.get', {}), (err: Error & { code?: string }) => err.code === 'PIPE_CLOSED');
    await closed;
  } finally {
    await closeServer(server);
  }
});

test('an error reply rejects with its code and message, and a push reaches a message listener', async () => {
  const server = await serve((socket, line) => {
    const { id } = JSON.parse(line) as { id: number };
    socket.write(JSON.stringify({ type: 'session.removed', sessionId: 'a' }) + '\n');
    socket.write(JSON.stringify({ type: 'reply', id, ok: false, error: { code: 'x', message: 'no' } }) + '\n');
  });
  try {
    const client = await PipeClient.connect(PIPE);
    const pushes: unknown[] = [];
    client.on('message', (m) => pushes.push(m));
    await assert.rejects(client.request('layout.get', {}), (err: Error & { code?: string }) => err.code === 'x' && err.message === 'no');
    assert.deepEqual(pushes, [{ type: 'session.removed', sessionId: 'a' }]);
    client.destroy();
  } finally {
    await closeServer(server);
  }
});
