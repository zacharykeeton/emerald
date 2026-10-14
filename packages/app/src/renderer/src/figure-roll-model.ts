// A figure's characters as slots for the odometer roll (M9 fix 235):
// when a shade face's figure changes, "31.6k" to "31.7k", the digit
// that changed rolls up like a drum on a petrol pump, the rest stay
// where they are. The component draws one span per slot with the new
// character as its text, so the line's textContent is still the figure
// whole, and the CSS draws the roll off the slot's data attributes. The
// two strings are aligned on their right ends, as an odometer's drums
// are, so "9.9k" to "10.0k" rolls two digits and grows one slot on the
// left rather than sliding every character one place.
export interface FigureSlot {
  // The character the slot shows now, empty for one that is leaving.
  text: string;
  // The character it showed before the change, when it changed, for the
  // CSS to draw sliding out; null when the slot is still or entering.
  from: string | null;
  // still: nothing to draw. roll: a digit became another digit. fade: a
  // change with a letter or a sign on either side (a carry into "k",
  // "999" to "1k"). enter and leave: the figure grew or shrank by this
  // slot, which fades in or out.
  move: 'still' | 'roll' | 'fade' | 'enter' | 'leave';
}

const DIGIT = /^[0-9]$/;

export function figureSlots(from: string | null, to: string): FigureSlot[] {
  const next = Array.from(to);
  if (from === null) return next.map((text) => ({ text, from: null, move: 'still' }));
  const prev = Array.from(from);
  const width = Math.max(prev.length, next.length);
  const slots: FigureSlot[] = [];
  for (let i = 0; i < width; i++) {
    const p = prev[i - (width - prev.length)];
    const n = next[i - (width - next.length)];
    if (n === undefined) slots.push({ text: '', from: p ?? null, move: 'leave' });
    else if (p === undefined) slots.push({ text: n, from: null, move: 'enter' });
    else if (p === n) slots.push({ text: n, from: null, move: 'still' });
    else if (DIGIT.test(p) && DIGIT.test(n)) slots.push({ text: n, from: p, move: 'roll' });
    else slots.push({ text: n, from: p, move: 'fade' });
  }
  return slots;
}
