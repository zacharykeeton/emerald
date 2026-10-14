import { groupTasksByOwner, taskProgress, tasksText } from '@emerald/shared';
import type { SessionInfo, SessionTask } from '@emerald/shared';
import { PopoverAnchor, PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';

// M9 fix 153: how far along Claude's own checklist is, on the sidebar
// row, the pane title and the shade: the count, 5/8, and a sliver of a
// bar, not a time estimate, since the source is Claude Code's task list
// (its TaskCreate and TaskUpdate calls, read by the daemon) and a task
// is not a minute. Shown only while a list exists and is not all done,
// so most short turns show nothing. The reading opens a card listing
// the tasks with the one in progress marked, on the popover the context
// reading has (M73). The reading is its own anchor beside the context
// reading rather than a part of it, since a span inside that anchor
// would open the context card on the same hover.

interface ReadingProps {
  session: SessionInfo;
  className: string;
}

export function TasksReading({ session, className }: ReadingProps) {
  const progress = taskProgress(session);
  if (progress === null) return null;
  const percent = Math.round((progress.done / progress.total) * 100);
  return (
    <PopoverAnchor id={`${session.id}:tasks`} className={className} data={{ 'data-done': String(progress.done), 'data-total': String(progress.total) }} card={(props) => <TasksPopover session={session} {...props} />}>
      <span className="tasks-count">{tasksText(session)}</span>
      <span className="tasks-bar">
        <span className="tasks-bar-done" style={{ width: `${percent}%` }} />
      </span>
    </PopoverAnchor>
  );
}

// One glyph per status on the card's lines, the same three the CLI's
// explain prints as [x], [>] and [ ].
const TASK_GLYPHS: Record<SessionTask['status'], string> = { completed: '✓', in_progress: '▸', pending: '○' };

// tasks names the list to draw when it is not the session's whole one
// (M9 fix 394): the lid's per-member strip passes that member's tasks
// and the card says whose list it is. The heading counts what it was
// given, so a member's card reads its own progress; an all-done list
// reads "Checklist done" either way.
//
// M9 fix 435: the whole-list card (given is undefined: the sidebar row,
// the pane title and the lid's own rule all open this one) used to read
// the flat list, which mixed every member's tasks with the parent's own
// and said whose was whose only on the member's own card. It now groups
// by owner (groupTasksByOwner, state-machine.ts): the parent's own
// tasks first with no heading, since that is most sessions and most
// turns, then each member's under a .tasks-popover-owner heading naming
// it, in team order. The member's own card (given set) is unchanged: it
// already says whose list it is in the heading above.
export function TasksPopover({ session, tasks: given, anchor, onClose, onEnter, onLeave }: CardProps & { session: SessionInfo; tasks?: readonly SessionTask[] }) {
  const tasks = given ?? session.tasks ?? [];
  const done = tasks.filter((t) => t.status === 'completed').length;
  const progress = given === undefined ? taskProgress(session) : done === tasks.length ? null : { done, total: tasks.length };
  const groups = given === undefined ? groupTasksByOwner(session) : null;
  return (
    <PopoverCard id={`${session.id}:tasks`} className="context-popover tasks-popover" data={{ 'data-session-id': session.id }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="context-popover-heading">
        <span className="context-popover-model">{progress === null ? 'Checklist done' : `${progress.done} of ${progress.total} done`}</span>
        <span className="context-popover-size">{given === undefined ? " · Claude's checklist" : " · this member's checklist"}</span>
      </div>
      <ul className="tasks-popover-list">
        {groups === null
          ? tasks.map((task) => <TasksPopoverTask key={task.id} task={task} />)
          : groups.flatMap((group) => [
              group.name === null ? null : (
                <li key={`${group.agentId}:owner`} className="tasks-popover-owner">
                  {group.name}
                </li>
              ),
              ...group.tasks.map((task) => <TasksPopoverTask key={task.id} task={task} />),
            ])}
      </ul>
    </PopoverCard>
  );
}

function TasksPopoverTask({ task }: { task: SessionTask }) {
  return (
    <li className="tasks-popover-task" data-status={task.status} data-task-id={task.id}>
      <span className="tasks-popover-glyph">{TASK_GLYPHS[task.status]}</span>
      {/* The one in progress reads as what Claude is doing, its activeForm, as the agent line does. */}
      <span className="tasks-popover-subject">{task.status === 'in_progress' ? (task.activeForm ?? task.subject) : task.subject}</span>
    </li>
  );
}
