// The hosts of ~/.ssh/config the on row offers (M9 fix 1080): every Host
// line's patterns that carry no *, ? or !, in file order, each with the
// destination ssh would reach (user@HostName when both are set under it,
// else HostName, else the name). The name is what ssh is given; the
// destination is for the chip's tooltip. Include is not followed, so a host
// in an included file is not offered; a Match block is skipped whole; a
// name met twice keeps its first entry. Pure, so the renderer can import it.
export function sshConfigHosts(text: string): { name: string; destination: string }[] {
  const out: { name: string; destination: string }[] = [];
  const seen = new Set<string>();
  // The block being read: its names, and its HostName and User so far.
  let block: { names: string[]; hostName: string | null; user: string | null } | null = null;
  // Inside a Match block, an indented Host-shaped line is read as the
  // block's own and skipped with it; an unindented Host ends the block.
  let inMatch = false;
  const flush = (): void => {
    if (block === null) return;
    for (const name of block.names) {
      if (seen.has(name)) continue;
      seen.add(name);
      const host = block.hostName ?? name;
      out.push({ name, destination: block.user !== null && block.hostName !== null ? `${block.user}@${block.hostName}` : host });
    }
    block = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(line);
    if (m === null) continue;
    const keyword = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (keyword === 'host') {
      if (inMatch && /^\s/.test(raw)) continue;
      inMatch = false;
      flush();
      const names = value.split(/\s+/).map(unquote).filter((p) => p !== '' && !/[*?!]/.test(p));
      block = { names, hostName: null, user: null };
      continue;
    }
    if (keyword === 'match') {
      // Everything to the next Host is skipped.
      flush();
      inMatch = true;
      block = { names: [], hostName: null, user: null };
      continue;
    }
    if (block === null) continue;
    // ssh takes the first value it meets for a keyword.
    if (keyword === 'hostname' && block.hostName === null) block.hostName = unquote(value.split(/\s+/)[0] ?? '');
    else if (keyword === 'user' && block.user === null) block.user = unquote(value.split(/\s+/)[0] ?? '');
  }
  flush();
  return out;
}

function unquote(word: string): string {
  return word.length >= 2 && word.startsWith('"') && word.endsWith('"') ? word.slice(1, -1) : word;
}
