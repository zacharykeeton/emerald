import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_PROFILE, BROWSER_TIMEOUT_MS, browserUrl, currentTab, findPane, focusPane, paneShowingIn, replaceTab, setPaneView, splitPane } from '@emerald/shared';
import type { BrowserAnswer, BrowserVerb } from '@emerald/shared';
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
} as const;

// The first daemon that relays browser.run (M9 fix 672).
const BROWSER_LEVEL = 63;

const USAGE = [
  'emmer browser <verb> [<args>] [--pane <id>] [--json]',
  '  open <url> [--profile <name>]  a browser pane on the page, beside the pane of the session this runs in; --profile gives it cookies and storage of its own',
  "  snapshot                      the page's controls, each with a ref (@e1), its role, name, value and state",
  "  click <ref>                   a click at the control's centre",
  '  hover <ref>                   the pointer moved over the control',
  '  fill <ref> <text>|--stdin|--file <path>|--clear  the text typed into a field, in place of what it held; --clear empties it',
  '  key <key>                     one key: Enter, Escape, Tab, an arrow, a letter, with Ctrl+, Shift+ or Alt+ before it',
  '  eval <js>|--stdin|--file <path>  an expression run in the page; prints its value as JSON',
  '  screenshot                    a PNG of the page under the emerald home; prints its path',
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
  const own = process.env['EMERALD_SESSION_ID'];
  const { client, hello } = await connectHello();
  try {
    const level = hello.featureLevel ?? 1;
    if (level < BROWSER_LEVEL) throw new CliError(`emmerd ${hello.daemonVersion} is older than emmer browser (level ${level}, needs ${BROWSER_LEVEL}); restart it from the app's banner`);
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
    const res = await client.request('browser.run', { paneId: pane.id, verb: verb as BrowserVerb, args, by, timeoutMs });
    if (res.apps === 0) throw new CliError(NO_WINDOW, EXIT.noWindow);
    if (res.drivers === 0) throw new CliError(`the window is older than emmer browser (it needs level ${BROWSER_LEVEL}); quit Emerald and open it again`);
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
