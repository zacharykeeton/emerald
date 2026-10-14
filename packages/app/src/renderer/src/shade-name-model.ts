// The lid's name (M9 fix 372, docs/design/shade-lid.md section 7): the
// session's name split into an identity line and a subject line where
// it can be, and a size step from the identity's character count, so a
// 49-character sentence survives on the hero without an ellipsis.
// Nothing is ever truncated on the lid. The pixel size per step is the
// shade's container query's (style.css), one per tier, since the tiers
// are CSS and not JS; the step is what the model decides.

export interface ShadeName {
  // The hero line.
  identity: string;
  // The second line under it, or null when the name is one line.
  subject: string | null;
  // 1 for a short identity (up to 12 characters) through 4 for a long
  // one (past 32), the hero's size class.
  step: 1 | 2 | 3 | 4;
}

// A leading id token, read only on a name longer than this: `Batch
// 5257 board chrome` splits at the number, `fix-runway-wrap` does not.
const SPLIT_PAST = 18;
const ID_TOKEN = /^(\S+[ -]#?\d[\w.]*|#?\d[\w.]*)\s+(.+)$/;

export function nameStep(chars: number): ShadeName['step'] {
  if (chars <= 12) return 1;
  if (chars <= 20) return 2;
  if (chars <= 32) return 3;
  return 4;
}

// In order: a colon with words on both sides; otherwise, past 18
// characters, a leading id token before a space; otherwise the whole
// name on one line. A colon is never assumed.
export function shadeName(name: string): ShadeName {
  const whole = name.trim();
  const colon = whole.indexOf(':');
  if (colon > 0) {
    const identity = whole.slice(0, colon).trim();
    const subject = whole.slice(colon + 1).trim();
    if (identity !== '' && subject !== '') return { identity, subject, step: nameStep(identity.length) };
  }
  if (whole.length > SPLIT_PAST) {
    const m = ID_TOKEN.exec(whole);
    if (m !== null) return { identity: m[1]!, subject: m[2]!, step: nameStep(m[1]!.length) };
  }
  return { identity: whole, subject: null, step: nameStep(whole.length) };
}
