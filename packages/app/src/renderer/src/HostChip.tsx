// The chip that marks a thing as living on another machine (M9 fix 1089):
// a pane's title, a lower-list row of the empty pane and the Files tab's note.
import { hostChipTitle } from './host-marks-model.ts';

export function HostChip({ name, destination }: { name: string; destination: string }) {
  return (
    <span className="host-chip" title={hostChipTitle(name, destination)}>
      {name}
    </span>
  );
}
