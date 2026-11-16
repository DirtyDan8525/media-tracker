import type { Category } from '@media-tracker/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from '../design/components/Icon';
import { LIST_LABEL } from '../nav';
import '../design/list-menu.css';

interface BaseProps {
  lists: Category[];
  /** The list shown on the trigger and marked in the menu. */
  value: Category;
  /** Names the menu ("Switch list", "Add to"). */
  menuLabel: string;
  /** What the trigger shows (its text names the button unless `triggerLabel` is given). */
  children: ReactNode;
  triggerLabel?: string;
  /** Cached counts, shown beside the links (the title dropdown). */
  counts?: Partial<Record<Category, number>>;
}

type ListMenuProps = BaseProps & (
  /** The list title: items are links, and the trigger sits in the screen's h1. */
  | { to: (c: Category) => string; heading: true; onChoose?: never; field?: never }
  /** A form field ("Add to"): items choose a value, and the menu opens in the flow of the form. */
  | { onChoose: (c: Category) => void; field: true; to?: never; heading?: never }
);

const ITEM = '[role^="menuitem"]';

/**
 * A menu button (WAI-ARIA menu button pattern) listing the lists: Enter / Space / click opens it on the
 * current list, ArrowDown / ArrowUp open it on the first / last; inside, arrows wrap, Home / End jump,
 * Escape or a tap outside closes it, and focus goes back to the trigger.
 */
export function ListMenu(props: ListMenuProps) {
  const { lists, value, menuLabel, children, counts, triggerLabel } = props;
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<'current' | 'first' | 'last'>('current');
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(ITEM) ?? []);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const openAt = (at: typeof start) => { setStart(at); setOpen(true); };

  // Focus moves into the menu: the current list, or the first / last item for the arrow keys.
  useEffect(() => {
    if (!open) return;
    const all = items();
    const target = start === 'first' ? all[0]
      : start === 'last' ? all[all.length - 1]
        : all.find((i) => i.getAttribute('aria-current') === 'true' || i.getAttribute('aria-checked') === 'true') ?? all[0];
    target?.focus();
  }, [open, start]);

  // A tap outside closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); openAt('first'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); openAt('last'); }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (i + 1) % all.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + all.length) % all.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = all.length - 1;
    if (next !== null) { e.preventDefault(); all[next]?.focus(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // a surrounding sheet stays open
      close(true);
    } else if (e.key === 'Tab') {
      // Back on the trigger, so Tab / Shift+Tab carries on from there.
      trigger.current?.focus();
      setOpen(false);
    }
  };

  const button = (
    <button
      ref={trigger} type="button" className="list-menu__trigger" aria-haspopup="menu" aria-expanded={open} aria-label={triggerLabel}
      aria-controls={open ? menuId : undefined} onKeyDown={onTriggerKey} onClick={() => (open ? close(true) : openAt('current'))}
    >
      <span>{children}</span>
      <span className="list-menu__chev"><Icon name="chevron-down" size={20} /></span>
    </button>
  );

  return (
    <div ref={root} className={`list-menu${props.field ? ' list-menu--field' : ''}`}>
      {props.heading ? <h1 className="page-title list-menu__h1">{button}</h1> : button}
      {open && (
        <div id={menuId} ref={panel} role="menu" aria-label={menuLabel} className="list-menu__panel" onKeyDown={onMenuKey}>
          {lists.map((c) => {
            const here = c === value;
            const count = counts?.[c];
            const body = (
              <>
                <span className="list-menu__label">{LIST_LABEL[c]}</span>
                {count !== undefined && <span className="list-menu__count">{count}</span>}
                <span className="list-menu__check">{here && <Icon name="check" size={18} />}</span>
              </>
            );
            return props.heading ? (
              <Link key={c} to={props.to(c)} role="menuitem" className="list-menu__item" tabIndex={-1} aria-current={here ? 'true' : undefined}
                aria-label={count !== undefined ? `${LIST_LABEL[c]}, ${count}` : LIST_LABEL[c]} onClick={() => setOpen(false)}>
                {body}
              </Link>
            ) : (
              <button key={c} type="button" role="menuitemradio" aria-checked={here} className="list-menu__item" tabIndex={-1}
                onClick={() => { props.onChoose(c); close(true); }}>
                {body}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
