import { EXITED_GROUP, describeState, folderRollup, formatDuration, groupSessions, listPanes, memberLine, rollup, rollupLabel, rollupText, runningKind, shellCommand, tasksText, teamCounts, teamText, waitingOnText } from '@emerald/shared';
import type { FolderLabel, Layout, SessionInfo, SidebarOrder } from '@emerald/shared';
import type { PipeClient } from '@emerald/shared/pipe-client';
import { parse, positionals } from '../args.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { withDaemon } from '../connect.ts';
import { shortId } from '../resolve.ts';

const options = {
  json: { type: 'boolean', default: false },
  'by-state': { type: 'boolean', default: false },
  team: { type: 'boolean', default: false },
} as const;

// The same rows the sidebar shows by default: grouped by the live folder
// in the order the sessions were made, the exited group last, and the
// badge words from describeState. --by-state is the sidebar's other
// order, most urgent group and row first, for a script that wants the
// blocked session on top. --json flattens the groups in that order and
// adds the label and the time in state so a script never re-derives them.
// groupLabel (M9 fix 194) is the person's own label on the folder, null
// for a group titled by its folder name.
export function listRows(sessions: SessionInfo[], now: number, order: SidebarOrder = 'created', labels?: ReadonlyMap<string, string>): Array<SessionInfo & { label: string; inStateMs: number; group: string; groupLabel: string | null }> {
  const rows: Array<SessionInfo & { label: string; inStateMs: number; group: string; groupLabel: string | null }> = [];
  for (const group of groupSessions(sessions, order, labels)) {
    for (const s of group.sessions) {
      rows.push({ ...s, tasks: s.tasks ?? [], label: describeState(s, now).text, inStateMs: Math.max(0, now - s.stateSince), group: group.key, groupLabel: labels?.get(group.key) ?? null });
    }
  }
  return rows;
}

// The folder labels (M9 fix 194) as the sidebar reads them; a daemon
// before level 39 answers bad-request, which is an empty map.
export async function folderLabels(client: PipeClient): Promise<Map<string, string>> {
  let folders: FolderLabel[];
  try {
    ({ folders } = await client.request('folders.list', {}));
  } catch {
    folders = [];
  }
  return new Map(folders.map((f) => [f.folder, f.label]));
}

// The name of the layout tab (M36) showing each session that is on screen
// somewhere, so a script can tell which tab to look at; a session no pane
// shows has no entry.
export function tabsShowing(layout: Layout): Map<string, string> {
  const out = new Map<string, string>();
  for (const tab of layout.tabs) {
    for (const pane of listPanes(tab)) {
      if (pane.sessionId !== null) out.set(pane.sessionId, tab.name);
    }
  }
  return out;
}

const command: Command = {
  name: 'ls',
  summary: 'list sessions in sidebar order',
  usage: 'emmer ls [--by-state] [--team] [--json]',
  async run(argv) {
    const parsed = parse(argv, options);
    positionals(parsed, []);
    const order: SidebarOrder = parsed.values['by-state'] ? 'state' : 'created';
    const { sessions, layout, labels } = await withDaemon(async (client) => ({
      ...(await client.request('session.list', {})),
      ...(await client.request('layout.get', {})),
      labels: await folderLabels(client),
    }));
    const now = Date.now();
    const tabs = tabsShowing(layout);
    if (parsed.values.json) {
      printJson({ sessions: listRows(sessions, now, order, labels).map((row) => ({ ...row, tab: tabs.get(row.id) ?? null })) });
      return;
    }
    if (sessions.length === 0) {
      println('no sessions');
      return;
    }
    // The title bar's units (M9 fix 88): the headings' four over every
    // folder, the exited ones left out as the headings leave them. A
    // shell runs when its record says so (M9 fix 196); the CLI has no
    // output rate to read for the others.
    const running = new Set(sessions.filter((s) => shellCommand(s)?.state === 'running').map((s) => s.id));
    const alive = sessions.filter((s) => s.state !== 'exited');
    const box = rollupText(folderRollup({ sessions: alive }, running));
    if (box !== '') println(box);
    for (const group of groupSessions(sessions, order, labels)) {
      // The heading's rollup (M32): what the folder's sessions need, when
      // any of them needs anything; then the units the sidebar heading
      // shows (M46), agents active and inactive, shells running and idle.
      const roll = rollup(group);
      const label = roll === null ? null : rollupLabel(roll);
      const units = group.key === EXITED_GROUP ? '' : rollupText(folderRollup(group, running));
      // A labelled folder (M9 fix 194) leads with the label, as the
      // heading does, and keeps the path after it so a script still
      // finds the group by its folder.
      const heading = labels.has(group.key) ? `${group.title}  ${group.key}` : group.key;
      println([heading, label, units].filter((part) => part !== null && part !== '').join('  '));
      const width = Math.max(...group.sessions.map((s) => describeState(s, now).text.length));
      for (const s of group.sessions) {
        const label = describeState(s, now).text.padEnd(width);
        const age = formatDuration(s.stateSince, now).padStart(4);
        // How far along Claude's own checklist is (M9 fix 153), after
        // the badge as the row puts it beside the context number: 2/3
        // while a list exists and is not all done.
        const tasks = tasksText(s);
        const progress = tasks === null ? '' : ` ${tasks}`;
        // The checkpoint (emmer set): the phase beside the badge, the
        // comment on a line of its own under the row.
        const phase = s.phase === null ? '' : ` [${s.phase}]`;
        // Which layout tab shows it, once there is more than one to tell apart.
        const tab = layout.tabs.length > 1 && tabs.has(s.id) ? `  [${tabs.get(s.id)}]` : '';
        // The team (M46): agents out, agents returned, background shells
        // running now (M9 fix 101, the count Claude Code prints itself),
        // after the name as on the row.
        const team = teamText(teamCounts(s));
        // What a needs-input row waits on (M55), at the end so the columns
        // hold: the tool call as a question, as on the row's agent line.
        const waiting = waitingOnText(s);
        println(`  ${shortId(s.id)}  ${label}${progress}${phase}  ${age}  ${runningKind(s).padEnd(6)}  ${s.name}${team === '' ? '' : `  ${team}`}${tab}${waiting === null ? '' : `  ${waiting}`}`);
        if (s.comment !== null) println(`            ${s.comment}`);
        // The team's members under the row (M9 fix 90), as the sidebar
        // lists them when the row is unfolded.
        if (parsed.values.team) for (const m of s.team) println(`            ${memberLine(m, now)}`);
      }
    }
  },
};

export default command;
