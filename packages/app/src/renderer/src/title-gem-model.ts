import type { SessionInfo } from '@emerald/shared';
import { markKind, workingMotion } from '@emerald/shared';
import type { Skin } from './skin.ts';

// The title-bar gem under the Emerald skin (M9 fix 571, handoff 8.1 and
// 8.4): the icon's flush gem at full size in 256-space, no ground and no
// sparkle. Facet i is the quad IO[i], IO[i+1], IT[i+1], IT[i], clockwise
// from the top, in paint order, then the table; each is filled and stroked
// in its own colour so neighbours meet with no ground between them. Its own
// file with no JSX, so node --test can read it.
export const GEM_FACETS: readonly { d: string; fill: string }[] = [
  { d: 'M104 40L152 40L140 84L116 84Z', fill: '#57d99c' },
  { d: 'M152 40L196 84L158 102L140 84Z', fill: '#3cc184' },
  { d: 'M196 84L196 172L158 154L158 102Z', fill: '#22905c' },
  { d: 'M196 172L152 216L140 172L158 154Z', fill: '#176a44' },
  { d: 'M152 216L104 216L116 172L140 172Z', fill: '#1c7f51' },
  { d: 'M104 216L60 172L98 154L116 172Z', fill: '#259a63' },
  { d: 'M60 172L60 84L98 102L98 154Z', fill: '#45c98c' },
  { d: 'M60 84L104 40L116 84L98 102Z', fill: '#9ff2c8' },
  { d: 'M116 84L140 84L158 102L158 154L140 172L116 172L98 154L98 102Z', fill: '#2fb67a' },
];

export const GEM_OUTLINE = 'M104 40L152 40L196 84L196 172L152 216L104 216L60 172L60 84Z';

// The glint's slanted band, 44 wide, swept across the gem under its clip.
export const GLINT_BAND = 'M40 40h44l-60 176h-44z';
export const GLINT_FILL = '#eafff4';

// Whether the gem glints: only under Emerald with the sidebar collapsed,
// where the rows' marks cannot be seen, and while some Claude session is
// working, by the same test that cycles a Claude row's mark (Sidebar's
// workingMotion and markKind), so a stale session or a plain shell does not
// count. Reduced motion is the CSS's, not this.
export function titleGlint(skin: Skin, sidebarCollapsed: boolean, sessions: Iterable<SessionInfo>): boolean {
  if (skin !== 'emerald' || !sidebarCollapsed) return false;
  for (const s of sessions) {
    if (markKind(s) === 'claude' && workingMotion(s) !== null) return true;
  }
  return false;
}
