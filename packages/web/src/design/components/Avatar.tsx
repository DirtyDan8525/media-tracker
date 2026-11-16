import { useEffect, useState } from 'react';
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
export function Avatar(props: ({ me: AvatarMe; user?: undefined } | { user: AvatarUser; me?: undefined }) & { size: number; className?: string }) {
  const { size, className } = props;
  const who = props.user ? { avatarAt: props.user.avatarAt, initial: initialOf({ username: props.user.username, email: '' }), src: `/api/users/${encodeURIComponent(props.user.id)}/avatar` }
    : { avatarAt: props.me.avatarAt, initial: initialOf(props.me), src: '/api/me/avatar' };
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [who.avatarAt]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  const cls = ['avatar', className].filter(Boolean).join(' ');
  if (!who.avatarAt || failed) {
    return <span className={cls} style={style} aria-hidden="true">{who.initial}</span>;
  }
  return (
    <span className={cls} style={style}>
      <img src={`${who.src}?v=${encodeURIComponent(who.avatarAt)}`} alt="" width={size} height={size}
        decoding="async" onError={() => setFailed(true)} />
    </span>
  );
}
