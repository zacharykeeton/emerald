import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { findPane, focusPane, formatDuration, formatSpanLength, formatTokens, formatUsd, runningKind, tallyText, taskTally, tasksOfAgent, tokensUp } from '@emerald/shared';
import { Limits } from '@emerald/shared';
import { SHELL_LABELS } from '@emerald/shared';
import type { SessionInfo, ShellId, SplitDirection, TeamMember } from '@emerald/shared';
import type { AttentionState } from './attention-model.ts';
import '@xterm/xterm/css/xterm.css';
import { closeSessionHere, copyAndNote, hidePaneHere, openBeside, renameSession, resumeSession, setSessionScheme, splitHere, splitWith, startShellHere, typeInto } from './actions.ts';
import { hadRecentInput } from './attention.ts';
import { attentionState, waitOverlay } from './attention-model.ts';
import { takeFresh } from './fresh-panes.ts';
import { useNow } from './use-now.ts';
import { RenameBox } from './RenameBox.tsx';
import { EmptyPane } from './EmptyPane.tsx';
import { ContextReading } from './ContextPopover.tsx';
import { useAgentsRunning, useTeamBeat } from './agents-running.ts';
import { agentOut, runningFigure } from './agents-running-model.ts';
import type { RunningFigure } from './agents-running-model.ts';
import { TasksPopover, TasksReading } from './TasksPopover.tsx';
import { PopoverAnchor, usePopoverAnchor } from './Popover.tsx';
import { AgentCard } from './AgentCard.tsx';
import { TurnStateAnchor } from './TurnCard.tsx';
import { FindBar } from './FindBar.tsx';
import { ChatView } from './ChatView.tsx';
import { faceOf } from './chat-model.ts';
import { terminalMayHandle } from './keys.ts';
import { CTRL_V, enterSequence, isCopyKey, isModifierKey, isPasteKey, plainKeyFor } from './keys-model.ts';
import { Menu } from './Menu.tsx';
import type { MenuHeading, MenuItem, MenuSwatches } from './Menu.tsx';
import { closeTitle, hideTitle, menuHint, sessionPaneMenu } from './pane-menu-model.ts';
import type { PaneMenuRun } from './pane-menu-model.ts';
import { registerPaneMenu } from './pane-menus.ts';
import { recordUse } from './use-record.ts';
import { PANE_USE } from './use-record-model.ts';
import { startSessionDrag } from './pane-drag.ts';
import { colorStyle, colorSwatches } from './session-color.ts';
import { SessionMark } from './session-mark.tsx';
import { RosterUnits } from './roster.tsx';
import { ShadeIcon } from './icons.tsx';
import { SHADE_AFTER_CHOICES, SHADE_TICK_MS, shadeActivity, shadeAfterLabel, shadeWait, shadeablePanes, shouldAutoShade } from './shade-model.ts';
import { liftByPerson, paneLifted, paneTouched, touchPane } from './shade-touch.ts';
import { shadeName } from './shade-name-model.ts';
import { loadSchemes, setScheme, useScheme } from './scheme-store.ts';
import { useRates } from './rates-store.ts';
import { resolveScheme, themeOf } from './scheme-model.ts';
import type { XtermTheme } from './scheme-model.ts';
import { liveSamples, rateText, shellMarkTitle, shellRunning } from './session-mark-model.ts';
import { useSqueeze } from './squeeze.ts';
import { paneTextVars } from './pane-text.ts';
import { usePaneWheel } from './pane-wheel.ts';
import { dialStyle } from './usage-model.ts';
import { folderName } from './files-model.ts';
import { lastFolder } from './recent-folders.ts';
import { ackable, compactPercent, contextPercentText, contextText, describeState, hasState, idleClock, idleClockTitle, markKind, memberHandle, memberParts, modelEffortWords, modelWord, resumeTitle, shellCommand, teamCounts, tasksText, tokensText, waitingOnText, workingMotion } from '@emerald/shared';
import { editTab, getState, useStore } from './store.ts';
import { browserViewSupported, fileViewSupported, otherShells } from './daemon-model.ts';
import { createStatCache } from './path-link-cache.ts';
import { joinWrappedRows, pathLinkAction, pathLinkParts, pathLinkTitle, pathLinksIn, resolvePathLink, urlLinkTitle } from './path-links.ts';
import type { FileStat } from '../../preload/api.ts';
import { TokensArrow, TokensText } from './TokensText.tsx';
import { RollingFigure } from './RollingFigure.tsx';
import { HushButton } from './HushButton.tsx';
import { feed } from './terminal-feed.ts';
import type { Fit } from './mirror-model.ts';
import { PaneNote } from './CheatSheet.tsx';
import { fileViewAt } from './tabs-model.ts';
import { closePicker, FONT_SIZE_DEFAULT, getUiState, liftPanes, openFileTab, openFind, openNewSession, openPicker, openReviewTab, pinFileTab, resetFontSize, revealInPane, setChatFace, setCopyOnSelect, setShadeAfter, setSplitKind, shadePane, shadePanes, toggleZoom, useUi } from './ui.ts';

interface Props {
  paneId: string;
  sessionId: string | null;
  focused: boolean;
  // The one pane in its tab: nothing to hide it behind, so no Hide button.
  onlyPane: boolean;
}

const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);

// The idle countdown's clock time in its tooltip (M9 fix 772).
const clockTime = (at: number): string => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// How long the exited notice (M9 fix 313) stays up after the last blocked
// key or paste, each one restarting the same four seconds.
const EXITED_NOTICE_MS = 4000;

// One leaf of the split tree: a terminal on a session, or a picker when the
// pane is empty. Clicking anywhere in it makes it the focused pane; a right
// click anywhere in it, terminal included, opens the pane menu.
export function Pane({ paneId, sessionId, focused, onlyPane }: Props) {
  const { sessions, daemon, layout } = useStore('sessions', 'daemon', 'layout');
  // This session's output samples alone (M9 fix 354), for the mark.
  const rate = useRates(sessionId);
  const session = sessions.get(sessionId ?? '');
  const { pickerPaneId, zoomedPaneId, sessionDrag, attention, shadedPanes, autoShaded, shadeAfter, splitKind, fontSizes, copyOnSelect, chatPanes } = useUi();
  // The face (M9 fix 689): a Claude session's pane shows its chat view or
  // its terminal; a shell, an empty pane and an unknown session have only
  // the terminal. A pane shown another session leaves the chat set, so a
  // session put back opens on the terminal.
  const claudePane = session !== undefined && markKind(session) === 'claude';
  const face = claudePane && faceOf(chatPanes, paneId, sessionId) === 'chat' ? 'chat' : 'terminal';
  const storedChat = chatPanes.get(paneId);
  useEffect(() => {
    // Not on an empty pane: startClaudeIn turns a pane to chat as it
    // fills it, and the layout's push can land after that.
    if (storedChat !== undefined && sessionId !== null && storedChat !== sessionId) setChatFace(paneId, storedChat, false);
  }, [storedChat, sessionId, paneId]);
  // The title bar pulses with the sidebar row while the session waits for
  // someone (attention-model.ts); the value is the state, for the colour.
  const wanting = sessionId !== null && attention.wanting.has(sessionId) && session !== undefined ? attentionState(session) : undefined;
  const pickerOpen = pickerPaneId === paneId;
  // The shade (M63): the terminal hidden behind the session's face. Only
  // a pane with a session has one; an empty pane shows its picker.
  const shaded = sessionId !== null && shadedPanes.has(paneId);
  const autoShade = shaded && autoShaded.has(paneId);
  // The idle shade (M63): every few seconds the pane asks whether its
  // session has rested long enough with no key into it, and pulls the
  // shade marked auto if so. The rule is shade-model.ts's; the focused
  // pane never shades itself, since a person is looking at it.
  const sessionState = session?.state;
  const stateSince = session?.stateSince;
  useEffect(() => {
    if (shadeAfter <= 0 || sessionState === undefined || stateSince === undefined || focused || shaded) return;
    const check = () => {
      const candidate = { focused, shaded, lastInputAt: paneTouched.get(paneId) ?? null, liftedAtStateSince: paneLifted.get(paneId) ?? null };
      if (shouldAutoShade({ state: sessionState, stateSince }, candidate, shadeAfter, Date.now())) shadePane(paneId, true);
    };
    check();
    const timer = setInterval(check, SHADE_TICK_MS);
    return () => clearInterval(timer);
  }, [shadeAfter, sessionState, stateSince, focused, shaded, paneId]);
  // The half of this pane a dragged session would take, or null. A file
  // from Explorer over a pane with a session takes no half: its path is
  // typed into the session, so the whole pane lights, in its own colour.
  // A file over an empty pane (M9 fix 387) takes a half instead, the same
  // preview a folder gets, since the drop opens a file view there rather
  // than typing anything.
  const dropZone = sessionDrag?.target?.paneId !== paneId ? null : sessionDrag.file && sessionId != null ? 'file' : sessionDrag.target.zone;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  // The name's width when the rename box replaced it (M9 fix 93): the box
  // keeps that room, so it never comes up empty in a narrow title.
  const nameWidth = useRef(0);
  const nameRef = useRef<HTMLSpanElement>(null);
  const startRename = () => {
    if (session === undefined) return;
    nameWidth.current = nameRef.current?.offsetWidth ?? 0;
    setRenaming(true);
  };
  // M9 fix 902: on pointerdown, which a scrollbar's preventDefault does not stop, where it cancels the mousedown that would follow.
  const onPressDown = (ev: React.PointerEvent) => {
    // A press anywhere in the pane counts as a touch for the idle shade.
    touchPane(paneId);
    if (focused) return;
    // The overlay's hush (M9 fix 267) is for a person mid-thought
    // elsewhere, so a press on it leaves the focus where it is: a done
    // pane taking focus would ack its session at once (fix 30's recent
    // input), and the hush would end the pulse it was meant to keep.
    if (ev.target instanceof Element && ev.target.closest('[data-action="hush"]') !== null) return;
    void editTab((t) => focusPane(t, paneId), paneId).catch(warn('focus'));
  };
  const onContextMenu = (ev: React.MouseEvent) => {
    ev.preventDefault();
    // The scheme list is asked again on each open (M9 fix 225), so a
    // scheme added to Windows Terminal meanwhile is on the menu.
    loadSchemes();
    setMenu({ x: ev.clientX, y: ev.clientY });
  };
  // The terminal's colour scheme (M9 fix 225): the menu's last section,
  // a list for the window and one for this pane's session (M9 fixes
  // 244, 648), so it is added here after the model's items
  // rather than in pane-menu-model, which the palette lists too.
  const schemeState = useScheme();
  // The menu's items (M9 fix 202): the list is pane-menu-model's, shared
  // with the action palette, and this is what each item does here. The
  // palette reaches the same two through the registry below.
  const runMenuItem = (run: PaneMenuRun, shell?: ShellId): void => {
    recordUse(PANE_USE[run], 'menu');
    switch (run) {
      case 'split-right':
        return splitHere(paneId, 'row');
      case 'split-down':
        return splitHere(paneId, 'column');
      case 'zoom':
        return toggleZoom(paneId);
      case 'text-reset':
        return resetFontSize(paneId);
      case 'new-shell':
        return void startShellHere(paneId, shell).catch(warn('new shell'));
      case 'new-claude':
        return openNewSession(paneId);
      case 'rename':
        return startRename();
      case 'pick':
        return openPicker(paneId);
      case 'find':
        return openFind(paneId);
      case 'review':
        return session === undefined ? undefined : openReviewTab(session.id);
      case 'hide':
        return hidePaneHere(paneId);
      case 'close-session':
        return closeSessionHere(paneId);
      default:
        return;
    }
  };
  const zoomed = zoomedPaneId === paneId;
  const atDefaultFontSize = (fontSizes.get(paneId) ?? FONT_SIZE_DEFAULT) === FONT_SIZE_DEFAULT;
  const menuItems = sessionPaneMenu({ session, sessionId, zoomed, onlyPane, splitKind, atDefaultFontSize, others: otherShells(daemon) });
  const menuHandle = useRef({ menuItems, runMenuItem, name: session?.name ?? '' });
  menuHandle.current = { menuItems, runMenuItem, name: session?.name ?? '' };
  useEffect(
    () =>
      registerPaneMenu(paneId, {
        name: () => menuHandle.current.name,
        items: () => menuHandle.current.menuItems,
        run: (run, shell) => menuHandle.current.runMenuItem(run, shell),
      }),
    [paneId],
  );

  // A finished turn stays highlighted until someone looks at it. "Looks at
  // it" is a click or a key anywhere in the window (M31, attention.ts), with
  // one shortcut: a reply into this pane while it is focused, the window has
  // focus and a key or click landed in the last few seconds is taken as
  // seen at once, since someone is sitting in front of it. Without recent
  // input nothing is acked here (M9 fix 30): the pane once acked on focus
  // alone, so a reply into an empty room never pulsed or chimed.
  const state = session?.state;
  useEffect(() => {
    if (!focused || session === undefined || !ackable(session) || sessionId === null) return;
    if (!document.hasFocus() || !hadRecentInput()) return;
    console.log(`[emerald] ack ${sessionId.slice(0, 8)} from pane ${paneId.slice(0, 8)} (recent input)`);
    void window.emerald.request('session.ack', { sessionId }).catch((err: unknown) => console.warn('[emerald] ack failed', err));
  }, [focused, state, sessionId, paneId]);

  // Focus landing here flashes the pane's ground once (M9 fix 63, the
  // animation is on the ring's ::after). Only a change from unfocused to
  // focused on a mounted pane counts: a pane that opens focused, at start,
  // after a split or on fix 36's re-mount, starts with the ref agreeing
  // with the prop and stays quiet. A timer rather than animationend, so
  // the attribute also clears where the animation never runs; focus
  // leaving clears it too, so a quick hop away and back restarts it.
  const [flashing, setFlashing] = useState(false);
  const wasFocused = useRef(focused);
  useEffect(() => {
    const landed = focused && !wasFocused.current;
    wasFocused.current = focused;
    if (!landed) {
      setFlashing(false);
      return;
    }
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), 600);
    return () => clearTimeout(timer);
  }, [focused]);

  // A pane room was just made for (New shell here, the heading's +, the
  // empty sidebar, the dialog's split preset) opens focused already, so
  // the effect above stays quiet for it; this flashes it once on mount
  // instead, the same cue, the same timer (M9 fix 449). takeFresh reads
  // the mark once, so a re-render of the same mounted pane never flashes
  // twice, and a pane that was not room made (a title-bar split, a
  // layout load, fix 36's remount) never does at all.
  useEffect(() => {
    if (!takeFresh(paneId)) return;
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), 600);
    return () => clearTimeout(timer);
  }, [paneId]);

  const label = session === undefined ? null : describeState(session);
  // The idle countdown (M9 fix 772): to Claude Code's idle compaction, else
  // to the prompt cache going cold, ticking only while there is one to count.
  const clockNow = useNow(session !== undefined && session.cache != null && ['idle', 'waiting', 'done'].includes(session.state));
  const clock = session === undefined ? null : idleClock(session, clockNow);
  // The state text pulses while the session works, as the sidebar row
  // moves (M33); nothing when stale. Claude's own title glyph stays in
  // the title and the tooltip (fix 59).
  const motion = session === undefined ? null : workingMotion(session);
  // The mark before the name (M46): a Claude session's asterisk in the
  // state's tone, stepping while it works, with the output rate in its
  // tooltip; a shell's prompt, its caret blinking while the shell writes.
  // An unknown session shows an idle asterisk.
  const kindOfMark = session === undefined ? 'claude' : markKind(session);
  const samples = liveSamples(motion, daemon?.featureLevel, rate);
  const markTitle = label === null ? undefined : samples === null ? label.text : `${label.text}, output ${rateText(samples)}`;
  // A plain shell's last command (M9 fix 196), for the mark's caret,
  // colour and tooltip; the title has no clock of its own, so the words
  // are as of the render, which a mark change brings.
  const command = session === undefined ? null : shellCommand(session);
  // The two-part dollar figure (M9 fix 277 and 293): computed once here
  // off the same store the shade reads, then passed down to the title's
  // .pane-cost and the shade's figure block, so the bar and the shade
  // never disagree about the running part.
  const running = useAgentsRunning();
  const figure = session === undefined ? null : runningFigure(session.costUsd ?? null, session.conversation === null ? null : (running.get(session.conversation.id) ?? null));
  // The title's roster folds to one total once the state word starts to
  // clip (M9 fix 77): both rosters are rendered and the CSS shows one by
  // data-squeeze, which the hook sets by measuring the state word at each
  // level. A second level drops the tokens (M9 fix 146), which hold
  // until then, and the checklist count with them (M9 fix 153). The
  // dollars, the context percent and the model's words go at the third
  // (fixes 222 and 859). Then the
  // line itself, in the order of M9 fix 237: the state word at the fifth
  // (the row and the shade face still say it, and the mark's colour and
  // motion carry it here), the name at the sixth with the reading, the
  // folded roster and the seam (a pane too narrow to name has no room
  // for a figure), and the title's own room tightened at the seventh.
  // The buttons give only once every word and figure has (M9 fix 840,
  // the user's rule): the chat button at the eighth (the most
  // expendable, M9 fix 860; the chord and the menu still flip the face,
  // fix 724), hide and close at the ninth (a pane that narrow is one to
  // zoom or shade, not close, and the keys and the menu still close it),
  // the two splits at the tenth, once the mark, the four buttons and the
  // tightened paddings no longer fit; the mark, the zoom and the shade never give,
  // since the zoom is what a narrow pane needs most (fix 181 had it go
  // first, and a person widened the window to reach the button whose
  // point was not to) and the shade is the other thing a person does to
  // a sliver of a pane. The hook measures the state word while it
  // shows, to the fraction of a pixel, since its ellipsis drew at any
  // overflow (M9 fix 859; the word now clips and is marked exact, so it
  // is whole or gone); from the fifth level the word is gone and the title's own
  // overflow is the measure, the buttons' box being the last thing on
  // the line. Every title has the ten levels (eleven counting the whole
  // line at 0); one without tokens or a count passes through an empty
  // second, and every title through the fourth, which hides nothing of
  // its own, which is simpler than renumbering. The reading's box is
  // measured too (M9 fix 817): once its words are gone its percent and
  // dollars are flex: none and run past its width unseen, so a level at
  // which the box overflows does not fit; hidden, it measures 0 against 0.
  const titleRef = useRef<HTMLDivElement>(null);
  // M9 fix 899: the pane's root takes Ctrl+wheel over any face, and carries
  // the text size's variables for the faces that are not a terminal.
  const rootRef = useRef<HTMLDivElement>(null);
  usePaneWheel(rootRef, paneId, true);
  const textVars = paneTextVars(fontSizes.get(paneId) ?? FONT_SIZE_DEFAULT);
  const sessionStyle = session === undefined ? undefined : colorStyle(session);
  const rootStyle = textVars === null ? sessionStyle : ({ ...sessionStyle, ...textVars } as CSSProperties);
  const team = session === undefined ? null : teamCounts(session);
  useSqueeze(titleRef, 11, '.pane-state, .pane-context', [layout?.revision ?? 0, zoomedPaneId, session?.name, label?.text, team?.out, team?.returned, team?.shells, session?.cwd, session === undefined ? null : contextText(session), session === undefined ? null : tokensText(session), session?.costUsd ?? null, figure?.row ?? null, session === undefined ? null : tasksText(session), clock?.words ?? null, renaming], renaming);
  // The session's colour on the pane as well as its title (M9 fix 43): the
  // focus ring is the pane's ::after, so it reads the variable from here.
  // An empty pane and a session with no colour keep the amber.
  return (
    <div
      ref={rootRef}
      className={focused ? 'pane focused' : 'pane'}
      data-pane-id={paneId}
      data-color={session?.color ?? undefined}
      data-flash={flashing || undefined}
      data-shaded={shaded || undefined}
      data-face={face === 'chat' ? 'chat' : undefined}
      style={rootStyle}
      onPointerDownCapture={onPressDown}
      onContextMenu={onContextMenu}
    >
      {sessionId !== null && (
        <div
          className="pane-title"
          ref={titleRef}
          data-attention={wanting}
          data-color={session?.color ?? undefined}
          data-dragging={(session !== undefined && sessionDrag?.sessionId === session.id) || undefined}
          style={session === undefined ? undefined : colorStyle(session)}
          // A left press on the bar can pick the pane up and put it beside
          // or in place of another (M9 fix 73), the same drag a sidebar row
          // starts, except that this pane goes with it (M50: a row's drop
          // adds a pane, a title's moves this one); nothing shows until the
          // mouse has moved DRAG_THRESHOLD pixels, so a click still focuses
          // (the pane's capture handler ran first) and a double click on the
          // name still renames. The buttons, the rename box and the context
          // reading keep their own presses.
          onMouseDown={(ev) => {
            // The second press of a double click is the rename's, not a drag's.
            if (ev.button !== 0 || session === undefined || renaming || ev.detail > 1) return;
            const el = ev.target instanceof Element ? ev.target : null;
            if (el !== null && el.closest('button, input, .pane-rename, .pane-context') !== null) return;
            startSessionDrag(session.id, ev.nativeEvent, () => {}, paneId);
          }}
        >
          <SessionMark
            kind={kindOfMark}
            tone={kindOfMark === 'claude' ? (label?.tone ?? 'unknown') : undefined}
            working={kindOfMark === 'claude' ? motion !== null : shellRunning(rate, command)}
            failed={command?.state === 'failed'}
            size="row"
            title={session !== undefined && hasState(session) ? markTitle : shellMarkTitle(command, Date.now())}
            className="pane-mark"
          />
          {renaming && session !== undefined ? (
            <RenameBox
              initial={session.name}
              className="pane-rename"
              maxLength={Limits.nameMaxChars}
              style={{ minWidth: `max(12ch, ${nameWidth.current}px)` }}
              onDone={(name) => {
                setRenaming(false);
                if (name !== null) void renameSession(session.id, name).catch(warn('rename'));
              }}
            />
          ) : (
            <span
              className="pane-name"
              ref={nameRef}
              title={session === undefined ? undefined : paneNameTitle(session, shaded)}
              onDoubleClick={startRename}
            >
              {session?.name ?? sessionId}
            </span>
          )}
          {/* A plain shell shows no state (hasState); an unknown session says so. The mark before the name is the one motion (M46). */}
          {(session === undefined || hasState(session)) && (
            // The word opens the turn card (M73 task 4), which carries the state's sentence and the terminal title its tooltip did.
            session === undefined ? (
              <span className="pane-state state-unknown" data-state="unknown" data-squeeze-exact="">
                unknown
              </span>
            ) : (
              <TurnStateAnchor session={session} className={`pane-state state-${label?.tone ?? 'unknown'}`} data={{ 'data-state': session.state, 'data-working': motion ?? undefined, 'data-squeeze-exact': '' }}>
                {label?.text ?? 'unknown'}
              </TurnStateAnchor>
            )
          )}
          {session !== undefined && hasState(session) && clock !== null && (
            <span className="pane-idle-clock" data-clock={clock.kind} title={idleClockTitle(clock, clockTime(clock.at))}>
              {clock.words}
            </span>
          )}
          {/* The roster (M46): the same units as the row's, before the seam; folded to a total once the title is squeezed (M9 fix 77), the CSS picking one of the two. */}
          {session !== undefined && team !== null && <RosterUnits id={session.id} counts={team} members={session.team} size="unit" />}
          {session !== undefined && team !== null && <RosterUnits id={session.id} counts={team} members={session.team} size="unit" folded />}
          {session !== undefined && session.cwd !== session.groupCwd && <span className="pane-cwd">{session.cwd}</span>}
          {session !== undefined && contextText(session) !== null && (
            <ContextReading session={session} className="pane-context">
              {/* The tooltip is the card the reading opens (M9 fix 67). The words in a span of their own, so a short title takes them first and leaves the dial (M9 fix 50); the dial (M9 fix 44) sits right before the percent it pictures, "Opus 5 · ◔ 19%" (M9 fix 66). */}
              {modelEffortWords(session) !== null && (
                <span className="pane-context-model">
                  {modelEffortWords(session)}
                  {contextPercentText(session) !== null && ' · '}
                </span>
              )}
              {session.contextPercent !== null && (
                <span className="context-dial" style={dialStyle(session.contextPercent, session.contextWindow === null ? undefined : compactPercent(session.contextWindow))} />
              )}
              {contextPercentText(session) !== null && <span className="pane-context-percent">{contextPercentText(session)}</span>}
              {/* The API cost as one bare figure (M9 fix 246), where the row has it (fix 221), the running part carried too (M9 fix 293) so the bar reads as the row does: the tokens follow and give a level before it. */}
              {figure !== null && (
                <span className="pane-cost" title={figure.rowTitle ?? undefined} data-running={figure.running || undefined}>
                  {figure.row}
                </span>
              )}
              {/* Sent and received since the process started (M9 fix 143); the first part to give, before the words. */}
              <TokensText session={session} className="pane-tokens" cached={false} />
            </ContextReading>
          )}
          {/* The checklist count (M9 fix 153) beside the reading's dial, dropped with the tokens at the second level. */}
          {session !== undefined && <TasksReading session={session} className="pane-tasks" />}
          {/* A seam between the reading and the buttons (M9 fix 53), the 5A mock's `|`; only where there is a reading to set apart. */}
          {session !== undefined && (contextText(session) !== null || tasksText(session) !== null) && <span className="pane-title-divider">|</span>}
          {session?.state === 'exited' && (
            <button
              className="pane-resume"
              title={resumeTitle(session)}
              onClick={() => void resumeSession(session.id).catch(warn('resume'))}
            >
              Resume
            </button>
          )}
          <PaneActions paneId={paneId} onlyPane={onlyPane} session={session} shaded={shaded} folder={session?.cwd ?? null} face={claudePane ? face : undefined} />
        </div>
      )}
      {menu !== null && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          className="pane-menu"
          data={{ 'pane-id': paneId }}
          items={menuItems.flatMap((item): Array<MenuItem | MenuSwatches | MenuHeading> => {
            // The shell items (M9 fix 647) are Other shell here's rows below.
            if (item.shell !== undefined) return [];
            const row: MenuItem = {
              label: item.label,
              hint: menuHint(item),
              disabled: item.disabled,
              title: item.title,
              separator: item.separator,
              onClick: () => {
                setMenu(null);
                runMenuItem(item.run);
              },
            };
            // The Colour row (M29) follows Rename and closes the menu
            // itself.
            if (item.run === 'rename' && session !== undefined) return [row, colorSwatches(session, () => setMenu(null))];
            // The other installed shells (M9 fix 624) follow New shell
            // here, on a daemon at the level that offers them.
            const others = item.run === 'new-shell' ? menuItems.filter((i) => i.shell !== undefined) : [];
            if (others.length === 0) return [row];
            return [
              row,
              {
                label: 'Other shell here',
                title: "Another installed shell in this session's folder, beside it",
                submenu: others.map((o) => ({
                  label: SHELL_LABELS[o.shell!],
                  title: o.title,
                  onClick: () => {
                    setMenu(null);
                    runMenuItem('new-shell', o.shell);
                  },
                })),
                onClick: () => undefined,
              },
            ];
          }).concat(copyOnSelectItem(copyOnSelect), schemeMenuItems(schemeState, session))}
        />
      )}
      {sessionId === null ? (
        <EmptyPane paneId={paneId} onDone={closePicker} showSplits onlyPane={onlyPane} />
      ) : (
        <TerminalView paneId={paneId} sessionId={sessionId} focused={focused && !pickerOpen} shaded={shaded} autoShade={autoShade} wanting={wanting} figure={figure} face={face} onlyPane={onlyPane} />
      )}
      {sessionId !== null && pickerOpen && (
        <div className="picker-overlay">
          <EmptyPane paneId={paneId} onDone={closePicker} />
        </div>
      )}
      {dropZone !== null && <div className="drop-overlay" data-drop-zone={dropZone} />}
    </div>
  );
}

// The name's tooltip: the folder, the checkpoint when there is one (the
// title bar has no room for a line of prose), and how to rename.
function paneNameTitle(session: SessionInfo, shaded: boolean): string {
  const lines = [session.cwd];
  if (session.comment !== null) lines.push(`Checkpoint: ${session.comment}`);
  if (session.phase !== null) lines.push(`Phase: ${session.phase}`);
  if (shaded) lines.push('Shaded: the terminal is hidden behind the face, a click on it brings it back');
  lines.push('Double-click to rename; an empty name follows the folder again');
  return lines.join('\n');
}

function shadeTitle(): string {
  return 'Pull a shade over this pane: the terminal hides behind the mark, name and state, readable from across the room; a click brings it back';
}

// The shade button (M63): a click pulls or lifts this pane's shade; a
// right click opens Shade all and Lift all for the tab this pane is in
// (the same pair the layout tab's menu has) and the idle setting, found
// where the shade is. The menu's mousedown is swallowed with the other
// actions', so the terminal keeps the keyboard.
// The zoom ends the moment the focused pane is another (App.tsx, the tmux
// rule), and the press that focuses this one is a layout edit still on
// its way to the daemon when the click lands, so the zoom waits for the
// focus to be the layout's before it starts; a pane already focused is
// an edit of nothing and zooms at once.
function zoomHere(paneId: string): void {
  void editTab((t) => (t.focusedPaneId === paneId ? t : focusPane(t, paneId)), paneId)
    .then(() => toggleZoom(paneId))
    .catch(warn('zoom'));
}

// A box in a box: the pane inside its tab. Zoomed, the inner box fills the
// outer one, which is what the button did.
function ZoomIcon({ zoomed }: { zoomed: boolean }) {
  return (
    <svg className="pane-zoom-icon" viewBox="0 0 16 16" width={13} height={13} aria-hidden="true">
      <path d="M2.5 2.5h11v11h-11z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      {zoomed ? (
        <path d="M4.5 4.5h7v7h-7z" fill="currentColor" stroke="none" />
      ) : (
        <path d="M6 6h4v4H6z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      )}
    </svg>
  );
}

// What a click on the face button gives (M9 fix 689): a terminal (a
// rounded box with a prompt and a cursor) while on the chat, a speech
// bubble with two lines while on the terminal.
function FaceIcon({ face }: { face: 'terminal' | 'chat' }) {
  return (
    <svg className="pane-face-icon" viewBox="0 0 16 16" width={13} height={13} aria-hidden="true">
      {face === 'chat' ? (
        <>
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4.5 6l2 2-2 2M8 10.5h3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M3 2.5h10a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5v-2.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M4.5 5.5h7M4.5 8h5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function ShadeButton({ paneId, session, shaded }: { paneId: string; session: SessionInfo | undefined; shaded: boolean }) {
  const { layout } = useStore('layout');
  const { shadeAfter } = useUi();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const tab = layout?.tabs.find((t) => findPane(t, paneId) !== null) ?? null;
  const panes = tab === null ? [paneId] : shadeablePanes(tab);
  return (
    <>
      <button
        className="pane-shade-toggle"
        data-shaded={shaded || undefined}
        title={shaded ? `Lift the shade (a click on the pane does too, and ${plainKeyFor('shade-pane')}); right-click for Shade all and the idle shade` : `${shadeTitle()} (${plainKeyFor('shade-pane')})`}
        onClick={() => (shaded ? liftByPerson(paneId, session) : shadePane(paneId))}
        onContextMenu={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          setMenu({ x: ev.clientX, y: ev.clientY });
        }}
      >
        <ShadeIcon />
      </button>
      {menu !== null && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          className="shade-menu"
          data={{ 'pane-id': paneId }}
          items={[
            {
              label: 'Shade all',
              // M9 fix 844: the one chord does whichever of the two rows the tab needs.
              hint: plainKeyFor('shade-all'),
              title: 'Pull the shade over every pane of this tab',
              onClick: () => {
                setMenu(null);
                shadePanes(panes);
              },
            },
            {
              label: 'Lift all',
              hint: plainKeyFor('shade-all'),
              title: 'Lift every shade on this tab',
              onClick: () => {
                setMenu(null);
                liftPanes(panes);
              },
            },
            {
              heading: 'Shade after idle',
              title: 'A pane whose session has been idle, done or exited this long with no key into it shades by itself; the focused pane never does',
            },
            ...SHADE_AFTER_CHOICES.map((minutes) => ({
              label: shadeAfterLabel(minutes),
              checked: shadeAfter === minutes,
              onClick: () => setShadeAfter(minutes),
            })),
          ]}
        />
      )}
    </>
  );
}

// M9 fix 441, moved here by fix 491: the window's one terminal setting
// sits on every pane's menu, the empty pane's included, between Close
// pane and the scheme section. A setting leaves the menu open.
function copyOnSelectItem(copyOnSelect: boolean): MenuItem[] {
  return [
    {
      label: 'Copy on select',
      checked: copyOnSelect,
      separator: true,
      title: 'Copy a selection in any terminal or chat pane as the mouse is let go; Ctrl+Shift+C and a right-click copy either way',
      onClick: () => setCopyOnSelect(!copyOnSelect),
    },
  ];
}

// The pane menu's scheme section (M9 fixes 225, 244, 648): headed Terminal
// colours, two rows that each open a list of the schemes, the shipped ones
// first and the person's Windows Terminal ones after. This session's list
// starts with The window's, which clears the session's own scheme, and
// checks the session's own pick; The window's list checks the window's.
// A pick in either leaves the menu and the list open, as a setting does,
// and the check moves. On an empty pane there is no session, so This
// session is off limits.
function schemeMenuItems(state: ReturnType<typeof useScheme>, session: SessionInfo | undefined): Array<MenuItem | MenuHeading> {
  const { schemes, current: windowScheme } = state;
  const resolved = resolveScheme(schemes, session?.scheme, state.picked, state.skin);
  const worn = resolved.scheme ?? windowScheme;
  const header: MenuHeading = {
    heading: 'Terminal colours',
    title: resolved.own
      ? `This session wears ${worn.name}, its own; the window's pick, in every other pane, is ${windowScheme.name}. The shipped schemes first, then the ones in your Windows Terminal settings`
      : 'The terminal colours in every pane of this window; the shipped schemes first, then the ones in your Windows Terminal settings',
  };
  const schemeTitle = (s: (typeof schemes)[number]): string => (s.source === 'shipped' ? `Shipped with emerald, ground ${s.background}` : `From your Windows Terminal settings, ground ${s.background}`);
  const own = session?.scheme ?? null;
  const sessionRow: MenuItem =
    session === undefined
      ? { label: 'This session', hint: 'nothing runs here', disabled: true, title: "Nothing runs in this pane; the window's list below sets the scheme for every pane", onClick: () => undefined }
      : {
          label: 'This session',
          hint: own ?? "the window's",
          title: "A scheme for this session alone; it follows the session between panes (emmer set --scheme). The window's clears it (emmer set --clear-scheme)",
          onClick: () => undefined,
          submenu: [
            {
              label: "The window's",
              hint: windowScheme.name,
              checked: own === null,
              title: `Drop this session's own scheme${own === null ? '' : ` (${own})`} and wear the window's, ${windowScheme.name} (emmer set --clear-scheme)`,
              onClick: () => void setSessionScheme(session.id, null).catch(warn('clear scheme')),
            },
            ...schemes.map(
              (s, i): MenuItem => ({
                label: s.name,
                checked: s.name === own,
                separator: i === 0,
                title: schemeTitle(s),
                onClick: () => void setSessionScheme(session.id, s.name).catch(warn('set scheme')),
              }),
            ),
          ],
        };
  const windowRow: MenuItem = {
    label: 'The window',
    hint: windowScheme.name,
    title: 'The scheme of every pane without one of its own',
    onClick: () => undefined,
    submenu: schemes.map((s): MenuItem => ({ label: s.name, checked: s.name === windowScheme.name, title: schemeTitle(s), onClick: () => setScheme(s.name) })),
  };
  return [header, sessionRow, windowRow];
}

// Split, hide and close, always on show at the right end of a title bar so
// the way to more panes is visible without knowing a key. A split here gives
// an empty pane unless the person picked Shell or Claude under By default
// (M9 fix 537); a shell or a Claude starts in the pane's folder: the
// session's live one, a commits view's, and when the pane has none (an
// activity view, M9 fix 126) the folder folderFor gives, the last one used
// or home, which the titles say by name (M9 fix 147). A right-click on
// either button offers all three kinds once and a pick of the default.
// Hide takes the pane away and leaves the session
// running; × kills it. The mousedown is swallowed so the terminal keeps
// keyboard focus.
export function PaneActions({ paneId, onlyPane, session, shaded, folder, view = false, face }: { paneId: string; onlyPane: boolean; session: SessionInfo | undefined; shaded?: boolean | undefined; folder: string | null; view?: boolean; face?: 'terminal' | 'chat' | undefined }) {
  const { zoomedPaneId, splitKind } = useUi();
  const zoomed = zoomedPaneId === paneId;
  const last = folder === null ? lastFolder() : null;
  const kindWord = splitKind === 'claude' ? 'new Claude' : 'new shell';
  const where =
    splitKind === 'empty'
      ? 'an empty pane'
      : folder !== null
        ? `${kindWord} in this folder`
        : last !== null
          ? `${kindWord} in ${folderName(last)}`
          : `${kindWord} in the home folder`;
  const [splitMenu, setSplitMenu] = useState<{ x: number; y: number; direction: SplitDirection } | null>(null);
  const openSplitMenu = (direction: SplitDirection) => (ev: React.MouseEvent) => {
    ev.preventDefault();
    // Not the pane's own menu as well: it would open over this one at the same point (M9 fix 536).
    ev.stopPropagation();
    setSplitMenu({ x: ev.clientX, y: ev.clientY, direction });
  };
  return (
    <span className="pane-title-actions" onMouseDown={(ev) => ev.preventDefault()}>
      {/* The face (M9 fix 689), first on a Claude session's pane: an icon of what a click gives. It gives at the eighth level once every word has gone (fix 840), alone and before the splits (fix 860); the chord stays. */}
      {face !== undefined && session !== undefined && (
        <button
          className="pane-face-toggle"
          data-face={face}
          aria-label={face === 'chat' ? 'Show the terminal' : 'Show the chat'}
          title={`${face === 'chat' ? 'Show the terminal' : 'Show the chat'} (${plainKeyFor('toggle-chat')})`}
          onClick={() => setChatFace(paneId, session.id, face !== 'chat')}
        >
          <FaceIcon face={face} />
        </button>
      )}
      <button
        className="pane-split-right"
        title={`Split right, ${where} (${plainKeyFor('split-vertical')})`}
        onClick={() => splitHere(paneId, 'row')}
        onContextMenu={openSplitMenu('row')}
      >
        ◫
      </button>
      <button
        className="pane-split-down"
        title={`Split down, ${where} (${plainKeyFor('split-horizontal')})`}
        onClick={() => splitHere(paneId, 'column')}
        onContextMenu={openSplitMenu('column')}
      >
        ⊟
      </button>
      {splitMenu !== null && (
        <Menu
          x={splitMenu.x}
          y={splitMenu.y}
          onClose={() => setSplitMenu(null)}
          className="split-menu"
          data={{ 'pane-id': paneId }}
          items={[
            {
              label: 'Split empty',
              onClick: () => {
                const direction = splitMenu.direction;
                setSplitMenu(null);
                void splitWith(paneId, direction, 'empty').catch(warn('split'));
              },
            },
            {
              label: 'Split with shell',
              onClick: () => {
                const direction = splitMenu.direction;
                setSplitMenu(null);
                void splitWith(paneId, direction, 'shell').catch(warn('split'));
              },
            },
            {
              label: 'Split with Claude',
              onClick: () => {
                const direction = splitMenu.direction;
                setSplitMenu(null);
                void splitWith(paneId, direction, 'claude').catch(warn('split'));
              },
            },
            { heading: 'By default', title: 'What a plain click on either split button gives' },
            { label: 'Empty pane', checked: splitKind === 'empty', onClick: () => setSplitKind('empty') },
            { label: 'Shell', checked: splitKind === 'shell', onClick: () => setSplitKind('shell') },
            { label: 'Claude', checked: splitKind === 'claude', onClick: () => setSplitKind('claude') },
          ]}
        />
      )}
      {/* The zoom (M9 fix 181), after the splits: the pane alone in the tab and back, the M5 zoom the chord and the menu reach. Hidden on the only pane, since the row is short and the menu already says why. */}
      {(!onlyPane || zoomed) && (
        <button
          className="pane-zoom"
          data-active={zoomed || undefined}
          title={zoomed ? 'Unfocus, back to the layout' : `Focus, this pane alone in the tab (${plainKeyFor('toggle-focus')})`}
          onClick={() => zoomHere(paneId)}
        >
          <ZoomIcon zoomed={zoomed} />
        </button>
      )}
      {/* The shade (M63), before hide: the terminal goes behind the session's face until a click on it. A view pane (M52) has no terminal and no shade. */}
      {shaded !== undefined && <ShadeButton paneId={paneId} session={session} shaded={shaded} />}
      <button className="pane-hide" title={hideTitle(onlyPane, view)} onClick={() => hidePaneHere(paneId)}>
        −
      </button>
      <button className="pane-close" title={closeTitle(session, onlyPane)} onClick={() => closeSessionHere(paneId)}>
        ×
      </button>
    </span>
  );
}

// One xterm attached to one session. Attaches on mount, detaches on unmount,
// re-attaches after a pipe reconnect.
//
// M9 fix 36: React re-mounts a pane when it is split (its node goes from a
// Pane to a split div holding one) and when a sibling closes (M2 gotcha 7),
// and a fresh xterm would attach, replay the scrollback and draw no cursor
// until focused. So the terminal, its addons, its pipe listeners and its
// refit live in a handle outside the component: the effect's cleanup parks
// the handle for a moment instead of disposing it, and the effect that
// follows in the same commit adopts it into the new host. React runs every
// unmount cleanup before any mount effect in one commit, so the handle is
// there for the re-mount; a pane that is truly gone disposes on the timer.
function TerminalView({ paneId, sessionId, focused, shaded, autoShade, wanting, figure, face, onlyPane }: { paneId: string; sessionId: string; focused: boolean; shaded: boolean; autoShade: boolean; wanting: AttentionState | undefined; figure: RunningFigure | null; face: 'terminal' | 'chat'; onlyPane: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // Fits the terminal to its host and tells the PTY; set once the terminal is open.
  const refitRef = useRef<(() => void) | null>(null);
  // Clears the screen and attaches afresh; set once the terminal is open.
  const reattachRef = useRef<(() => void) | null>(null);
  const { layout, sessions, daemon } = useStore('layout', 'sessions', 'daemon');
  const revision = layout?.revision ?? 0;
  const session = sessions.get(sessionId);
  const sessionState = session?.state;
  // Whether the terminal shows the frame kept at the session's exit (M9
  // fix 159): asked of the daemon once the session is exited, since the
  // frame arrives as the replay and nothing else says it is a kept one;
  // the terminal is dimmed for it and the attribute is what the scripts
  // read. Cleared when the session leaves exited. Asked again on a new
  // daemon, since the old one's answer was about its own records; a
  // daemon from before the field answers no rows and no mark.
  const [kept, setKept] = useState(false);
  const daemonPid = daemon?.pid ?? null;
  useEffect(() => {
    if (sessionState !== 'exited' || daemonPid === null) {
      setKept(false);
      return;
    }
    let live = true;
    void window.emerald
      .request('pty.screen', { sessionId })
      .then((screen) => {
        if (live) setKept(screen.kept === true);
      })
      .catch(() => {
        if (live) setKept(false);
      });
    return () => {
      live = false;
    };
  }, [sessionState, sessionId, daemonPid]);
  // What is running now, for Shift+Enter (M28): a shell that has typed
  // claude gets the kitty sequence from the moment Claude reports in and
  // a plain CR again once it leaves. Through a ref, since the key handler
  // is attached once per session.
  const kindRef = useRef<'claude' | 'shell'>('shell');
  kindRef.current = runningKind(sessions.get(sessionId) ?? { kind: 'shell', claudeSessionId: null });
  // The exited notice (M9 fix 313): a key, an Enter sequence or a paste
  // into a session with no pty sends nothing instead, and says so over
  // the kept frame. `blockedRef` sits beside kindRef for the same reason:
  // term.onData and the key handler below are registered once, when the
  // terminal opens, so they read the session's state through a ref
  // rather than a value that would go stale. Calling it both answers
  // whether the attempt is blocked and, when it is, shows the notice and
  // restarts its four-second fade.
  const [notice, setNotice] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockedRef = useRef<() => boolean>(() => false);
  blockedRef.current = () => {
    if (sessionState !== 'exited') return false;
    setNotice(true);
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(false), EXITED_NOTICE_MS);
    return true;
  };
  useEffect(
    () => () => {
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    },
    [],
  );
  const { zoomedPaneId, fontSizes, findOpen, dropping } = useUi();
  const fontSize = fontSizes.get(paneId) ?? FONT_SIZE_DEFAULT;
  // The search addon is built with the terminal; the find bar (M26) gets
  // it through state rather than a ref so the bar follows a new terminal
  // behind the same pane.
  const [search, setSearch] = useState<SearchAddon | null>(null);
  const findSeq = findOpen.get(paneId);
  // The terminal is built once per session; it reads the size current at
  // that moment and follows later changes through the effect below.
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const paneIdRef = useRef(paneId);
  paneIdRef.current = paneId;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const key = parkKey(paneId, sessionId);
    const waiting = parked.get(key);
    let handle: TerminalHandle;
    if (waiting !== undefined) {
      clearTimeout(waiting.timer);
      parked.delete(key);
      handle = waiting.handle;
      handle.adopt(host, kindRef, paneIdRef, blockedRef);
    } else {
      handle = openTerminal(sessionId, host, fontSizeRef.current, kindRef, paneIdRef, themeRef.current, blockedRef);
    }
    termRef.current = handle.term;
    refitRef.current = handle.refit;
    reattachRef.current = handle.reattach;
    setSearch(handle.search);

    return () => {
      // Parked, not disposed: the pane may be back in a moment under a new
      // split node (see above). The timer is well past the same-commit
      // re-mount and short enough that a hidden pane's detach still lands
      // before anyone notices.
      const timer = setTimeout(() => {
        parked.delete(key);
        handle.dispose();
      }, PARK_MS);
      parked.set(key, { handle, timer });
      setSearch(null);
      termRef.current = null;
      refitRef.current = null;
      reattachRef.current = null;
    };
  }, [paneId, sessionId]);

  // A resumed session has a new PTY behind the same id. The daemon does not
  // move attachments over, so when the session leaves `exited` this pane
  // starts over: clear the dead process's screen and attach to the new one.
  const wasExited = useRef(false);
  useEffect(() => {
    if (wasExited.current && sessionState !== undefined && sessionState !== 'exited') {
      console.log(`[emerald] session ${sessionId.slice(0, 8)} resumed, re-attaching`);
      reattachRef.current?.();
      // M9 fix 313: the notice is never up from the exit itself, so a
      // later exit of the same pane starts fresh too.
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
      setNotice(false);
    }
    wasExited.current = sessionState === 'exited';
  }, [sessionState, sessionId]);

  // A new text size changes the cell size, so the PTY gets fewer or more
  // columns for the same box.
  useEffect(() => {
    const term = termRef.current;
    if (term === null || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    refitRef.current?.();
  }, [fontSize]);

  // The colour scheme (M9 fix 225), set on every terminal at once when
  // the window's pick changes; xterm repaints on the option. M9 fix 244:
  // the session's own scheme wins when it has one, resolved here per
  // terminal, and the ground goes on this host (over the root's window
  // value) so a pane with its own scheme has its own box colour.
  const schemeState = useScheme();
  const sessionScheme = session?.scheme;
  const scheme = useMemo(() => resolveScheme(schemeState.schemes, sessionScheme, schemeState.picked, schemeState.skin).scheme ?? schemeState.current, [schemeState, sessionScheme]);
  const themeRef = useRef<XtermTheme>(themeOf(scheme));
  themeRef.current = themeOf(scheme);
  useEffect(() => {
    const term = termRef.current;
    if (term === null) return;
    term.options.theme = themeRef.current;
  }, [scheme]);

  // Also fit whenever the layout or the zoom changes. ResizeObserver
  // callbacks and animation frames are paused while the window is hidden or
  // occluded, but effects still run, so the PTY size keeps matching the pane
  // and a scripted run sees the same geometry a visible window would.
  useEffect(() => {
    refitRef.current?.();
  }, [revision, zoomedPaneId]);

  // Keyboard focus follows layout focus, so a focus-by-direction key lands
  // keystrokes in the right terminal. Under a shade (M63) the keyboard goes
  // to the shade instead: a terminal hidden behind it would take keys
  // nobody can see land, so the shade takes them and the first one lifts
  // it. A focus arriving at a pane the idle timer shaded lifts the shade
  // outright, since a person came to it.
  const shadeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focused) return;
    if (shaded && autoShade) {
      liftByPerson(paneId, session);
      return;
    }
    if (shaded) shadeRef.current?.focus();
    // The chat face's box takes the keyboard itself (ChatView).
    else if (face !== 'chat') termRef.current?.focus();
  }, [focused, sessionId, shaded, autoShade, paneId, face]);

  const term = termRef.current;
  return (
    <div
      className="term-wrap"
      data-kept={kept ? '' : undefined}
      data-dropping={dropping.has(sessionId) ? '' : undefined}
      // A click anywhere in the pane dismisses the exited notice, except
      // the notice's own Resume and Close buttons, which stop the click
      // reaching here (M9 fixes 313 and 861).
      onClick={() => {
        if (notice) setNotice(false);
      }}
    >
      <div className="term-host" ref={hostRef} data-scheme={scheme.name} style={{ '--pane-bg': scheme.background } as CSSProperties} />
      {face !== 'chat' && <PaneNote paneId={paneId} />}
      {/* M9 fix 689: the chat face over the terminal, which stays mounted and hidden under it; inside .term-wrap so the shade covers both. */}
      {face === 'chat' && session !== undefined && <ChatView paneId={paneId} session={session} focused={focused} shaded={shaded} />}
      {findSeq !== undefined && term !== null && search !== null && <FindBar paneId={paneId} term={term} search={search} focusSeq={findSeq} />}
      {shaded && session !== undefined && <PaneShade paneId={paneId} session={session} auto={autoShade} wanting={wanting} shadeRef={shadeRef} />}
      {/* M9 fix 397: the counter is the lid's own while the shade is
          down, so the overlay never draws over the hero. */}
      {session !== undefined && !shaded && <WaitOverlay sessionId={session.id} wanting={wanting} since={session.stateSince} />}
      {/* M9 fix 804: on the chat face there is no box to block a key
          into, so the notice stands the whole time the session is exited
          and a click in the pane does not put it away. */}
      {sessionState === 'exited' && (notice || face === 'chat') && session !== undefined && (
        <div className="pane-exited-notice" data-exited-notice="">
          {/* M9 fix 841: on a solid card, as a dialog is, on both faces. Close beside Resume forgets the session and closes the pane, as the title bar's × does (M9 fix 861). */}
          <div className="pane-exited-notice-card">
            <div className="pane-exited-notice-title">exited</div>
            <div className="pane-exited-notice-body">
              {face === 'chat' ? "This session's process has ended; its conversation is kept." : "This session's process has ended; its last screen is kept."}
            </div>
            <div className="pane-exited-notice-actions">
              <button
                className="pane-exited-notice-resume"
                title={resumeTitle(session)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  void resumeSession(session.id).catch(warn('resume'));
                }}
              >
                Resume
              </button>
              <button
                className="pane-exited-notice-close secondary"
                title={closeTitle(session, onlyPane)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  closeSessionHere(paneId);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The counter over the pulse (M9 fix 247, redrawn by fix 267): while the
// pane pulses for a question or a finished reply, the wait as a big
// figure in the pane's top right corner over the terminal or the shade
// face alike, `12s` at 48px with `waiting` or `done` under it, in the
// pulse's tone, climbing a second at a time so the wait is in front of
// the person and not only in the row's age. It stands on no wash: each
// glyph carries a halo in the ground it sits over (the terminal's
// scheme, or the shade's), so the output under it stays readable. No
// pointer events but the hush button's, the row's own (fix 190) beside
// the figure, so the text under it stays clickable; gone with the
// pulse at the acknowledge. The clock runs only while there is
// something to count. The digits are RollingFigure's slots (fix 235).
function WaitOverlay({ sessionId, wanting, since }: { sessionId: string; wanting: AttentionState | undefined; since: number }) {
  const { attention, attentionSound } = useUi();
  const now = useNow(wanting === 'needs-input' || wanting === 'done');
  const overlay = waitOverlay(wanting, since, now);
  if (overlay === null) return null;
  const hushable = attentionSound === 'repeat';
  return (
    <span className="wait-overlay" data-word={overlay.word} data-figure={overlay.figure}>
      <span className="wait-overlay-word">{overlay.word}</span>{' '}
      <span className="wait-overlay-figure">
        <RollingFigure text={overlay.figure} />
      </span>
      {hushable && <HushButton sessionId={sessionId} hushed={attention.hushed.has(sessionId)} className="wait-overlay-hush" />}
    </span>
  );
}

// The shade's face (M63), a lid since M9 fix 372 (docs/design/shade-lid.md):
// one hero, the mark on its own line over the session's name split into
// an identity and a subject where it can be (shade-name-model.ts), the
// state word, the spend at the largest size with its caption, then one
// line for every other figure (the model and the dial with its percent,
// sent and received, the cached share, the age); then the session's
// checklist as the rule between the hero and the team, one segment per
// task, or a plain hairline when there is no list; then one box per
// subagent in a grid, each a mark, a name, a state word and its price,
// or "working alone". Every reading is live off the same session, so
// the lid is the title enlarged and nothing new to keep current. The
// mark steps while the session works as it does on the row; a session
// that needs input shows what it is waiting on (M55) large, and the
// shade stays until it is clicked, since the point is to be read from
// afar. A click anywhere lifts it (a click on a checklist bar pins its
// card instead, as the title's reading does); so does any key, spent on
// the lift, so no keystroke reaches the hidden terminal unseen; the
// chords are the window's and never arrive here. The tiers (narrow
// under 360px, wide from 760) are the shade's container queries in
// style.css, not JS: the model hands the CSS a size step and a fold.
function PaneShade({ paneId, session, auto, wanting, shadeRef }: { paneId: string; session: SessionInfo; auto: boolean; wanting: AttentionState | undefined; shadeRef: React.RefObject<HTMLDivElement | null> }) {
  const rate = useRates(session.id);
  const label = describeState(session);
  const motion = workingMotion(session);
  const kindOfMark = markKind(session);
  const stateText = hasState(session) ? (waitingOnText(session) ?? label.text) : null;
  // M9 fix 654: the row's own activity line, under the state word.
  const activity = shadeActivity(session, stateText);
  const name = shadeName(session.name);
  // The forks' part of the figure, faster while this shade is up with
  // an agent out (M9 fix 322): the row's `$99 ~` and the members' model
  // words and prices read the forks' files every three seconds for this
  // one conversation, since the shade is the reading a person is watching.
  useTeamBeat(session.conversation === null ? null : session.conversation.id, agentOut(session.team));
  return (
    <div
      className="pane-shade"
      ref={shadeRef}
      tabIndex={-1}
      data-auto={auto || undefined}
      data-state={session.state}
      title="Click to lift the shade"
      onClick={() => liftByPerson(paneId, session)}
      onKeyDown={(ev) => {
        if (isModifierKey(ev.nativeEvent.code)) return;
        ev.preventDefault();
        liftByPerson(paneId, session);
      }}
    >
      <div className="pane-shade-face">
        <div className="pane-shade-hero">
          <SessionMark
            kind={kindOfMark}
            tone={kindOfMark === 'claude' ? label.tone : undefined}
            working={kindOfMark === 'claude' ? motion !== null : shellRunning(rate, shellCommand(session))}
            failed={shellCommand(session)?.state === 'failed'}
            size="face"
            className="pane-shade-mark"
          />
          <span className="pane-shade-name" data-step={name.step} data-split={name.subject === null ? undefined : ''}>
            {name.identity}
          </span>
          {name.subject !== null && <span className="pane-shade-subject">{name.subject}</span>}
          {stateText !== null && (
            <span className={`pane-shade-state state-${label.tone}`} data-state={session.state} data-working={motion ?? undefined}>
              {stateText}
            </span>
          )}
          {activity !== null && (
            <span className="pane-shade-activity" title={activity}>
              {activity}
            </span>
          )}
          <ShadeSpend session={session} />
          <ShadeWait session={session} wanting={wanting} />
          <ShadeLine session={session} waiting={shadeWait(session, wanting) !== null} />
        </div>
        <ShadeRule session={session} />
        <ShadeTeam session={session} />
      </div>
    </div>
  );
}

// The spend as the hero's figure (M9 fix 372, after fix 205's block and
// fix 209's caption): Claude Code's own figure, every request the
// process made at API rates with the forks' included, over "at API
// rates, subagents included". The per-member prices in the grid are its
// breakdown, never a second total. The figure's characters are
// RollingFigure's slots (fix 235), so a digit that changes rolls like an
// odometer's drum. The block keeps .pane-shade-figures and
// data-figure="cost" on the figure, which verify:graph's fix 318 step
// reads; absent until a status line has carried a cost. The forks'
// running part (fix 277) is the row's and the card's, not the lid's
// (fix 318).
function ShadeSpend({ session }: { session: SessionInfo }) {
  const usd = session.costUsd ?? null;
  if (usd === null) return null;
  return (
    <span className="pane-shade-spend pane-shade-figures" data-figure="cost" data-part="cost">
      <span className="pane-shade-figure">
        <RollingFigure text={formatUsd(usd)} />
      </span>
      <span className="pane-shade-figure-word">at API rates, subagents included</span>
    </span>
  );
}

// The one line for everything else (M9 fix 372): the context reading
// (the model word, the dial and its percent, keeping .pane-shade-context
// as the scripts read it), the sent and received counts with the arrows
// as marks (fix 155), the cached share as a percent of what was sent,
// and how long the session has been in its state, the row's age on the
// row's clock. Each part is absent until the record carries it, so a
// plain shell's lid has an empty line and the CSS draws nothing for it.
function ShadeLine({ session, waiting }: { session: SessionInfo; waiting: boolean }) {
  // M9 fix 396: the age leaves the line while the wait row above shows
  // the same stateSince as a figure of its own. Two clocks on one start,
  // a second apart, read as two different facts; the row is the coarser
  // and the nearer, so the line gives way to it.
  const stated = hasState(session) && !waiting;
  const now = useNow(stated);
  const t = session.tokens ?? null;
  const up = t === null ? 0 : tokensUp(t);
  const cachedPercent = t === null || up === 0 || t.cacheRead <= 0 ? null : Math.round((t.cacheRead / up) * 100);
  return (
    <span className="pane-shade-line">
      {contextText(session) !== null && (
        <span className="pane-shade-context">
          {modelEffortWords(session) !== null && (
            <span className="pane-shade-context-model">
              {modelEffortWords(session)}
              {contextPercentText(session) !== null && ' · '}
            </span>
          )}
          {session.contextPercent !== null && (
            <span className="context-dial" style={dialStyle(session.contextPercent, session.contextWindow === null ? undefined : compactPercent(session.contextWindow))} />
          )}
          {contextPercentText(session) !== null && <span className="pane-shade-context-percent">{contextPercentText(session)}</span>}
        </span>
      )}
      {t !== null && (
        <span className="pane-shade-tokens" data-part="tokens">
          <span className="pane-shade-sent">
            <TokensArrow dir="up" />
            <RollingFigure text={formatTokens(up)} />
          </span>{' '}
          <span className="pane-shade-received">
            <TokensArrow dir="down" />
            <RollingFigure text={formatTokens(t.output)} />
          </span>
        </span>
      )}
      {cachedPercent !== null && <span className="pane-shade-cached">{cachedPercent}% cached</span>}
      {stated && (
        <span className="pane-shade-age" title={`In this state since ${new Date(session.stateSince).toLocaleTimeString()}`}>
          {formatDuration(session.stateSince, now)}
        </span>
      )}
    </span>
  );
}

// The checklist as the rule (M9 fix 372, after fix 156's count on a
// line of its own): the divider between the session and its team is
// its progress bar, one segment per task, the done ones lit, with "1 of
// 3 tasks" above it, so the fill says how far along and the divisions
// say how much there is. It is the tally and not taskProgress, so a
// finished list keeps its full bar (a finished plan is worth seeing).
// With no list the plain hairline takes its place: the boundary is
// always drawn, a list only thickens it, and an empty track is never
// drawn since it reads as a list with none of it done. Hovering the
// rule opens the list on the popover the title's reading has (fix 153).
function ShadeRule({ session }: { session: SessionInfo }) {
  const tally = taskTally(session);
  if (tally === null) return <span className="pane-shade-divider" />;
  const tasks = session.tasks ?? [];
  return (
    <PopoverAnchor id={`${session.id}:shade-tasks`} className="pane-shade-rule" data={{ 'data-done': String(tally.done), 'data-total': String(tally.total) }} card={(props) => <TasksPopover session={session} {...props} />}>
      <span className="pane-shade-rule-caption">{tallyText(tally)}</span>
      <span className="pane-shade-rule-track">
        {tasks.map((task) => (
          <span key={task.id} className="pane-shade-rule-segment" data-status={task.status} data-done={task.status === 'completed' || undefined} />
        ))}
      </span>
    </PopoverAnchor>
  );
}

// A member's own checklist under its box (M9 fix 394), where the design
// cut the lid: a 2px strip, one segment per task the daemon attributed
// to this member off its hooks' agent_id, lit by the same rule as the
// session's rule above, and the same hover opening the same card on that
// member's list alone. A member no task is attributed to draws nothing,
// which is most of them: the strip is a mark of a member keeping a list,
// not a slot every box carries.
function ShadeMemberRule({ session, agentId }: { session: SessionInfo; agentId: string }) {
  const tasks = tasksOfAgent(session, agentId);
  if (tasks.length === 0) return null;
  const done = tasks.filter((t) => t.status === 'completed').length;
  return (
    <PopoverAnchor
      id={`${session.id}:shade-member-tasks:${agentId}`}
      className="pane-shade-member-rule"
      data={{ 'data-done': String(done), 'data-total': String(tasks.length), 'data-member': agentId }}
      card={(props) => <TasksPopover session={session} tasks={tasks} {...props} />}
    >
      <span className="pane-shade-member-track">
        {tasks.map((task) => (
          <span key={task.id} className="pane-shade-member-segment" data-status={task.status} data-done={task.status === 'completed' || undefined} />
        ))}
      </span>
    </PopoverAnchor>
  );
}

// M9 fix 821: a hover on a member's box opens the commit graph's agent card
// for it (a shell's gets the same card with its command). M9 fix 961: the
// hover is the box's own, its padding, border and the gaps between its
// lines included; the span that held it was display: contents and had no
// box, so a pointer resting in the padding was off it. The box carries the
// hover only: not the click or the press (usePopoverAnchor's other
// handlers pin the card and stop the click), so a click on a box or on its
// open card still lifts the shade. The checklist strip inside the box
// opens its own card, so a pointer over the strip counts as off the box.
function ShadeMemberCard({ session, member, now, data, children }: { session: SessionInfo; member: TeamMember; now: number; data: Record<string, string | undefined>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const state = usePopoverAnchor(true);
  const id = `${session.id}:shade-member:${member.id}`;
  return (
    <div
      ref={ref}
      className="pane-shade-member"
      {...data}
      data-popover-for={id}
      data-popover-open={state.open}
      onMouseOver={(ev) => {
        // A card portalled to the body bubbles here through the React
        // tree; it keeps itself through its own onEnter and onLeave.
        if (!(ev.target instanceof Element) || !ev.currentTarget.contains(ev.target)) return;
        if (ev.target.closest('.pane-shade-member-rule') !== null) state.handlers.onMouseLeave();
        else state.handlers.onMouseEnter();
      }}
      onMouseLeave={state.handlers.onMouseLeave}
    >
      {children}
      {state.card(ref.current, (props) => (
        <AgentCard member={member} session={session} now={now} anchorId={id} {...props} />
      ))}
    </div>
  );
}

// The team as a grid of boxes (M9 fix 372, after fix 291's list): one
// per member in spawn order, each a mark (the model's family sizing the
// star, fix 288), the name (the description's first line, or the type),
// then a state line: the word memberParts already knows (working for a
// running agent, returned for one that has come back, running and
// finished for a shell), the model word when a request has landed for
// it, the kind the agent was started as (fix 373: fork for a fork, else
// its own type, so the lid says which members are forks as the sidebar
// does; the bare kind with no type), and the price of its requests so
// far off the same agents-running answer the model word comes from,
// dimmed a step so it recedes under the session's figure. With no
// members the line says so. A one-column pane cannot take twelve boxes
// (the fold is the narrow tier's container query, which hides the
// boxes past the fourth), so the fifth box on carries data-fold and a
// line under the grid names the rest, drawn only under that tier; past
// twelve the grid is capped at every width, as before.
const SHOWN_MEMBERS = 12;
const NARROW_MEMBERS = 4;

function ShadeTeam({ session }: { session: SessionInfo }) {
  const running = useAgentsRunning();
  const answer = session.conversation === null ? undefined : running.get(session.conversation.id);
  // Fix 490: a finished session worked alone, a live one is working alone.
  if (session.team.length === 0) return <span className="pane-shade-alone">{session.state === 'done' || session.state === 'idle' || session.state === 'exited' ? 'worked alone' : 'working alone'}</span>;
  const now = Date.now();
  const shown = session.team.slice(0, SHOWN_MEMBERS);
  const dense = session.team.length > 8;
  return (
    <div className="pane-shade-team" data-count={session.team.length} data-dense={dense || undefined}>
      {shown.map((m, i) => {
        const { kind, working, task, activity } = memberParts(m, now);
        const state = kind === 'agent' ? (working ? 'working' : 'returned') : working ? 'running' : 'finished';
        const word = modelWord(answer?.models?.[m.id] ?? null);
        const handle = memberHandle(m);
        const usd = answer?.spend?.[m.id] ?? null;
        const name = task ?? m.type ?? kind;
        // The kind word is an agent's (fix 373): a shell's mark says what
        // it is. It is left off when the box's name is that word already
        // (an agent with no description is named by its type).
        const type = m.type ?? kind;
        const kindWord = kind === 'shell' || type === name ? null : type;
        return (
          <ShadeMemberCard key={m.id} session={session} member={m} now={now} data={{ 'data-working': working ? 'true' : undefined, 'data-kind': kind, 'data-type': type, 'data-member': m.id, 'data-fold': i >= NARROW_MEMBERS ? '' : undefined }}>
              <span className="pane-shade-member-head">
                <SessionMark kind={kind === 'shell' ? 'shell' : 'claude'} working={working} size="unit" family={word} />
                <span className="pane-shade-member-name">{name}</span>
              </span>
              <span className="pane-shade-member-line">
                {handle !== null && <span className="pane-shade-member-handle">{handle}</span>}
                <span className="pane-shade-member-state">{state}</span>
                {(word !== null || kindWord !== null) && (
                  <span className="pane-shade-member-words">
                    {word !== null && <span className="pane-shade-member-model">{word}</span>}
                    {kindWord !== null && <span className="pane-shade-member-type">{kindWord}</span>}
                  </span>
                )}
                {usd !== null && <span className="pane-shade-member-price">{formatUsd(usd)}</span>}
              </span>
            {/* M9 fix 654: the agent's latest tool call; a shell's box draws
                none, since its command is its name, and a returned agent
                keeps its last phrase. M9 fix 940: outside the dense tier an
                agent's box draws the line before its first call too, a
                no-break space marked data-empty, so the box is one height
                before and after and its name never moves under a pointer;
                the dense tier hides the line, so it draws none there until
                a call, as before. */}
            {kind === 'agent' && (activity !== null || !dense) && (
              <span className="pane-shade-member-activity" data-empty={activity === null ? '' : undefined}>
                {activity ?? ' '}
              </span>
            )}
            <ShadeMemberRule session={session} agentId={m.id} />
          </ShadeMemberCard>
        );
      })}
      {session.team.length > NARROW_MEMBERS && (
        <span className="pane-shade-member-more" data-fold="narrow">
          and {session.team.length - NARROW_MEMBERS} more
        </span>
      )}
      {session.team.length > SHOWN_MEMBERS && (
        <span className="pane-shade-member-more" data-fold="wide">
          and {session.team.length - SHOWN_MEMBERS} more
        </span>
      )}
    </div>
  );
}

// The live wait on the face (M9 fix 231): how long this session has
// been waiting on the person, `27m` over its word in the waiting tone,
// beside the cost. Never a day total: the face is a reading of the pane
// in front of you.
//
// M9 fix 396: on useNow, the one clock every age on screen runs on. It
// had an interval of its own at five seconds while the line's age below
// it ticked every second off the same stateSince, so the lid showed one
// state's start on two clocks a second apart; the line drops its age
// while this row shows (ShadeLine) and one tick now drives the face.
//
// M9 fix 397: this row is where the fix 247 counter goes while the pane
// is shaded, so nothing draws over the hero on a narrow pane, with the
// same hush button and the same handler and hooks, so hushing from the
// lid is hushing.
//
// M9 fix 434: a shaded pane that finishes showed no big counter and no
// hush, since needs-input was the only state this row drew for and a
// shaded pane never got the fix 247 overlay either (fix 397 stops that
// while the shade is down). shadeWait (shade-model.ts) now gives the
// row two forms: needs-input off the record's own state, as fix 231
// had it, so the row does not turn on whether the pulse is armed for
// this pane; and a finished reply keyed on the pulse instead (wanting
// === 'done', the same test the fix 247 overlay uses), so it draws in
// the --done tone and goes the moment the session is acknowledged
// rather than counting up forever on an acked pane. Either way the
// line gives its age up to this row while it shows (fix 396).
function ShadeWait({ session, wanting }: { session: SessionInfo; wanting: AttentionState | undefined }) {
  const { attention, attentionSound } = useUi();
  const wait = shadeWait(session, wanting);
  const now = useNow(wait !== null);
  if (wait === null) return null;
  const ms = Math.max(0, now - session.stateSince);
  return (
    <span className="pane-shade-wait" data-kind={wait.kind} data-ms={ms}>
      <span className="pane-shade-figure">{formatSpanLength(ms)}</span>
      {attentionSound === 'repeat' && <HushButton sessionId={session.id} hushed={attention.hushed.has(session.id)} className="pane-shade-wait-hush" />}
    </span>
  );
}

// The terminal and everything bound to it, kept across a re-mount of its
// pane (fix 36). adopt moves it into a new host; dispose ends it.
interface TerminalHandle {
  term: Terminal;
  search: SearchAddon;
  refit: () => void;
  reattach: () => void;
  adopt: (host: HTMLDivElement, kindRef: KindRef, paneIdRef: PaneIdRef, blockedRef: BlockedRef) => void;
  dispose: () => void;
}

type KindRef = React.RefObject<'claude' | 'shell'>;
type PaneIdRef = React.RefObject<string>;
// Whether the input that just reached the terminal should be swallowed
// instead of sent (M9 fix 313): true means the pane is exited and the
// notice has been shown for it.
type BlockedRef = React.RefObject<() => boolean>;

// Handles between a pane's unmount and its re-mount, by pane and session,
// each with the timer that disposes it if no re-mount comes. The
// attachment itself is the feed's (terminal-feed.ts, M50): a parked
// handle that dies after the session's new pane opened (the session
// moved panes: a drop, the palette, showSession) closes one handle of
// two and detaches nothing, which is what fix 36's deferred dispose was
// for when each terminal attached for itself.
const parked = new Map<string, { handle: TerminalHandle; timer: ReturnType<typeof setTimeout> }>();
const PARK_MS = 250;
// M9 fix 356: the waits before each new WebGL addon after a lost context.
const WEBGL_RETRY_MS = [1000, 2000, 4000];

// The folder a path a session printed is relative to: where its shell
// is, as last reported, else where it was started.
function sessionFolder(sessionId: string): string {
  const s = getState().sessions.get(sessionId);
  return s?.shellCwd ?? s?.spawnCwd ?? '';
}

function parkKey(paneId: string, sessionId: string): string {
  return `${paneId} ${sessionId}`;
}

// Builds the terminal in the host and opens it on the session's feed,
// which attaches, sizes and writes it (M50). The host-bound pieces (the
// ResizeObserver, the wheel listener, the tags the verify scripts read,
// the size check in refit) go through `host`, which adopt swaps for a
// new element.
function openTerminal(sessionId: string, initialHost: HTMLDivElement, fontSize: number, initialKindRef: KindRef, initialPaneIdRef: PaneIdRef, theme: XtermTheme, initialBlockedRef: BlockedRef): TerminalHandle {
  let host = initialHost;
  let kindRef = initialKindRef;
  let paneIdRef = initialPaneIdRef;
  let blockedRef = initialBlockedRef;

  const term = new Terminal({
    // The search addon's highlights are decorations, still a proposed
    // API in xterm 6.
    allowProposedApi: true,
    cursorBlink: true,
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    fontSize,
    scrollback: 10_000,
    // The colours are the scheme's (M9 fix 225; before it the 5A palette
    // of M38 sat here as a literal): the window's pick, or the session's
    // own (M9 fix 244), resolved by TerminalView, handed in at build and
    // followed through its effect.
    theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const search = new SearchAddon();
  term.loadAddon(search);
  term.open(host);
  const lift = liftComposition(term.element);
  // The WebGL renderer leaves no text in the DOM, so the verify scripts
  // read the screen through the terminal's buffer instead.
  const tag = (el: HTMLDivElement) => {
    (el as HTMLDivElement & { emeraldTerm?: Terminal; emeraldSearch?: SearchAddon }).emeraldTerm = term;
    (el as HTMLDivElement & { emeraldSearch?: SearchAddon }).emeraldSearch = search; // the addon too, for a probe
  };
  tag(host);
  // Our chords and the prefix never reach the shell, even if the window
  // handler is bypassed. Shift+Enter in a Claude pane goes out as the
  // kitty sequence instead of xterm's CR; the default is prevented so
  // the keypress that would follow does not send a CR of its own.
  // Ctrl+V (M9 fix 92) is a paste: the clipboard is read through the main
  // process, so the keydown is swallowed here (the default too, or the
  // browser would paste as well) and the text lands a moment later
  // through term.paste, bracketed when the program asked for it, as
  // Ctrl+Shift+V's does; with an image and no text the byte xterm would
  // have sent goes instead, since Claude Code reads the image itself on
  // it. The keyup and any keypress of the same key are swallowed too.
  const pasteClipboard = () => {
    if (blockedRef.current()) return;
    void window.emerald.clipboard
      .read()
      .then(({ text, image }) => {
        if (text !== null) term.paste(text);
        else if (image) typeInto(sessionId, CTRL_V);
      })
      .catch((err: unknown) => console.warn('[emerald] paste failed', err));
  };
  // M9 fix 441: copying out of a pane. xterm keeps its selection in its
  // own model, and the app menu's Copy (Ctrl+C) never fires, since xterm
  // takes the key first and sends ^C; so the copy is ours, through the
  // main process as every copy has been since fix 370. Returns whether
  // there was anything to copy.
  const copySelection = (): boolean => {
    if (!term.hasSelection()) return false;
    const text = term.getSelection();
    if (text === '') return false;
    // M9 fix 806: with a note in the corner of what was copied.
    copyAndNote(text, paneIdRef.current);
    return true;
  };
  term.attachCustomKeyEventHandler((ev) => {
    const seq = enterSequence(ev, kindRef.current);
    if (seq !== null) {
      ev.preventDefault();
      // M9 fix 313: an exited session has no pty for the daemon to hand
      // this to, so it is swallowed here and the pane says so instead.
      if (!blockedRef.current()) window.emerald.send({ type: 'pty.input', sessionId, data: seq });
      return false;
    }
    if (isPasteKey(ev)) {
      ev.preventDefault();
      if (ev.type === 'keydown') pasteClipboard();
      return false;
    }
    // Ctrl+Shift+C copies the selection and does nothing without one;
    // never sent on, since xterm would send it as ^C.
    if (isCopyKey(ev)) {
      ev.preventDefault();
      if (ev.type === 'keydown') copySelection();
      return false;
    }
    return terminalMayHandle(ev);
  });
  // A right-click copies the selection when there is one and clears it,
  // as Windows Terminal does, and pastes when there is none, through the
  // same read Ctrl+V takes. The browser's own menu has nothing to offer
  // on a canvas, so the default goes. On term.element, which moves with
  // the terminal when adopt swaps the host.
  const onContextMenu = (ev: MouseEvent) => {
    ev.preventDefault();
    if (copySelection()) term.clearSelection();
    else pasteClipboard();
  };
  term.element?.addEventListener('contextmenu', onContextMenu);
  // Copy on select, when the person has turned it on: the selection is
  // copied as the left button is let go. A tick later, since xterm
  // settles a drag's selection on the same mouseup.
  const onMouseUp = (ev: MouseEvent) => {
    if (ev.button !== 0 || !getUiState().copyOnSelect) return;
    setTimeout(copySelection, 0);
  };
  term.element?.addEventListener('mouseup', onMouseUp);
  // M9 fix 653: xterm takes Shift+click as "extend the selection to here"
  // from wherever the last click landed, a selection on screen or not
  // (every single click leaves a start behind), so a Ctrl+Shift+click on a
  // link selected the text between and, with Copy on select, copied it.
  // A press with both keys on a link drops the selection first, as a
  // plain Ctrl+click on one already does; capture on term.element runs
  // before xterm's own mousedown there, and the link's own press on the
  // screen element below still lands.
  const onLinkShiftPress = (ev: MouseEvent) => {
    if (ev.button !== 0 || !ev.ctrlKey || !ev.shiftKey || host.dataset['link'] === undefined) return;
    term.clearSelection();
  };
  term.element?.addEventListener('mousedown', onLinkShiftPress, { capture: true });
  // WebGL must load after open(). If the GPU context dies (the driver
  // reset, the box back from sleep, too many contexts) the addon is
  // dropped and the terminal falls back to the DOM renderer, which was
  // part of the typing lag of 2026-09-21: a pane that had lost its
  // context once stayed slow for the rest of the window's life. Since
  // M9 fix 356 a lost context is tried again, three times with a growing
  // wait, before the pane settles on the DOM renderer; the host says
  // which renderer it is on, and every change is a console warning that
  // fix 355 carries to main.log.
  let webglTries = 0;
  let webglTimer = 0;
  let renderer: 'webgl' | 'dom' = 'dom';
  const setRenderer = (kind: 'webgl' | 'dom', why: string) => {
    renderer = kind;
    host.dataset['renderer'] = kind;
    console.warn(`[emerald] terminal renderer: ${kind} (${why})`);
  };
  // On the DOM renderer for now, and a new addon after the next wait
  // while any is left; else settled there.
  const fallBack = (what: string) => {
    if (webglTries >= WEBGL_RETRY_MS.length) {
      setRenderer('dom', `${what}, ${webglTries} retries spent`);
      return;
    }
    const wait = WEBGL_RETRY_MS[webglTries] ?? 0;
    webglTries++;
    setRenderer('dom', `${what}, retry ${webglTries} of ${WEBGL_RETRY_MS.length} in ${wait} ms`);
    webglTimer = window.setTimeout(() => loadWebgl(`retry ${webglTries}`), wait);
  };
  const loadWebgl = (why: string | null) => {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        fallBack('context lost');
      });
      term.loadAddon(webgl);
      // The open itself is not a change worth a line in the log.
      if (why === null) {
        renderer = 'webgl';
        host.dataset['renderer'] = 'webgl';
      } else setRenderer('webgl', why);
    } catch (err) {
      fallBack(`addon unavailable (${err instanceof Error ? err.message : String(err)})`);
    }
  };
  loadWebgl(null);
  // M9 fix 204: a URL a session prints is a link, underlined on hover by
  // the addon and opened on Ctrl+click alone, since a plain click is the
  // terminal's (Claude's own prompt box takes clicks). Since fix 863 the
  // URL opens in a browser pane beside this one, the system browser on a
  // daemon too old for one.
  // The main process refuses anything but http and https. The hovered
  // link is written on the host, as a tooltip saying how to open it and
  // for the verify script, since the WebGL renderer leaves no DOM to read.
  term.loadAddon(
    new WebLinksAddon(
      (ev, uri) => {
        if (!ev.ctrlKey) return;
        const fail = (err: unknown) => console.warn('[emerald] open link failed', err);
        if (browserViewSupported(getState().daemon)) void openBeside({ kind: 'browser', url: uri }, paneIdRef.current).catch(fail);
        else void window.emerald.files.openExternal(uri).catch(fail);
      },
      {
        hover: (_ev, uri) => {
          host.dataset['link'] = uri;
          host.title = urlLinkTitle(uri, browserViewSupported(getState().daemon));
        },
        leave: () => {
          delete host.dataset['link'];
          host.removeAttribute('title');
        },
      },
    ),
  );
  // M9 fix 357: a file path a session prints is a link too, opened on
  // Ctrl+click in a file pane beside this one at the line (M9 fix 864; a
  // pinned tab before it, and still on a daemon too old for a file
  // pane). Not a second WebLinksAddon: that
  // addon keeps only a match `new URL` parses, which no path is, so the
  // provider is this one, in its shape (a row's text scanned for the
  // pattern, each match a link on that row's cells). A relative path is
  // taken from the session's folder as the shell last reported it; the
  // hover stats it, since a folder or a name that is not there (a
  // prompt's cwd, a fraction, `and/or`) is no link and says nothing,
  // and a file gets the tooltip fix 204's URL gets.
  // M9 fix 653: a folder is a link too, opened in Explorer on Ctrl+click;
  // Ctrl+Shift+click on a file shows it selected in its folder. xterm's
  // Shift+click only moves the end of a selection already there and does
  // not take the click, so the link still activates.
  let hoveredPath: string | null = null;
  // M9 fix 425: the hover's own stat, good for five seconds, so hovering
  // the same link again inside that window is no IPC round trip;
  // activate always asks, since it is the answer a click acts on.
  const hoverStatCache = createStatCache<FileStat>();
  const pathLinks = term.registerLinkProvider({
    provideLinks: (y, callback) => {
      const line = term.buffer.active.getLine(y - 1);
      if (line === undefined) {
        callback(undefined);
        return;
      }
      // M9 fix 423: the row joined with the rows its wrap continues from
      // and into (joinWrappedRows), so a path wrapped at the pane's edge
      // is one token and not two halves; cellOf now carries each
      // character's own row too, since a wrapped match can end on a row
      // other than the one queried.
      const { text, cellOf } = joinWrappedRows(term.buffer.active, y - 1);
      const links = pathLinksIn(text).map((l) => {
        const start = cellOf[l.start];
        const end = cellOf[l.end - 1];
        return {
          text: l.text,
          range: { start: { x: (start?.x ?? 0) + 1, y: (start?.y ?? y - 1) + 1 }, end: { x: (end?.x ?? 0) + 1, y: (end?.y ?? y - 1) + 1 } },
          activate: (ev: MouseEvent, token: string) => {
            if (!ev.ctrlKey) return;
            const { path: p, line: at, column } = pathLinkParts(token);
            const full = resolvePathLink(sessionFolder(sessionId), p);
            void window.emerald.files
              .stat(full)
              .then((st) => {
                if (!('kind' in st)) return;
                const fail = (err: unknown) => console.warn('[emerald] open path failed', err);
                switch (pathLinkAction(st.kind, ev, fileViewSupported(getState().daemon))) {
                  case 'beside':
                    void openBeside(fileViewAt(full, at), paneIdRef.current)
                      .then((paneId) => {
                        if (at !== undefined) revealInPane(paneId, full, at, column);
                      })
                      .catch(fail);
                    return;
                  case 'tab':
                    openFileTab(full, at, column);
                    pinFileTab(full);
                    return;
                  case 'reveal':
                    void window.emerald.files.reveal(full).catch(fail);
                    return;
                  case 'open-folder':
                    void window.emerald.files.openFolder(full).catch(fail);
                    return;
                  case null:
                    return;
                }
              })
              .catch((err: unknown) => console.warn('[emerald] open path failed', err));
          },
          hover: (_ev: MouseEvent, token: string) => {
            const full = resolvePathLink(sessionFolder(sessionId), pathLinkParts(token).path);
            hoveredPath = full;
            const showLink = (st: FileStat) => {
              // The pointer may have left while the stat was out.
              if (hoveredPath !== full || !('kind' in st)) return;
              host.dataset['link'] = full;
              host.dataset['linkKind'] = st.kind;
              host.title = pathLinkTitle(full, st.kind, fileViewSupported(getState().daemon));
            };
            const cached = hoverStatCache.get(full);
            if (cached !== undefined) {
              showLink(cached);
              return;
            }
            void window.emerald.files
              .stat(full)
              .then((st) => {
                hoverStatCache.set(full, st);
                showLink(st);
              })
              .catch(() => undefined);
          },
          leave: () => {
            hoveredPath = null;
            delete host.dataset['link'];
            delete host.dataset['linkKind'];
            host.removeAttribute('title');
          },
        };
      });
      callback(links.length === 0 ? undefined : links);
    },
  });
  // What the host fits, or null while it has no size: a pane hidden by
  // zoom has none, and sizing the PTY to it would shrink it to nothing
  // and reflow the shell, so the feed is told nothing and leaves the size
  // as it was, like tmux. The terminal itself is never fitted here: the
  // feed resizes it to the size it chose for the session, which is this
  // pane's when it is the focused one and another pane's when this one
  // mirrors it.
  const propose = (): Fit | null => {
    if (host.clientWidth === 0 || host.clientHeight === 0) return null;
    const dims = fit.proposeDimensions();
    if (dims === undefined || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows) || dims.cols < 1 || dims.rows < 1) return null;
    return { cols: dims.cols, rows: dims.rows };
  };
  const feedHandle = feed().open(sessionId, term, { paneId: () => paneIdRef.current, host: () => host, fit: propose() });
  const refit = () => feedHandle.report(propose());
  // A new PTY behind the same id: the feed clears every terminal on the
  // session and attaches once for them all.
  const reattach = () => feed().reattach(sessionId);

  const input = term.onData((data) => {
    // M9 fix 313: a plain key, and a text paste too (xterm's paste()
    // writes through this same event), gets the same swallow-and-notice
    // treatment as the Enter and paste branches above.
    if (blockedRef.current()) return;
    touchPane(paneIdRef.current);
    window.emerald.send({ type: 'pty.input', sessionId, data });
  });
  const binary = term.onBinary((data) => window.emerald.send({ type: 'pty.input', sessionId, data }));

  // Fit on the next frame so several layout changes collapse into one resize.
  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refit);
  });
  observer.observe(host);

  // The right button never reaches the program (M9 fix 538). xterm's own
  // mousedown on term.element reports a press to a program that takes the
  // mouse, Claude Code among them, and Claude Code pastes on a right-click
  // itself, so the contextmenu handler's paste above made two. A capture
  // listener on the host runs before anything on term.element, its
  // descendant, and ends the dispatch: no press is sent, and xterm's
  // document mouseup reporter is never added. contextmenu is another event
  // and still copies or pastes once; the pane's own focus comes from the
  // capture handler on .pane.
  const onRightButton = (ev: MouseEvent) => {
    if (ev.button === 2) ev.stopPropagation();
  };
  host.addEventListener('mousedown', onRightButton, { capture: true });
  host.addEventListener('mouseup', onRightButton, { capture: true });

  const adopt = (next: HTMLDivElement, nextKindRef: KindRef, nextPaneIdRef: PaneIdRef, nextBlockedRef: BlockedRef) => {
    host.removeEventListener('mousedown', onRightButton, { capture: true });
    host.removeEventListener('mouseup', onRightButton, { capture: true });
    observer.unobserve(host);
    host = next;
    kindRef = nextKindRef;
    paneIdRef = nextPaneIdRef;
    blockedRef = nextBlockedRef;
    // xterm keeps nothing about the parent it was opened in (the fit addon
    // reads element.parentElement each time), so the element moves whole,
    // canvas and all; the old host is already off the DOM.
    if (term.element !== undefined) host.appendChild(term.element);
    tag(host);
    host.dataset['renderer'] = renderer;
    observer.observe(host);
    host.addEventListener('mousedown', onRightButton, { capture: true });
    host.addEventListener('mouseup', onRightButton, { capture: true });
    refit();
  };

  const dispose = () => {
    host.removeEventListener('mousedown', onRightButton, { capture: true });
    host.removeEventListener('mouseup', onRightButton, { capture: true });
    observer.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(webglTimer);
    pathLinks.dispose();
    input.dispose();
    binary.dispose();
    // The feed lets the attachment go once no handle on the session is left.
    feedHandle.close();
    lift.disconnect();
    term.element?.removeEventListener('contextmenu', onContextMenu);
    term.element?.removeEventListener('mouseup', onMouseUp);
    term.element?.removeEventListener('mousedown', onLinkShiftPress, { capture: true });
    term.dispose();
  };

  return { term, search, refit, reattach, adopt, dispose };
}

// M9 fix 57: xterm anchors its IME composition view at the cursor, so a
// long dictated sentence low in a short pane wraps past the bottom edge,
// where the host's overflow clips it (fix 21). When the view's bottom
// passes the screen's, it is shifted up by the overflow with a transform.
// xterm's CompositionHelper writes left, top, height, line-height and the
// font inline on every update and never touches transform, so the shift
// survives its updates; the observers re-run the check after each of them
// and after the view grows. The textarea under the view keeps xterm's own
// place, since it is what the IME's candidate window is anchored to.
function liftComposition(element: HTMLElement | undefined): { disconnect: () => void } {
  const view = element?.querySelector<HTMLElement>('.composition-view') ?? null;
  const screen = element?.querySelector<HTMLElement>('.xterm-screen') ?? null;
  if (view === null || screen === null) return { disconnect: () => {} };
  const place = () => {
    if (!view.classList.contains('active')) {
      if (view.style.transform !== '') view.style.transform = '';
      return;
    }
    const overflow = view.offsetTop + view.offsetHeight - screen.offsetHeight;
    const next = overflow > 0 ? `translateY(${-Math.min(overflow, view.offsetTop)}px)` : '';
    if (view.style.transform !== next) view.style.transform = next;
  };
  const mutations = new MutationObserver(place);
  mutations.observe(view, { attributes: true, attributeFilter: ['style', 'class'], characterData: true, childList: true, subtree: true });
  const sizes = new ResizeObserver(place);
  sizes.observe(view);
  return {
    disconnect: () => {
      mutations.disconnect();
      sizes.disconnect();
    },
  };
}
