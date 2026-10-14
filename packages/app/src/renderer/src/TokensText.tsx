import { tokensParts } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';

// The token reading the row and the pane title draw (M9 fix 154): the
// parts of tokensText laid out with the cached share between them on
// the row ("↑9.1M (8.5M cached) ↓61.7k"), bare on the title, which keeps
// the reading it had (ruled 2026-09-14). The parenthetical is its own
// span so the row's squeeze drops it first (style.css). One component
// for both so a change to the reading lands on every face at once.
//
// M9 fix 155: each arrow is a small filled SVG, a stem with a solid
// head at the text's height, since the UI font's U+2191 is a hairline
// beside the first digit and "↑9.4k" read as "19.4k" at a glance; bold
// did not help, the glyph's stem staying a hairline at 700. The glyph
// stays in the span, visually hidden, so the reading's textContent is
// still "↑9.4k ↓130" for the scripts, the clipboard and a screen reader,
// and tokensText is the text form as before.

interface Props {
  session: Pick<SessionInfo, 'tokens'>;
  className: string;
  cached: boolean;
}

export function TokensText({ session, className, cached }: Props) {
  const p = tokensParts(session);
  if (p === null) return null;
  return (
    <span className={className}>
      <TokensArrow dir="up" />
      {p.up}
      {cached && p.cached !== null && <span className="tokens-cached"> ({p.cached} cached)</span>}{' '}
      <TokensArrow dir="down" />
      {p.down}
    </span>
  );
}

// The arrow as a mark: a 10 by 14 box, the head a filled triangle five
// deep over a two-wide stem, drawn up and flipped for down; the glyph
// beside it is the text and takes no room.
export function TokensArrow({ dir }: { dir: 'up' | 'down' }) {
  return (
    <span className="tokens-arrow" data-dir={dir}>
      <svg className="tokens-arrow-icon" viewBox="0 0 10 14" aria-hidden="true" style={dir === 'down' ? { transform: 'scaleY(-1)' } : undefined}>
        <path d="M5 0 L10 5.5 L6.2 5.5 L6.2 14 L3.8 14 L3.8 5.5 L0 5.5 Z" fill="currentColor" />
      </svg>
      <span className="tokens-arrow-text">{dir === 'up' ? '↑' : '↓'}</span>
    </span>
  );
}
