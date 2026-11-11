// M9 fix 1091: OSC 52, a program's write to the clipboard of the terminal it
// is shown in. Claude Code copies this way over ssh (its "c to copy" of a
// login URL among them), and Windows Terminal honours these writes too, so a
// pane's terminal takes them onto this PC's clipboard. Pure, imports nothing.

// The largest decoded write taken, one MiB: a login URL is about 465
// characters and Claude Code's /copy of a long reply stays well under it.
export const OSC52_MAX_BYTES = 1_048_576;

// `data` is what xterm hands an OSC 52 handler, the payload after `52;`:
// a selection, a `;`, then base64. Answers the text to copy, or null:
// - no `;`: not an OSC 52 write at all;
// - a selection outside c, p, q, s and 0 to 7 (empty included, which xterm
//   reads as s 0): not one emerald knows; every known target lands on the
//   one clipboard, as Windows Terminal does;
// - `?`: a read, never answered, so no program reads this PC's clipboard;
// - empty: xterm's spec reads it as "clear", which emerald does not do;
// - not base64: nothing to decode;
// - over OSC52_MAX_BYTES once decoded: refused before any decode, so a
//   runaway program cannot make the renderer allocate without bound.
// The decode is not fatal, so a stray byte reads as U+FFFD rather than
// failing the copy.
export function osc52Text(data: string): string | null {
  const semi = data.indexOf(';');
  if (semi < 0) return null;
  const selection = data.slice(0, semi);
  const rest = data.slice(semi + 1);
  if (!/^[cpqs0-7]*$/.test(selection)) return null;
  if (rest === '?' || rest === '') return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(rest)) return null;
  const pad = rest.endsWith('==') ? 2 : rest.endsWith('=') ? 1 : 0;
  if (Math.floor((rest.length * 3) / 4) - pad > OSC52_MAX_BYTES) return null;
  let binary: string;
  try {
    binary = atob(rest);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
