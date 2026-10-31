import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { claimPipe } from './pipe-server.ts';

// M9 fix 1015: off Windows the daemon's pipe is a Unix socket file in its
// home. The claim restricts it to the user, clears a dead daemon's file and
// leaves a live one's, or anything that is not a socket, to fail
// EADDRINUSE as the single-instance check. Each test runs off Windows alone;
// a named pipe has no file to read.

const skip = process.platform === 'win32';

function tempSock(): { dir: string; sock: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-sock-'));
  return { dir, sock: path.join(dir, 'emmerd.sock') };
}

function reach(sock: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.createConnection(sock);
    c.once('connect', () => {
      c.destroy();
      resolve(true);
    });
    c.once('error', () => resolve(false));
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function listenOn(sock: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const s = net.createServer((c) => c.destroy());
    s.once('error', reject);
    s.listen(sock, () => resolve(s));
  });
}

test('claimPipe makes a socket of mode 600 that a client reaches', { skip }, async () => {
  const { dir, sock } = tempSock();
  try {
    const { server } = await claimPipe(sock);
    try {
      const st = fs.lstatSync(sock);
      assert.equal(st.isSocket(), true, 'a socket file');
      assert.equal(st.mode & 0o777, 0o600, 'mode 600');
      assert.equal(await reach(sock), true, 'a client reaches it');
    } finally {
      await close(server);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a dead daemon's socket file is cleared and the claim succeeds", { skip }, async () => {
  const { dir, sock } = tempSock();
  try {
    // A child listens on the path and kills itself hard, which leaves the
    // file behind as a SIGKILLed daemon does.
    const child = spawn(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(sock)}, () => process.kill(process.pid, 'SIGKILL'))`], { stdio: 'ignore' });
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    assert.equal(fs.lstatSync(sock).isSocket(), true, 'the stale file is there');
    assert.equal(await reach(sock), false, 'nobody answers on it');
    const { server } = await claimPipe(sock);
    try {
      assert.equal(await reach(sock), true, 'the new claim answers');
    } finally {
      await close(server);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a path a live server holds rejects EADDRINUSE and the live server still answers', { skip }, async () => {
  const { dir, sock } = tempSock();
  try {
    const live = await listenOn(sock);
    try {
      await assert.rejects(claimPipe(sock), (err: NodeJS.ErrnoException) => err.code === 'EADDRINUSE');
      assert.equal(await reach(sock), true, 'the live server still answers');
    } finally {
      await close(live);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a regular file at the path rejects EADDRINUSE and is left where it is', { skip }, async () => {
  const { dir, sock } = tempSock();
  try {
    fs.writeFileSync(sock, 'not a socket');
    await assert.rejects(claimPipe(sock), (err: NodeJS.ErrnoException) => err.code === 'EADDRINUSE');
    assert.equal(fs.readFileSync(sock, 'utf8'), 'not a socket', 'the file is still there');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the socket file goes when the claimed server closes", { skip }, async () => {
  const { dir, sock } = tempSock();
  try {
    const { server } = await claimPipe(sock);
    await close(server);
    // libuv unlinks a Unix socket's path when the server's handle closes,
    // which is why the daemon's finish() unlinks nothing itself.
    assert.equal(fs.existsSync(sock), false, 'the path is gone');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
