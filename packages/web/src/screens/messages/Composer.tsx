import { MESSAGE_MAX, type RecSnapshot } from '@media-tracker/shared';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '../../api/client';
import { sendErrorText, useSendImage, useSendRec, useSendText } from '../../data/messages';
import { Icon } from '../../design/components/Icon';
import { IconButton } from '../../design/components/IconButton';
import { useToast } from '../../design/components/Toast';
import { useIsWide } from '../../hooks';
import { RecommendPicker } from './RecommendPicker';
import { resizeImage } from './resizeImage';

/** The counter shows from here on. */
const COUNTER_FROM = 1800;

/**
 * The chat's composer: + (Photo, Recommend a title), the text field and Send. On PC Enter sends and Shift+Enter starts a
 * new line; on a phone Enter is a new line (Send is the button). 2000 characters at most, with a counter near the limit.
 */
export function Composer({ conversationId, onSent }: { conversationId: string; onSent: () => void }) {
  const toast = useToast();
  const wide = useIsWide();
  const sendText = useSendText(conversationId);
  const sendRec = useSendRec(conversationId);
  const sendImage = useSendImage(conversationId);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const [noPictures, setNoPictures] = useState(false);
  const [sendingPicture, setSendingPicture] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('pointerdown', close);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

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

  async function onPhoto(f: File | undefined) {
    if (!f) return;
    setSendingPicture(true);
    try {
      let blob: Blob;
      try {
        blob = await resizeImage(f);
      } catch {
        toast.show("Couldn't read that picture.");
        return;
      }
      await sendImage.mutateAsync(blob);
      onSent();
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setNoPictures(true);
      toast.show(sendErrorText(e, 'picture'));
    } finally {
      setSendingPicture(false);
      if (file.current) file.current.value = '';
    }
  }

  async function recommend(rec: RecSnapshot) {
    setPicker(false);
    try {
      await sendRec.mutateAsync({ rec });
      toast.show(`Recommended ${rec.title}`);
      onSent();
    } catch (e) {
      toast.show(sendErrorText(e));
    }
  }

  return (
    <div className="composer">
      {sendingPicture && <p className="composer__status" role="status">Sending picture…</p>}
      <div className="composer__row">
        <div className="composer__plus" ref={wrap}
          onKeyDown={(e) => { if (e.key === 'Escape' && menu) { e.stopPropagation(); setMenu(false); wrap.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus(); } }}>
          <IconButton label="Add to message" icon="plus" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} />
          {menu && (
            <div role="menu" aria-label="Add to message" className="menu composer__menu">
              <button type="button" role="menuitem" className="menu__item" disabled={noPictures}
                onClick={() => { setMenu(false); file.current?.click(); }}>{noPictures ? 'Pictures need setup' : 'Photo'}</button>
              <button type="button" role="menuitem" className="menu__item" onClick={() => { setMenu(false); setPicker(true); }}>Recommend a title</button>
            </div>
          )}
        </div>
        <input ref={file} type="file" accept="image/*" hidden aria-label="Choose a photo" tabIndex={-1}
          onChange={(e) => void onPhoto(e.target.files?.[0])} />
        <textarea ref={field} className="input composer__field" rows={1} aria-label="Message" placeholder="Message" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} aria-invalid={over || undefined} />
        <button type="button" className="icon-btn icon-btn--outlined composer__send" aria-label="Send" title="Send" disabled={!canSend} onClick={() => void send()}>
          <Icon name="send" size={22} />
        </button>
      </div>
      {length >= COUNTER_FROM && (
        <p className={`composer__count${over ? ' is-over' : ''}`}>{length} / {MESSAGE_MAX}{over ? ' · too long' : ''}</p>
      )}
      <RecommendPicker open={picker} onClose={() => setPicker(false)} onPick={(r) => void recommend(r)} />
    </div>
  );
}
