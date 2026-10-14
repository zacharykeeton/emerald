import { GEM_FACETS, GEM_OUTLINE, GLINT_BAND, GLINT_FILL } from './title-gem-model.ts';

// The title-bar gem under the Emerald skin (M9 fix 571). The clip sits on
// the outer group and the glint's transform on the inner one, as the board
// draws it: a transform on the clipped group itself would carry the clip
// along with the band. The clip's id is fixed, since the title row is drawn
// once per window.
export function TitleGem() {
  return (
    <svg className="title-gem" viewBox="40 40 176 176" width="12" height="12" aria-hidden="true">
      <defs>
        <clipPath id="title-gem-clip">
          <path d={GEM_OUTLINE} />
        </clipPath>
      </defs>
      {GEM_FACETS.map((f) => (
        <path key={f.d} d={f.d} fill={f.fill} stroke={f.fill} strokeWidth={3} strokeLinejoin="round" />
      ))}
      <g clipPath="url(#title-gem-clip)">
        <g className="title-gem-glint">
          <path d={GLINT_BAND} fill={GLINT_FILL} opacity={0.85} />
        </g>
      </g>
    </svg>
  );
}
