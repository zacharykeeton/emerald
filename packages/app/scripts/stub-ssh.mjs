// A stand-in for ssh.exe (M9 fix 1082), run by the app's main process
// through EMERALD_SSH under verify:remote. It takes ssh's argv (each -o
// pair, the destination, then the command's words), logs the argv, and
// plays a host on this box: by default a Windows host whose sshd runs
// PowerShell 5.1, home EMERALD_STUB_HOME. Its mode is EMERALD_STUB_SSH_MODE
// when set (a run by hand), else the destination's entry in the JSON file
// EMERALD_STUB_SSH_MODES names (main's environment is fixed at launch, so a
// script changes the mode by rewriting that file), else powershell:
//   powershell  answers the two probes as wfs-db does and runs any other
//               command through powershell.exe -Command, as sshd does; a
//               relay whose kit node does not exist yet runs this checkout's
//               CLI relay instead, on the stub daemon's pipe
//   hostkey     an unknown host key: ssh's two lines, exit 255
//   down        a refused connection, exit 255
//   nokit       a relay whose node is not there: PowerShell's line, exit 1
//   linux       answers the sh probe as a Linux host
// Every command it runs gets the stub home as USERPROFILE, HOME and
// HOMEPATH, and a Claude config under it, so the kit's hooks install never
// writes the harness's settings or the person's; EMERALD_HOME and
// EMERALD_PIPE are removed, as on a real host.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const argv = process.argv.slice(2);
let i = 0;
while (argv[i] === '-o') i += 2;
const dest = argv[i] ?? '';
const words = argv.slice(i + 1);
const command = words.join(' ');
const H = process.env['EMERALD_STUB_HOME'] ?? '';
if (H === '') {
  process.stderr.write('stub-ssh: EMERALD_STUB_HOME is not set\n');
  process.exit(2);
}
fs.mkdirSync(H, { recursive: true });
fs.appendFileSync(path.join(H, 'stub-ssh.log'), `${new Date().toISOString()} ${JSON.stringify(argv)}\n`);

function modeOf() {
  const forced = process.env['EMERALD_STUB_SSH_MODE'];
  if (forced !== undefined && forced !== '') return forced;
  const file = process.env['EMERALD_STUB_SSH_MODES'];
  if (file !== undefined) {
    try {
      const modes = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof modes[dest] === 'string') return modes[dest];
    } catch {
      // No file or not JSON: the default.
    }
  }
  return 'powershell';
}

const env = { ...process.env, USERPROFILE: H, HOME: H, HOMEPATH: H, CLAUDE_CONFIG_DIR: path.join(H, '.claude'), CLAUDE_SETTINGS: path.join(H, '.claude', 'settings.json') };
delete env['EMERALD_HOME'];
delete env['EMERALD_PIPE'];

const isRelay = / relay /.test(` ${command} `);
// The relay's first quoted word is the kit's node, then its CLI, then --home.
const quoted = [...command.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
const nodeWord = quoted[0] ?? '';
const homeAt = words.indexOf('--home');
const homeWord = homeAt >= 0 ? (words[homeAt + 1] ?? '').replace(/^"|"$/g, '') : '';

function run(exe, args) {
  const child = spawn(exe, args, { stdio: 'inherit', env, windowsHide: true });
  child.on('exit', (code) => process.exit(code ?? 1));
  child.on('error', (err) => {
    process.stderr.write(`stub-ssh: ${err.message}\n`);
    process.exit(1);
  });
}

function writePid() {
  fs.writeFileSync(path.join(H, 'stub-ssh.pid'), String(process.pid));
}

const mode = modeOf();
if (mode === 'hostkey') {
  process.stderr.write(`No ED25519 host key is known for ${dest} and you have requested strict checking.\r\n`);
  process.stderr.write('Host key verification failed.\r\n');
  process.exit(255);
}
if (mode === 'down') {
  process.stderr.write(`ssh: connect to host ${dest} port 22: Connection refused\r\n`);
  process.exit(255);
}
if (mode === 'linux' && command === 'uname -sm; echo $HOME') {
  // A Unix home, as a Linux host has: the kit's sh probe takes a second
  // line that starts with / and nothing else, so the stub's own Windows
  // home here would read as no answer and fall through to PowerShell's.
  process.stdout.write('Linux x86_64\n/home/verify\n');
  process.exit(0);
}
if (mode === 'nokit' && isRelay) {
  process.stderr.write(`& : The term '${nodeWord}' is not recognized as the name of a cmdlet, function, script file, or operable program.\r\n`);
  process.exit(1);
}
if (command === 'uname -sm; echo $HOME') {
  // PowerShell 5.1 runs the sh probe too: uname is not found, echo $HOME
  // prints the home, and the exit follows the last statement (wfs-db's
  // answer, 2026-11-05); the probe is told apart by its line count.
  process.stderr.write("uname : The term 'uname' is not recognized as the name of a cmdlet, function, script file, or operable program.\r\n");
  process.stdout.write(`${H}\r\n`);
  process.exit(0);
}
if (command === '$env:PROCESSOR_ARCHITECTURE; $HOME') {
  process.stdout.write(`${process.env['PROCESSOR_ARCHITECTURE'] ?? 'AMD64'}\r\n${H}\r\n`);
  process.exit(0);
}
if (isRelay && !fs.existsSync(nodeWord)) {
  // No kit copied yet: this checkout's CLI stands in for it, on the stub
  // daemon's own pipe.
  writePid();
  run(process.execPath, [path.join(repo, 'packages', 'cli', 'dist', 'main.js'), 'relay', '--home', homeWord, '--pipe', process.env['EMERALD_STUB_PIPE'] ?? '']);
} else {
  if (isRelay) writePid();
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
}
