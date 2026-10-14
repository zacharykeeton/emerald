import { useEffect, useState } from 'react';
import { figureSlots } from './figure-roll-model.ts';

// A figure whose digits roll like an odometer's drums when they change
// (M9 fix 235). The text is split into one span per character with the
// new character as its text, so the line's textContent is the figure
// whole the moment it changes and nothing here waits on a frame; the
// roll is decoration the CSS draws off data-move and data-from (the
// old character sliding out of the slot's ::before while the text
// slides in from below, style.css). The slots that changed at once
// share one generation, so they roll together, and a moving slot is
// keyed by that generation so a second change inside the roll's 300ms
// restarts it on a fresh element rather than swapping the attribute
// under an animation that would not run again. The settle timer clears
// the previous figure after the roll, which drops the leaving slots and
// the attributes; under prefers-reduced-motion the CSS draws no roll
// and the timer runs the same. The roll's length is the root's
// --figure-roll-ms, read once per change so a frame that slows the CSS
// (verify:shade's odometer frame sets it to seconds) keeps the drum on
// screen as long; 300ms when it is unset.
export const ROLL_MS = 300;

function rollMs(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--figure-roll-ms').trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n < 0) return ROLL_MS;
  return v.endsWith('ms') ? n : n * 1000;
}

interface Roll {
  from: string | null;
  to: string;
  gen: number;
}

export function RollingFigure({ text }: { text: string }) {
  const [roll, setRoll] = useState<Roll>({ from: null, to: text, gen: 0 });
  // A new figure lands in the same render it arrived in: the state is
  // derived here rather than in an effect so the text is never a frame
  // behind the session.
  if (roll.to !== text) setRoll({ from: roll.to, to: text, gen: roll.gen + 1 });
  const { from, to, gen } = roll;
  useEffect(() => {
    if (from === null) return;
    const timer = setTimeout(() => setRoll((r) => (r.gen === gen ? { ...r, from: null } : r)), rollMs());
    return () => clearTimeout(timer);
  }, [from, gen]);
  const slots = figureSlots(from, to);
  return (
    <>
      {slots.map((s, i) => {
        // Keyed from the right, where the still digits are, so a slot
        // that enters on the left never re-mounts the ones beside it.
        const key = s.move === 'still' ? `${slots.length - i}` : `${slots.length - i}:${gen}`;
        return (
          <span key={key} className="figure-slot" data-move={s.move === 'still' ? undefined : s.move} data-from={s.from ?? undefined}>
            <span className="figure-slot-in">{s.text}</span>
          </span>
        );
      })}
    </>
  );
}
