// M9 fix 892: each rendered block carries the source line it starts on, so a reveal at a line lands on the block holding it. markdown-it's own token map is 0-based; the attribute is 1-based, as the editor's lines are.
import type { MarkdownIt } from 'markdown-it';

export function installSourceLines(md: MarkdownIt): void {
  md.core.ruler.push('source_line', (state) => {
    for (const t of state.tokens) {
      if (t.block && t.map !== null && t.nesting !== -1 && t.type !== 'inline') t.attrSet('data-source-line', String(t.map[0] + 1));
    }
  });
}

// The index of the last block starting at or before the line: the
// innermost on a tie, since an item and its paragraph share a line. A line
// before the first block gives 0, and an empty list gives -1.
export function blockAtLine(lines: readonly number[], line: number): number {
  if (lines.length === 0) return -1;
  let found = 0;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] as number) <= line) found = i;
  }
  return found;
}

// The editor's FLASH_MS (FileView.tsx).
export const SOURCE_LINE_FLASH_MS = 1500;
