// A stand-in for claude (M9 fix 1094), for verify:remote's stub host:
// the verify copies it beside a claude.cmd of npm's shape in a stub-bin
// folder ahead of the stub daemon's PATH, so the daemon's findClaude finds
// that shim and resolves it to node on this script, and no read of the
// stub host ever runs the person's own claude. It appends its argv as one
// JSON line to stub-claude.log beside itself. For `auth status --json` it
// answers from auth.json beside itself ({ loggedIn, loginExpiresAt },
// signed out when absent) in the shape Claude Code 2.1.319 prints, and
// exits 1 when not logged in, as Claude Code does; any other words print
// one line and exit 0.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const words = process.argv.slice(2);
fs.appendFileSync(path.join(here, 'stub-claude.log'), JSON.stringify(words) + '\n');

if (words.join(' ') === 'auth status --json') {
  let auth = { loggedIn: false, loginExpiresAt: null };
  try {
    auth = JSON.parse(fs.readFileSync(path.join(here, 'auth.json'), 'utf8'));
  } catch {
    // No file: signed out.
  }
  const loggedIn = auth.loggedIn === true;
  const answer = {
    loggedIn,
    authMethod: loggedIn ? 'claude.ai' : 'none',
    apiProvider: 'firstParty',
    configDirectory: path.join(os.homedir(), '.claude'),
    loginExpiresAt: auth.loginExpiresAt ?? null,
  };
  process.stdout.write(JSON.stringify(answer, null, 2) + '\n');
  process.exitCode = loggedIn ? 0 : 1;
} else {
  process.stdout.write(`stub claude: ${words.join(' ')}\n`);
}
