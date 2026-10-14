// Pure helpers behind the new-session dialog, covered by node:test.

// Turns the extra-args box into argv. Whitespace separates, double quotes
// group so a path with spaces survives, and a backslash before a quote
// keeps it literal. Anything fancier belongs in a real shell.
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  let hasToken = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\' && text[i + 1] === '"') {
      current += '"';
      hasToken = true;
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
      hasToken = true;
    } else if (!inQuotes && /\s/.test(ch)) {
      if (hasToken) out.push(current);
      current = '';
      hasToken = false;
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (hasToken) out.push(current);
  return out;
}

export const RECENT_FOLDERS_MAX = 8;

// Most recent first, no duplicates, capped. Comparison ignores case and the
// slash style because Windows does, so C:/x and c:\x are the same entry.
export function rememberFolder(recent: readonly string[], folder: string, max = RECENT_FOLDERS_MAX): string[] {
  const key = normalizeFolder(folder);
  const rest = recent.filter((f) => normalizeFolder(f) !== key);
  return [folder, ...rest].slice(0, max);
}

export function normalizeFolder(folder: string): string {
  return folder.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}
