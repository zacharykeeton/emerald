'use strict';
// Claude Code's status line command, installed by emmer hooks install as
// ~/.emerald/hooks/claude-statusline.js and run through claude-statusline.cmd.
// Claude Code hands it JSON on stdin after every turn: the model and how
// full the context window is. Two things happen with it, in this order. It
// goes to emmerd's hook sink as a StatusLine event, with the session id and
// token the PTY environment carries, the way claude-hook.cmd posts the
// hooks. Then the status line command that was in settings.json before
// ours, kept in statusline-previous.json beside this file, runs with the
// same JSON on its stdin and its output passes straight through, so a
// status line the user already had still shows. The post finishes before
// the previous command starts: run side by side under Emerald.exe as node, a
// previous command that could not run starved the post until it timed out.
// Nothing here may block Claude: the post gives up after 1.5 s and any
// failure is silent. A Claude emerald did not start (M9 fix 233) has no
// session in its environment; its line posts off daemon.json, under the
// conversation's own id, with postUnhosted below (in claude-hook.js until
// M9 fix 599).
//
// emmer hooks status reads the version below and counts an older one as
// stale, so the banner offers the reinstall that lands this file.
const STATUS_LINE_VERSION = 4;

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => main(Buffer.concat(chunks)));
process.stdin.on('error', () => main(Buffer.concat(chunks)));

function main(body) {
  post(body)
    .then(() => passThrough(body))
    .then((code) => process.exit(code));
}

function post(body) {
  return new Promise((resolve) => {
    const sessionId = process.env['EMERALD_SESSION_ID'];
    const port = Number(process.env['EMERALD_HOOK_PORT']);
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      return resolve();
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return resolve();
    if (!sessionId) {
      // No stamp: not emerald's Claude. The unhosted post finds the daemon
      // on its own, or does nothing.
      return postUnhosted(payload, 'StatusLine').then(resolve, resolve);
    }
    if (!Number.isInteger(port) || port <= 0) return resolve();
    const data = JSON.stringify({ ...payload, hook_event_name: 'StatusLine' });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/hook',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'X-Emerald-Token': process.env['EMERALD_HOOK_TOKEN'] ?? '',
          'X-Emerald-Session': sessionId,
        },
        timeout: 1500,
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
        res.on('error', resolve);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', resolve);
    req.end(data);
  });
}

// The port and token of the daemon whose home this is; null when there
// is no daemon.json, or it is not the shape emmerd writes.
function readDaemon() {
  const home = (process.env['EMERALD_HOME'] || '').trim() || path.join(os.homedir(), '.emerald');
  try {
    const d = JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'));
    if (typeof d !== 'object' || d === null || !Number.isInteger(d.hookPort) || d.hookPort <= 0 || typeof d.hookToken !== 'string' || d.hookToken === '') return null;
    return { port: d.hookPort, token: d.hookToken };
  } catch {
    return null;
  }
}

// Posts the payload as the conversation's own; resolves whatever
// happens. `event` overrides the payload's hook_event_name (the status
// line names its own).
function postUnhosted(payload, event) {
  return new Promise((resolve) => {
    const daemon = readDaemon();
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
    if (daemon === null || sessionId === '') return resolve();
    const data = JSON.stringify(event === undefined ? payload : { ...payload, hook_event_name: event });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: daemon.port,
        method: 'POST',
        path: '/hook',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'X-Emerald-Token': daemon.token,
          'X-Emerald-Session': sessionId,
          'X-Emerald-Unhosted': '1',
          'X-Emerald-Hook': __filename,
        },
        timeout: 1500,
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
        res.on('error', resolve);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', resolve);
    req.end(data);
  });
}

// The shell Claude Code would have run the previous command under, which on
// Windows is Git Bash: the one it was told about, else the one beside the
// git on PATH, else cmd.exe as a last resort. A status line another tool
// installed is written for bash (Orca's is an `if [ -z ...` one-liner) and
// cmd.exe cannot parse it.
function previousShell(command) {
  const bash = findBash();
  if (bash !== null) return { exe: bash, args: ['-c', command], verbatim: false };
  return { exe: process.env['COMSPEC'] || 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], verbatim: true };
}

function findBash() {
  const given = process.env['CLAUDE_CODE_GIT_BASH_PATH'];
  if (given && fs.existsSync(given)) return given;
  for (const dir of (process.env['PATH'] || '').split(path.delimiter)) {
    if (dir === '' || !fs.existsSync(path.join(dir, 'git.exe'))) continue;
    // Git\cmd\git.exe and Git\mingw64\bin\git.exe both sit one level
    // under the install, and bash.exe is in Git\bin.
    for (const candidate of [path.join(dir, 'bash.exe'), path.join(dir, '..', 'bin', 'bash.exe')]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// Resolves with the exit code Claude Code should see: the previous
// command's, or 0 when there was none or it could not run.
function passThrough(body) {
  return new Promise((resolve) => {
    let previous = null;
    try {
      const kept = JSON.parse(fs.readFileSync(path.join(__dirname, 'statusline-previous.json'), 'utf8'));
      previous = kept && typeof kept === 'object' ? kept.statusLine : null;
    } catch {
      // No file, or not JSON: nothing was there before.
    }
    if (!previous || previous.type !== 'command' || typeof previous.command !== 'string' || previous.command.trim() === '') return resolve(0);
    // A previous command that is this wrapper itself would start a chain
    // of node processes, each running the next (M9 fix 468: an install
    // that did not know a backslash-spelled entry as its own kept it as
    // the previous one).
    const self = path.join(__dirname, 'claude-statusline.cmd').replace(/\\/g, '/').toLowerCase();
    if (previous.command.replace(/\\/g, '/').toLowerCase().includes(self)) return resolve(0);
    const shell = previousShell(previous.command);
    let child;
    try {
      child = spawn(shell.exe, shell.args, {
        stdio: ['pipe', 'inherit', 'inherit'],
        windowsHide: true,
        windowsVerbatimArguments: shell.verbatim,
      });
    } catch {
      return resolve(0);
    }
    child.on('error', () => resolve(0));
    child.on('exit', (code) => resolve(typeof code === 'number' ? code : 0));
    child.stdin.on('error', () => {});
    child.stdin.end(body);
  });
}
