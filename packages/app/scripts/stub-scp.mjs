// A stand-in for scp.exe (M9 fix 1082), run by the app's main process
// through EMERALD_SCP under verify:remote. It takes scp's argv (each -o
// pair, the local file, then <dest>:<path>), logs it, and copies the file
// to <path> under the stub host's home (EMERALD_STUB_HOME), a relative
// path being the login's home as on a real host. A missing folder exits 1
// with scp's own line.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
let i = 0;
while (argv[i] === '-o') i += 2;
const rest = argv.slice(i);
const target = rest[rest.length - 1] ?? '';
const local = rest[rest.length - 2] ?? '';
const H = process.env['EMERALD_STUB_HOME'] ?? '';
if (H === '') {
  process.stderr.write('stub-scp: EMERALD_STUB_HOME is not set\n');
  process.exit(2);
}
fs.appendFileSync(path.join(H, 'stub-scp.log'), `${new Date().toISOString()} ${JSON.stringify(argv)}\n`);
// <dest>:<path>, the dest never holding a colon of its own here.
const colon = target.indexOf(':');
const remote = colon >= 0 ? target.slice(colon + 1) : target;
const to = path.isAbsolute(remote) ? remote : path.join(H, remote);
if (!fs.existsSync(path.dirname(to))) {
  process.stderr.write(`scp: ${remote}: No such file or directory\r\n`);
  process.exit(1);
}
try {
  fs.copyFileSync(path.resolve(local), to);
} catch (err) {
  process.stderr.write(`scp: ${local}: ${err.message}\r\n`);
  process.exit(1);
}
process.exit(0);
