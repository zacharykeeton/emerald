import type { HookTestOutcome, HooksStatus, UserConfig } from '../../preload/api.ts';

// Pure helpers behind the hooks banner, covered by node:test.

// The banner is a first-run helper, not a nag: the config can turn it off.
export function shouldPromptHooks(config: UserConfig): boolean {
  return config.promptHooks !== false;
}

// Why the banner shows, in one sentence, or null when there is nothing to
// say. The counts come from the CLI so the banner and `emmer hooks status`
// always agree on what is installed.
export function hooksProblem(status: HooksStatus): string | null {
  if (status.complete) return null;
  const total = status.installed.length + status.missing.length;
  if (status.installed.length === 0) return 'Claude Code hooks are not installed, so emerald cannot see what its sessions are doing.';
  if (status.missing.length > 0) return `Only ${status.installed.length} of ${total} Claude Code hooks are installed, so some session states will be missed.`;
  if (!status.scriptPresent) return 'The emerald hook script is missing, so the Claude Code hooks have nothing to run.';
  if (status.scriptStale) return 'The emerald hook script is older than the one this version ships.';
  if (!status.statusLine) return 'The Claude Code status line is not set to report the model and context fill to emerald.';
  if (!status.skill) return 'The emmer-cli skill, which tells a Claude session how to drive emerald, is not installed or is out of date.';
  return 'The Claude Code hooks need attention.';
}

// The hint after the problem. With the longest problem it fits the banner on
// one line at the window's default 1200px with a few words to spare (M9 fix
// 579), so a longer hint or problem must be measured against that.
export const INSTALL_HINT = "Install edits Claude Code's settings so new sessions report their state.";

// What the Install button says in each phase of the banner.
// 'fighting' (M9 fix 606): another writer keeps taking the hooks out, so
// Install is offered no more until the minute passes.
export type BannerPhase = 'prompt' | 'installing' | 'failed' | 'fighting';

export function installLabel(phase: BannerPhase): string {
  if (phase === 'installing') return 'Installing';
  if (phase === 'failed') return 'Retry';
  return 'Install hooks';
}

export function bannerHint(phase: BannerPhase, error: string): string {
  if (phase === 'fighting') return OTHER_WRITER;
  return phase === 'failed' ? `Install failed: ${error}` : INSTALL_HINT;
}

// The Test button (M9 fix 606) and what it found, each shorter than
// INSTALL_HINT so the banner stays one line; the tooltip names the file.
export const TEST_LABEL = 'Test';
export const TESTING_LABEL = 'Testing';
export const OTHER_WRITER = 'Another program, or a second emerald, keeps rewriting these settings.';

export function testText(result: HookTestOutcome): string {
  switch (result) {
    case 'passed':
      return 'Test passed: the hook reached emerald.';
    case 'no-script':
      return 'Test failed: the hook script is missing.';
    case 'no-daemon':
      return "Test failed: emerald's daemon is not running.";
    case 'old-daemon':
      return 'Test failed: the daemon predates the Test; restart it.';
    case 'not-heard':
      return 'Test failed: the hook ran but emerald never heard it.';
  }
}

// A CLI that could not run: like Install failed, the text is not ours to
// bound and may take a second line.
export function testFailedText(message: string): string {
  return `Test failed: ${message}`;
}

export interface BannerShown {
  phase: BannerPhase;
  problem: string;
}

// The banner after a status the main process pushed on a settings change
// (M9 fix 606), or null to hide it. An install in flight keeps its phase
// (its own re-read decides); Not now holds for the problem it was clicked
// on, and a different problem raises the banner again.
export function bannerOnStatus(current: BannerShown | null, status: HooksStatus, dismissed: string | null): BannerShown | null {
  if (current !== null && current.phase === 'installing') return current;
  const problem = hooksProblem(status);
  if (problem === null) return null;
  if (current === null && problem === dismissed) return null;
  if (status.fighting) return { phase: 'fighting', problem };
  if (current !== null && current.phase === 'failed' && current.problem === problem) return { phase: 'failed', problem };
  return { phase: 'prompt', problem };
}
