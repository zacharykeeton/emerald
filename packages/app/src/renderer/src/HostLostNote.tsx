// The band under a remote pane's title while the line to its host is lost
// (M9 fix 1090), with a Try now. The theme note's look under its own class,
// and no `.banner`, which the scripts wait to clear.
import { useRef } from 'react';
import { lostBandText, retrySecondsLeft } from './host-marks-model.ts';
import { useNow } from './use-now.ts';

export function HostLostNote({ name, since, retryIn, onTryNow }: { name: string; since: number; retryIn: number | null; onTryNow: () => void }) {
  // The moment each new retryIn arrived, so the countdown runs from it.
  const seen = useRef<{ retryIn: number | null; since: number; at: number } | null>(null);
  if (seen.current === null || seen.current.retryIn !== retryIn || seen.current.since !== since) {
    seen.current = { retryIn, since, at: Date.now() };
  }
  const now = useNow();
  const text = lostBandText(name, since, retrySecondsLeft(retryIn, seen.current.at, now));
  return (
    <div className="host-lost-note" data-host={name}>
      <span className="host-lost-note-text" title={text}>
        {text}
      </span>
      <button className="host-lost-try" onClick={onTryNow}>
        Try now
      </button>
    </div>
  );
}
