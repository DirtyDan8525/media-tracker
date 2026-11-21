import { nameOf, type Conversation, type Message, type PublicUser } from '@media-tracker/shared';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { backState } from '../../shell/BackButton';
import { ApiError } from '../../api/client';
import { conversationTitle, messageImageUrl, useChat, useConversation, useDeleteMessage, useMuteConversation, useReactToMessage } from '../../data/messages';
import { CoverBackdrop } from '../../design/components/CoverBackdrop';
import { Avatar } from '../../design/components/Avatar';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Icon } from '../../design/components/Icon';
import { IconButton } from '../../design/components/IconButton';
import { Sheet } from '../../design/components/Sheet';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { BackButton } from '../../shell/BackButton';
import { useIsWide } from '../../hooks';
import { useSessionMe } from '../../shell/SessionGate';
import { dayLabel } from '../activity/format';
import { Composer, type ReplyDraft } from './Composer';
import { TextSizeControl } from '../../design/components/TextSizeControl';
import { useBubbleMineColors } from './bubbleColors';
import { useChatTextSize } from '../../design/components/useTextSize';
import { AddPeopleSheet, LeaveSheet, RenameSheet } from './GroupSheets';
import { RecCard } from './RecCard';
import { useBackdropCover } from './useBackdropCover';
import { quoteText, snippetOfMessage } from './format';
import { MessageMenu, reactionGroups } from './MessageMenu';
import { LONG_PRESS_MS, SWIPE_REPLY_PX, useBubbleGestures } from './useBubbleGestures';
import { VoicePlayer } from './VoicePlayer';
import { PictureViewer } from '../../media/photoStaging';
import '../../design/messages.css';

/** Back in a chat. Phone: the round arrow to the Messages list. PC (no arrow of its own): a "Back" button that returns to where you opened the chat from, else the Messages list. */
function ChatBack() {
  const wide = useIsWide();
  return <BackButton to="/messages" pc useHistory={wide} />;
}

/** One chat (route /messages/:id): bubbles, day separators, the composer. Polls every 5 s while visible (see useChat). */
export function ChatScreen() {
  const { id = '' } = useParams();
  const conv = useConversation(id);
  if (conv.isPending) {
    return (
      <div className="screen chat" aria-busy="true" aria-label="Loading">
        <div className="chat__top"><ChatBack /></div>
        <div className="screen__body stack-10"><Skeleton height={48} /><Skeleton height={48} /></div>
      </div>
    );
  }
  if (conv.isError || !conv.data) {
    const missing = conv.error instanceof ApiError && conv.error.status === 404;
    return (
      <div className="screen chat">
        <div className="chat__top"><ChatBack /></div>
        <div className="screen__body">
          {missing ? (
            <EmptyState icon="info" title="We couldn't find that chat" body="It may be gone, or you're not in it any more." actionLabel="Go to Messages" actionHref="/messages" />
          ) : (
            <EmptyState icon="info" title="Couldn't load this chat" body="Check your connection and try again." actionLabel="Retry" onAction={() => void conv.refetch()} />
          )}
        </div>
      </div>
    );
  }
  return <Chat conversation={conv.data} />;
}

/** The hidden hint every bubble points at (aria-describedby). */
const HINT_ID = 'chat-bubble-hint';

/** A pause this long starts a new run of bubbles (more space above it, the name again in a group). */
const RUN_GAP_MS = 10 * 60_000;

type Sheets = null | 'rename' | 'add' | 'leave';

function Chat({ conversation }: { conversation: Conversation }) {
  const me = useSessionMe();
  const toast = useToast();
  const { query, chat } = useChat(conversation.id);
  const del = useDeleteMessage(conversation.id);
  const mute = useMuteConversation(conversation.id);
  const [sheet, setSheet] = useState<Sheets>(null);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [viewing, setViewing] = useState<Message | null>(null);
  const [live, setLive] = useState('');
  const [reply, setReply] = useState<ReplyDraft | null>(null);
  const [menuFor, setMenuFor] = useState<{ m: Message; anchor: HTMLElement | null } | null>(null);
  const [whoFor, setWhoFor] = useState<Message | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const textSize = useChatTextSize();
  const mineColors = useBubbleMineColors();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const menuWrap = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);

  const wide = useIsWide();
  const cover = useBackdropCover(conversation.members.filter((m) => m.id !== me.id).map((m) => m.username), wide);
  const isGroup = conversation.kind === 'group';
  const title = conversationTitle(conversation, me.id);
  const users: Record<string, PublicUser> = { ...Object.fromEntries(conversation.members.map((m) => [m.id, m])), ...chat?.users };
  const nameFor = (uid: string) => (uid === me.id ? 'You' : users[uid] ? nameOf(users[uid]) : 'Someone');
  const readOnly = conversation.readOnly || chat?.readOnly === true;

  const scrollDown = () => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; };
  const last = chat?.messages[chat.messages.length - 1];
  useLayoutEffect(() => {
    if (last && (stick.current || last.senderId === me.id)) scrollDown();
  }, [last?.id, last?.deleted, me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // New messages from others are announced politely; the first load and your own messages are not.
  useEffect(() => {
    if (!chat) return;
    const ids = new Set(chat.messages.map((m) => m.id));
    if (seen.current) {
      const fresh = chat.messages.filter((m) => !seen.current!.has(m.id) && m.senderId !== me.id && !m.deleted);
      if (fresh.length > 0) {
        const m = fresh[fresh.length - 1]!;
        const what = m.kind === 'image' ? 'sent a photo' : m.kind === 'voice' ? 'sent a voice memo' : m.kind === 'rec' ? `recommended ${m.rec?.title ?? 'a title'}` : m.text;
        setLive(fresh.length > 1 ? `${fresh.length} new messages. ${nameFor(m.senderId)}: ${what}` : `${nameFor(m.senderId)}: ${what}`);
      }
    }
    seen.current = ids;
  }, [chat?.messages]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!menuWrap.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('pointerdown', close);
    menuWrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      setDeleting(null);
    } catch {
      toast.show("Couldn't delete it. Try again.");
    }
  }

  const loaded = new Set((chat?.messages ?? []).map((m) => m.id));
  const react = useReactToMessage(conversation.id, me.id, (id, fn) => chat?.patchMessage(id, fn));
  const setReaction = (m: Message, emoji: string | null) => {
    react.mutate({ messageId: m.id, emoji }, { onError: () => toast.show("Couldn't save your reaction. Try again.") });
  };
  // A chip: yours again takes it off; another one becomes yours (one per person).
  const toggleReaction = (m: Message, emoji: string) => {
    const mineNow = (m.reactions ?? []).find((r) => r.userId === me.id)?.emoji;
    setReaction(m, mineNow === emoji ? null : emoji);
  };
  const copy = async (m: Message) => {
    try {
      await navigator.clipboard.writeText(m.text);
      toast.show('Copied');
    } catch {
      toast.show("Couldn't copy. Select the text instead.");
    }
  };
  const startReply = (m: Message) => setReply({ id: m.id, name: m.senderId === me.id ? 'yourself' : nameFor(m.senderId), snippet: snippetOfMessage(m) });
  // A quote scrolls to its original and marks it for a moment (a ring, no motion needed); focus follows so keyboard and screen reader users arrive there too.
  const flashTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const jumpTo = (id: string) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`);
    if (!el) return;
    stick.current = false;
    el.scrollIntoView?.({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    setFlash(id);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
  };

  const sub = isGroup
    ? `${['You', ...conversation.members.filter((m) => m.id !== me.id).map((m) => nameOf(m))].join(', ')} · ${conversation.members.length} members`
    : (() => { const o = conversation.members.find((m) => m.id !== me.id); return o?.displayName ? `@${o.username}` : null; })();
  const other = conversation.members.find((m) => m.id !== me.id);

  const rows: ReactNode[] = [];
  const msgs = chat?.messages ?? [];
  const now = new Date();
  // A run is one sender's consecutive messages on one day with no long pause: the name sits above its first bubble, the picture beside its last.
  const breaks = (a: Message, b: Message) =>
    a.senderId !== b.senderId || dayLabel(a.createdAt, now) !== dayLabel(b.createdAt, now) || Date.parse(b.createdAt) - Date.parse(a.createdAt) > RUN_GAP_MS;
  msgs.forEach((m, i) => {
    const prev = msgs[i - 1];
    const next = msgs[i + 1];
    const day = dayLabel(m.createdAt, now);
    const newDay = !prev || dayLabel(prev.createdAt, now) !== day;
    if (newDay) rows.push(<li key={`day-${m.id}`} className="chat__day"><span>{day}</span></li>);
    const first = !prev || breaks(prev, m);
    const mine = m.senderId === me.id;
    rows.push(
      <Bubble key={m.id} m={m} mine={mine} first={first && !newDay} showWho={isGroup && !mine && first} lastOfRun={!next || breaks(m, next)} sender={users[m.senderId]}
        name={nameFor(m.senderId)} meId={me.id} isGroup={isGroup} wide={wide} canDelete={mine || me.isAdmin} canReply={!readOnly && !m.deleted}
        canReact={!readOnly && !m.deleted} flash={flash === m.id}
        isLoaded={(id) => loaded.has(id)} onReply={() => startReply(m)} onJump={jumpTo} onMenu={(anchor) => setMenuFor({ m, anchor })}
        onOpenImage={() => setViewing(m)} onToggleReaction={(e) => toggleReaction(m, e)} onWhoReacted={() => setWhoFor(m)} />,
    );
  });

  const screenEl = (
    <div className="screen chat"
      style={{ '--chat-scale': textSize.scale, '--bubble-mine-bg': mineColors.bg, '--bubble-mine-text': mineColors.text } as CSSProperties}>
      <header className="chat__top">
        <ChatBack />
        {isGroup ? (
          <>
            <span className="chat-avatar chat-avatar--group" aria-hidden="true"><Icon name="group" size={20} /></span>
            <div className="chat__titles">
              <h1 className="chat__title">{title}</h1>
              {sub && <span className="chat__sub">{sub}</span>}
            </div>
          </>
        ) : other ? (
          // Tapping their picture or name opens their profile; its Back returns here (Dan, 2026-11-20).
          <Link to={`/u/${other.username}`} state={backState('chat')} className="chat__who" aria-label={`Open ${other.displayName || `@${other.username}`}'s profile`}>
            <Avatar user={other} size={44} />
            <div className="chat__titles">
              <h1 className="chat__title">{title}</h1>
              {sub && <span className="chat__sub">{sub}</span>}
            </div>
          </Link>
        ) : (
          <div className="chat__titles"><h1 className="chat__title">{title}</h1></div>
        )}
        <TextSizeControl step={textSize.step} onChange={textSize.set} />
        <div className="chat__menu" ref={menuWrap}
          onKeyDown={(e) => { if (e.key === 'Escape' && menu) { e.stopPropagation(); setMenu(false); menuWrap.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus(); } }}>
          <IconButton label={isGroup ? 'Group options' : 'Chat options'} icon="more" look="plain" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} />
          {menu && (
            <div role="menu" aria-label={isGroup ? 'Group options' : 'Chat options'} className="menu">
              {isGroup && <button type="button" role="menuitem" className="menu__item" onClick={() => { setMenu(false); setSheet('rename'); }}>Rename</button>}
              {isGroup && <button type="button" role="menuitem" className="menu__item" onClick={() => { setMenu(false); setSheet('add'); }}>Add people</button>}
              <button type="button" role="menuitem" className="menu__item"
                onClick={() => { setMenu(false); mute.mutate(!conversation.muted, { onSuccess: () => setLive(conversation.muted ? 'Notifications on for this chat' : 'Notifications muted for this chat'), onError: () => toast.show("Couldn't change that. Try again.") }); }}>
                {conversation.muted ? 'Unmute' : 'Mute notifications'}
              </button>
              {isGroup && <button type="button" role="menuitem" className="menu__item" onClick={() => { setMenu(false); setSheet('leave'); }}>Leave</button>}
            </div>
          )}
        </div>
      </header>

      <div className="chat__scroll" ref={scroller}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {query.isPending ? (
          <div className="stack-10" aria-busy="true" aria-label="Loading messages"><Skeleton height={44} /><Skeleton height={44} /></div>
        ) : !chat ? (
          <EmptyState icon="info" title="Couldn't load the messages" body="Check your connection and try again." actionLabel="Retry" onAction={() => void query.refetch()} />
        ) : (
          <>
            {chat.hasOlder && <Button className="chat__older" disabled={chat.loadingOlder} onClick={() => void chat.loadOlder()}>Show earlier messages</Button>}
            {msgs.length === 0 && <p className="hint chat__empty">No messages yet. Say hello.</p>}
            <ol className="chat__list" aria-label="Messages">{rows}</ol>
          </>
        )}
      </div>
      <p className="sr-only chat__live" role="status" aria-live="polite">{live}</p>
      <p id={HINT_ID} hidden>Press Enter for reactions, reply and more.</p>

      {readOnly ? (
        <p className="chat__readonly" role="note">
          {other ? `You and ${nameOf(other)} are no longer friends, so this chat is read-only.` : 'This chat is read-only.'}
        </p>
      ) : (
        <Composer conversationId={conversation.id} onSent={() => { stick.current = true; setReply(null); }} reply={reply} onCancelReply={() => setReply(null)} />
      )}

      {sheet === 'rename' && <RenameSheet conversation={conversation} onClose={() => setSheet(null)} />}
      {sheet === 'add' && <AddPeopleSheet conversation={conversation} onClose={() => setSheet(null)} />}
      {sheet === 'leave' && <LeaveSheet conversation={conversation} onClose={() => setSheet(null)} />}
      <Sheet open={deleting !== null} title="Delete this message?" onClose={() => setDeleting(null)}
        footer={
          <div className="btn-stack">
            <Button variant="primary" className="btn--big" disabled={del.isPending} onClick={() => void confirmDelete()}>Delete message</Button>
            <Button className="btn--big" onClick={() => setDeleting(null)}>Cancel</Button>
          </div>
        }>
        <p className="hint">It's replaced by “Message deleted” for everyone in the chat.</p>
      </Sheet>
      {menuFor && (() => {
        // The menu follows the live message (a poll may have changed its reactions).
        const m = msgs.find((x) => x.id === menuFor.m.id) ?? menuFor.m;
        const mine = m.senderId === me.id;
        return (
          <MessageMenu m={m} meId={me.id} users={users} wide={wide} anchor={menuFor.anchor}
            canReact={!readOnly && !m.deleted} canReply={!readOnly && !m.deleted} canDelete={mine || me.isAdmin}
            onClose={() => setMenuFor(null)} onReact={(e) => setReaction(m, e)} onReply={() => startReply(m)}
            onCopy={() => void copy(m)} onDelete={() => setDeleting(m)} />
        );
      })()}
      <Sheet open={whoFor !== null} title="Reactions" onClose={() => setWhoFor(null)}>
        {whoFor && (
          <ul className="msg-menu__who">
            {reactionGroups(msgs.find((x) => x.id === whoFor.id) ?? whoFor, me.id, users).map((g) => (
              <li key={g.emoji}><span className="msg-menu__who-emoji" aria-hidden="true">{g.emoji}</span><span className="sr-only">{g.emoji}: </span>{g.names.join(', ')}</li>
            ))}
          </ul>
        )}
      </Sheet>
      <PictureViewer src={viewing ? messageImageUrl(viewing.id) : null} alt={viewing ? `Picture from ${nameFor(viewing.senderId)}, full size` : ''} onClose={() => setViewing(null)} />
    </div>
  );
  // PC: the chat is a centred column; its sides show a blurred cover (one pick per visit, from your top titles or theirs).
  return wide ? <div className="chat-page has-backdrop"><CoverBackdrop src={cover} className="backdrop--side" />{screenEl}</div> : screenEl;
}

/** One message: its bubble (text, photo, voice memo, recommendation or a note), the quote above a reply, reactions under it. */
function Bubble({ m, mine, first, showWho, lastOfRun, sender, name, meId, isGroup, wide, canDelete, canReply, canReact, flash, isLoaded, onReply, onJump, onMenu, onOpenImage, onToggleReaction, onWhoReacted }: {
  /** Your own message, or any message for the admin (AD7). */
  canDelete: boolean;
  canReply: boolean;
  canReact: boolean;
  flash: boolean;
  /** Starts a new run (more space above). */
  first: boolean;
  lastOfRun: boolean;
  meId: string;
  isGroup: boolean;
  wide: boolean;
  isLoaded: (id: string) => boolean;
  m: Message; mine: boolean; showWho: boolean; sender: PublicUser | undefined; name: string;
  onReply: () => void; onJump: (id: string) => void; onMenu: (anchor: HTMLElement | null) => void; onOpenImage: () => void;
  onToggleReaction: (emoji: string) => void; onWhoReacted: () => void;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  // Swipe toward the middle of the screen: their messages (left) to the right, mine (right) to the left.
  const { dx, handlers } = useBubbleGestures({
    dir: mine ? -1 : 1, holdEnabled: true, swipeEnabled: canReply,
    onHold: () => onMenu(bubbleRef.current), onSwipe: onReply,
  });
  const q = m.replyTo;
  const quoteWho = q && !q.deleted ? (q.senderId === meId ? 'You' : q.senderName || 'Someone') : '';
  const quoteInner = q && (
    <>
      <span className="bubble__quote-label">Reply</span>
      {isGroup && quoteWho && <b className="bubble__quote-who">{quoteWho}</b>}
      <span className="bubble__quote-text">{quoteText(q)}</span>
    </>
  );
  const quote = q && (q.deleted ? (
    <div className="bubble__quote bubble__quote--deleted"><span className="bubble__quote-text">Original message deleted</span></div>
  ) : isLoaded(q.id) ? (
    <button type="button" className="bubble__quote" aria-label={`In reply to ${q.senderId === meId ? 'you' : q.senderName || 'someone'}: ${quoteText(q)}. Go to that message`} onClick={() => onJump(q.id)}>
      {quoteInner}
    </button>
  ) : (
    <div className="bubble__quote">{quoteInner}</div>
  ));
  const body = m.deleted ? (
    <span className="bubble__deleted">Message deleted</span>
  ) : m.expired ? (
    <span className="bubble__deleted bubble__expired">{m.kind === 'voice' ? 'Voice memo expired' : 'Photo expired'}</span>
  ) : m.kind === 'image' ? (
    <button type="button" className="bubble__photo" aria-label={`Open picture from ${name} full size`} onClick={onOpenImage}>
      <img src={messageImageUrl(m.id)} alt={`Picture from ${name}`} loading="lazy" />
    </button>
  ) : m.kind === 'voice' && m.voice ? (
    <VoicePlayer id={m.id} durationMs={m.voice.durationMs} from={mine ? 'you' : name} />
  ) : m.kind === 'rec' && m.rec ? (
    <>
      <span className="bubble__label" aria-hidden="true">Recommendation</span>
      <RecCard rec={m.rec} senderName={name} senderUsername={sender?.username} note={m.text} own={mine} />
    </>
  ) : (
    <span className="bubble__text">{m.text}</span>
  );
  const reactions = m.deleted ? [] : summarize(m, meId);
  const cls = `bubble-row${mine ? ' bubble-row--mine' : ''}${first ? ' bubble-row--first' : ''}${flash ? ' is-flash' : ''}`;
  const optsLabel = mine ? 'Message options' : `Message options for ${name}'s message`;
  const swiping = dx !== 0;
  return (
    <li className={cls} data-mid={m.id} tabIndex={-1}>
      {!mine && (
        <span className="bubble-row__avatar">
          {lastOfRun && sender ? <Avatar user={sender} size={28} viewable name={name} /> : null}
        </span>
      )}
      <div className="bubble-col">
        {showWho && <span className="bubble__who">{name}</span>}
        <div className="bubble-wrap">
          <span className={`bubble__swipe-hint${Math.abs(dx) >= SWIPE_REPLY_PX ? ' is-ready' : ''}`} aria-hidden="true"
            style={{ opacity: Math.min(Math.abs(dx) / SWIPE_REPLY_PX, 1) }}>
            <Icon name="reply" size={18} />
          </span>
          {/* Focusable: Enter or Space opens the message menu (the same one a hold, a right-click or "⋯" opens). */}
          <div ref={bubbleRef} tabIndex={0} aria-describedby={HINT_ID}
            className={`bubble${mine ? ' bubble--mine' : ''}${m.deleted ? ' bubble--deleted' : ''}${m.kind === 'rec' && !m.deleted ? ' bubble--rec' : ''}${m.kind === 'voice' && !m.deleted && !m.expired ? ' bubble--voice' : ''}${m.kind === 'image' && !m.deleted && !m.expired ? ' bubble--image' : ''}${swiping ? ' is-swiping' : ''}`}
            style={swiping ? { transform: `translateX(${dx}px)` } : undefined}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onMenu(e.currentTarget); } }}
            {...handlers}>
            {quote}
            {body}
          </div>
          {/* PC: Reply and ⋯ show on hover or focus. Phone: hidden from sight (hold or swipe instead) but there for screen readers. */}
          <span className={`bubble__actions${wide ? '' : ' bubble__actions--sr'}`}>
            {canReply && <button type="button" className="bubble__reply" aria-label={`Reply to ${mine ? 'your own' : `${name}'s`} message`} onClick={onReply}>Reply</button>}
            {(canReact || canReply || canDelete || m.text !== '') && (
              <IconButton label={optsLabel} icon="more" look="plain" className="bubble__opts" aria-haspopup="dialog"
                onClick={(e) => onMenu((e.currentTarget as HTMLElement).closest('.bubble-wrap')?.querySelector<HTMLElement>('.bubble') ?? null)} />
            )}
          </span>
        </div>
        {reactions.length > 0 && (
          <ReactionRow items={reactions} disabled={!canReact} onToggle={onToggleReaction} onWho={onWhoReacted} />
        )}
      </div>
    </li>
  );
}

/** The chips under a bubble: one per emoji, a count when more than one person used it, yours highlighted. */
function summarize(m: Message, meId: string): { emoji: string; count: number; mine: boolean }[] {
  const out = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of m.reactions ?? []) {
    const c = out.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    c.count++;
    if (r.userId === meId) c.mine = true;
    out.set(r.emoji, c);
  }
  return [...out.values()];
}

function ReactionRow({ items, disabled, onToggle, onWho }: { items: { emoji: string; count: number; mine: boolean }[]; disabled: boolean; onToggle: (emoji: string) => void; onWho: () => void }) {
  const hold = useRef<number | undefined>(undefined);
  const held = useRef(false);
  useEffect(() => () => window.clearTimeout(hold.current), []);
  return (
    <div role="group" aria-label="Reactions" className="msg-reactions"
      onTouchStart={() => { held.current = false; window.clearTimeout(hold.current); hold.current = window.setTimeout(() => { held.current = true; navigator.vibrate?.(10); onWho(); }, LONG_PRESS_MS); }}
      onTouchMove={() => window.clearTimeout(hold.current)} onTouchEnd={() => window.clearTimeout(hold.current)} onTouchCancel={() => window.clearTimeout(hold.current)}
      onContextMenu={(e) => { e.preventDefault(); if (!held.current) onWho(); held.current = false; }}>
      {items.map((r) => (
        <button key={r.emoji} type="button" className="msg-reactions__chip" aria-pressed={r.mine} disabled={disabled}
          aria-label={`${r.emoji} ${r.count}${r.mine ? ', yours' : ''}`}
          onClick={(e) => { if (held.current) { held.current = false; e.preventDefault(); return; } onToggle(r.emoji); }}>
          <span aria-hidden="true">{r.emoji}</span>
          {r.count > 1 && <span aria-hidden="true" className="msg-reactions__n">{r.count}</span>}
        </button>
      ))}
    </div>
  );
}
