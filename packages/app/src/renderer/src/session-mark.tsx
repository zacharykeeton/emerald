import { StarGlyph } from './star.tsx';
import { familyStar } from './session-mark-model.ts';
import { markGlyphs } from './session-mark-glyphs.ts';
import { useSkin } from './skin.ts';

// M46, the session mark: the one mark before a name on a sidebar row, in
// a pane title and on a layout tab, saying what kind of session this is
// and whether it is busy. A Claude session at rest is the eight-spoke
// star the history rows draw (M9 fix 80); while it works the mark cycles
// Claude Code's own transcript asterisks, four text glyphs shown one at a
// time in the same cell (fix 86: the frames used to be a stack slid under
// the cell's clip, a composited move the user's GPU presented once and
// never again, so the row read still; frames switched in place repaint
// and paint everywhere). No glyph is transformed mid-frame, which is why
// it holds at 10px where a spin smears.
// A shell is a prompt with a caret on the baseline, blinking only while
// the shell writes. The colour is the state's (state-<tone> on the cell,
// the star takes currentColor), or the parent's where no tone is given,
// which is how the roster's units colour theirs. The rate the M39
// meter's bars carried lives in the tooltip now. The sizes are the
// mock's cells: 16px on a row and in a title, 12px for a roster unit,
// 13px for a heading unit, 12px for a unit on the title bar (M9 fix 88),
// the star two pixels smaller than its cell, and a 48px face for the
// shade over a pane (M63), the same mark read across a room; the CSS
// sizes the glyphs to match.
// Under the Emerald skin (M9 fix 570) the still is a ◆ and the frames ◇ ◈ ◆ ✦
// in Segoe UI Symbol, on the same keyframe and clock, with data-glyphs="gem"
// on the cell for the CSS. The four are drawn as SVG, not typeset (see GemFrame).
export type MarkSize = 'row' | 'unit' | 'heading' | 'title' | 'face';

// The four stepping frames, Claude Code's transcript asterisks.
export { MARK_FRAMES } from './session-mark-glyphs.ts';

const STAR_SIZE: Record<MarkSize, number> = { row: 14, unit: 10, heading: 11, title: 10, face: 44 };

// The Emerald skin's four glyphs as 16 by 16 drawings (M9 fix 570). Segoe UI
// Symbol's ink centres drifted by 0.6px at 125 and 150 percent zoom (the
// verify block's canvas read, past the 0.5px the plan allows), so the frames
// are drawn rather than typeset: every shape is centred on 8,8 by
// construction. The cell's CSS sizes them at 90 percent of --mark-cell; px is
// the attribute a first paint holds before the sheet answers.
function GemFrame({ glyph, px }: { glyph: string; px: number }) {
  const diamond = 'M8 1.5L14.5 8L8 14.5L1.5 8Z';
  return (
    <svg viewBox="0 0 16 16" width={px} height={px} aria-hidden="true">
      {glyph === '\u25c7' && <path d={diamond} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />}
      {glyph === '\u25c8' && (
        <>
          <path d={diamond} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M8 5L11 8L8 11L5 8Z" fill="currentColor" />
        </>
      )}
      {glyph === '\u25c6' && <path d={diamond} fill="currentColor" />}
      {glyph === '\u2726' && <path d="M8 1.5Q9.04 6.96 14.5 8Q9.04 9.04 8 14.5Q6.96 9.04 1.5 8Q6.96 6.96 8 1.5Z" fill="currentColor" />}
    </svg>
  );
}

// failed (M9 fix 196): the shell's last command exited nonzero, which
// colours the prompt glyph --error until the next command starts.
// family (M9 fix 288): on a unit mark, the model family of the team
// member it stands for (Fable, Opus, Sonnet, Haiku, or null for no
// request yet), which sizes the star by familyStar and the cell and the
// frames through data-family; every other size ignores it, and a unit
// mark that passes none draws as before.
export function SessionMark({ kind, tone, working, failed, size, title, className, family }: { kind: 'claude' | 'shell'; tone?: string | undefined; working: boolean; failed?: boolean | undefined; size: MarkSize; title?: string | undefined; className?: string | undefined; family?: string | null | undefined }) {
  const skin = useSkin();
  if (kind === 'shell') {
    const classes = ['shell-mark'];
    if (className !== undefined) classes.push(className);
    return (
      <span className={classes.join(' ')} data-size={size} data-running={working || undefined} data-failed={failed || undefined} title={title}>
        <span className="shell-mark-glyph">❯</span>
        <span className="shell-mark-caret" />
      </span>
    );
  }
  const glyphs = markGlyphs(skin);
  const classes = ['session-mark'];
  if (tone !== undefined) classes.push(`state-${tone}`);
  if (className !== undefined) classes.push(className);
  const familyName = size === 'unit' && family !== undefined ? (family === null ? 'none' : family) : undefined;
  const star = familyName === undefined ? STAR_SIZE[size] : familyStar(family ?? null);
  const gemPx = Math.round((star + (size === 'face' ? 4 : 2)) * 9) / 10;
  return (
    <span className={classes.join(' ')} data-size={size} data-tone={tone} data-working={working || undefined} data-family={familyName} data-glyphs={skin === 'emerald' ? 'gem' : undefined} title={title}>
      <span className="session-mark-still" data-glyph={glyphs.still ?? undefined}>
        {glyphs.still === null ? <StarGlyph size={star} /> : <GemFrame glyph={glyphs.still} px={gemPx} />}
      </span>
      <span className="session-mark-frames">
        {glyphs.frames.map((glyph) => (
          <span key={glyph} data-glyph={skin === 'emerald' ? glyph : undefined}>
            {skin === 'emerald' ? <GemFrame glyph={glyph} px={gemPx} /> : glyph}
          </span>
        ))}
      </span>
    </span>
  );
}

