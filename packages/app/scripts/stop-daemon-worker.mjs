// The detached half of cdp.mjs's stopDaemon (M9 fix 258): asks the daemon
// to stop over its pipe, the way `emmer daemon stop` does, so it kills its
// sessions first (the ptys' shells and the Claudes resumed in them, which a
// taskkill of the daemon's pid alone left alive, forty-five of them once),
// and falls back to `taskkill /t /f` on the pid when the pipe does not
// answer or the process is still there after the deadline. A detached node
// rather than code in the script because every script exits half a second
// after stopDaemon() and a graceful stop takes longer than that.
//
// Usage: node stop-daemon-worker.mjs <pid> <pipe> [<token>]
//
// The token is daemon.json's pipeToken (M9 fix 612), said on the hello; a
// daemon that has one refuses a hello without it, which would turn every
// clean-up into the hard kill after the deadline.
import { spawnSync } from 'node:child_process';
import net from 'node:net';

const pid = Number(process.argv[2]);
const pipe = process.argv[3];
const token = process.argv[4];
const deadline = Date.now() + 8000;

const alive = () => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const hard = () => {
  if (alive()) spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  process.exit(0);
};

const poll = () => {
  if (!alive()) process.exit(0);
  if (Date.now() > deadline) hard();
  else setTimeout(poll, 200);
};

if (!Number.isInteger(pid) || pid <= 0 || typeof pipe !== 'string' || pipe === '') process.exit(0);
const sock = net.createConnection(pipe);
sock.on('error', hard);
sock.on('data', () => {});
sock.on('close', () => {});
sock.on('connect', () => {
  const line = (msg) => JSON.stringify(msg) + '\n';
  sock.write(line({ id: 1, type: 'hello', client: 'cli', protocolVersion: 1, ...(token ? { token } : {}) }) + line({ id: 2, type: 'daemon.stop' }));
  poll();
});
