import { layersTitle, nextLayers } from './activity-layers.ts';
import type { ActivityLayers } from './activity-layers.ts';

// The layers button (M9 fix 166): one files-button cycling both, the
// band alone and the lanes alone, its face a 14px picture of the state
// on show (a stepped profile over two bars, the profile alone, the bars
// alone) and its tooltip naming the state after the click. The picture
// is drawn here rather than in icons.tsx since nothing else wears it.
// Disabled where the place draws no band (the vertical activity view),
// with the caller's word for why.

interface Props {
  value: ActivityLayers;
  onChange: (next: ActivityLayers) => void;
  disabled?: boolean | undefined;
  // Replaces the cycling tooltip while disabled.
  title?: string | undefined;
  className?: string | undefined;
}

export function LayersButton({ value, onChange, disabled = false, title, className = '' }: Props) {
  return (
    <button className={`files-button activity-layers ${className}`.trim()} data-layers={value} disabled={disabled} title={disabled ? (title ?? layersTitle(value)) : layersTitle(value)} onClick={() => onChange(nextLayers(value))}>
      <LayersIcon value={value} />
    </button>
  );
}

function LayersIcon({ value }: { value: ActivityLayers }) {
  // Each state fills the box: both is the profile over two bars, the
  // band alone a taller profile, the lanes alone two staggered bars (three
  // would read as the density button's glyph beside it), so no
  // state reads as a mark left in a corner.
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true" className="activity-layers-icon">
      {value === 'both' && (
        <>
          <path d="M1,7 L1,5 L4,5 L4,2 L7,2 L7,4 L10,4 L10,3 L13,3 L13,7 Z" fill="currentColor" fillOpacity={0.35} stroke="currentColor" strokeWidth={1} strokeLinejoin="miter" />
          <rect x={1} y={9} width={8} height={1.5} fill="currentColor" />
          <rect x={4} y={12} width={9} height={1.5} fill="currentColor" />
        </>
      )}
      {value === 'band' && <path d="M1,12 L1,8 L4,8 L4,2 L7,2 L7,6 L10,6 L10,4 L13,4 L13,12 Z" fill="currentColor" fillOpacity={0.35} stroke="currentColor" strokeWidth={1} strokeLinejoin="miter" />}
      {value === 'lanes' && (
        <>
          <rect x={1} y={3} width={8} height={2} fill="currentColor" />
          <rect x={4} y={9} width={9} height={2} fill="currentColor" />
        </>
      )}
    </svg>
  );
}
