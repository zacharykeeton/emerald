import { useEffect, useRef, useState } from 'react';
import type { BannerPhase } from './hooks-banner-model.ts';
import { TESTING_LABEL, TEST_LABEL, bannerHint, bannerOnStatus, hooksProblem, installLabel, shouldPromptHooks, testFailedText, testText } from './hooks-banner-model.ts';

interface Shown {
  phase: BannerPhase;
  problem: string;
  settings: string;
  // The install error, for the failed phase.
  error: string;
  // What the last Test found (M9 fix 606), in place of the hint.
  test: string | null;
  testing: boolean;
}

// Offers to install the Claude Code hooks when `emmer hooks status` says
// they are incomplete. Checked when the window loads, after the config is
// read, so a user who set promptHooks to false never sees it. The install
// runs through the shipped CLI in the main process; sessions already running
// keep going without hooks, which the text says. Since M9 fix 606 the main
// process watches the settings file and the banner rises and lowers with it;
// it never installs on its own; Test sends one event through the installed
// hook to the daemon.
export function HooksBanner() {
  const [shown, setShown] = useState<Shown | null>(null);
  // The problem Not now was clicked on: a pushed status with the same
  // problem keeps the banner down, a different one raises it.
  const dismissed = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void (async () => {
      try {
        const info = await window.emerald.info();
        if (!shouldPromptHooks(info.config)) return;
        const status = await window.emerald.hooksStatus();
        if (cancelled) return;
        const problem = hooksProblem(status);
        if (problem !== null) setShown({ phase: status.fighting ? 'fighting' : 'prompt', problem, settings: status.settings, error: '', test: null, testing: false });
        unsubscribe = window.emerald.onHooksChanged((next) => {
          setShown((current) => {
            // The install's own re-read decides.
            if (current !== null && current.phase === 'installing') return current;
            const shape = bannerOnStatus(current, next, dismissed.current);
            if (shape === null) return null;
            const error = shape.phase === 'failed' && current !== null ? current.error : '';
            return { phase: shape.phase, problem: shape.problem, settings: next.settings, error, test: null, testing: false };
          });
        });
      } catch (err) {
        // Nothing to offer when the CLI cannot run (a dev tree without a
        // CLI build); the console says why.
        console.warn('[emerald] hooks check skipped', err);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (shown === null) return null;

  const install = async () => {
    setShown({ ...shown, phase: 'installing', test: null });
    try {
      await window.emerald.hooksInstall();
      const status = await window.emerald.hooksStatus();
      const problem = hooksProblem(status);
      if (problem === null) setShown(null);
      else setShown({ phase: 'failed', problem, settings: status.settings, error: 'still incomplete after installing', test: null, testing: false });
    } catch (err) {
      setShown({ ...shown, phase: 'failed', error: err instanceof Error ? err.message : String(err), test: null, testing: false });
    }
  };

  const runTest = async () => {
    setShown((s) => (s === null ? s : { ...s, testing: true }));
    let text: string;
    try {
      const { result } = await window.emerald.hooksTest();
      text = testText(result);
    } catch (err) {
      text = testFailedText(err instanceof Error ? err.message : String(err));
    }
    setShown((s) => (s === null ? s : { ...s, test: text, testing: false }));
  };

  const hint = bannerHint(shown.phase, shown.error);
  return (
    <div className="hooks-banner" data-phase={shown.phase} title={`Settings file: ${shown.settings}`}>
      <span className="hooks-banner-text">
        {shown.problem} {shown.test ?? hint}
      </span>
      <button className="hooks-install" onClick={() => void install()} disabled={shown.phase === 'installing' || shown.phase === 'fighting'}>
        {installLabel(shown.phase)}
      </button>
      <button className="secondary hooks-test" onClick={() => void runTest()} disabled={shown.phase === 'installing' || shown.testing}>
        {shown.testing ? TESTING_LABEL : TEST_LABEL}
      </button>
      <button
        className="secondary hooks-dismiss"
        onClick={() => {
          dismissed.current = shown.problem;
          setShown(null);
        }}
        disabled={shown.phase === 'installing'}
      >
        Not now
      </button>
    </div>
  );
}
