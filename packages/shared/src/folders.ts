// M9 fix 194: a label of the person's own on a folder group, kept by the
// daemon (folders.json) so every window and emmer ls title the group the
// same and a session started later in the folder comes up under it. The
// folder is the group's key, the spelling groupCwd has (the daemon's
// realFolder); the label is what the heading shows in place of the
// folder's last segment. The grouping stays by folder underneath.
export interface FolderLabel {
  folder: string;
  label: string;
}

// A label is one short line, as a prompt's name is; a cleared box sets
// null and the heading falls back to the folder's name.
export const FOLDER_LABEL_MAX = 64;

export function isFolderLabel(v: unknown): v is string {
  return typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= FOLDER_LABEL_MAX && !/[\r\n]/.test(v);
}

export function isFolderLabelEntry(v: unknown): v is FolderLabel {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['folder'] === 'string' && o['folder'].length > 0 && isFolderLabel(o['label']);
}
