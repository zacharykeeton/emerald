import type React from 'react';
import { StarGlyph } from './star.tsx';
import { useSkin } from './skin.ts';

// Claude Code's own sessions, the history row, the Sessions tab and a
// transcript's tab (M9 fix 570): the star under Classic, a still ◆ in the
// gem font under Emerald, so no Classic star is drawn under Emerald; the
// colour stays the caller's class, through currentColor either way.
export function ClaudeStar({ size = 12, className }: { size?: number | undefined; className?: string | undefined }) {
  const skin = useSkin();
  if (skin !== 'emerald') return <StarGlyph size={size} {...(className === undefined ? {} : { className })} />;
  return (
    <span className={className === undefined ? 'gem-still' : `${className} gem-still`} data-glyphs="gem" data-glyph="◆" aria-hidden="true" style={{ '--mark-cell': `${size}px` } as React.CSSProperties}>
      ◆
    </span>
  );
}
