// The 12px status column of a file row (M45): the letter of the change, in
// the row's git colour, or empty so the names of a folder's files line up
// whether or not they changed. Shared by the tree, the search hits and
// the Changes list. With onShowDiff (M9 fix 199) a letter is a click
// target that opens the file's diff in the review tab; the click stops
// at the letter so the row does not also open the file.
export function GitLetter({ letter, onShowDiff }: { letter: string | null; onShowDiff?: (() => void) | undefined }) {
  const clickable = letter !== null && onShowDiff !== undefined;
  return (
    <span
      className="git-letter"
      data-letter={letter ?? undefined}
      data-diff={clickable || undefined}
      title={clickable ? 'Show the diff' : undefined}
      onClick={
        clickable
          ? (ev) => {
              ev.stopPropagation();
              onShowDiff();
            }
          : undefined
      }
    >
      {letter ?? ''}
    </span>
  );
}
