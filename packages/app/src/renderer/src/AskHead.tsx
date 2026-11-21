import { useSyncExternalStore } from 'react';
import type { SessionInfo } from '@emerald/shared';
import { askHeadParts } from './ask-notify-model.ts';
import { askNotifyLine, subscribeAskNotify } from './ask-notify.ts';

// The quiet line after a permission ask answered from its toast (M9 fix
// 1199, board A2): the record of a grant made away from the dialog, the
// latest answer of the session, put away by its next prompt.
export function NotifyAnswerLine({ session }: { session: Pick<SessionInfo, 'id' | 'lastPromptAt'> }) {
  const line = useSyncExternalStore(subscribeAskNotify, () => askNotifyLine(session.id));
  if (line === null) return null;
  if (session.lastPromptAt != null && line.at < session.lastPromptAt) return null;
  return (
    <div className="chat-notify-answer" data-tool-use-id={line.toolUseId} data-allowed={line.allowed ? 'true' : 'false'}>
      <span className="chat-notify-answer-mark">{line.allowed ? '✓' : '✕'}</span>
      <span>{line.allowed ? 'Allowed once from the notification:' : 'Denied from the notification:'}</span>
      <code className="chat-notify-answer-command">{line.command}</code>
      <time>{new Date(line.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
    </div>
  );
}

// The head of a permission ask's card off the mod's record (M9 fix 1199),
// one component for the chat's ask card and the sidebar's answer popover
// so the two never disagree: the tool in a chip and the input's own
// description beside it, the exact input in full (wrapping, never cut),
// then why it was asked, the rule or the reason, when the mod sent one.
export function AskHead({ asked, agent }: { asked: NonNullable<SessionInfo['askedFor']>; agent: string | null }) {
  const { desc, why } = askHeadParts(asked, agent);
  return (
    <>
      <div className="chat-ask-head-row">
        <span className="chat-ask-tool">{asked.tool}</span>
        {desc !== null && <span className="chat-ask-desc-line">{desc}</span>}
      </div>
      <pre className="chat-ask-command">{asked.input}</pre>
      {why !== null && <div className="chat-ask-why">{why}</div>}
    </>
  );
}
