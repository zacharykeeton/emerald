import { useEffect, useMemo, useState } from 'react';
import type { SessionInfo } from '@emerald/shared';
import { folderName } from './files-model.ts';
import { PLAN_POLL_MS, PLAN_REL, planBlocks, planPrompt, planSendGate, planTitle } from './plan-doc-model.ts';
import type { PendingPlan } from './plan-doc-model.ts';
import { sendPlanComments } from './plan-send.ts';
import { commentCount, countText, keepDraft, openDraft, removeComment } from './review-model.ts';
import { getReview, updateReview, useReview } from './review-state.ts';
import { GeneralLine } from './ReviewTab.tsx';
import { useStore } from './store.ts';
import { planFile, planSessionId, tabQuery } from './tabs-model.ts';
import { openPlanTab, setTabTitle, useUi } from './ui.ts';

// M9 fix 1169: a plan waiting for approval as a document. The ask card
// heads a plan's approval with its title and Open the plan; the tab cuts
// the plan into its parts (each heading, paragraph and list item), takes
// the review tab's comments on each part and a general one, and Send
// comments types them into the dialog's No, keep planning row, so Claude
// keeps planning with them. The plan's file wins over the transcript's
// text: it is what the approval carries out, and ctrl+g edits it after
// the tool_use was written; the transcript's text stands in when there
// is no file (a plan handed straight to the tool), and with neither the
// tab says so. The comments live under `plan:<session>` in
// review-state.ts, for the app's run, as a review's do.

// The transcript's plan text per session, set by the card's button, since
// the tab is keyed by the session and the file alone survives in its path.
const fromTranscript = new Map<string, string>();

export function rememberPlan(sessionId: string, text: string | null): void {
  if (text === null || text === '') fromTranscript.delete(sessionId);
  else fromTranscript.set(sessionId, text);
}

export function PlanCardHead({ session, plan }: { session: SessionInfo; plan: PendingPlan }) {
  const title = plan.text !== null && plan.text.trim() !== '' ? planTitle(plan.text) : plan.path === null ? '' : folderName(plan.path);
  return (
    <>
      <div className="chat-ask-head-row">
        <div className="chat-ask-heading">Claude's plan is ready</div>
        <button
          type="button"
          className="chat-ask-plan-open"
          title="Open the plan in a tab to comment on its parts and send the comments back as the answer"
          onClick={() => {
            rememberPlan(session.id, plan.text);
            openPlanTab(session.id, plan.path ?? undefined);
          }}
        >
          Open the plan
        </button>
      </div>
      <div className="chat-ask-plan-title" title={plan.path ?? undefined}>
        {title}
      </div>
    </>
  );
}

type Source = 'file' | 'transcript' | 'none';

export function PlanTab({ path }: { path: string }) {
  const id = planSessionId(path) ?? '';
  const { sessions } = useStore('sessions');
  const { tabs } = useUi();
  const session = sessions.get(id);
  const file = planFile(tabQuery(tabs, path));
  const key = `plan:${id}`;
  const review = useReview(key);
  const [read, setRead] = useState<{ text: string | null; source: Source }>({ text: null, source: 'none' });
  const [sent, setSent] = useState<'sent' | 'not-moved' | null>(null);
  const name = session?.name ?? id;

  useEffect(() => {
    let live = true;
    const fetch = async () => {
      let text: string | null = null;
      let source: Source = 'none';
      if (file !== null) {
        try {
          const r = await window.emerald.files.read(file);
          if ('text' in r) {
            text = r.text;
            source = 'file';
          }
        } catch {
          // A file gone since the plan was written falls back below.
        }
      }
      if (text === null) {
        const t = fromTranscript.get(id);
        if (t !== undefined) {
          text = t;
          source = 'transcript';
        }
      }
      if (live) setRead((prev) => (prev.text === text && prev.source === source ? prev : { text, source }));
    };
    void fetch();
    const timer = setInterval(() => void fetch(), PLAN_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [file, id]);

  useEffect(() => {
    setTabTitle(path, `Plan · ${name}`);
  }, [path, name]);

  const blocks = useMemo(() => (read.text === null ? [] : planBlocks(read.text)), [read.text]);
  const count = commentCount(review);
  const gate = planSendGate(session, count);

  const send = () => {
    if (session === undefined || !gate.enabled) return;
    // The draft is kept first, so nothing typed is lost.
    updateReview(key, keepDraft);
    const state = getReview(key);
    void sendPlanComments(session.id, planPrompt(state.comments, state.general)).then((outcome) => {
      if (outcome === 'sent') updateReview(key, (s) => ({ ...s, comments: [], draft: null, general: '', generalOpen: false }));
      setSent(outcome);
    });
  };

  // A link in the plan opens in the browser when it is the web's; any
  // other navigates nowhere.
  const onBlockClick = (ev: React.MouseEvent) => {
    const a = (ev.target as HTMLElement).closest('a');
    if (a === null) return;
    ev.preventDefault();
    const href = a.getAttribute('href');
    if (href !== null && /^https?:/i.test(href)) void window.emerald.files.openExternal(href);
  };

  return (
    <div className="file-view plan-tab" data-path={path} data-session-id={id} data-source={read.source} data-blocks={blocks.length} data-comments={count}>
      <div className="file-header plan-header">
        <span className="plan-name">{name}</span>
        <span className="plan-file" title={read.source === 'file' && file !== null ? file : undefined}>
          {read.source === 'file' && file !== null ? folderName(file) : read.source === 'transcript' ? 'from the transcript' : ''}
        </span>
        <span className="plan-spacer" />
        <span className="plan-count" data-count={count}>
          {countText(count)}
        </span>
        {gate.note !== null && <span className="plan-note">{gate.note}</span>}
        <button className="plan-send" disabled={!gate.enabled} title={gate.enabled ? `Type the ${countText(count)} into ${name}'s plan dialog as the answer; Claude keeps planning with them` : (gate.note ?? 'Nothing to send')} onClick={send}>
          Send comments
        </button>
      </div>
      <GeneralLine sessionId={key} open={review.generalOpen} text={review.general} />
      {sent !== null && (
        <div className="plan-sent" data-outcome={sent}>
          {sent === 'sent' ? `Sent to ${name}; Claude keeps planning with your comments.` : "The plan's dialog was not on the screen; nothing was sent."}
          <button className="files-button" onClick={() => setSent(null)}>
            ×
          </button>
        </div>
      )}
      <div className="plan-body">
        {read.text === null ? (
          <div className="plan-empty">No plan to show; open it from the plan's ask card in the chat view.</div>
        ) : (
          <div className="plan-doc">
            {blocks.map((b) => {
              const kept = review.comments.find((c) => c.rel === PLAN_REL && c.line === b.line);
              const draft = review.draft !== null && review.draft.rel === PLAN_REL && review.draft.line === b.line ? review.draft : null;
              return (
                <div key={b.line} className="plan-block" data-line={b.line} data-commented={kept !== undefined || undefined} data-drafting={draft !== null || undefined}>
                  <button className="plan-block-comment" title="Comment on this part of the plan" onClick={() => updateReview(key, (s) => openDraft(s, PLAN_REL, b.line, b.code))}>
                    +
                  </button>
                  <div className="plan-block-main">
                    <div className="plan-block-text markdown" onClick={onBlockClick} dangerouslySetInnerHTML={{ __html: b.html }} />
                    {draft !== null ? <DraftBox reviewKey={key} line={b.line} text={draft.text} /> : kept !== undefined && <KeptRow reviewKey={key} line={b.line} code={b.code} text={kept.text} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// A kept comment as the review's keptRow draws it: the mark, the text on
// one line, edit and remove; a click on the text edits it.
function KeptRow({ reviewKey, line, code, text }: { reviewKey: string; line: number; code: string; text: string }) {
  const edit = () => updateReview(reviewKey, (s) => openDraft(s, PLAN_REL, line, code));
  return (
    <div className="review-comment" data-line={line}>
      <span className="review-comment-mark">▪</span>
      <span className="review-comment-text" title={text} onClick={edit}>
        {text}
      </span>
      <button className="review-comment-edit" onClick={edit}>
        edit
      </button>
      <button className="review-comment-remove" onClick={() => updateReview(reviewKey, (s) => removeComment(s, PLAN_REL, line))}>
        remove
      </button>
    </div>
  );
}

// The box under a part, as the review's draftBox: Ctrl+Enter keeps,
// Escape cancels, every keystroke to the store so the count and Send see it.
function DraftBox({ reviewKey, line, text }: { reviewKey: string; line: number; text: string }) {
  const keep = () => updateReview(reviewKey, keepDraft);
  const cancel = () => updateReview(reviewKey, (s) => ({ ...s, draft: null }));
  return (
    <div className="review-comment-box" data-line={line}>
      <textarea
        className="review-comment-input"
        placeholder="A comment on this part of the plan"
        value={text}
        rows={2}
        autoFocus
        onChange={(ev) => {
          const value = ev.target.value;
          updateReview(reviewKey, (s) => (s.draft === null ? s : { ...s, draft: { ...s.draft, text: value } }));
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            ev.preventDefault();
            cancel();
          } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
            ev.preventDefault();
            keep();
          }
          ev.stopPropagation();
        }}
      />
      <div className="review-comment-actions">
        <button className="review-comment-keep" onClick={keep}>
          Keep
        </button>
        <button className="review-comment-cancel" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
