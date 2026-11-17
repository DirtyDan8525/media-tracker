import { MESSAGE_MAX, type RecSnapshot } from '@media-tracker/shared';
import { useRef, useState, type KeyboardEvent } from 'react';
import { sendErrorText, useSendRec, useSendText } from '../../data/messages';
import { Icon } from '../../design/components/Icon';
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
export function Composer({ conversationId, onSent }: { conversationId: string; onSent: () => void }) {
  const toast = useToast();
  const wide = useIsWide();
  const sendText = useSendText(conversationId);
  const sendRec = useSendRec(conversationId);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  const length = Array.from(text.trim()).length;
  const over = length > MESSAGE_MAX;
  const canSend = length > 0 && !over && !sendText.isPending;

  async function send() {
    if (!canSend) return;
    try {
      await sendText.mutateAsync(text.trim());
      setText('');
      onSent();
    } catch (e) {
      toast.show(sendErrorText(e));
    }
    field.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && wide && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  async function recommend(rec: RecSnapshot, note: string) {
    setPicker(false);
    try {
      await sendRec.mutateAsync({ rec, ...(note ? { text: note } : {}) });
      toast.show(`Recommended ${rec.title}`);
      onSent();
    } catch (e) {
      toast.show(sendErrorText(e));
    }
  }

  return (
    <div className="composer">
      <div className="composer__row">
        <button type="button" className="btn btn--secondary btn--compact composer__rec" aria-haspopup="dialog" onClick={() => setPicker(true)}>
          <Icon name="share" size={18} />Recommend
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
