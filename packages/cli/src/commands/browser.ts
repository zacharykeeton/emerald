import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_FILTER_CHARS, BROWSER_FILTER_REF, BROWSER_PROFILE, BROWSER_TIMEOUT_MS, browserUrl, dragOffset, pagePoint, currentTab, findPane, focusPane, paneShowingIn, replaceTab, setPaneView, splitPane } from '@emerald/shared';
import type { BrowserAnswer, BrowserFilter, BrowserVerb } from '@emerald/shared';
import { integerOption, parse, positionals, readText } from '../args.ts';
import { browserTarget } from '../browser-target.ts';
import { CliError, EXIT, NO_WINDOW, usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { connectHello } from '../connect.ts';
import { shortId } from '../resolve.ts';

// emmer browser (M9 fix 672): a Claude session drives the page in a
// browser pane while the person watches. Every verb but open goes to the
// daemon as browser.run, which relays it to the window's main process;
// the main process runs it on the page through the debugger and answers
// with one line of text. open edits the layout itself, as emmer focus
// does, so it needs no window. No recipe ships with it: the verbs and
// this usage are the whole of it.
const options = {
  pane: { type: 'string' },
  timeout: { type: 'string' },
  json: { type: 'boolean', default: false },
  profile: { type: 'string' },
  stdin: { type: 'boolean', default: false },
  file: { type: 'string' },
  clear: { type: 'boolean', default: false },
  name: { type: 'string' },
  within: { type: 'string' },
} as const;

// The first daemon that relays browser.run (M9 fix 672).
const BROWSER_LEVEL = 63;
// The first daemon and window that take drag and a snapshot's filter (M9 fixes 874 and 875).
const BROWSER_DRAG_LEVEL = 72;
// The first daemon and window that take drag from a point x,y (M9 fix 915).
const BROWSER_POINT_LEVEL = 74;
// The first daemon and window that take click and hover at a point x,y (M9 fix 935).
const BROWSER_CLICK_POINT_LEVEL = 75;

const USAGE = [
  'emmer browser <verb> [<args>] [--pane <id>] [--json]',
  '  open <url> [--profile <name>]  a browser pane on the page, beside the pane of the session this runs in; --profile gives it cookies and storage of its own',
  "  snapshot [--name <text>] [--within <ref>]  the page's controls, each with a ref (@e1), its role, name, value and state, and its regions (@r1); --name keeps the rows whose name or value holds the text, --within the rows inside a region or a control",
  "  click <ref>|<x>,<y>           a click at the control's centre or at x,y in the page's CSS pixels",
  "  hover <ref>|<x>,<y>           the pointer moved over the control or to x,y in the page's CSS pixels",
  "  drag <ref>|<x>,<y> <ref>|<dx>,<dy>  a press on the control or at x,y in the page's CSS pixels, a move in steps and a release on the second control, or dx,dy CSS pixels from the start (a negative dx after --)",
  '  fill <ref> <text>|--stdin|--file <path>|--clear  the text typed into a field, in place of what it held; --clear empties it; a select takes the option by its value or text',
  '  key <key>                     one key: Enter, Escape, Tab, an arrow, a letter, with Ctrl+, Shift+ or Alt+ before it',
  '  eval <js>|--stdin|--file <path>  an expression run in the page; prints its value as JSON',
  "  screenshot                    a PNG of the page under the emerald home; prints its path, the page's size in CSS pixels and the device pixels in one CSS pixel",
  '  wait <text|ref> [--timeout <s>]  until the text is on the page, in a field\'s value or an aria-label, or the control is on screen (10 s by default)',
  '  navigate <url> [--timeout <s>]   the page loaded at that URL (http://, https:// or host:port)',
  '  upload <ref> <path>           a file set on a file input',
  '  events                        what happened since the last read: a window the page tried to open, a download, a console error',
  "  resume                        drive the pane again after the person's click or key paused it",
  "the target is the one browser pane on the layout tab holding this session's pane (else the tab in front); --pane <id> names one when there are several",
  "a click or a key of the person's in a driven page pauses every command but events and resume (exit 77)",
  'a newline, a % or a double quote in <text> or <js> does not survive emmer.cmd or Windows PowerShell 5.1 on the command line; --stdin or --file <path> reads it verbatim',
].join('\n');

// Each verb's positionals, under names that make its own messages.
const ARGS: Record<BrowserVerb | 'open', string[]> = {
  open: ['url'],
  snapshot: [],
  click: ['ref'],
  hover: ['ref'],
  drag: ['ref', 'target'],
  fill: ['ref', 'text'],
  key: ['key'],
  eval: ['js'],
  screenshot: [],
  wait: ['text'],
  navigate: ['url'],
  upload: ['ref', 'path'],
  events: [],
  resume: [],
};

function badUrl(url: string): CliError {
  return usageError(`${url} is not a URL the browser pane opens: http://, https:// or host:port`);
}

export async function runBrowser(argv: string[]): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    println(USAGE);
    return EXIT.ok;
  }
  const parsed = parse(argv, options);
  // Anything after a bare -- is a positional too, so eval -- -1 works.
  const words = [...parsed.positionals, ...parsed.rest];
  const verb = words[0];
  if (verb === undefined) throw usageError('missing verb');
  if (!Object.hasOwn(ARGS, verb)) throw usageError(`unknown verb ${JSON.stringify(verb)}; emmer help browser lists them`);
  const v = parsed.values;
  // M9 fix 854: fill's text or eval's expression read verbatim from stdin
  // or a file, or --clear for an empty fill; the verb's last positional is
  // then not on the line.
  const textVerb = verb === 'fill' || verb === 'eval';
  if (v.stdin && !textVerb) throw usageError('--stdin is for fill and eval');
  if (v.file !== undefined && !textVerb) throw usageError('--file is for fill and eval');
  if (v.clear && verb !== 'fill') throw usageError('--clear is for fill');
  if (v.clear && v.stdin) throw usageError('--clear and --stdin together');
  if (v.clear && v.file !== undefined) throw usageError('--clear and --file together');
  const fromText = v.stdin || v.file !== undefined || v.clear;
  const all = ARGS[verb as keyof typeof ARGS];
  const names = fromText ? all.slice(0, -1) : all;
  const got = positionals({ positionals: words.slice(1) }, names);
  const args = names.map((n) => (got as Record<string, string>)[n]!);
  if (fromText) {
    const text = v.clear ? '' : ((await readText({ stdin: v.stdin, file: v.file }, { stdin: '--stdin', file: '--file' }, verb === 'eval')) ?? '');
    if (verb === 'eval' && text === '') throw usageError(`the expression from ${v.stdin ? '--stdin' : '--file'} is empty`);
    args.push(text);
  }
  let timeoutMs = BROWSER_TIMEOUT_MS;
  if (v.timeout !== undefined) {
    if (verb !== 'wait' && verb !== 'navigate') throw usageError('--timeout is for wait and navigate');
    const s = integerOption(v.timeout, 'timeout', 0);
    if (s < 1 || s > 120) throw usageError('--timeout takes 1 to 120 seconds');
    timeoutMs = s * 1000;
  }
  if (verb === 'navigate' || verb === 'open') {
    const url = browserUrl(args[0]!);
    if (url === null) throw badUrl(args[0]!);
    args[0] = url;
  }
  // M9 fix 673: a profile of its own for a new pane's page.
  const profile = v.profile;
  if (profile !== undefined) {
    if (verb !== 'open') throw usageError('--profile is for open');
    if (!BROWSER_PROFILE.test(profile)) throw usageError('--profile takes lowercase letters, digits and hyphens, up to 32, such as b or viewer');
  }
  // The file is checked here, before the pipe, and sent whole.
  if (verb === 'upload') {
    const file = path.resolve(args[1]!);
    if (!isFile(file)) throw new CliError(`no file ${file}`);
    args[1] = file;
  }
  if (verb === 'drag' && !/^@?e\d+$/.test(args[0]!) && pagePoint(args[0]!) === null) {
    throw usageError(`drag starts at a ref or at x,y in the page's CSS pixels, such as @e7 or 120,300; got ${JSON.stringify(args[0])}`);
  }
  if (verb === 'drag' && !/^@?e\d+$/.test(args[1]!) && dragOffset(args[1]!) === null) {
    throw usageError(`drag goes to a ref or to dx,dy in CSS pixels, such as @e7 or 0,-40; got ${JSON.stringify(args[1])}`);
  }
  if ((verb === 'click' || verb === 'hover') && !/^@?e\d+$/.test(args[0]!) && pagePoint(args[0]!) === null) {
    throw usageError(`${verb} takes a ref or x,y in the page's CSS pixels, such as @e7 or 120,300; got ${JSON.stringify(args[0])}`);
  }
  // M9 fix 875: a snapshot's printed rows kept to a name or a region.
  if (v.name !== undefined && verb !== 'snapshot') throw usageError('--name is for snapshot');
  if (v.within !== undefined && verb !== 'snapshot') throw usageError('--within is for snapshot');
  if (v.name !== undefined && (v.name.length < 1 || v.name.length > BROWSER_FILTER_CHARS)) throw usageError(`--name takes 1 to ${BROWSER_FILTER_CHARS} characters`);
  if (v.within !== undefined && !BROWSER_FILTER_REF.test(v.within)) throw usageError('--within takes a ref such as @r1 or @e3');
  const filter: BrowserFilter = { ...(v.name === undefined ? {} : { name: v.name }), ...(v.within === undefined ? {} : { within: v.within }) };
  const filtered = v.name !== undefined || v.within !== undefined;
  const fromPoint = (verb === 'drag' || verb === 'click' || verb === 'hover') && pagePoint(args[0]!) !== null;
  const needs = fromPoint ? (verb === 'drag' ? BROWSER_POINT_LEVEL : BROWSER_CLICK_POINT_LEVEL) : verb === 'drag' || filtered ? BROWSER_DRAG_LEVEL : BROWSER_LEVEL;
  const what = fromPoint ? `emmer browser ${verb} from a point` : verb === 'drag' ? 'emmer browser drag' : filtered ? 'emmer browser snapshot --name and --within' : 'emmer browser';
  const own = process.env['EMERALD_SESSION_ID'];
  const { client, hello } = await connectHello();
  try {
    const level = hello.featureLevel ?? 1;
    if (level < needs) throw new CliError(`emmerd ${hello.daemonVersion} is older than ${what} (level ${level}, needs ${needs}); restart it from the app's banner`);
    const { layout } = await client.request('layout.get', {});
    if (verb === 'open') {
      // Beside the caller's own pane, else the focused pane of the tab in
      // front; the focus is put back so the person's keyboard stays put.
      const showing = own === undefined || own === '' ? null : paneShowingIn(layout, own);
      const tab = showing?.tab ?? currentTab(layout);
      const beside = showing?.pane ?? findPane(tab, tab.focusedPaneId);
      if (beside === null) throw new CliError(`no pane to open beside on tab ${tab.name}`);
      const split = splitPane(tab, beside.id, 'row');
      const newId = split.focusedPaneId;
      const placed = focusPane(setPaneView(split, newId, { kind: 'browser', url: args[0]!, ...(profile === undefined ? {} : { profile }) }), tab.focusedPaneId);
      // The revision read travels with the edit; a stale one is the
      // daemon's refusal, printed as any wire error is.
      await client.request('layout.set', { layout: replaceTab(layout, placed) });
      if (v.json) printJson({ pane: newId, tab: tab.name, url: args[0], ...(profile === undefined ? {} : { profile }) });
      else println(`opened ${args[0]} in pane ${shortId(newId)} on tab ${tab.name}${profile === undefined ? '' : ` under profile ${profile}`}`);
      return EXIT.ok;
    }
    const { tab, pane } = browserTarget(layout, own, v.pane);
    let by = 'emmer';
    if (own !== undefined && own !== '') {
      const { sessions } = await client.request('session.list', {});
      by = sessions.find((s) => s.id === own)?.name ?? 'emmer';
    }
    const res = await client.request('browser.run', { paneId: pane.id, verb: verb as BrowserVerb, args, by, timeoutMs, ...(filtered ? { filter } : {}) });
    if (res.apps === 0) throw new CliError(NO_WINDOW, EXIT.noWindow);
    if (res.drivers === 0) throw new CliError(`the window is older than ${what} (it needs level ${needs}); quit Emerald and open it again`);
    if (res.answered === false || res.answer === undefined) {
      throw new CliError(`sent to the window; it did not answer within ${Math.round((timeoutMs + 5000) / 1000)} s`, EXIT.noAnswer);
    }
    const answer: BrowserAnswer = res.answer;
    const code = answer.ok ? EXIT.ok : answerCode(answer);
    if (v.json) {
      printJson({ pane: pane.id, tab: tab.name, verb, ...answer });
      return code;
    }
    if (!answer.ok) throw new CliError(answer.text, code);
    println(answer.text);
    return EXIT.ok;
  } finally {
    client.close();
  }
}

function answerCode(answer: BrowserAnswer): number {
  return answer.reason === 'timeout' ? EXIT.timeout : answer.reason === 'paused' ? EXIT.paused : EXIT.failure;
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

const command: Command = {
  name: 'browser',
  summary: 'drive the page in a browser pane: a snapshot of its controls, a click, a fill, a key, a screenshot (emmer help browser lists the verbs)',
  usage: USAGE,
  run: (argv) => runBrowser(argv),
};

export default command;
