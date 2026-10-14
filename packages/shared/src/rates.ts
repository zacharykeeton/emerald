import type { SessionTokens } from './session.ts';
import { tokensUp } from './session.ts';

// API rates in dollars per million tokens (M9 fix 154), one row per
// model family, so the context card can price each part of the running
// sum beside Claude Code's own total. Claude Code's figure is the one to
// trust; these are ours and go stale when prices move, which the card
// says when the parts' sum and the total drift apart. Read on 2026-09-14:
// cache writes are a quarter over the fresh rate and cache reads a
// tenth of it on every family but Fable 5.1, whose reads are cheaper.
// M9 fix 278: a cache write has two rates, by the TTL asked for, and
// cacheWrite above was the 5-minute one all along (1.25x fresh); a
// 1-hour write is 2x fresh, and every request Claude Code makes on this
// box is a 1-hour write, so cacheWrite1h is read on 2026-09-18.
// M9 fix 444: Opus 5.5's row, read off the pricing table on 2026-09-26
// ($4 fresh, $20 output, cache reads $0.20, the write rates at the
// table's usual 1.25x and 2x of fresh).
// M9 fix 464: Opus 4.8's row, which this box has run, read off the
// pricing table on 2026-09-28 ($5 fresh, $25 output, the same as Opus 5,
// so its cache rates are Opus 5's).

export interface ModelRates {
  family: string;
  fresh: number;
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export const MODEL_RATES: readonly ModelRates[] = [
  { family: 'Fable 5.1', fresh: 10, cacheWrite: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 },
  { family: 'Opus 5', fresh: 5, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  { family: 'Opus 4.8', fresh: 5, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  { family: 'Opus 5.5', fresh: 4, cacheWrite: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  { family: 'Sonnet 5', fresh: 2, cacheWrite: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
  { family: 'Haiku 4.5', fresh: 1, cacheWrite: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 },
];

// Every family's first word, for modelWord's fallback below; deduped,
// since Opus wears three rows.
const FAMILY_WORDS: readonly string[] = Array.from(new Set(MODEL_RATES.map((r) => r.family.split(' ')[0]!.toLowerCase())));

// A model id or status-line name lowercased, its decimal point turned
// back from a hyphen to a dot, and every other separator turned to a
// space, padded with a leading and trailing space so a family name can
// be found as a whole word run. A model id spells its decimal point as
// a hyphen ("claude-fable-5-1", "claude-haiku-4-5"), which the table's
// own names spell as a dot ("Fable 5.1", "Haiku 4.5"); a digit-hyphen-
// digit run is turned back into a dot before the rest of the
// punctuation becomes spaces, or those families never match their own
// model. A trailing date ("-20260301") is dropped first (M9 fix 464),
// or a family with a single number reads it as a decimal ("sonnet
// 5.20260301").
function flatten(model: string): string {
  return ` ${model
    .toLowerCase()
    .replace(/-\d{8}\b/, '')
    .replace(/(\d)-(\d)/g, '$1.$2')
    .replace(/[^a-z0-9.]+/g, ' ')} `;
}

// The rates for a model as the status line names it ("Opus 5 (1M
// context)", "claude-opus-5[1m]"), matched on the family's name and
// number standing together whatever the case and the separator, so
// "sonnet-4-5" is not Sonnet 5; null for a model not in the table, whose
// card shows tokens alone. Safe in either row order: "opus 5.5" does
// not contain "opus 5 " as a substring, so a shorter family name never
// steals a longer one's match.
export function ratesFor(model: string | null): ModelRates | null {
  if (model === null) return null;
  const flat = flatten(model);
  for (const r of MODEL_RATES) {
    if (flat.includes(` ${r.family.toLowerCase()} `)) return r;
  }
  return null;
}

// The model's family as one word for a glance-read row ("Fable", "Opus",
// "Sonnet", "Haiku"), matched the same way as ratesFor; null for a model
// not in the table. When the model names a known family with a number
// the table does not carry (a flat "opus 6" matches no row), the word
// alone is still read off the family word standing next to a bare
// integer, so a future point release still says "Opus" while ratesFor
// stays null and prices nothing made up; a dotted number right after
// the family word ("sonnet 4.5") is a different, unlisted family and
// stays null throughout, since it is not the bare-integer shape a new
// release wears.
export function modelWord(model: string | null): string | null {
  const rates = ratesFor(model);
  if (rates !== null) return rates.family.split(' ')[0]!;
  if (model === null) return null;
  const words = flatten(model)
    .trim()
    .split(' ')
    .filter((w) => w.length > 0);
  for (let i = 0; i < words.length - 1; i++) {
    const word = words[i]!;
    if (FAMILY_WORDS.includes(word) && /^\d+$/.test(words[i + 1]!)) {
      return word[0]!.toUpperCase() + word.slice(1);
    }
  }
  return null;
}

// Each part of the sum priced at its rate, in dollars.
export interface CostParts {
  fresh: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  total: number;
}

export function costParts(t: SessionTokens, r: ModelRates): CostParts {
  const per = (n: number, rate: number): number => (n / 1_000_000) * rate;
  // The 1-hour share at its own rate, the rest at the 5-minute one; no
  // split (t.cacheWrite1h absent or 0) prices the whole at the 5-minute
  // rate, as before fix 278. The two never show as separate lines, so
  // cacheWrite here is their sum, the way it always was.
  const write1h = t.cacheWrite1h ?? 0;
  const cacheWrite = per(t.cacheWrite - write1h, r.cacheWrite) + per(write1h, r.cacheWrite1h);
  const parts = { fresh: per(t.fresh, r.fresh), cacheWrite, cacheRead: per(t.cacheRead, r.cacheRead), output: per(t.output, r.output) };
  return { ...parts, total: parts.fresh + parts.cacheWrite + parts.cacheRead + parts.output };
}

// What the same traffic would have cost with no cache: the whole sent
// count at the fresh rate plus the output at the out rate, the answer to
// "is that 9.1M what a key would pay for".
export function uncachedCost(t: SessionTokens, r: ModelRates): number {
  return (tokensUp(t) / 1_000_000) * r.fresh + (t.output / 1_000_000) * r.output;
}

// Whether our table and Claude Code's total disagree by more than a few
// percent, which says the table is old (or the session changed model).
export function ratesLookStale(estimate: number, actual: number): boolean {
  if (actual <= 0.01) return false;
  return Math.abs(estimate - actual) / actual > 0.05;
}

// Dollars the way every price in the window prints them (M9 fix 395):
// dollars and cents at every figure, so "$1.40", "$0.03", "$47.31",
// "$125.88". Until fix 395 a figure of ten dollars or more was rounded
// to the dollar, which left the lid's spend and the sidebar's cost
// standing still for an hour and then jumping a whole dollar; the cents
// are what says a price is moving. The one reader that still drops the
// dollars is the sidebar at its narrowest level (fix 221), which cuts
// the figure it is given rather than asking for a shorter one.
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
