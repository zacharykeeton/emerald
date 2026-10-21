import type { AskTab } from './screen-prompt-model.ts';

// M9 fix 922: an AskUserQuestion's tabs on an ask card, the chat view's or
// the sidebar's: the current one a chip as before, every other one a
// button that moves the dialog to its question. The mouse-down keeps the
// focus where it is (the chat card's keys; the terminal under the
// sidebar's card, whose own mouse-down already keeps it). Since fix 959 the
// buttons take no focus by Tab either; the cards walk the tabs by the
// dialog's keys.
export function AskTabs({ tabs, prefix, sent, onPress }: { tabs: readonly AskTab[]; prefix: 'chat-ask' | 'answer-popover'; sent: boolean; onPress: (to: number) => void }) {
  const cur = tabs.findIndex((t) => t.current);
  return (
    <div className={`${prefix}-tabs`}>
      {tabs
        .filter((t) => t.state !== 'submit')
        .map((t, i) => {
          const mark = t.state === 'answered' && <span className={`${prefix}-tab-mark`}>✓</span>;
          if (t.current || cur < 0) {
            return (
              <span key={i} className={`${prefix}-tab`} data-state={t.state} data-current={t.current ? 'true' : undefined}>
                {mark}
                {t.name}
              </span>
            );
          }
          const n = Math.abs(i - cur);
          const times = n > 1 ? ` ${n} times` : '';
          const title = i < cur ? `Sends ← to the session${times}, back to this question` : `Sends → to the session${times}, on to this question`;
          return (
            <button key={i} type="button" className={`${prefix}-tab`} data-state={t.state} data-sent={sent ? 'true' : undefined} title={title} tabIndex={-1} onMouseDown={(ev) => ev.preventDefault()} onClick={() => onPress(i)}>
              {mark}
              {t.name}
            </button>
          );
        })}
    </div>
  );
}
