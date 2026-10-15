import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeConfigDir } from '@emerald/shared/claude-home';
import { parse, positionals } from '../args.ts';
import { EXIT, usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { runHookTest } from '../hook-test.ts';
import type { HookTestOutcome } from '../hook-test.ts';
import { HOOK_EVENTS, hooksStatus, installHooks, skillPaths, statusLinePaths, recentInstalls, uninstallHooks, writtenPath } from '../hooks-install.ts';
import type { DeadEntry, HooksInstallOptions } from '../hooks-install.ts';
import { emeraldHome } from '../paths.ts';

const options = {
  json: { type: 'boolean', default: false },
  // Claude Code's user settings; the default is ~/.claude/settings.json,
  // or CLAUDE_CONFIG_DIR's.
  settings: { type: 'string' },
  // One Test event through the installed hook to the daemon (M9 fix 606).
  test: { type: 'boolean', default: false },
} as const;

// The shipped hook script sits in packages/cli/hooks, one level above src
// and dist alike. Installing copies it under ~/.emerald so the settings entry
// keeps working after the repo moves.
export function hookOptions(settings: string | undefined): HooksInstallOptions {
  return {
    settingsPath: settings ?? process.env['CLAUDE_SETTINGS'] ?? path.join(claudeConfigDir(), 'settings.json'),
    scriptDest: path.join(emeraldHome(), 'hooks', 'claude-hook.cmd'),
    scriptSource: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'claude-hook.cmd'),
  };
}

// The emerald mod (M9 fix 726), shipped beside the CLI at cli/mod in the
// repo and the stage alike. Whether it is there is all a status can say;
// whether it loaded only a session knows, and the daemon's log says so.
function modShipped(): { modDir: string; modPresent: boolean } {
  const modDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'mod');
  let modPresent = false;
  try {
    modPresent = fs.statSync(path.join(modDir, 'hooks', 'register.js')).isFile();
  } catch {
    // Not shipped.
  }
  return { modDir, modPresent };
}

const command: Command = {
  name: 'hooks',
  summary: "install or remove emerald's Claude Code hooks",
  usage: 'emmer hooks install|uninstall|status [--test] [--json] [--settings <settings.json>]',
  async run(argv) {
    const parsed = parse(argv, options);
    const { action } = positionals(parsed, ['action']);
    const opts = hookOptions(parsed.values.settings);
    const json = parsed.values.json;
    if (parsed.values.test && action !== 'status') throw usageError('--test goes with hooks status');
    switch (action) {
      case 'install': {
        const { changed, removed } = installHooks(opts);
        const sl = statusLinePaths(opts);
        const skill = skillPaths(opts).dest;
        // What is left dead after the install is anyone else's (M9 fix 710).
        const left = hooksStatus(opts).dead;
        if (json) printJson({ changed, events: HOOK_EVENTS.length, settings: opts.settingsPath, script: opts.scriptDest, statusLine: sl.cmdDest, skill, removed, left });
        else {
          println(`${changed ? 'installed' : 'already installed'}: ${HOOK_EVENTS.length} hooks and the status line in ${opts.settingsPath}`);
          println(`script: ${opts.scriptDest}`);
          println(`status line: ${sl.cmdDest} (a status line that was there before still runs after it)`);
          println(`skill: ${skill}`);
          if (removed.length === 1) println('removed: 1 entry that pointed at a missing file');
          else if (removed.length > 1) println(`removed: ${removed.length} entries that pointed at missing files`);
          for (const d of left) println(deadLine(d));
        }
        return EXIT.ok;
      }
      case 'uninstall': {
        const { changed, removed } = uninstallHooks(opts);
        if (json) printJson({ changed, settings: opts.settingsPath, removed });
        else {
          println(`${changed ? 'removed' : 'nothing to remove'}: emmer hooks in ${opts.settingsPath}, the scripts and the skill`);
          if (removed.length === 1) println('removed: 1 entry that pointed at a missing file');
          else if (removed.length > 1) println(`removed: ${removed.length} entries that pointed at missing files`);
        }
        return EXIT.ok;
      }
      case 'status': {
        const s = hooksStatus(opts);
        // A dead entry of ours counts against complete; anyone else's is
        // named and does not, since no install of ours clears it (M9 fix 710).
        const complete = s.missing.length === 0 && s.scriptPresent && !s.scriptStale && s.statusLine && s.skill && !s.dead.some((d) => d.ours);
        const test = parsed.values.test ? await runHookTest(opts.scriptDest) : null;
        const written = writtenPath(opts);
        // The mod never counts toward complete: the hook file is its
        // fallback, and the banner must not rise for it.
        const { modDir, modPresent } = modShipped();
        if (json) printJson({ ...s, complete, settings: opts.settingsPath, script: opts.scriptDest, written, modDir, modPresent, ...(test !== null ? { test } : {}) });
        else {
          println(`settings: ${opts.settingsPath}`);
          println(`installed: ${s.installed.length}/${HOOK_EVENTS.length}${s.missing.length > 0 ? ` (missing ${s.missing.join(', ')})` : ''}`);
          println(`script: ${s.scriptPresent ? (s.scriptStale ? 'present but differs from the shipped copy' : 'present') : 'missing'} at ${opts.scriptDest}`);
          const version = s.statusLineVersion === null ? 'no version, from before the bash pass-through' : `version ${s.statusLineVersion}`;
          println(`status line: ${s.statusLine ? 'set to' : 'not set to'} ${statusLinePaths(opts).cmdDest} (${version}, shipped ${s.shippedStatusLineVersion})`);
          println(`skill: ${s.skill ? 'present' : 'missing or differs from the shipped copy'} at ${skillPaths(opts).dest}`);
          println(modPresent ? `mod: shipped at ${modDir}, loaded by Emerald's own Claude sessions` : `mod: missing at ${modDir}; Emerald's Claude sessions post through the hook file alone`);
          for (const d of s.dead) println(deadLine(d));
          if (s.fighting) println(`another writer: ${recentInstalls(opts)} installs in the last minute, and the file has changed since the last one`);
          if (test !== null) println(testLine(test, opts.scriptDest));
        }
        // Like daemon status: the exit code answers "are we good" for scripts.
        if (test !== null) return complete && test === 'passed' ? EXIT.ok : EXIT.failure;
        return complete ? EXIT.ok : EXIT.failure;
      }
      default:
        throw usageError(`unknown hooks action ${JSON.stringify(action)}`);
    }
  },
};

function deadLine(d: DeadEntry): string {
  return d.ours
    ? `missing file: ${d.event} runs ${d.path} (an old emerald entry; emmer hooks install takes it out)`
    : `missing file: ${d.event} runs ${d.path} (not emerald's; left as it is)`;
}

function testLine(test: HookTestOutcome, script: string): string {
  switch (test) {
    case 'passed':
      return `test: passed, a Test event went through ${script} and reached emmerd`;
    case 'no-script':
      return `test: failed, the hook script is missing at ${script}`;
    case 'no-daemon':
      return `test: failed, emmerd is not running for ${emeraldHome()}`;
    case 'old-daemon':
      return 'test: failed, emmerd is older than level 59 and cannot take a Test; restart it';
    case 'not-heard':
      return `test: failed, ${script} ran but emmerd never heard the Test`;
  }
}

export default command;
