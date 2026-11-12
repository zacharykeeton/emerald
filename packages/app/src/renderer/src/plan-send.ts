import { typeInto } from './actions.ts';
import { planFeedback } from './plan-doc-model.ts';
import { CLAUDE_ENTER_DELAY_MS } from './prompt-model.ts';
import { FREE_MOVE_WAIT_MS } from './screen-prompt-model.ts';
import { acknowledgeAttention } from './ui.ts';

// M9 fix 1169: the plan tab's Send comments, typed into the plan dialog's
// No, keep planning row as sendFreeAnswer types an AskUserQuestion's free
// answer (actions.ts): the row's digit when the pointer is elsewhere, a
// read until the pointer is there (the keys after it must land in the
// field), Backspaces over what the field holds and the text in one
// write, then Enter alone after the pause a Claude session needs, which
// answers the dialog with the text as feedback and Claude keeps planning.
// Not on the prompt chain: at the dialog nothing is queued behind it.
export async function sendPlanComments(sessionId: string, text: string): Promise<'sent' | 'not-moved'> {
  const read = async () => {
    const res = await window.emerald.request('pty.screen', { sessionId });
    return planFeedback(res.rows);
  };
  let field = await read();
  if (field === null) return 'not-moved';
  if (!field.pointer) {
    typeInto(sessionId, field.key);
    const until = Date.now() + FREE_MOVE_WAIT_MS;
    let there = false;
    while (!there && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const next = await read();
      if (next !== null && next.pointer) {
        field = next;
        there = true;
      }
    }
    if (!there) {
      console.warn('[emerald] plan comments: the pointer never reached the No, keep planning row');
      return 'not-moved';
    }
  }
  typeInto(sessionId, '\x7f'.repeat([...field.typed].length) + text);
  await new Promise((resolve) => setTimeout(resolve, CLAUDE_ENTER_DELAY_MS));
  typeInto(sessionId, '\r');
  acknowledgeAttention(sessionId);
  return 'sent';
}
