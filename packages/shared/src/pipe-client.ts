import { EventEmitter } from 'node:events';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { ClientMessage, Reply, RequestType, Requests, ServerMessage } from './protocol.ts';
import { JsonLinesDecoder, encodeJsonLine } from './jsonlines.ts';

// One connection to emmerd (M9 fix 665, the one copy). The CLI uses it for
// the lifetime of a command and the daemon's tests and smoke script the same
// way; the app's main process holds one per connection inside its own
// reconnect loop (packages/app/src/main/pipe-client.ts). No reconnect here:
// a connection that is lost fails what is pending, and the caller connects afresh.
// Emits 'message' (ServerMessage) for every push, 'bad-frame' (Error) before a
// bad frame drops the connection, 'error' to a caller that listens, and 'close'.
export class PipeClient extends EventEmitter {
  // A pipe's socket, or any duplex carrying the same lines (M9 fix 1081:
  // ssh's stdio to a remote host's relay).
  private readonly socket: Duplex;
  private readonly decoder = new JsonLinesDecoder();
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  // What the error texts name: the pipe's path, or the stream's label.
  private readonly label: string;

  private constructor(socket: Duplex, label: string) {
    super();
    this.socket = socket;
    this.label = label;
    socket.on('data', (chunk: Buffer) => {
      let messages: unknown[];
      try {
        messages = this.decoder.push(chunk);
      } catch (err) {
        // A bad frame means we no longer know where messages begin; the
        // connection is dropped and 'close' settles every pending request with
        // PIPE_CLOSED, rather than the throw leaving the socket's callback (M75's L2).
        if (this.listenerCount('bad-frame') > 0) this.emit('bad-frame', err);
        socket.destroy();
        return;
      }
      for (const msg of messages) this.onMessage(msg as ServerMessage);
    });
    // A socket error (a write EPIPE on a daemon that has just gone, a
    // reset mid-request) was re-emitted as 'error' on this emitter, which
    // nobody listens to, so it threw out of the socket callback and the
    // command died with a stack at best and nothing at all at worst (M9
    // fix 379). Now every pending request is settled with an error naming
    // the pipe and the socket is destroyed, so 'close' follows and the
    // command's own catch prints one line; the event is still emitted for
    // a caller that did subscribe.
    socket.on('error', (err) => {
      this.settle(Object.assign(new Error(`emmerd pipe ${this.label}: ${err.message}`), { code: (err as NodeJS.ErrnoException).code ?? 'PIPE_CLOSED' }));
      socket.destroy();
      if (this.listenerCount('error') > 0) this.emit('error', err);
    });
    socket.once('close', () => {
      // The code makes the CLI's router print it as one line rather than
      // as a bug's stack.
      this.settle(Object.assign(new Error(`emmerd pipe ${this.label} closed`), { code: 'PIPE_CLOSED' }));
      this.emit('close');
    });
  }

  static connect(pipePath: string): Promise<PipeClient> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(pipePath);
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.off('error', reject);
        resolve(new PipeClient(socket, pipePath));
      });
    });
  }

  // The same client over a given stream (M9 fix 1081), so the app's host
  // client speaks the pipe protocol over ssh's stdio with the one framing,
  // the one request ids and the one hello.
  static over(stream: Duplex, label: string): PipeClient {
    return new PipeClient(stream, label);
  }

  request<K extends RequestType>(type: K, body: Requests[K]['req']): Promise<Requests[K]['res']> {
    const id = this.nextId++;
    const msg = { id, type, ...body } as ClientMessage;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket.write(encodeJsonLine(msg));
    });
  }

  // Fire-and-forget messages: pty.input and pty.resize.
  send(msg: ClientMessage): void {
    this.socket.write(encodeJsonLine(msg));
  }

  close(): void {
    this.socket.end();
  }

  // Drops the connection rather than half-closing it. `close` sends FIN
  // and waits, which leaves a daemon that accepts and never answers
  // holding the socket open and the process alive; the hello deadline
  // (M9 fix 402) needs the handle gone before the command can exit.
  destroy(): void {
    this.socket.destroy();
  }

  // Rejects every request still waiting for a reply with the one error.
  private settle(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private onMessage(msg: ServerMessage): void {
    if (msg.type === 'reply') {
      const reply = msg as Reply;
      const p = this.pending.get(reply.id);
      if (p === undefined) return;
      this.pending.delete(reply.id);
      if (reply.ok) p.resolve(reply.result);
      else p.reject(Object.assign(new Error(reply.error.message), { code: reply.error.code }));
      return;
    }
    this.emit('message', msg);
  }
}
