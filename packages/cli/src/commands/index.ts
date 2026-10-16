import type { Command } from '../command.ts';

// One command's place in the list (M9 fix 736): its name and summary for
// `emmer help`, and a loader, so a run imports the one command it runs and
// its graph rather than all of them. Each summary is a copy of its
// module's; index.test.ts holds the two together.
export interface CommandEntry {
  name: string;
  summary: string;
  load(): Promise<Command>;
}

// Every command, in the order `emmer help` lists them.
export const commands: CommandEntry[] = [
  { name: 'ls', summary: 'list sessions in sidebar order', load: () => import('./ls.ts').then((m) => m.default) },
  { name: 'new', summary: 'start a Claude session in a folder', load: () => import('./new.ts').then((m) => m.default) },
  { name: 'shell', summary: 'start a plain shell session in a folder; --shell picks pwsh, powershell, gitbash or cmd', load: () => import('./shell.ts').then((m) => m.default) },
  { name: 'send', summary: 'type text into a session', load: () => import('./send.ts').then((m) => m.default) },
  { name: 'read', summary: 'print what a session has written to its terminal', load: () => import('./read.ts').then((m) => m.default) },
  { name: 'wait', summary: 'block until a session reaches a state, goes quiet, stalls or exits', load: () => import('./wait.ts').then((m) => m.default) },
  { name: 'prompt', summary: 'send a prompt and wait for the reply', load: () => import('./prompt.ts').then((m) => m.default) },
  { name: 'prompts', summary: 'list, add or remove saved prompts', load: () => import('./prompts.ts').then((m) => m.default) },
  { name: 'explain', summary: 'say why a session is in its state, from its hook events', load: () => import('./explain.ts').then((m) => m.default) },
  { name: 'activity', summary: "the day's activity: each session's working spans and how much ran in parallel", load: () => import('./activity.ts').then((m) => m.default) },
  { name: 'usage', summary: 'a markdown digest of how emerald is used, from the usage record and the hook log', load: () => import('./usage.ts').then((m) => m.default) },
  {
    name: 'conflicts',
    summary: "the conflict forecast: which live sessions' branches would conflict on a merge, on what, and how far each is behind the default",
    load: () => import('./conflicts.ts').then((m) => m.default),
  },
  {
    name: 'set',
    summary: "write a session's checkpoint, a comment and a phase, or set its colour (no <session>: the one this runs in)",
    load: () => import('./set.ts').then((m) => m.default),
  },
  { name: 'kill', summary: 'end a session; it stays listed as exited', load: () => import('./kill.ts').then((m) => m.default) },
  { name: 'resume', summary: 'start an exited session again under the same id', load: () => import('./resume.ts').then((m) => m.default) },
  { name: 'rm', summary: 'forget an exited session', load: () => import('./rm.ts').then((m) => m.default) },
  {
    name: 'focus',
    summary: 'show a session in the focused pane, or focus the pane showing it (the one on the tab in front, else the first in tab order)',
    load: () => import('./focus.ts').then((m) => m.default),
  },
  {
    name: 'open',
    summary:
      "open a file in the window as a tab, with --pane in a pane beside the focused one, or with --beside beside a session's pane (the one on the tab in front, else the first in tab order); --scheme picks the file's own colour scheme; a URL opens a browser pane",
    load: () => import('./open.ts').then((m) => m.default),
  },
  {
    name: 'browser',
    summary: 'drive the page in a browser pane: a snapshot of its controls, a click, a fill, a key, a screenshot (emmer help browser lists the verbs)',
    load: () => import('./browser.ts').then((m) => m.default),
  },
  { name: 'hooks', summary: "install or remove emerald's Claude Code hooks", load: () => import('./hooks.ts').then((m) => m.default) },
  {
    name: 'mod-channel',
    summary: "stream a session's queued prompts to the emerald mod, which starts this itself",
    load: () => import('./mod-channel.ts').then((m) => m.default),
  },
  { name: 'skill', summary: 'print the emmer-cli skill, the guide a Claude session reads to drive emerald', load: () => import('./skill.ts').then((m) => m.default) },
  { name: 'daemon', summary: 'start, stop or show emmerd', load: () => import('./daemon.ts').then((m) => m.default) },
  { name: 'update', summary: "show the app's update state, or click its badge: --check, --download, --install", load: () => import('./update.ts').then((m) => m.default) },
  { name: 'feed', summary: 'publish a build into the update feed, or serve the feed', load: () => import('./feed.ts').then((m) => m.default) },
];

export function findCommand(name: string): CommandEntry | undefined {
  return commands.find((c) => c.name === name);
}
