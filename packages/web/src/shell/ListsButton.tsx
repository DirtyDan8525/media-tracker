import type { Category } from '@media-tracker/shared';
import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { Icon } from '../design/components/Icon';
import { LIST_LABEL } from '../nav';

/**
 * B5 (ListsMenu board): the round floating button (bottom right, above the bar) that opens the
 * see-through Lists menu just above it: every enabled list with its icon and cached count, the
 * current one marked. Escape, a tap outside or picking a list closes it, and focus returns to the
 * button. Not on /entry/:id; nothing at all when every list is off.
 */
export function ListsButton({ lists, current, counts }: {
  lists: Category[];
  current: Category | null;
  counts: Partial<Record<Category, number>>;
}) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  const menuId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // Focus moves into the menu, onto the current list (else the first).
  useEffect(() => {
    if (!open) return;
    const links = menu.current?.querySelectorAll<HTMLAnchorElement>('a');
    (menu.current?.querySelector<HTMLAnchorElement>('a[aria-current="page"]') ?? links?.[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // A route change (a list picked, Back) closes it.
  useEffect(() => setOpen(false), [pathname]);

  if (lists.length === 0 || pathname.startsWith('/entry/')) return null;

  // Tabbing out of the menu (to anything but the button) closes it; a click elsewhere is the backdrop's.
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    const to = e.relatedTarget as Node | null;
    if (to && !menu.current?.contains(to) && to !== button.current) setOpen(false);
  };

  return (
    <>
      {open && <div className="lists-backdrop" aria-hidden="true" onClick={() => close(true)} />}
      {open && (
        <nav id={menuId} ref={menu} aria-label="Lists" className="lists-menu" onBlur={onBlur}>
          <ul className="plain-list">
            {lists.map((c) => {
              const here = c === current;
              const count = counts[c];
              return (
                <li key={c}>
                  <Link to={`/list/${c}`} className="lists-menu__item" aria-current={here ? 'page' : undefined}
                    aria-label={count !== undefined ? `${LIST_LABEL[c]}, ${count}` : LIST_LABEL[c]}
                    onClick={() => close(true)}>
                    <span className="tile-icon"><Icon name={c} size={18} /></span>
                    <span className="lists-menu__label">{LIST_LABEL[c]}</span>
                    {count !== undefined && <span className="lists-menu__count">{count}</span>}
                    <span className="lists-menu__check">{here && <Icon name="check" size={18} />}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <button ref={button} type="button" className="lists-fab" aria-label="Lists" aria-expanded={open}
        aria-controls={open ? menuId : undefined} onClick={() => (open ? close(true) : setOpen(true))}>
        <Icon name="lists" size={24} />
      </button>
    </>
  );
}
