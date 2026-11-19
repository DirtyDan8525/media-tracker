import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import type { PublicUser } from '@media-tracker/shared';
import type { Me } from '../../api/types';

type AvatarMe = Pick<Me, 'username' | 'email' | 'avatarAt'>;
/** Someone else: their photo is `/api/users/<id>/avatar?v=` (friends only; anything else answers 404 and shows the initial). */
type AvatarUser = Pick<PublicUser, 'id' | 'username' | 'avatarAt'>;

/** The username's first character, uppercased (the email's when there is no username yet). */
export function initialOf(me: Pick<Me, 'username' | 'email'>): string {
  return (me.username || me.email || '?').charAt(0).toUpperCase();
}

/**
 * The profile photo, or the initial on Highlight when there is none or the image fails. Always
 * requested as `/api/me/avatar?v=<avatarAt>`: the answer is immutable and the server ignores `v`,
 * so a new photo (a new `avatarAt`) is a new URL. Decorative (`alt=""`): the control around it carries the name.
 */
export function Avatar(props: ({ me: AvatarMe; user?: undefined } | { user: AvatarUser; me?: undefined }) & { size: number; className?: string; src?: string; viewable?: boolean; name?: string }) {
  const { size, className } = props;
  const who = props.user ? { avatarAt: props.user.avatarAt, initial: initialOf({ username: props.user.username, email: '' }), src: `/api/users/${encodeURIComponent(props.user.id)}/avatar` }
    : { avatarAt: props.me.avatarAt, initial: initialOf(props.me), src: '/api/me/avatar' };
  // `src`: another route for the same photo (the public profile link's token-scoped one, item 34).
  if (props.src) who.src = props.src;
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => setFailed(false), [who.avatarAt]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  const cls = ['avatar', className].filter(Boolean).join(' ');
  if (!who.avatarAt || failed) {
    return <span className={cls} style={style} aria-hidden="true">{who.initial}</span>;
  }
  const url = `${who.src}?v=${encodeURIComponent(who.avatarAt)}`;
  const picture = (
    <span className={cls} style={style}>
      <img src={url} alt="" width={size} height={size} decoding="async" onError={() => setFailed(true)} />
    </span>
  );
  if (!props.viewable) return picture;
  const owner = props.name ? `${props.name}'s` : 'your';
  const Owner = owner.charAt(0).toUpperCase() + owner.slice(1);
  return (
    <>
      <button ref={opener} type="button" className="avatar-btn" aria-label={`View ${owner} profile picture`} onClick={() => setOpen(true)}>
        {picture}
      </button>
      {open && <AvatarViewer url={url} label={`${Owner} profile picture`} onClose={() => { setOpen(false); opener.current?.focus(); }} />}
    </>
  );
}

/** The picture full screen: a dialog with a Close button; Escape and a tap on the dark area close it. Focus goes to Close and the caller puts it back. */
function AvatarViewer({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return createPortal(
    <div className="avatar-viewer" role="dialog" aria-modal="true" aria-label={label}
      onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } else if (e.key === 'Tab') { e.preventDefault(); close.current?.focus(); } }}>
      <IconButton ref={close} label="Close" icon="close" look="plain" className="avatar-viewer__close" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <img className="avatar-viewer__img" src={url} alt={label} onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  );
}
