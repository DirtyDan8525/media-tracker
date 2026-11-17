import type { PublicUser } from '@media-tracker/shared';
import type { ReactNode } from 'react';
import { Avatar } from '../../design/components/Avatar';
import { Icon } from '../../design/components/Icon';
import { PersonText } from '../social/parts';

/** A checkable row (a friend or a group): the whole row is the label of a real checkbox, 56 px tall. */
export function CheckRow({ checked, onChange, user, group, title, sub, disabled }: {
  checked: boolean; onChange: (on: boolean) => void; user?: PublicUser; group?: boolean; title?: string; sub?: ReactNode; disabled?: boolean;
}) {
  return (
    <label className={`check-row${checked ? ' is-checked' : ''}`}>
      <input type="checkbox" className="check-row__box" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {user ? <Avatar user={user} size={40} /> : <span className="chat-avatar chat-avatar--group" aria-hidden="true"><Icon name="group" size={20} /></span>}
      {user ? <PersonText user={user} sub={sub} /> : (
        <span className="person__meta"><span className="person__name">{title}</span>{sub && <span className="person__sub">{sub}</span>}</span>
      )}
    </label>
  );
}
