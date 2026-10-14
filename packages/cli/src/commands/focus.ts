import { currentTab, findPane, focusPane, paneShowingIn, replaceTab, setPaneSession, splitPane, switchTab } from '@emerald/shared';
import { parse, positionals } from '../args.ts';
import { println } from '../command.ts';
import type { Command } from '../command.ts';
import { findSession, withDaemon } from '../connect.ts';
import { shortId } from '../resolve.ts';

const options = {
  beside: { type: 'boolean', default: false },
} as const;

// The sidebar's click, from the command line: a pane already showing the
// session gets the focus, one on the tab on show first and else one in
// another layout tab (M36, M50), and the window switches to that tab;
// otherwise the focused pane of the tab on show starts showing it, or
// with --beside a new pane split to the right of it does (M9 fix 91; an
// empty focused pane is taken as it is, the heading's + rule). The app
// mirrors layout.changed, so the window follows at once. The window's
// remembered answer to a row click is the window's own, so the command
// replaces unless told otherwise. M9 fix 404: a session on several panes
// has one picked for it by the same rule emmer open --beside uses, the
// tab in front and then tab order, so the reply always names the pane
// and its tab.
const command: Command = {
  name: 'focus',
  summary: 'show a session in the focused pane, or focus the pane showing it (the one on the tab in front, else the first in tab order)',
  usage: 'emmer focus <session> [--beside]',
  async run(argv) {
    const parsed = parse(argv, options);
    const { session } = positionals(parsed, ['session']);
    await withDaemon(async (client) => {
      const found = await findSession(client, session);
      const { layout } = await client.request('layout.get', {});
      const showing = paneShowingIn(layout, found.id, layout.currentTabId);
      let next;
      if (showing !== null) {
        next = switchTab(replaceTab(layout, focusPane(showing.tab, showing.pane.id)), showing.tab.id);
      } else {
        const tab = currentTab(layout);
        const focused = findPane(tab, tab.focusedPaneId);
        const room = parsed.values.beside && focused !== null && focused.sessionId !== null ? splitPane(tab, tab.focusedPaneId, 'row') : tab;
        next = replaceTab(layout, setPaneSession(room, room.focusedPaneId, found.id));
      }
      // The revision the edit was based on travels with it; a stale one is
      // refused by the daemon, and a second try would only race the app again.
      await client.request('layout.set', { layout: next });
      const tab = currentTab(next);
      // The pane and its tab, always (M9 fix 404): paneShowingIn picks
      // one of a session's panes for you, so the reply names which even
      // on a window with one tab, as emmer open --beside does. The pane
      // id is cut to eight characters, the same as a session's short id
      // (M9 fix 432); focus has no --json to keep the full one in.
      const where = ` in pane ${shortId(tab.focusedPaneId)} on tab ${tab.name}`;
      println(`${showing !== null ? 'focused' : 'showing'} ${shortId(found.id)} ${found.name}${where}`);
    });
  },
};

export default command;
