import { currentPrefix } from './keys.ts';
import { BINDINGS, formatChord, hostPlatform, plainKeyFor } from './keys-model.ts';
import { useSkin } from './skin.ts';
import { closeCheatSheet, useUi } from './ui.ts';
import { actionIn, noteIn } from './copy-note.ts';

// The key table, opened with prefix then ? (or Ctrl+Shift+?). Rendered from
// the same BINDINGS the handler uses, so it cannot drift. Any key or a
// click closes it; keys.ts handles the key.
export function CheatSheet() {
  const { cheatSheetOpen } = useUi();
  const skin = useSkin();
  if (!cheatSheetOpen) return null;
  const prefix = formatChord(currentPrefix());
  return (
    <div className="dialog-backdrop cheat-backdrop" onMouseDown={closeCheatSheet}>
      <div className="dialog cheat-sheet" onMouseDown={(ev) => ev.stopPropagation()}>
        <div className="dialog-title">Keys</div>
        <div className="muted">
          Prefix is {prefix}. Press it, then a key. {prefix} twice sends {prefix} to the terminal. Escape cancels.
        </div>
        {/* M9 fix 234: the two other ways in, so a reader who found this
            sheet by chance learns the palette and the menu too. */}
        <div className="muted cheat-ways">
          Every action is also in the palette, {plainKeyFor('open-actions')}, and this sheet, the palette and What's new are on the {skin === 'emerald' ? 'gem' : 'Z'} at the top left.
        </div>
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>After {prefix}</th>
              <th>Without prefix</th>
            </tr>
          </thead>
          <tbody>
            {BINDINGS.map((b) => (
              <tr key={b.action} data-action={b.action}>
                <td>{b.label}</td>
                <td>{b.prefixed === null ? '' : formatChord(b.prefixed)}</td>
                <td>{plainKeyFor(b.action)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted">Change the prefix with {'{"prefixKey": "Ctrl+Space"}'} in ~/.emerald/config.json.</div>
        {/* M9 fix 1063: the sheet prints the Cmd twins on a Mac; the Ctrl forms still work. */}
        {hostPlatform() === 'darwin' && <div className="muted cheat-cmd">Each Cmd chord works with Ctrl in its place too.</div>}
      </div>
    </div>
  );
}

// Shown in the corner while the prefix is armed, so a stray Ctrl+B is not
// a mystery. The same corner carries a note for a moment when a key had
// nothing to do (M9 fix 201: the jump key with nothing waiting), under a
// class of its own so the prefix reads stay about the prefix.
export function PrefixIndicator() {
  const { prefixArmed, cornerNote } = useUi();
  if (prefixArmed) return <div className="prefix-armed">{formatChord(currentPrefix())} …</div>;
  const text = noteIn(cornerNote, null);
  const action = actionIn(cornerNote, null);
  // The text in a span of its own, so fix 1124's Cancel can sit beside it
  // and a read of the note's words still takes the words alone (M9 fix 1123).
  // The press is held back so the focus stays in the terminal the person
  // was typing in.
  if (text !== null)
    return (
      <div className="corner-note">
        <span className="corner-note-text">{text}</span>
        {action !== null && (
          <button type="button" className="corner-note-action" title={action.title} onMouseDown={(e) => e.preventDefault()} onClick={action.run}>
            {action.label}
          </button>
        )}
      </div>
    );
  return null;
}

// M9 fix 849: a copy's note in the bottom right of the pane it came from,
// under the same class so every document-wide read still finds it.
export function PaneNote({ paneId }: { paneId: string }) {
  const { cornerNote } = useUi();
  const text = noteIn(cornerNote, paneId);
  return text === null ? null : <div className="corner-note in-pane">{text}</div>;
}
