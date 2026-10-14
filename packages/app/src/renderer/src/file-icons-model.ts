// The pure part of the file type icons (M9 fix 71): which icon of the
// Material set (material-icon-theme, the VS Code icon theme) a row gets,
// from the theme's own contribution map, which file-icons.ts binds to the
// SVGs. The map is passed in so this can be tested from node against the
// JSON on disk.

// The parts of VS Code's icon theme contribution the lookup reads: a
// definition name per file name, per extension and per folder name, and
// the two fallbacks. The open form of a folder is the closed name with
// `-open` on it throughout the set (its folderNamesExpanded map says so
// for every one of its 4654 folders), so that map is not carried; it is
// 150 KB of the bundle otherwise.
export interface IconMap {
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  file: string;
  folder: string;
}

const OPEN = '-open';

// The definition name for an entry. A file by its exact name first
// (`package.json`, `readme.md`), the theme's keys being mostly lowercase
// with a few cased ones, so both spellings are tried; else the longest
// dotted suffix in the extension map (`d.ts` before `ts`, `spec.tsx`
// before `tsx`); else the plain file. A folder by its name, open or
// closed, else the plain folder.
export function iconFor(map: IconMap, name: string, kind: 'file' | 'dir', expanded = false): string {
  const lower = name.toLowerCase();
  if (kind === 'dir') {
    const closed = map.folderNames[name] ?? map.folderNames[lower] ?? map.folder;
    return expanded ? closed + OPEN : closed;
  }
  const byName = map.fileNames[name] ?? map.fileNames[lower];
  if (byName !== undefined) return byName;
  // Every suffix after a dot, longest first: `a.d.ts` tries `d.ts` then `ts`.
  for (let i = lower.indexOf('.'); i !== -1; i = lower.indexOf('.', i + 1)) {
    const ext = lower.slice(i + 1);
    if (ext === '') break;
    const byExt = map.fileExtensions[ext];
    if (byExt !== undefined) return byExt;
  }
  return map.file;
}
