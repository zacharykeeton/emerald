import { useEffect, useRef, useState } from 'react';
import { appMenuItems } from './app-menu-model.ts';
import { runAction } from './keys.ts';
import { recordUse } from './use-record.ts';
import { Menu } from './Menu.tsx';
import { useStore } from './store.ts';
import { useRunningShells } from './rates-store.ts';
import { titleCounts, titleSummary } from './title-bar-model.ts';
import { HeadingUnits } from './roster.tsx';
import { updateBadge } from './update-model.ts';
import { setSkin, useSkin } from './skin.ts';
import { useUi } from './ui.ts';
import { TitleGem } from './title-gem.tsx';
import { titleGlint } from './title-gem-model.ts';
import type { UpdateState } from './update-model.ts';

// The 26px title row of the 5A mock (M43): the amber Z under Classic and
// the gem under Emerald (M9 fix 571), the name and a
// summary of what is running, in the frame's place. The whole row is a
// drag region, so it moves the window and a double-click maximises it,
// as a frame would; Windows draws the caption buttons over its right end
// (titleBarOverlay in the main process) and the row stops where they
// start (its width in style.css). In full screen the frame would be gone,
// so the row goes too; the main process says when, since under Electron
// neither the overlay's visible flag nor display-mode moves.
export function TitleBar() {
  const { sessions, layout } = useStore('sessions', 'layout');
  const skin = useSkin();
  const { sidebarCollapsed } = useUi();
  // The running shells for the units (M9 fix 354): one Set that holds
  // while its members do, so the row renders on a shell starting or
  // stopping and not on every window of its output.
  const runningShells = useRunningShells(sessions);
  const [fullscreen, setFullscreen] = useState(false);
  // The app menu under the Z mark (M9 fix 234): What's new, the cheat
  // sheet and the palette, each reachable before this only by a chord or
  // the palette itself. The mark is the row's other no-drag spot, and the
  // menu hangs from its bottom left like a window's icon menu does.
  const [menuOpen, setMenuOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const markRef = useRef<HTMLButtonElement>(null);
  // The updater's state (M9 fix 239): asked once at mount, since the
  // first push may have gone out before this renderer loaded, then
  // followed by the pushes.
  const [update, setUpdate] = useState<UpdateState | null>(null);

  useEffect(
    () =>
      window.emerald.on((msg) => {
        if (msg.type === 'window.fullscreen') setFullscreen(msg.on);
        if (msg.type === 'update.state') setUpdate(msg.state);
      }),
    [],
  );
  useEffect(() => {
    void window.emerald
      .info()
      .then((info) => setVersion(info.version))
      .catch((err: unknown) => console.warn('[emerald] could not read the version', err));
  }, []);
  useEffect(() => {
    let live = true;
    window.emerald.update.state().then(
      (s) => {
        if (live) setUpdate(s);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  const menuAt = markRef.current === null ? { x: 0, y: 26 } : { x: markRef.current.getBoundingClientRect().left, y: markRef.current.getBoundingClientRect().bottom };

  // The four units the headings carry, over every folder (M9 fix 88):
  // the sidebar may be collapsed, and this row is always on show. The
  // units open the headings' card with the sessions over every folder
  // (M73 task 3); the roster's span is the one no-drag spot on the row.
  const counts = layout === null ? null : titleCounts(sessions.values(), layout, runningShells);
  const summary = counts === null ? null : titleSummary(counts);
  const alive = [...sessions.values()].filter((s) => s.state !== 'exited');
  // The gem's rare glint (M9 fix 571) stands in for the rows' marks while
  // the sidebar is collapsed and something works.
  const glint = titleGlint(skin, sidebarCollapsed, sessions.values());
  // The badge at the row's right (M9 fix 239): a newer build in the feed,
  // the download, the restart; nothing at all otherwise, so the row is
  // what it was for a build with no feed.
  const badge = update === null ? null : updateBadge(update.current, update.latest, update.phase, update.percent, update.message);
  return (
    <div className="title-bar" hidden={fullscreen}>
      <button ref={markRef} className="title-bar-mark" title="Menu" aria-haspopup="menu" aria-expanded={menuOpen} data-glint={glint || undefined} onClick={() => setMenuOpen((o) => !o)}>
        {skin === 'emerald' ? <TitleGem /> : 'Z'}
      </button>
      {menuOpen && (
        <Menu
          x={menuAt.x}
          y={menuAt.y}
          onClose={() => setMenuOpen(false)}
          className="app-menu"
          anchor={markRef.current}
          items={appMenuItems(version, update, skin).map((item) => ({
            label: item.label,
            hint: item.hint,
            disabled: item.disabled,
            onClick: () => {
              setMenuOpen(false);
              if (item.action === 'check-updates') {
                recordUse('check-updates', 'menu');
                void window.emerald.update.act();
              } else if (item.action === 'toggle-skin') {
                recordUse('toggle-skin', 'menu');
                setSkin(skin === 'emerald' ? 'classic' : 'emerald');
              } else void runAction(item.action, 'menu');
            },
          }))}
        />
      )}
      <span className="title-bar-name">emerald</span>
      {summary !== null && <span className="title-bar-summary">{summary}</span>}
      {counts !== null && (
        <span className="title-bar-roster">
          <HeadingUnits id="title-bar" roll={counts.roll} sessions={alive} size="title" />
        </span>
      )}
      {badge !== null && update !== null && (
        <button type="button" className="title-bar-update" data-phase={update.phase} title={badge.title} onClick={() => void window.emerald.update.act()}>
          {badge.text}
        </button>
      )}
    </div>
  );
}
