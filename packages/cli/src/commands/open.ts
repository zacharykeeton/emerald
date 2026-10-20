import path from 'node:path';
import { browserUrl, looksLikeUrl } from '@emerald/shared';
import { parse, positionals } from '../args.ts';
import { CliError, EXIT, NO_WINDOW, usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { connectHello } from '../connect.ts';
import { resolveSession, shortId } from '../resolve.ts';
import { sessionRefFor } from './set.ts';

// A file opened in the window from a pane (M9 fix 341): the path goes to
// the daemon as file.open, which relays it to every window on the app
// topic as file.open.requested, and the window opens it as a pinned tab,
// or with --pane in a pane beside the focused one, lifting itself the
// way a notification's click does. The CLI never reads the file; the
// path is made absolute here so the window opens the one this shell
// meant. A box with no window open has nothing to show it in. M9 fix
// 375: --scheme <name> sets the file's own colour scheme in the window
// before it opens (the pick the file menu makes, kept by path, so a file
// already open takes it too) and --clear-scheme drops it, as emmer set
// has them; the window says whether the name is on its list, and a name
// it does not know is kept as the pick and shows no colour, so the CLI
// prints one line about it and exits 0. M9 fix 376: --beside <session>
// (--pane implied) puts the file beside that session's pane on its own
// tab, whatever tab is in front; with no session named it is the one
// the command runs in, as emmer set reads it; a session on no pane
// falls back to beside the focused pane, and the CLI says so. M9 fix
// 404: a session can be on several panes, so the window picks one (the
// one on the tab in front, else the first in tab order) and the reply
// names it, --json carrying the pane id and the tab name. M9 fix 582:
// every open to a window at level 58 waits for its answer, and one that
// does not come within 3 s is one line and exit 75, not `opened`. M9
// fix 659: a positional that reads as a URL (http://, https:// or
// host:port) is a page for a browser pane, in a pane always, sent as
// browserUrl writes it with url set, never resolved as a path and never
// with a scheme; anything else is a path as before. M9 fix 936:
// --browser sends an .html or .htm path with browser set, in a pane
// always, and the window renders it on emerald-file: from the rail's
// folder or the file's own; an emerald-file: URL is refused, since only
// the window mints its root id.
const options = {
  pane: { type: 'boolean', default: false },
  beside: { type: 'string' },
  scheme: { type: 'string' },
  'clear-scheme': { type: 'boolean', default: false },
  browser: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
} as const;

// The first daemon build with the relay, and the first that takes a
// scheme or a beside (fixes 375 and 376); a plain open still works on
// the older one.
const OPEN_LEVEL = 53;
const EXTRAS_LEVEL = 55;
// The first daemon whose layout takes a browser view (M9 fix 659).
const URL_LEVEL = 62;
// The first daemon that takes browser on file.open, an .html file rendered in a browser pane (M9 fix 936).
const BROWSER_OPEN_LEVEL = 75;

// What a window that did not answer says (M9 fix 582); 3 s is the
// daemon's FILE_OPEN_ACK_MS. A daemon or a window older than level 58
// never says answered, so a missing field reads as sent, which is why
// no level gate is added.
const NO_ANSWER = 'sent to the window; it did not answer within 3 s';

// parseArgs takes no option with an optional value, so a bare --beside
// (the session this runs in) is given an empty value here before the
// parse, which sessionRefFor then reads as none named.
function withBareBeside(argv: string[]): string[] {
  const out = [...argv];
  const dash = out.indexOf('--');
  for (let i = 0; i < (dash === -1 ? out.length : dash); i++) {
    if (out[i] !== '--beside') continue;
    const next = out[i + 1];
    if (next === undefined || next.startsWith('-')) out.splice(i + 1, 0, '');
  }
  return out;
}

export async function runOpen(argv: string[]): Promise<number> {
  const parsed = parse(withBareBeside(argv), options);
  const { file } = positionals(parsed, ['file']);
  const v = parsed.values;
  // M9 fix 936: an emerald-file: URL names a root id only the window
  // minted, so the page's own path with --browser is the way to it.
  if (/^emerald-file:/i.test(file.trim())) throw usageError("an emerald-file: URL is the window's own; give the page's path with --browser");
  let page: string | null = null;
  if (looksLikeUrl(file)) {
    if (v.browser) throw usageError('--browser is for an .html or .htm file; a URL opens in a browser pane without it');
    page = browserUrl(file);
    if (page === null) throw usageError(`${file} is not a URL the browser pane opens: http://, https:// or host:port`);
    if (v.scheme !== undefined || v['clear-scheme']) throw usageError('--scheme and --clear-scheme are for a file, not a URL');
  }
  if (v.browser && !/\.html?$/i.test(file)) throw usageError(`--browser opens an .html or .htm file; got ${JSON.stringify(file)}`);
  if (v.browser && (v.scheme !== undefined || v['clear-scheme'])) throw usageError('--scheme and --clear-scheme are for a file tab, not --browser');
  const target = page ?? path.resolve(file);
  if (v.scheme !== undefined && v['clear-scheme']) throw usageError('--scheme and --clear-scheme together');
  if (v.scheme !== undefined && v.scheme.trim() === '') throw usageError('--scheme needs a name, the one the file menu lists');
  const scheme: string | null | undefined = v.scheme !== undefined ? v.scheme.trim() : v['clear-scheme'] ? null : undefined;
  const besideRef = v.beside === undefined ? undefined : sessionRefFor(v.beside.trim() === '' ? undefined : v.beside.trim(), process.env);
  const pane = page !== null || v.pane || besideRef !== undefined || v.browser;
  const needs = page !== null ? URL_LEVEL : v.browser ? BROWSER_OPEN_LEVEL : scheme === undefined && besideRef === undefined ? OPEN_LEVEL : EXTRAS_LEVEL;
  const what = page !== null ? 'emmer open <url>' : v.browser ? 'emmer open --browser' : scheme !== undefined ? 'emmer open --scheme' : besideRef !== undefined ? 'emmer open --beside' : 'emmer open';
  const { client, hello } = await connectHello();
  try {
    const level = hello.featureLevel ?? 1;
    if (level < needs) throw new CliError(`emmerd ${hello.daemonVersion} is older than ${what} (level ${level}, needs ${needs}); restart it from the app's banner`);
    // The session named, or the one this runs in, as one id; a name or a
    // prefix that matches nothing is refused here, before the window.
    const beside = besideRef === undefined ? undefined : resolveSession((await client.request('session.list', {})).sessions, besideRef);
    const { apps, known, besideFound, besidePane, besideTab, answered } = await client.request('file.open', { path: target, pane, ...(scheme === undefined ? {} : { scheme }), ...(beside === undefined ? {} : { beside: beside.id }), ...(page === null ? {} : { url: true }), ...(v.browser ? { browser: true } : {}) });
    if (apps === 0) throw new CliError(NO_WINDOW, EXIT.noWindow);
    const besideWord = beside === undefined ? '' : ` ${beside.name} (${shortId(beside.id)})`;
    // Which of the session's panes the window picked (M9 fix 404): the
    // one on the tab in front, else the first in tab order. A window
    // older than the fix names neither and the line is what it was. The
    // pane id is a UUID from randomId; the printed line cuts it to eight
    // characters, the same as a session's short id, and --json keeps the
    // full one (M9 fix 432).
    const pickedWord = besidePane === undefined ? '' : ` in pane ${shortId(besidePane)}${besideTab === undefined ? '' : ` on tab ${besideTab}`}`;
    if (v.json) printJson({ path: target, pane, apps, answered: answered ?? null, ...(page === null ? {} : { url: true }), ...(v.browser ? { browser: true } : {}), ...(scheme === undefined ? {} : { scheme, known: known ?? null }), ...(beside === undefined ? {} : { beside: beside.id, besideFound: besideFound ?? null, besidePane: besidePane ?? null, besideTab: besideTab ?? null }) });
    else {
      if (answered === false) throw new CliError(NO_ANSWER, EXIT.noAnswer);
      println(`opened ${target}${pane ? (beside !== undefined && besideFound !== false ? ` beside${besideWord}${pickedWord}` : ' in a pane') : ''}${scheme === undefined ? '' : scheme === null ? ', its own scheme cleared' : ` in ${scheme}`}`);
      // The window answered and did not know the name: the pick is kept
      // and shows no colour until a scheme of that name exists.
      if (scheme !== null && scheme !== undefined && known === false) println(`${scheme} is not among the window's schemes (see the file menu); the pick is kept and shows no colour`);
      // The session is on no pane: the file went beside the focused one.
      if (beside !== undefined && besideFound === false) println(`${beside.name} (${shortId(beside.id)}) is on no pane; opened beside the focused pane`);
    }
    return answered === false ? EXIT.noAnswer : EXIT.ok;
  } finally {
    client.close();
  }
}

const command: Command = {
  name: 'open',
  summary:
    "open a file in the window as a tab, with --pane in a pane beside the focused one, or with --beside beside a session's pane (the one on the tab in front, else the first in tab order); --scheme picks the file's own colour scheme; a URL opens a browser pane, and --browser renders an .html file in one",
  usage:
    'emmer open <path | url> [--pane | --beside [<session>]] [--scheme <name> | --clear-scheme] [--browser] [--json]\n--beside takes the session\'s pane on the tab in front, else its first in tab order, and the reply names the pane and the tab\na url (http://, https:// or host:port, such as localhost:3000) opens in a browser pane, beside the focused one or beside --beside\'s session\n--browser renders an .html or .htm file in a browser pane, served from the Files rail\'s folder when the file is under it, else from its own folder',
  run: (argv) => runOpen(argv),
};

export default command;
