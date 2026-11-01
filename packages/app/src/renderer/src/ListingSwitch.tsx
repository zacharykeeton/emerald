import { useRef, useState } from 'react';
import { Menu } from './Menu.tsx';
import type { MenuHeading, MenuItem } from './Menu.tsx';
import { CLAUDE_AI_SKILLS_URL, listingButton, listingKind, listingMenu, othersToTurnOff, scopeValues, turnOffLabel } from './listing-model.ts';
import { refreshListing, setListing, undoListingChange, useListing, useListingNote } from './listing-store.ts';

// The listing switch (M9 fix 1042, the Context tab's design,
// docs/design/context-tab.md section 3): the last control of a skill row,
// a dropdown of what Claude sees of the skill, set in this folder or in
// every folder; the group's turn-off button; and the note with Undo after
// a change. Every word comes from listing-model.ts. The rows and the pane
// view that hold these are context-history's (M9 fix 1040).

export { useListing } from './listing-store.ts';

type MenuAt = { x: number; y: number } | null;

// Where a menu hangs: under the button's left edge, as every menu here
// does; Menu clamps it back inside the window.
function below(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom };
}

export function ListingSwitch({ name, folder, source }: { name: string; folder: string; source: string; pluginName?: string }) {
  const { read } = useListing(folder);
  const [menu, setMenu] = useState<MenuAt>(null);
  const button = useRef<HTMLButtonElement>(null);
  const kind = listingKind(source, name);
  if (kind === 'plugin') {
    return (
      <span className="listing-locked" title="A plugin's skill: turn off the whole plugin in /plugin">
        in /plugin
      </span>
    );
  }
  if (kind === 'synced-locked') {
    return (
      <span className="listing-locked" title="A skill synced from claude.ai: turn it off in claude.ai's skills settings">
        on claude.ai
      </span>
    );
  }
  const values = scopeValues(read, name);
  const { word, from, title, value } = listingButton(name, values);
  const close = () => setMenu(null);
  const errors: { local?: string; user?: string } = {};
  for (const s of read?.scopes ?? []) {
    if (s.error === undefined) continue;
    if (s.scope === 'local') errors.local = s.error;
    if (s.scope === 'user') errors.user = s.error;
  }
  const items: Array<MenuItem | MenuHeading> = listingMenu(values, errors).map((r) =>
    r.kind === 'heading'
      ? { heading: r.label, title: r.title }
      : {
          id: r.id,
          label: r.label,
          checked: r.checked,
          hint: r.hint,
          disabled: r.disabled,
          title: r.title,
          onClick: () => {
            close();
            if (!r.checked && r.write !== undefined) void setListing(folder, r.write.scope, [name], r.write.value);
          },
        },
  );
  return (
    <>
      <button
        ref={button}
        type="button"
        className="listing-switch"
        data-skill={name}
        data-value={value}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={title}
        title={title}
        onClick={(ev) => {
          if (menu !== null) {
            close();
            return;
          }
          // A /skills change made meanwhile shows in the menu.
          void refreshListing(folder);
          setMenu(below(ev.currentTarget));
        }}
      >
        <span>{word}</span>
        {from && <span className="listing-switch-from">{from}</span>}
        <span className="listing-switch-caret"> ▾</span>
      </button>
      {menu !== null && <Menu x={menu.x} y={menu.y} items={items} onClose={close} className="listing-menu" data={{ skill: name }} anchor={button.current} />}
    </>
  );
}

// The `from your settings` group's last line: every skill of the group not
// off yet, turned off here or in every folder in one write.
export function TurnOffOthersButton({ names, folder }: { names: readonly string[]; folder: string }) {
  const { read } = useListing(folder);
  const [menu, setMenu] = useState<MenuAt>(null);
  const button = useRef<HTMLButtonElement>(null);
  const others = othersToTurnOff(names, read);
  if (others.length === 0) return null;
  const close = () => setMenu(null);
  const turnOff = (scope: 'local' | 'user') => () => {
    close();
    void setListing(folder, scope, others, 'off');
  };
  return (
    <div className="listing-group-action">
      <button
        ref={button}
        type="button"
        className="listing-group-button"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(ev) => (menu !== null ? close() : setMenu(below(ev.currentTarget)))}
      >
        {turnOffLabel(others.length)}
      </button>
      <span className="listing-group-note">here or in every folder</span>
      {menu !== null && (
        <Menu
          x={menu.x}
          y={menu.y}
          items={[
            { label: 'In this folder', onClick: turnOff('local') },
            { label: 'In every folder', onClick: turnOff('user') },
          ]}
          onClose={close}
          className="listing-menu listing-group-menu"
          data={{ menu: 'listing-group' }}
          anchor={button.current}
        />
      )}
    </div>
  );
}

// The synced group's last line: claude.ai's own settings, a second way
// beside the dropdowns.
export function ClaudeAiSkillsButton() {
  return (
    <div className="listing-group-action">
      <button type="button" className="listing-group-button" onClick={() => void window.emerald.files.openExternal(CLAUDE_AI_SKILLS_URL)}>
        Open claude.ai skills
      </button>
      <span className="listing-group-note">synced skills are turned off there</span>
    </div>
  );
}

// The note after a change made from this folder, with Undo, or the
// refusal's words in its place. It stays until every view of the skills
// closes (listing-store.ts).
export function ListingUndoNote({ folder }: { folder: string }) {
  const { change, error } = useListingNote();
  if (change !== null && change.folder === folder) {
    return (
      <div className="listing-undo-note" data-change={change.change.id}>
        <span className="listing-undo-text">{change.note}</span>
        <button type="button" className="listing-undo" onClick={() => void undoListingChange()}>
          Undo
        </button>
      </div>
    );
  }
  if (error !== null && error.folder === folder) {
    return (
      <div className="listing-undo-note" data-error="">
        <span className="listing-undo-text">{error.text}</span>
      </div>
    );
  }
  return null;
}
