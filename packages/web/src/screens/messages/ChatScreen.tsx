import { nameOf, type Conversation, type Message, type PublicUser } from '@media-tracker/shared';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { conversationTitle, messageImageUrl, useChat, useConversation, useDeleteMessage } from '../../data/messages';
import { Avatar } from '../../design/components/Avatar';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import { Icon } from '../../design/components/Icon';
import { IconButton } from '../../design/components/IconButton';
import { Sheet } from '../../design/components/Sheet';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { BackButton } from '../../shell/BackButton';
import { useSessionMe } from '../../shell/SessionGate';
import { dayLabel } from '../activity/format';
import { Composer } from './Composer';
import { AddPeopleSheet, LeaveSheet, RenameSheet } from './GroupSheets';
import { RecCard } from './RecCard';
import { clock } from './format';
import '../../design/messages.css';

/** One chat (route /messages/:id): bubbles, day separators, the composer. Polls every 5 s while visible (see useChat). */
export function ChatScreen() {
  const { id = '' } = useParams();
  const conv = useConversation(id);
  if (conv.isPending) {
    return (
      <div className="screen chat" aria-busy="true" aria-label="Loading">
        <div className="chat__top"><BackButton to="/messages" /></div>
        <div className="screen__body stack-10"><Skeleton height={48} /><Skeleton height={48} /></div>
      </div>
    );
  }
  if (conv.isError || !conv.data) {
    const missing = conv.error instanceof ApiError && conv.error.status === 404;
    return (
      <div className="screen chat">
        <div className="chat__top"><BackButton to="/messages" /></div>
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

type Sheets = null | 'rename' | 'add' | 'leave';

function Chat({ conversation }: { conversation: Conversation }) {
  const me = useSessionMe();
  const toast = useToast();
  const { query, chat } = useChat(conversation.id);
  const del = useDeleteMessage(conversation.id);
  const [sheet, setSheet] = useState<Sheets>(null);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [viewing, setViewing] = useState<Message | null>(null);
  const [live, setLive] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const menuWrap = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);

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
        const what = m.kind === 'image' ? 'sent a picture' : m.kind === 'rec' ? `recommended ${m.rec?.title ?? 'a title'}` : m.text;
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

  const sub = isGroup
    ? `${['You', ...conversation.members.filter((m) => m.id !== me.id).map((m) => nameOf(m))].join(', ')} · ${conversation.members.length} members`
    : (() => { const o = conversation.members.find((m) => m.id !== me.id); return o?.displayName ? `@${o.username}` : null; })();
  const other = conversation.members.find((m) => m.id !== me.id);

  const rows: ReactNode[] = [];
  const msgs = chat?.messages ?? [];
  const now = new Date();
  msgs.forEach((m, i) => {
    const prev = msgs[i - 1];
    const day = dayLabel(m.createdAt, now);
    if (!prev || dayLabel(prev.createdAt, now) !== day) rows.push(<li key={`day-${m.id}`} className="chat__day"><span>{day}</span></li>);
    const first = !prev || prev.senderId !== m.senderId || dayLabel(prev.createdAt, now) !== day;
    rows.push(
      <Bubble key={m.id} m={m} mine={m.senderId === me.id} showWho={isGroup && m.senderId !== me.id && first} sender={users[m.senderId]}
        name={nameFor(m.senderId)} canDelete={m.senderId === me.id || me.isAdmin} onOptions={() => setDeleting(m)} onOpenImage={() => setViewing(m)} />,
    );
  });

  return (
    <div className="screen chat">
      <header className="chat__top">
        <BackButton to="/messages" />
        {isGroup
          ? <span className="chat-avatar chat-avatar--group" aria-hidden="true"><Icon name="group" size={20} /></span>
          : other && <Avatar user={other} size={40} />}
        <div className="chat__titles">
          <h1 className="chat__title">{title}</h1>
          {sub && <span className="chat__sub">{sub}</span>}
        </div>
        {isGroup && (
          <div className="chat__menu" ref={menuWrap}
            onKeyDown={(e) => { if (e.key === 'Escape' && menu) { e.stopPropagation(); setMenu(false); menuWrap.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus(); } }}>
            <IconButton label="Group options" icon="more" look="plain" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} />
            {menu && (
              <div role="menu" aria-label="Group options" className="menu">
                <button type="button" role="menuitem" className="menu__item" onClick={() => { setMenu(false); setSheet('rename'); }}>Rename</button>
                <button type="button" role="menuitem" className="menu__item" onClick={() => { setMenu(false); setSheet('add'); }}>Add people</button>
                <button type="button" role="menuitem" className="menu__item" onClick={() => { setMenu(false); setSheet('leave'); }}>Leave</button>
              </div>
            )}
          </div>
        )}
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

      {readOnly ? (
        <p className="chat__readonly" role="note">
          {other ? `You and ${nameOf(other)} are no longer friends, so this chat is read-only.` : 'This chat is read-only.'}
        </p>
      ) : (
        <Composer conversationId={conversation.id} onSent={() => { stick.current = true; }} />
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
      <Sheet open={viewing !== null} title="Picture" onClose={() => setViewing(null)}>
        {viewing && <img className="chat__full" src={messageImageUrl(viewing.id)} alt={`Picture from ${nameFor(viewing.senderId)}, full size`} />}
      </Sheet>
    </div>
  );
}

function Bubble({ m, mine, showWho, sender, name, canDelete, onOptions, onOpenImage }: {
  /** Your own message, or any message for the admin (AD7). */
  canDelete: boolean;
  m: Message; mine: boolean; showWho: boolean; sender: PublicUser | undefined; name: string; onOptions: () => void; onOpenImage: () => void;
}) {
  const body = m.deleted ? (
    <span className="bubble__deleted">Message deleted</span>
  ) : m.kind === 'image' ? (
    <button type="button" className="bubble__photo" aria-label={`Open picture from ${name} full size`} onClick={onOpenImage}>
      <img src={messageImageUrl(m.id)} alt={`Picture from ${name}`} loading="lazy" />
    </button>
  ) : m.kind === 'rec' && m.rec ? (
    <RecCard rec={m.rec} senderName={name} note={m.text} own={mine} />
  ) : (
    <span className="bubble__text">{m.text}</span>
  );
  return (
    <li className={`bubble-row${mine ? ' bubble-row--mine' : ''}`}>
      {!mine && (showWho && sender ? <Avatar user={sender} size={32} /> : <span className="bubble-row__gap" aria-hidden="true" />)}
      <div className="bubble-col">
        {showWho && <span className="bubble__who">{name}</span>}
        <div className="bubble-wrap">
          <div className={`bubble${mine ? ' bubble--mine' : ''}${m.deleted ? ' bubble--deleted' : ''}${m.kind === 'rec' && !m.deleted ? ' bubble--rec' : ''}`}>
            {body}
            <time className="bubble__time" dateTime={m.createdAt}>{clock(m.createdAt)}</time>
          </div>
          {canDelete && !m.deleted && <IconButton label={mine ? 'Message options' : `Message options for ${name}'s message`} icon="more" look="plain" className="bubble__opts" onClick={onOptions} />}
        </div>
      </div>
    </li>
  );
}
