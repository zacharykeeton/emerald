import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type { RemoteHost } from '@emerald/shared';
import { HostClient, sshCommand } from './host-client.ts';
import type { HostRefusal } from './host-client.ts';

// A child process as far as the host client reads one: three pipes, a pid,
// an exit. exit() ends stdout as a real child's would.
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  exitCode: number | null = null;
  lines: string[] = [];
  kill(): boolean {
    this.exit(null);
    return true;
  }
  exit(code: number | null): void {
    if (this.exitCode !== null) return;
    this.exitCode = code ?? 1;
    this.stdout.end();
    setImmediate(() => this.emit('exit', code, null));
  }
}

// The host daemon behind the relay: answers hello, subscribe and the list.
function daemon(child: FakeChild, pid: number, sessions: unknown[] = []): void {
  let buf = '';
  child.stdin.setEncoding('utf8');
  child.stdin.on('data', (d: string) => {
    buf += d;
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
      child.lines.push(line);
      const msg = JSON.parse(line) as { id: number; type: string };
      const result =
        msg.type === 'hello' ? { daemonPid: pid, daemonVersion: '0.1.1079', featureLevel: 80, claude: true } :
        msg.type === 'session.list' ? { sessions } : {};
      child.stdout.write(JSON.stringify({ type: 'reply', id: msg.id, ok: true, result }) + '\n');
    }
  });
}

function refuse(child: FakeChild, lines: string[], code: number): void {
  setImmediate(() => {
    for (const l of lines) child.stderr.write(l + '\r\n');
    setImmediate(() => child.exit(code));
  });
}

const stub: RemoteHost = { name: 'stub', destination: 'verify@stub.invalid', source: 'config', os: 'win32', shell: 'powershell', home: 'C:\\h', nodeVersion: '24.20.0', kitVersion: '0.1.1079', addedAt: 0 };

type Behaviour = (child: FakeChild) => void;

function harness(behaviours: Behaviour[], host: RemoteHost = stub) {
  const calls: { exe: string; args: readonly string[] }[] = [];
  const children: FakeChild[] = [];
  const events: string[] = [];
  const client = new HostClient({
    host,
    runner: 'node',
    log: () => {},
    env: {},
    // Never resolves: a wait ends only by tryNow, so the test drives the clock.
    sleep: () => new Promise(() => {}),
    spawn: (exe, args) => {
      calls.push({ exe, args });
      const child = new FakeChild();
      children.push(child);
      const b = behaviours.shift();
      if (b !== undefined) b(child);
      return child as unknown as ChildProcess;
    },
  });
  client.on('connected', (d: { pid: number }) => events.push(`up ${d.pid}`));
  client.on('lost', (l: { retryIn: number }) => events.push(`lost ${l.retryIn}`));
  client.on('refused', (r: HostRefusal) => events.push(`refused ${r.kind}: ${r.line}`));
  return { client, calls, children, events };
}

function next(client: HostClient, event: string): Promise<unknown[]> {
  return new Promise((resolve) => client.once(event, (...args: unknown[]) => resolve(args)));
}

test('the argv carries the -o words and the PowerShell relay words, and the hello no token (M9 fix 1081)', async () => {
  const h = harness([(c) => daemon(c, 77)]);
  await h.client.connect();
  assert.equal(h.calls[0]!.exe, 'ssh');
  assert.deepEqual(h.calls[0]!.args, [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', 'stub',
    '&', '"C:\\h\\.emerald-remote\\node-24.20.0\\node.exe"', '"C:\\h\\.emerald-remote\\0.1.1079\\cli\\dist\\main.js"', 'relay', '--home', '"C:\\h\\.emerald-remote"',
  ]);
  const hello = JSON.parse(h.children[0]!.lines[0]!) as Record<string, unknown>;
  assert.equal(hello['type'], 'hello');
  assert.equal(hello['client'], 'app');
  assert.equal('token' in hello, false);
  assert.equal(h.client.state, 'up');
  assert.equal(h.client.daemon?.claude, true);
  assert.deepEqual(h.events, ['up 77']);
  h.client.stop();
});

test('an added host is reached by its destination (M9 fix 1081)', async () => {
  const h = harness([(c) => daemon(c, 1)], { ...stub, name: 'box', destination: 'me@box', source: 'added' });
  await h.client.connect();
  assert.equal(h.calls[0]!.args[6], 'me@box');
  h.client.stop();
});

test('refused hostkey from the last stderr line after the warnings, exit 255 (M9 fix 1081)', async () => {
  const warn = '** WARNING: connection is not using a post-quantum key exchange algorithm.';
  const h = harness([(c) => refuse(c, [warn, warn, warn, 'Host key verification failed.'], 255)]);
  await h.client.connect();
  assert.deepEqual(h.events, ['refused hostkey: Host key verification failed.']);
  assert.equal(h.client.state, 'refused');
  await assert.rejects(h.client.request('session.list', {}), /Host key verification failed\./);
});

test('refused ssh on any other 255, refused nokit on exit 1 (M9 fix 1081)', async () => {
  const a = harness([(c) => refuse(c, ['ssh: connect to host stub port 22: Connection refused'], 255)]);
  await a.client.connect();
  assert.deepEqual(a.events, ['refused ssh: ssh: connect to host stub port 22: Connection refused']);
  const b = harness([(c) => refuse(c, ["& : The term 'x' is not recognized"], 1)]);
  await b.client.connect();
  assert.deepEqual(b.events, ["refused nokit: & : The term 'x' is not recognized"]);
});

test('a host with no kit is refused nokit with no spawn (M9 fix 1081)', async () => {
  const { kitVersion: _k, ...bare } = stub;
  const h = harness([], bare);
  await h.client.connect();
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.events, ['refused nokit: emerald is not set up on stub yet']);
});

test('after a hello a drop is lost at 2 then 4, tryNow cuts the wait, and a reconnect lists again (M9 fix 1081)', async () => {
  const h = harness([
    (c) => daemon(c, 10),
    (c) => refuse(c, ['ssh: connect to host stub port 22: Connection refused'], 255),
    (c) => daemon(c, 10, [{ id: 's1' }]),
  ]);
  await h.client.connect();
  const lost1 = next(h.client, 'lost');
  h.children[0]!.exit(0);
  const [first] = (await lost1) as [{ at: number; retryIn: number }];
  assert.equal(first.retryIn, 2);
  assert.equal(h.client.state, 'lost');
  const lost2 = next(h.client, 'lost');
  h.client.tryNow();
  const [second] = (await lost2) as [{ at: number; retryIn: number }];
  assert.equal(second.retryIn, 4);
  assert.equal(second.at, first.at, 'one outage keeps its at');
  const up = next(h.client, 'connected');
  h.client.tryNow();
  const [, sessions] = (await up) as [unknown, unknown[]];
  assert.deepEqual(sessions, [{ id: 's1' }]);
  assert.ok(h.children[2]!.lines.some((l) => l.includes('"session.list"')));
  assert.deepEqual(h.events, ['up 10', 'lost 2', 'lost 4', 'up 10']);
  h.client.stop();
});

test('a changed host key while lost turns refused (M9 fix 1081)', async () => {
  const h = harness([
    (c) => daemon(c, 10),
    (c) => refuse(c, ['Host key verification failed.'], 255),
  ]);
  await h.client.connect();
  const lost = next(h.client, 'lost');
  h.children[0]!.exit(0);
  await lost;
  const refused = next(h.client, 'refused');
  h.client.tryNow();
  await refused;
  assert.equal(h.client.state, 'refused');
  assert.deepEqual(h.events, ['up 10', 'lost 2', 'refused hostkey: Host key verification failed.']);
});

test('sshCommand: unset is ssh, a script runs under node, anything else is the exe (M9 fix 1081)', () => {
  assert.deepEqual(sshCommand(undefined, 'node').exe, 'ssh');
  assert.deepEqual(sshCommand(undefined, 'node').prefix, []);
  const script = sshCommand('C:\\x\\stub-ssh.mjs', 'node');
  assert.deepEqual(script.prefix, ['C:\\x\\stub-ssh.mjs']);
  assert.match(script.exe, /node(\.exe)?$|electron|emerald/i);
  assert.deepEqual(sshCommand('C:\\x\\ssh.exe', 'node'), { exe: 'C:\\x\\ssh.exe', prefix: [], env: { ...process.env } });
});
