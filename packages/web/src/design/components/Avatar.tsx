import { useEffect, useState } from 'react';
import type { Me } from '../../api/types';

type AvatarMe = Pick<Me, 'username' | 'email' | 'avatarAt'>;

/** The username's first character, uppercased (the email's when there is no username yet). */
export function initialOf(me: Pick<Me, 'username' | 'email'>): string {
  return (me.username || me.email || '?').charAt(0).toUpperCase();
}

/**
 * The profile photo, or the initial on Highlight when there is none or the image fails. Always
 * requested as `/api/me/avatar?v=<avatarAt>`: the answer is immutable and the server ignores `v`,
 * so a new photo (a new `avatarAt`) is a new URL. Decorative (`alt=""`): the control around it carries the name.
 */
export function Avatar({ me, size, className }: { me: AvatarMe; size: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [me.avatarAt]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  const cls = ['avatar', className].filter(Boolean).join(' ');
  if (!me.avatarAt || failed) {
    return <span className={cls} style={style} aria-hidden="true">{initialOf(me)}</span>;
  }
  return (
    <span className={cls} style={style}>
      <img src={`/api/me/avatar?v=${encodeURIComponent(me.avatarAt)}`} alt="" width={size} height={size}
        decoding="async" onError={() => setFailed(true)} />
    </span>
  );
}
