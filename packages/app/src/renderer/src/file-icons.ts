import { file, fileExtensions, fileNames, folder, folderNames } from 'material-icon-theme/dist/material-icons.json';
import { iconFor } from './file-icons-model.ts';
import type { IconMap } from './file-icons-model.ts';

// The file type icons of the tree and the search hits (M9 fix 71): the
// Material set, coloured as VS Code draws it, one SVG per definition.
// The theme's contribution JSON is the lookup (file-icons-model.ts),
// imported by name so the parts the lookup never reads (the expanded
// folder map, the definitions, the light and high contrast variants)
// are shaken out; the SVGs come in through a glob of the package's icons
// folder as URLs, so the bundle carries a path per icon and the file
// itself is fetched the first time a row shows it, and
// electron.vite.config.ts keeps them as files rather than inlining a
// megabyte of base64.
const map: IconMap = { file, fileExtensions, fileNames, folder, folderNames };

const urls = import.meta.glob('../../../../../node_modules/material-icon-theme/icons/*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const byFile = new Map<string, string>();
for (const key in urls) byFile.set(key.slice(key.lastIndexOf('/') + 1), urls[key]!);

// The definition name and the SVG's URL for an entry. A definition's
// file is `<name>.svg`, or `<name>.clone.svg` for the 72 the set draws
// as a recoloured copy of another; one the glob did not find (the set
// and its map out of step) falls back to the plain file or folder, and
// if even that is missing the URL is empty and the img draws nothing.
export function fileIcon(name: string, kind: 'file' | 'dir', expanded = false): { icon: string; url: string } {
  const icon = iconFor(map, name, kind, expanded);
  return { icon, url: urlOf(icon) ?? urlOf(kind === 'dir' ? (expanded ? 'folder-open' : folder) : file) ?? '' };
}

function urlOf(icon: string): string | undefined {
  return byFile.get(`${icon}.svg`) ?? byFile.get(`${icon}.clone.svg`);
}
