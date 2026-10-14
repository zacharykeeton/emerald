import type { AttentionSound } from './attention-model.ts';
import { setSessionHushed } from './ui.ts';

// The hush button (M9 fix 190): a crossed speaker in the attention
// colour that stops the chime for one session and keeps its pulse. It
// sits on the sidebar row and, since M9 fix 267, beside the pane's
// waiting figure too, one component so the two press the same way.
// attention.ts leaves a press on data-action="hush" alone (it is neither
// an ack nor a hush of the rest), so the row and the pane go on pulsing
// under it; a second press lets the chime through again. The double
// click is stopped so two quick presses never reach the row's resume.
export function HushButton({ sessionId, hushed, className }: { sessionId: string; hushed: boolean; className?: string }) {
  return (
    <button
      className={className === undefined ? 'sidebar-row-hush' : `sidebar-row-hush ${className}`}
      data-action="hush"
      data-hushed={hushed ? true : undefined}
      title={hushed ? 'Hushed; click to let the chime through again' : 'Hush the chime for this one; the row keeps pulsing'}
      onClick={(ev) => {
        ev.stopPropagation();
        setSessionHushed(sessionId, !hushed);
      }}
      onDoubleClick={(ev) => ev.stopPropagation()}
    >
      <SpeakerIcon sound="off" />
    </button>
  );
}

// A speaker with two waves for repeat, one for once, and a bar across it
// for off, in the current colour like the other icons.
export function SpeakerIcon({ sound }: { sound: AttentionSound }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" />
      {sound !== 'off' && <path d="M10 6a2.5 2.5 0 0 1 0 4" fill="none" stroke="currentColor" strokeWidth="1.2" />}
      {sound === 'repeat' && <path d="M11.8 4a5 5 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="1.2" />}
      {sound === 'off' && <path d="M10 6l4 4M14 6l-4 4" fill="none" stroke="currentColor" strokeWidth="1.2" />}
    </svg>
  );
}
