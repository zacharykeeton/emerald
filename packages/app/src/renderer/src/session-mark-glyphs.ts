import type { Skin } from './skin.ts';

// The session mark's glyphs per skin (M9 fix 570): Classic's still is the
// star SVG (null here), Emerald's the ✦ character; the frames are the four
// characters the cell steps through on the one clock, in the same keyframe
// either way.

// The four stepping frames, Claude Code's transcript asterisks.
export const MARK_FRAMES = ['✳', '✱', '✻', '✽'] as const;

export const GEM_FRAMES = ['◇', '◈', '◆', '✦'] as const;
export const GEM_STILL = '✦';

export function markGlyphs(skin: Skin): { frames: readonly string[]; still: string | null } {
  return skin === 'emerald' ? { frames: GEM_FRAMES, still: GEM_STILL } : { frames: MARK_FRAMES, still: null };
}
