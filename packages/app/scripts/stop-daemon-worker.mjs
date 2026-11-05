// The detached half of cdp.mjs's stopDaemon (M9 fix 258): asks the daemon
// to stop over its pipe, the way `emmer daemon stop` does, so it kills its
// sessions first (the ptys' shells and the Claudes resumed in them, which a
// taskkill of the daemon's pid alone left alive, forty-five of them once),
// and falls back to `taskkill /t /f` on the pid when the pipe does not
// answer or the process is still there after the deadline. A detached node
// rather than code in the script because every script exits half a second
// after stopDaemon() and a graceful stop takes longer than that.
//
// Usage: node stop-daemon-worker.mjs <pid> <pipe> <token> <startedAt> <log>
// An empty token is passed as ''.
//
// The token is daemon.json's pipeToken (M9 fix 612), said on the hello; a
// daemon that has one refuses a hello without it, which would turn every
// clean-up into the hard kill after the deadline.
//
// The fallback kills only while the pid is still the daemon that started at
// startedAt (M9 fix 1048): a daemon that crashed leaves daemon.json naming a
// number Windows reuses within minutes, and a /t /f on it took whatever had
// the number and its tree. Each fallback is one line in the log, so a
// close-out can count them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { processIdentity } from '@emerald/shared/process-identity';

const pid = Number(process.argv[2]);
const pipe = process.argv[3];
const token = process.argv[4];
const startedAt = Number(process.argv[5]);
const logFile = process.argv[6];
const deadline = Date.now() + 8000;

const alive = () => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const note = (line) => {
  if (typeof logFile !== 'string' || logFile === '') return;
  // A failure to log must not keep the worker alive.
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line + '\n');
  } catch {
    // nothing
  }
};

const hard = (why) => {
  // Without a start time there is no way to tell the daemon from whatever
  // took its number, so nothing is killed.
  let identity = 'unknown';
  if (Number.isFinite(startedAt) && startedAt > 0) {
    try {
      identity = processIdentity(pid, startedAt);
    } catch {
      identity = 'unknown';
    }
  }
  if (identity === 'same') spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  note(`${new Date().toISOString()} stop-daemon pid ${pid} on ${pipe}: ${why}; identity ${identity}, ${identity === 'same' ? 'tree killed' : 'nothing killed'}`);
  process.exit(0);
};

// The bare alive() stays here: a wrong "alive" only reaches hard(), which
// checks the identity before it kills.
const poll = () => {
  if (!alive()) process.exit(0);
  if (Date.now() > deadline) hard('still up 8 s after daemon.stop');
  else setTimeout(poll, 200);
};

if (!Number.isInteger(pid) || pid <= 0 || typeof pipe !== 'string' || pipe === '') process.exit(0);
const sock = net.createConnection(pipe);
sock.on('error', (err) => hard(`the pipe did not answer (${err.code ?? err.message})`));
sock.on('data', () => {});
sock.on('close', () => {});
sock.on('connect', () => {
  const line = (msg) => JSON.stringify(msg) + '\n';
  sock.write(line({ id: 1, type: 'hello', client: 'cli', protocolVersion: 1, ...(token ? { token } : {}) }) + line({ id: 2, type: 'daemon.stop' }));
  poll();
});
