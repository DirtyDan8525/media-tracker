import { nameOf, type Message, type PublicUser } from '@media-tracker/shared';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from '../../design/components/Sheet';
import { EmojiPicker } from '../social/ReactionBar';
import { sentAt } from './format';

/** Reactions grouped by emoji, most first (ties: who reacted first), with the people's names ("You" for you). */
export function reactionGroups(m: Message, meId: string, users: Record<string, PublicUser>): { emoji: string; names: string[]; mine: boolean }[] {
  const groups = new Map<string, { emoji: string; names: string[]; mine: boolean }>();
  for (const r of m.reactions ?? []) {
    const g = groups.get(r.emoji) ?? { emoji: r.emoji, names: [], mine: false };
    g.names.push(r.userId === meId ? 'You' : users[r.userId] ? nameOf(users[r.userId]!) : 'Someone');
    if (r.userId === meId) g.mine = true;
    groups.set(r.emoji, g);
  }
  return [...groups.values()].sort((a, b) => b.names.length - a.names.length);
}

export interface MessageMenuProps {
  m: Message;
  meId: string;
  users: Record<string, PublicUser>;
  /** PC: a popover beside this element. Phone: a bottom sheet. */
  wide: boolean;
  anchor: HTMLElement | null;
  canReact: boolean;
  canReply: boolean;
  canDelete: boolean;
  onClose: () => void;
  onReact: (emoji: string | null) => void;
  onReply: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

/**
 * The message menu (hold a bubble; on PC also right-click or the hover "⋯"; Enter or Space on a focused bubble): when it was
 * sent, the reactions picker (quick set, "+", Recent), who reacted, and Reply / Copy text / Delete.
 */
export function MessageMenu(p: MessageMenuProps) {
  const now = new Date();
  const mine = (p.m.reactions ?? []).find((r) => r.userId === p.meId)?.emoji;
  const groups = reactionGroups(p.m, p.meId, p.users);
  const act = (fn: () => void) => () => { p.onClose(); fn(); };
  const body: ReactNode = (
    <div className="msg-menu">
      <p className="msg-menu__time"><span className="sr-only">Sent </span><time dateTime={p.m.createdAt}>{sentAt(p.m.createdAt, now)}</time></p>
      {p.canReact && (
        <EmojiPicker mine={mine ? [mine] : []} autoFocus={p.wide}
          onPick={(emoji) => { p.onClose(); p.onReact(emoji === mine ? null : emoji); }} />
      )}
      {groups.length > 0 && (
        <ul className="msg-menu__who" aria-label="Who reacted">
          {groups.map((g) => (
            <li key={g.emoji}><span className="msg-menu__who-emoji" aria-hidden="true">{g.emoji}</span><span className="sr-only">{g.emoji}: </span>{g.names.join(', ')}</li>
          ))}
        </ul>
      )}
      <div className="msg-menu__actions">
        {p.canReply && <button type="button" className="menu__item" onClick={act(p.onReply)}>Reply</button>}
        {p.m.text !== '' && !p.m.deleted && <button type="button" className="menu__item" onClick={act(p.onCopy)}>Copy text</button>}
        {p.canDelete && !p.m.deleted && <button type="button" className="menu__item msg-menu__delete" onClick={act(p.onDelete)}>Delete</button>}
      </div>
    </div>
  );
  if (!p.wide) return <Sheet open title="Message options" onClose={p.onClose}>{body}</Sheet>;
  return <Popover anchor={p.anchor} onClose={p.onClose}>{body}</Popover>;
}

/** PC: a small non-modal dialog beside the bubble; outside clicks and Escape close it and focus goes back to the bubble. */
function Popover({ anchor, onClose, children }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const r = anchor?.getBoundingClientRect();
    const box = ref.current?.getBoundingClientRect();
    if (!r || !box) { setStyle({}); return; }
    const w = box.width || 300;
    const h = box.height || 240;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
    setStyle({ left, top });
  }, [anchor]);
  useEffect(() => {
    const returnTo = anchor;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('pointerdown', away);
    return () => { document.removeEventListener('pointerdown', away); returnTo?.focus?.({ preventScroll: true }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div ref={ref} role="dialog" aria-label="Message options" className="msg-pop" style={style}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      {children}
    </div>,
    document.body,
  );
}
