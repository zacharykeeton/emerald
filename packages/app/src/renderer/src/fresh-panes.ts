// The pane ids room was just made for: New shell here, the heading's +,
// the empty sidebar's New shell, the dialog's split preset and the other
// routes through roomBeside and roomBesideFocused (M9 fix 449), so Pane
// can flash the one it mounts into once, the way fix 63 flashes a pane
// focus lands on, and make it plain that a split happened rather than
// the pane clicked being filled. Not a field on ui.ts, which fixes 439
// and 441 both touch this batch; a Set here needs no store plumbing and
// nothing else reads it. A title-bar split, a layout load and fix 36's
// remount never call markFresh, so they never flash.
const fresh = new Set<string>();

export function markFresh(paneId: string): void {
  fresh.add(paneId);
}

// Read once: the id comes out the moment Pane asks, so a remount or a
// second read of the same pane never flashes twice.
export function takeFresh(paneId: string): boolean {
  return fresh.delete(paneId);
}
