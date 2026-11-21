import { GIF_MAX_BYTES, MESSAGE_MAX, type RecSnapshot } from '@media-tracker/shared';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '../../api/client';
import { useMediaOptions } from '../../data/appSettings';
import { sendErrorText, useSendImage, useSendRec, useSendText, useSendVoice } from '../../data/messages';
import { Icon } from '../../design/components/Icon';
import { IconButton } from '../../design/components/IconButton';
import { useToast } from '../../design/components/Toast';
import { useIsWide } from '../../hooks';
import { RecommendPicker } from './RecommendPicker';
import { resizeImage } from './resizeImage';
import { VoiceRecorder } from './VoiceRecorder';

/** A GIF by its type or its first bytes (GIF87a / GIF89a). */
async function isGif(file: Blob): Promise<boolean> {
  if (file.type === 'image/gif') return true;
  try {
    const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
    return head.length === 6 && String.fromCharCode(...head).startsWith('GIF8') && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61;
  } catch { return false; }
}

/** The counter shows from here on. */
const COUNTER_FROM = 1800;

/**
 * The chat's composer: a "+" (More options) menu, the text field and Send. The menu offers Send a recommendation (one picker over
 * all your lists, optional note), Send a photo and Record a voice memo; the last two only when their admin switch is on and the
 * server has the storage (useMediaOptions). On PC Enter sends and Shift+Enter starts a new line; on a phone Enter is a new line
 * (Send is the button). 2000 characters at most, with a counter near the limit. More items can join the menu's list.
 */
export interface ReplyDraft { id: string; name: string; snippet: string }

export function Composer({ conversationId, onSent, reply = null, onCancelReply }: { conversationId: string; onSent: () => void; reply?: ReplyDraft | null; onCancelReply?: () => void }) {
  const toast = useToast();
  const wide = useIsWide();
  const sendText = useSendText(conversationId);
  const sendRec = useSendRec(conversationId);
  const sendImage = useSendImage(conversationId);
  const sendVoice = useSendVoice(conversationId);
  const options = useMediaOptions();
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [recording, setRecording] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menuWrap = useRef<HTMLDivElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!menuWrap.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('pointerdown', away);
    menuWrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', away);
  }, [menu]);
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
  // A photo waits here after it's chosen; Send sends it (then any typed text), ✕ removes it (Dan, 2026-11-20).
  const [staged, setStaged] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => () => { if (staged?.url) URL.revokeObjectURL(staged.url); }, [staged]);
  const busy = sendText.isPending || sendImage.isPending;
  const canSend = (length > 0 || staged !== null) && !over && !busy;

  async function send() {
    if (!canSend) return;
    if (staged) {
      try {
        await sendImage.mutateAsync(staged.blob);
        setStaged(null);
        if (length === 0) onSent();
      } catch (e) {
        toast.show(sendErrorText(e, 'picture'));
        return;
      }
      if (length === 0) { field.current?.focus(); return; }
    }
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

  async function stagePhoto(file: File | undefined) {
    if (!file) return;
    let blob: Blob;
    if (await isGif(file)) {
      // A GIF goes as it is: resizing would flatten it to one frame.
      if (file.size > GIF_MAX_BYTES) { toast.show('That GIF is too big to send (max 8 MB).'); return; }
      blob = file.type === 'image/gif' ? file : new Blob([file], { type: 'image/gif' });
    } else try {
      // Resized (longest side 1600 px) and re-encoded: the copy carries no EXIF or location.
      blob = await resizeImage(file);
    } catch {
      toast.show("That file isn't a photo that can be sent.");
      return;
    }
    let url = '';
    try { url = URL.createObjectURL(blob); } catch { /* no preview, still sendable */ }
    setStaged({ blob, url });
    field.current?.focus();
  }

  async function sendMemo(blob: Blob, durationMs: number) {
    try {
      await sendVoice.mutateAsync({ blob, durationMs });
      setRecording(false);
      onSent();
      field.current?.focus();
    } catch (e) {
      toast.show(sendErrorText(e, 'voice'));
    }
  }

  /** The + menu's items, in order (add new ones here). */
  const items: { key: string; label: string; icon: 'share' | 'image' | 'mic'; run: () => void }[] = [
    { key: 'rec', label: 'Send a recommendation', icon: 'share', run: () => setPicker(true) },
    ...(options.photos ? [{ key: 'photo', label: 'Send a photo', icon: 'image' as const, run: () => fileInput.current?.click() }] : []),
    ...(options.voice ? [{ key: 'voice', label: 'Record a voice memo', icon: 'mic' as const, run: () => setRecording(true) }] : []),
  ];
  const closeMenu = (refocus: boolean) => { setMenu(false); if (refocus) plus.current?.focus(); };
  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && menu) { e.stopPropagation(); closeMenu(true); return; }
    if (!menu || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const all = [...(menuWrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    all[(at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  }

  if (recording) {
    return (
      <div className="composer">
        <VoiceRecorder sending={sendVoice.isPending} onSend={(b, ms) => void sendMemo(b, ms)} onClose={() => { setRecording(false); field.current?.focus(); }} />
      </div>
    );
  }

  return (
    <div className="composer">
      {reply && (
        <div className="composer__reply" role="group" aria-label="Replying to">
          <p className="composer__reply-text"><span>Replying to <b>{reply.name}</b>:</span> <span className="composer__reply-snippet">{reply.snippet}</span></p>
          <IconButton label="Cancel reply" icon="close" look="plain" onClick={() => onCancelReply?.()} />
        </div>
      )}
      {staged && (
        <div className="composer__staged" role="group" aria-label="Photo to send">
          <span className="composer__staged-img">
            <img src={staged.url} alt="Photo to send" />
            <IconButton label="Remove photo" icon="close" look="plain" className="composer__staged-remove"
              onClick={() => { setStaged(null); field.current?.focus(); }} />
          </span>
        </div>
      )}
      <div className="composer__row">
        <div className="composer__more" ref={menuWrap} onKeyDown={onMenuKey}>
          <button ref={plus} type="button" className="icon-btn icon-btn--outlined composer__plus" aria-label="More options" title="More options"
            aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            <Icon name="plus" size={22} />
          </button>
          {menu && (
            <div role="menu" aria-label="More options" className="menu composer__menu">
              {items.map((it) => (
                <button key={it.key} type="button" role="menuitem" className="menu__item composer__menu-item" onClick={() => { closeMenu(false); it.run(); }}>
                  <Icon name={it.icon} size={20} /> {it.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {options.photos && (
          <input ref={fileInput} type="file" accept="image/*,image/gif" className="sr-only" tabIndex={-1} aria-hidden="true"
            data-testid="photo-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void stagePhoto(f); }} />
        )}
        <textarea ref={field} className="input composer__field" rows={1} aria-label="Message" placeholder="Message" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} aria-invalid={over || undefined} />
        <button type="button" className="icon-btn icon-btn--outlined composer__send" aria-label="Send" title="Send" disabled={!canSend}
          // Keep focus (and the phone keyboard) in the message box: without this the first tap only closed the keyboard,
          // the layout jumped and a second tap was needed to send (Dan, 2026-11-20).
          onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
          onClick={() => void send()}>
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
