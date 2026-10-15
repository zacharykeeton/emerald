import type { Command } from '../command.ts';
import activity from './activity.ts';
import browser from './browser.ts';
import conflicts from './conflicts.ts';
import daemon from './daemon.ts';
import explain from './explain.ts';
import feed from './feed.ts';
import focus from './focus.ts';
import hooks from './hooks.ts';
import kill from './kill.ts';
import ls from './ls.ts';
import read from './read.ts';
import newSession from './new.ts';
import open from './open.ts';
import prompt from './prompt.ts';
import prompts from './prompts.ts';
import resume from './resume.ts';
import rm from './rm.ts';
import send from './send.ts';
import set from './set.ts';
import shell from './shell.ts';
import skill from './skill.ts';
import update from './update.ts';
import usage from './usage.ts';
import wait from './wait.ts';

// Every command, in the order `emmer help` lists them.
export const commands: Command[] = [ls, newSession, shell, send, read, wait, prompt, prompts, explain, activity, usage, conflicts, set, kill, resume, rm, focus, open, browser, hooks, skill, daemon, update, feed];

export function findCommand(name: string): Command | undefined {
  return commands.find((c) => c.name === name);
}
