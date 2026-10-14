// The chime for a session that wants attention: two short tones from the
// Web Audio API, no asset to ship. One AudioContext for the window, made on
// the first chime; Electron's autoplay policy lets it run without a user
// gesture, and a suspended one is resumed in case that ever changes.
//
// M9 fix 47: which chime depends on the home the app runs on (ChimeMode,
// from the main process). The real one is for the real home. A private
// EMERALD_HOME is a verify script or a click-through, and its chimes were
// being taken for the user's own, so there the same two tones go out at
// zero gain: nothing is heard, and verify:attention, which counts the
// oscillators started, still counts them. A run that asks to hear one
// (EMERALD_CHIME) gets a lower pair falling instead of rising, so it cannot
// be mistaken for the real chime.

import type { ChimeMode } from '../../preload/api.ts';

const REPEAT_MS = 4000;
const REAL_PEAK = 0.25;

let ctx: AudioContext | null = null;
let repeat: ReturnType<typeof setInterval> | null = null;

export function chime(mode: ChimeMode): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const at = ctx.currentTime;
    const peak = mode === 'muted' ? 0 : REAL_PEAK;
    if (mode === 'test') {
      tone(ctx, 523, at, 0.12, peak);
      tone(ctx, 392, at + 0.14, 0.18, peak);
    } else {
      tone(ctx, 880, at, 0.12, peak);
      tone(ctx, 1175, at + 0.14, 0.18, peak);
    }
  } catch (err) {
    console.warn('[emerald] chime failed', err);
  }
}

// Keeps the four second repeat running while there is something to hear,
// and only then. Safe to call on every change; a timer already running is
// left alone so its beat does not reset.
export function syncRepeat(active: boolean, mode: ChimeMode): void {
  if (active && repeat === null) repeat = setInterval(() => chime(mode), REPEAT_MS);
  if (!active && repeat !== null) {
    clearInterval(repeat);
    repeat = null;
  }
}

function tone(c: AudioContext, hz: number, at: number, seconds: number, peak: number): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = hz;
  // A short ramp each side so the tone starts and ends without a click.
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.01);
  gain.gain.setValueAtTime(peak, at + seconds - 0.03);
  gain.gain.linearRampToValueAtTime(0, at + seconds);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(at);
  osc.stop(at + seconds);
}
