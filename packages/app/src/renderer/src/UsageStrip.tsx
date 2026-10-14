import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { UsageAsk, UsageResult, UsageWindow } from '../../preload/api.ts';
import { HIGH_PERCENT, NO_SCHEDULE, STRIP_BAR_PX, STRIP_BAR_TALL_PX, STRIP_FORMS, STRIP_METER_PX, USAGE_FLOOR_MS, dialStyle, errorText, fitForm, nextSchedule, paceBar, refreshTitle, segmentLabel, segmentRest, shouldPoll, staleText, stripNeeds, stripRunway, stripText } from './usage-model.ts';
import { UsageBar, UsageWindowAnchor } from './UsageCard.tsx';
import { setUsageReading } from './usage-reading.ts';
import type { StripForm, StripNeeds, StripWindowNeed, UsageSchedule } from './usage-model.ts';

// The account's Claude usage at the bottom of the sidebar: one segment
// per window, "5h" then a pace bar then "resets 41m" (the window's name
// first, a model window's being the model, M9 fix 61; M9 fix 308: the
// bar's fill is the percent, so the number went, and the bar's mark
// says how far through the window the reset is; a window of unknown
// length keeps the dial and the percent, M9 fix 66), and a refresh
// button.
// The main process does the fetch (usage.ts) and this only asks: on
// open, every five minutes while the window is visible, on the window's
// focus when the last reading is older than that, and on the button. The
// reset countdown ticks once a minute on its own, so the text moves
// without a request. M9 fix 100: the asking keeps to a schedule
// (usage-model.ts), one request in flight and a floor between requests,
// the button included, that a 429 raises to the endpoint's retry-after;
// a press inside the floor fetches nothing and the button shows the hold
// and how long it has left instead, so nobody can spam the endpoint from
// here and nobody is left pressing a button that ignores them. M9 fix
// 163: an answer that is not a reading (a 429, a dropped connection, a
// 5xx) keeps the last windows on the strip, dimmed, with the card's note
// saying what the ask met and when the next goes; the note in their
// place shows only when there is no reading to keep, so a rate limit is
// a dim strip for a while rather than the numbers gone. M9 fix 321: the
// windows on show are written to usage-reading.ts as they change, for
// the activity view's five-hour unit; the strip is still the only thing
// that asks. M9 fix 348: each ask says what made it (mount, timer,
// focus, button) and the main log's read line carries it; a harness log
// that showed four reads in three seconds was four Page.reloads, a mount
// each, and the strip asks once per renderer life plus its schedule.
// M9 fix 347: the strip's form (the windows on one line, or one per
// line, the runways inline or under their resets) is measured rather
// than read off a container query: a hidden copy of the texts in the row
// form is measured after every render and on every resize of the
// windows' box, and the first form that fits (usage-model.ts fitForm)
// goes on the strip as data-stack, which style.css lays out. The needs
// go on data-needs for the verify script.

const REFRESH_MS = 5 * 60_000;
const TICK_MS = 60_000;
const HOLD_TICK_MS = 1000;

type PollKind = Extract<UsageAsk, 'timer' | 'focus'>;

// For the verify script, on the strip's element: the timer's and the
// focus's poll with an injected now, since a five-minute timer and a
// hidden window cannot be waited for in a run.
interface UsageHooks {
  poll(kind: PollKind, now?: number): void;
}

export function UsageStrip() {
  const [result, setResult] = useState<UsageResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [schedule, setSchedule] = useState<UsageSchedule>(NO_SCHEDULE);
  // The floor is the main process's to say (EMERALD_USAGE_FLOOR_MS, for the
  // verify script, whose steps press the button seconds apart), so the
  // first fetch waits for info, a few milliseconds, rather than land on
  // the default floor.
  const floor = useRef(USAGE_FLOOR_MS);
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  const lastAt = useRef<number | null>(null);
  // When the numbers on show were asked for, for the card's note (M73),
  // and the reading they came from, kept through an answer that is not
  // one (fix 163); askedAt is the last ask whatever it met.
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [kept, setKept] = useState<UsageWindow[] | null>(null);
  const [askedAt, setAskedAt] = useState<number | null>(null);
  // A fetch that lands after unmount must not set state; a click during a
  // fetch is ignored rather than queued, since the answer is the same.
  const inFlight = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback((at?: number, ask: UsageAsk = 'button') => {
    const asked = at ?? Date.now();
    if (inFlight.current) return;
    if (asked < scheduleRef.current.allowedAt) {
      // Inside the floor: no request, and the clock moves so the hold's
      // countdown reads as of this press.
      setNow(asked);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    void window.emerald.usage
      .get(ask)
      .catch((err: unknown) => {
        console.warn('[emerald] usage fetch failed', err);
        return { error: 'unavailable', reason: { kind: 'offline' } } as const;
      })
      .then((r) => {
        inFlight.current = false;
        if (!alive.current) return;
        const landed = Date.now();
        lastAt.current = landed;
        setResult(r);
        setAskedAt(landed);
        if ('windows' in r) {
          setKept(r.windows);
          setFetchedAt(landed);
        } else if (r.error !== 'unavailable') {
          // Signed out or refused: the token is gone, and a kept reading
          // would say the account is fine.
          setKept(null);
          setFetchedAt(null);
        }
        setNow(landed);
        setSchedule((prev) => nextSchedule(prev, r, landed, floor.current));
        setBusy(false);
      });
  }, []);

  const poll = useCallback(
    (kind: PollKind, at?: number) => {
      const asked = at ?? Date.now();
      if (!shouldPoll(kind, document.hidden, lastAt.current, asked, REFRESH_MS)) return;
      refresh(asked, kind);
    },
    [refresh],
  );

  useEffect(() => {
    alive.current = true;
    void window.emerald
      .info()
      .then((info) => {
        floor.current = info.usageFloorMs;
      })
      .catch((err: unknown) => console.warn('[emerald] could not read the usage floor', err))
      .then(() => {
        if (alive.current) refresh(undefined, 'mount');
      });
    const fetchTimer = setInterval(() => poll('timer'), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    const onFocus = () => poll('focus');
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      clearInterval(fetchTimer);
      clearInterval(tick);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh, poll]);

  // While held the countdown moves by the second, and stops when the
  // hold has passed, so the strip is quiet the rest of the time.
  const held = schedule.allowedAt > now;
  useEffect(() => {
    if (!held) return;
    const t = setInterval(() => setNow(Date.now()), HOLD_TICK_MS);
    return () => clearInterval(t);
  }, [held]);

  const hooks = useCallback(
    (el: HTMLDivElement | null) => {
      if (el !== null) (el as HTMLDivElement & { emeraldUsage?: UsageHooks }).emeraldUsage = { poll };
    },
    [poll],
  );

  // M9 fix 347: the fit. The probe's spans are read after every render
  // (the texts move with the clock and the reading) and whenever the
  // box's width changes; a form that is already on the strip sets no
  // state, so the layout effect settles in one pass.
  const fit = useRef<HTMLDivElement | null>(null);
  const probe = useRef<HTMLDivElement | null>(null);
  const [stack, setStack] = useState<StripForm>('');
  const [needs, setNeeds] = useState<string>('');
  // M9 fix 440: in the column forms the bar's track is whatever the
  // sidebar leaves once the label and the text (their own needs) are
  // laid out, the same arithmetic the CSS grid does (style.css); barPx
  // is that drawn width, fed to paceBar so the ticks pace to what is
  // actually on screen, and never under the model's 44px need.
  const [barPx, setBarPx] = useState<number>(STRIP_BAR_PX);
  const measure = useCallback(() => {
    if (fit.current === null || probe.current === null) return;
    const read = readNeeds(probe.current);
    const width = fit.current.getBoundingClientRect().width;
    const form = fitForm(read, width);
    setStack(form);
    const need = stripNeeds(read);
    setNeeds(STRIP_FORMS.map((f) => Math.ceil(need[f])).join(','));
    const column = form === 'column' || form === 'column-runway';
    setBarPx(column ? Math.max(STRIP_BAR_PX, width - need[form] + STRIP_BAR_PX) : STRIP_BAR_PX);
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    if (fit.current === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(fit.current);
    return () => observer.disconnect();
  }, [measure]);

  const state = result === null ? 'loading' : 'error' in result ? result.error : 'ok';
  // The windows on show: the answer's, or the kept reading while the
  // answer is unavailable, which is the stale case.
  const unavailable = result !== null && 'error' in result && result.error === 'unavailable' ? result : null;
  const windows = result !== null && 'windows' in result ? result.windows : unavailable !== null ? kept : null;
  useEffect(() => setUsageReading(windows), [windows]);
  const stale = unavailable !== null && windows !== null && askedAt !== null ? staleText(unavailable, askedAt, schedule.allowedAt, now) : null;
  // The texts a window shows, once, for the strip and the probe alike.
  // The bar here is always at the model's need (STRIP_BAR_PX): the text
  // beside it (tone, rest, runway) never depends on the drawn width, and
  // the probe reports the need, not the column form's grown bar.
  const parts = (windows ?? []).map((w) => {
    const bar = paceBar(w, now, STRIP_BAR_PX);
    const runway = stripRunway(bar, now);
    return { w, bar, runway, rest: runway === null ? stripText(w, bar, now) : segmentRest(w, now) };
  });
  // M9 fix 440: the visible bar paces its ticks to barPx, the column
  // form's drawn width, so a wider bar coarsens or refines rather than
  // stretching the same handful of ticks; every other form keeps barPx
  // at STRIP_BAR_PX and this is the same object as above.
  const columnForm = stack === 'column' || stack === 'column-runway';
  const tall = columnForm && barPx >= STRIP_BAR_TALL_PX;
  return (
    // M9 fix 347: data-stack is the measured form (style.css lays each
    // out), data-needs the four forms' needs in px for the verify script.
    <div ref={hooks} className="usage-strip" data-state={state} data-stale={stale !== null || undefined} data-windows={windows !== null ? windows.length : undefined} data-stack={stack} data-needs={windows !== null ? needs : undefined}>
      {/* usage-fit is the windows' own room, the box the fit is measured against; the refresh button is outside it (M9 fix 68). */}
      <div className="usage-fit" ref={fit}>
      <div className="usage-windows">
        {result === null && <span className="usage-note">Loading usage</span>}
        {result !== null && 'error' in result && windows === null && <span className="usage-note">{errorText(result, schedule.allowedAt, now)}</span>}
        {windows !== null && windows.length === 0 && <span className="usage-note">No usage windows</span>}
        {windows !== null &&
          parts.map(({ w, bar, runway, rest }, i) => (
            // The segment opens the usage card (M73 task 2), which is the
            // tooltip it carried. The dot between windows sits beside the
            // anchor, not in it (M9 fix 347), so the anchor's children are
            // the label, the bar and the text in every form.
            <Fragment key={w.key}>
              {i > 0 && <span className="usage-dot">·</span>}
              <UsageWindowAnchor windows={windows} current={w} now={now} fetchedAt={fetchedAt} stale={stale} className="usage-window">
                <span className="usage-label">{segmentLabel(w)}</span>
                {bar !== null ? <UsageBar bar={columnForm ? paceBar(w, now, barPx)! : bar} form="strip" tall={tall} /> : <span className="usage-meter" style={dialStyle(w.percent)} data-high={w.percent >= HIGH_PERCENT || undefined} />}
                {/* M9 fix 324: the text in the bar's tone, and in the error
                    tone the runway after a dot (stripText is the whole); the
                    three spans let the stacked forms put the runway on a line
                    of its own under the reset, the join hidden (style.css). */}
                <span className="usage-text" data-tone={bar?.tone}>
                  {runway === null ? rest : <><span className="usage-rest">{rest}</span><span className="usage-join"> · </span><span className="usage-runway">{runway}</span></>}
                </span>
              </UsageWindowAnchor>
            </Fragment>
          ))}
      </div>
      {/* M9 fix 347: the probe, the same texts in the row form, hidden and
          out of the flow, whose spans the fit measures; a bar's width is
          the model's constant, so no bar is drawn here. */}
      <div className="usage-probe" ref={probe} aria-hidden="true">
        <span data-probe="dot">·</span>
        {parts.map(({ w, bar, runway, rest }) => (
          <span key={w.key} data-probe="window" data-bar={bar !== null ? STRIP_BAR_PX : STRIP_METER_PX}>
            <span data-probe="label">{segmentLabel(w)}</span>
            <span data-probe="rest">{rest}</span>
            {runway !== null && <span data-probe="join"> · </span>}
            {runway !== null && <span data-probe="runway">{runway}</span>}
          </span>
        ))}
      </div>
      </div>
      <button
        className="usage-refresh"
        title={refreshTitle(result, schedule.allowedAt, now)}
        data-busy={busy ? 'true' : undefined}
        data-held={held || undefined}
        onClick={() => refresh()}
        // The terminal keeps the keyboard; a click here is not a focus change.
        onMouseDown={(ev) => ev.preventDefault()}
      >
        <RefreshIcon />
      </button>
    </div>
  );
}

// The probe's spans as the model's needs (M9 fix 347): each span's own
// width, which is its text's since nothing wraps or shrinks in the probe.
function readNeeds(probe: HTMLDivElement): StripNeeds {
  const width = (el: Element | null): number => (el === null ? 0 : el.getBoundingClientRect().width);
  const windows: StripWindowNeed[] = [...probe.querySelectorAll<HTMLElement>('[data-probe="window"]')].map((w) => {
    const join = w.querySelector('[data-probe="join"]');
    return {
      label: width(w.querySelector('[data-probe="label"]')),
      bar: Number(w.dataset['bar']),
      rest: width(w.querySelector('[data-probe="rest"]')),
      join: join === null ? null : width(join),
      runway: join === null ? null : width(w.querySelector('[data-probe="runway"]')),
    };
  });
  return { windows, dot: width(probe.querySelector('[data-probe="dot"]')) };
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3.2h-3.2" />
    </svg>
  );
}
