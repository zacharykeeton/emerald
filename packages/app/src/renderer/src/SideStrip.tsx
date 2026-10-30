// M9 fix 1005: a /btw side question beside the chat view, its question and
// the answer Claude Code draws in its panel, read off the screen since the
// side question never reaches the transcript. The view owns its state
// (ChatView.tsx); this only draws it. Esc or the close button closes it
// and the panel with it.

export interface SideStripProps {
  question: string;
  // Null while the panel answers.
  answer: string | null;
  // No screen read drew the panel in time after the send.
  missing: boolean;
  onClose: () => void;
}

export function SideStrip({ question, answer, missing, onClose }: SideStripProps) {
  const state = missing ? 'missing' : answer === null ? 'pending' : 'answered';
  return (
    <aside className="chat-side" aria-label="Side question" data-state={state}>
      <div className="chat-side-head">
        <span className="chat-side-title">/btw</span>
        <button type="button" className="chat-side-close" aria-label="Close the side question" title="Close (Esc)" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="chat-side-question">{question}</div>
      {state === 'pending' && <div className="chat-side-pending">Answering…</div>}
      {state === 'answered' && <div className="chat-side-answer">{answer}</div>}
      {state === 'missing' && <div className="chat-side-pending">The side question did not open in the session. The terminal view shows what it drew.</div>}
    </aside>
  );
}
