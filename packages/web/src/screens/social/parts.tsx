import { nameOf, type PublicUser } from '@media-tracker/shared';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Avatar } from '../../design/components/Avatar';
import { Button } from '../../design/components/Button';
import type { Category } from '@media-tracker/shared';
import { listName } from '../../lists/registry';

/** The value after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** "Ren" when they have a display name, else "@ren". */
export const who = (u: Pick<PublicUser, 'username' | 'displayName'>): string => nameOf(u);

/** The name block of a person row: bold name, the @username under it when a display name is set. */
export function PersonText({ user, sub }: { user: Pick<PublicUser, 'username' | 'displayName'>; sub?: ReactNode }) {
  return (
    <span className="person__meta">
      <span className="person__name">{who(user)}</span>
      {user.displayName ? <span className="person__sub">@{user.username}{sub ? <> · {sub}</> : null}</span>
        : sub ? <span className="person__sub">{sub}</span> : null}
    </span>
  );
}

export function PersonAvatar({ user, size = 44, src, viewable, name }: { user: Pick<PublicUser, 'id' | 'username' | 'avatarAt'>; size?: number; src?: string; viewable?: boolean; name?: string }) {
  return <Avatar user={user} size={size} src={src} viewable={viewable} name={name} />;
}

/** One chip per category (single choice), the pattern of the list filters. */
export function CategoryChips({ categories, value, onChange, label = 'Category' }: {
  categories: Category[]; value: Category | null; onChange: (c: Category) => void; label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="chip-row">
      {categories.map((c) => (
        <Button key={c} variant="chip" active={c === value} onClick={() => onChange(c)}>{listName(c)}</Button>
      ))}
    </div>
  );
}

export interface TabDef<T extends string> { id: T; label: string }

/** role=tablist with arrow keys moving between tabs; the caller renders the one tabpanel. */
export function Tabs<T extends string>({ label, tabs, value, onChange, idPrefix }: {
  label: string; tabs: TabDef<T>[]; value: T; onChange: (t: T) => void; idPrefix: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length]!;
    onChange(next.id);
    refs.current[next.id]?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab" className="tabs__tab"
          id={`${idPrefix}-tab-${t.id}`} aria-controls={`${idPrefix}-panel`} aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
