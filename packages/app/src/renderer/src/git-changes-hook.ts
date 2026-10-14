import { useEffect, useState } from 'react';
import type { GitChanges } from '../../preload/api.ts';
import { useGitPoll } from './git-poll.ts';

// The changed files with their line counts (M9 fix 70), on the rail's
// cadence, for the counts on the tree's rows and the Changed list. Out of
// FilesRail since M9 fix 200, so the sidebar can read a folder's changes
// per heading. The main process leaves the ignored files out already.
export const EMPTY_CHANGES: GitChanges = { root: null, files: [] };

// Fix 492: the stamp carries the status code. A git add of a modified file
// changes the code and no count, and a stamp of counts alone kept the
// list's old amber M until some count moved. A reply whose status and
// numstat straddled a git add is corrected by the next poll, since its
// stamp differs from the right one.
export function changesStamp(c: GitChanges): string {
  return [c.root, ...c.files.map((f) => `${f.path}:${f.code}:${f.added}:${f.removed}`)].join('\n');
}

export function useGitChanges(root: string | null, tick: number): GitChanges {
  // The stamp (M9 fix 354): the paths with their counts, so an unchanged
  // list keeps its object between polls.
  return useGitPoll(root, tick, EMPTY_CHANGES, (dir) => window.emerald.files.gitChanges(dir), 'git changes', '', changesStamp);
}

// The count behind a folder heading's mark (M9 fix 200): how many files
// under the folder are changed, on the same cadence as the rail. A folder
// that is not a repository answers once with a null root and is not
// asked again, since it will not become one under the heading; the exited
// group hands a null folder and asks nothing. A reply is told from the
// empty start by identity: useGitPoll hands back the very empty object
// until the first reply lands.
export function useFolderChangeCount(folder: string | null): number {
  const [repo, setRepo] = useState(true);
  const changes = useGitChanges(repo ? folder : null, 0);
  useEffect(() => {
    setRepo(true);
  }, [folder]);
  useEffect(() => {
    if (changes !== EMPTY_CHANGES && changes.root === null) setRepo(false);
  }, [changes]);
  return changes.files.length;
}
