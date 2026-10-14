// The burner: three busy workers for as long as it is told, so the
// session's process tree reads a few hundred percent of one core and
// its sidebar row's load sparkline climbs past the amber line and falls
// back. Each worker is a node -e spinning on the clock; nothing is
// computed and nothing is written.
//
//   node tools/burn.mjs 60
import { spawn } from 'node:child_process';

const seconds = Math.max(1, Math.min(600, Number(process.argv[2]) || 60));
const loop = `const end = Date.now() + ${seconds * 1000}; let n = 0; while (Date.now() < end) n++;`;
const workers = [0, 1, 2].map(() => spawn(process.execPath, ['-e', loop], { stdio: 'ignore' }));
console.log(`burn: ${seconds} s on three workers`);
await Promise.all(workers.map((w) => new Promise((resolve) => w.on('exit', resolve))));
console.log('burn: done');
