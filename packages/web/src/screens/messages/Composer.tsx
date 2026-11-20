import { MESSAGE_MAX, type RecSnapshot } from '@media-tracker/shared';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '../../api/client';
import { sendErrorText, useSendRec, useSendText } from '../../data/messages';
import { Icon } from '../../design/components/Icon';
import { IconButton } from '../../design/components/IconButton';
import { useToast } from '../../design/components/Toast';
import { useIsWide } from '../../hooks';
import { RecommendPicker } from './RecommendPicker';

/** The counter shows from here on. */
const COUNTER_FROM = 1800;

/**
 * The chat's composer: a Recommend button (one picker over all your lists, optional note), the text field and Send. Sending pictures is
 * hidden for now (Dan, 2026-11-17): the server and useSendImage stay, the Photo option is gone. On PC Enter sends and Shift+Enter starts a
 * new line; on a phone Enter is a new line (Send is the button). 2000 characters at most, with a counter near the limit.
 */
export interface ReplyDraft { id: string; name: string; snippet: string }

export function Composer({ conversationId, onSent, reply = null, onCancelReply }: { conversationId: string; onSent: () => void; reply?: ReplyDraft | null; onCancelReply?: () => void }) {
  const toast = useToast();
  const wide = useIsWide();
  const sendText = useSendText(conversationId);
  const sendRec = useSendRec(conversationId);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // Choosing a message to reply to moves you to the field, ready to type.
  useEffect(() => { if (reply) field.current?.focus(); }, [reply?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const replyTo = reply?.id ?? null;
  /** A reply whose original has gone: the bar is dropped, the typed text stays. */
  const failed = (e: unknown) => {
    toast.show(sendErrorText(e));
    if (e instanceof ApiError && e.error === 'invalid_reply') onCancelReply?.();
  };

  const length = Array.from(text.trim()).length;
  const over = length > MESSAGE_MAX;
  const canSend = length > 0 && !over && !sendText.isPending;

  async function send() {
    if (!canSend) return;
    try {
      await sendText.mutateAsync({ text: text.trim(), replyTo });
      setText('');
      onSent();
    } catch (e) {
      failed(e);
    }
    field.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape' && reply && onCancelReply) {
      e.stopPropagation();
      onCancelReply();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && wide && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  async function recommend(rec: RecSnapshot, note: string) {
    setPicker(false);
    try {
      await sendRec.mutateAsync({ rec, ...(note ? { text: note } : {}), replyTo });
      toast.show(`Recommended ${rec.title}`);
      onSent();
    } catch (e) {
      failed(e);
    }
  }

  return (
    <div className="composer">
      {reply && (
        <div className="composer__reply" role="group" aria-label="Replying to">
          <p className="composer__reply-text"><span>Replying to <b>{reply.name}</b>:</span> <span className="composer__reply-snippet">{reply.snippet}</span></p>
          <IconButton label="Cancel reply" icon="close" look="plain" onClick={() => onCancelReply?.()} />
        </div>
      )}
      <div className="composer__row">
        <button type="button" className="icon-btn icon-btn--outlined composer__rec" aria-label="Recommend" title="Recommend" aria-haspopup="dialog" onClick={() => setPicker(true)}>
          <Icon name="share" size={22} />
        </button>
        <textarea ref={field} className="input composer__field" rows={1} aria-label="Message" placeholder="Message" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} aria-invalid={over || undefined} />
        <button type="button" className="icon-btn icon-btn--outlined composer__send" aria-label="Send" title="Send" disabled={!canSend} onClick={() => void send()}>
          <Icon name="send" size={22} />
        </button>
      </div>
      {length >= COUNTER_FROM && (
        <p className={`composer__count${over ? ' is-over' : ''}`}>{length} / {MESSAGE_MAX}{over ? ' · too long' : ''}</p>
      )}
      <RecommendPicker open={picker} onClose={() => setPicker(false)} onPick={(r, note) => void recommend(r, note)} />
    </div>
  );
}
