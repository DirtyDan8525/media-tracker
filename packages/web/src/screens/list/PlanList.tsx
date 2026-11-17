import { CATEGORY_CONFIG, type Entry } from '@media-tracker/shared';
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Link } from 'react-router';
import { effectiveLookupState } from '../../data/entryCache';
import { CoverImage } from '../../design/components/CoverImage';
import { Icon } from '../../design/components/Icon';
import { dragTarget, moveId, moveStep, type Step } from '../../lists/plan';
import { LookupNote } from './LookupNote';
import { PrivateLock } from './PrivateLock';
import type { RowActions } from './EntryCards';
import '../../design/plan.css';

export interface PlanListProps extends RowActions {
  /** The rows to show, in plan order. */
  rows: Entry[];
  /** Every planned title of the list, in plan order (a filtered view shows fewer rows than this). */
  order: string[];
  label: string;
  /** False while a search or genre filter hides some titles: positions still show, nothing can move. */
  reorderable: boolean;
  /** The whole list's new order (ids in plan order). */
  onReorder: (ids: string[]) => void;
}

const MENU: { step: Step; label: string }[] = [
  { step: 'top', label: 'Move to top' },
  { step: 'up', label: 'Move up' },
  { step: 'down', label: 'Move down' },
];

interface Drag { id: string; from: number; over: number; dy: number; h: number }

/** The Plan to watch view: numbered rows, "Up next" on #1, a drag handle and a ⋯ menu (Move to top / up / down) on each. */
export function PlanList({ rows, order, label, reorderable, onReorder, ...actions }: PlanListProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [said, setSaid] = useState('');
  const hintId = useId();
  const list = useRef<HTMLOListElement>(null);
  // Pointer bookkeeping that must not re-render: where the drag started, the scroller, the latest pointer y.
  const g = useRef({ startY: 0, startScroll: 0, y: 0, pointer: -1, scroller: null as HTMLElement | null });

  const titleOf = (id: string) => rows.find((r) => r.id === id)?.title ?? '';
  const move = (id: string, next: string[]) => {
    const to = next.indexOf(id);
    onReorder(next);
    setSaid(`Moved ${titleOf(id)} to position ${to + 1} of ${next.length}`);
  };

  const scrollerOf = (el: HTMLElement): HTMLElement | null => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
  };
  const scrollTop = () => (g.current.scroller ? g.current.scroller.scrollTop : window.scrollY);

  const update = (d: Drag): Drag => {
    const dy = g.current.y - g.current.startY + (scrollTop() - g.current.startScroll);
    return { ...d, dy, over: dragTarget(d.from, dy, d.h, order.length) };
  };

  // While dragging near the top or bottom edge of the scroller (or the window), keep scrolling.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const tick = () => {
      const s = g.current.scroller;
      const box = s ? s.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const edge = 72;
      const dir = g.current.y < box.top + edge ? -1 : g.current.y > box.bottom - edge ? 1 : 0;
      if (dir) {
        if (s) s.scrollTop += dir * 12; else window.scrollBy(0, dir * 12);
        setDrag((d) => (d ? update(d) : d));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  function onDown(e: PointerEvent<HTMLButtonElement>, id: string) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const li = e.currentTarget.closest('li');
    const ul = list.current;
    if (!li || !ul) return;
    const from = order.indexOf(id);
    if (from < 0) return;
    const gap = parseFloat(getComputedStyle(ul).rowGap) || 0;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    g.current = { startY: e.clientY, startScroll: 0, y: e.clientY, pointer: e.pointerId, scroller: scrollerOf(ul) };
    g.current.startScroll = scrollTop();
    setDrag({ id, from, over: from, dy: 0, h: li.getBoundingClientRect().height + gap });
  }
  function onMove(e: PointerEvent<HTMLButtonElement>) {
    if (!drag || e.pointerId !== g.current.pointer) return;
    g.current.y = e.clientY;
    setDrag(update(drag));
  }
  function onUp(e: PointerEvent<HTMLButtonElement>) {
    if (!drag || e.pointerId !== g.current.pointer) return;
    const { id, over, from } = update(drag);
    setDrag(null);
    if (over !== from) move(id, moveId(order, id, over));
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (drag) {
      if (e.key === 'Escape') setDrag(null);
      return;
    }
    const step: Step | null = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'Home' ? 'top' : null;
    if (step) {
      e.preventDefault();
      const next = moveStep(order, id, step);
      if (next !== order && next.some((x, i) => x !== order[i])) move(id, next);
    } else if (e.key === 'End') {
      e.preventDefault();
      const next = moveId(order, id, order.length - 1);
      if (next.some((x, i) => x !== order[i])) move(id, next);
    }
  }

  const shift = (i: number): CSSProperties | undefined => {
    if (!drag) return undefined;
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)` };
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return { transform: `translateY(${-drag.h}px)` };
    if (drag.from > drag.over && i >= drag.over && i < drag.from) return { transform: `translateY(${drag.h}px)` };
    return undefined;
  };

  return (
    <>
      <ol ref={list} className="plan-list plain-list" aria-label={label}>
        {rows.map((e) => {
          const pos = order.indexOf(e.id);
          return (
            <PlanRow
              key={e.id} entry={e} position={pos + 1} count={order.length} reorderable={reorderable}
              dragging={drag?.id === e.id} style={shift(pos)} hintId={hintId}
              onDown={(ev) => onDown(ev, e.id)} onMove={onMove} onUp={onUp} onCancel={() => setDrag(null)}
              onKey={(ev) => onKey(ev, e.id)} onStep={(step) => move(e.id, moveStep(order, e.id, step))}
              {...actions}
            />
          );
        })}
      </ol>
      {reorderable && <p id={hintId} className="sr-only">Drag the handle, or focus it and press the up and down arrow keys, to change the order.</p>}
      <p role="status" aria-live="polite" className="sr-only">{said}</p>
    </>
  );
}

interface RowProps extends RowActions {
  entry: Entry;
  position: number;
  count: number;
  reorderable: boolean;
  dragging: boolean;
  style: CSSProperties | undefined;
  hintId: string;
  onDown: (e: PointerEvent<HTMLButtonElement>) => void;
  onMove: (e: PointerEvent<HTMLButtonElement>) => void;
  onUp: (e: PointerEvent<HTMLButtonElement>) => void;
  onCancel: () => void;
  onKey: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onStep: (s: Step) => void;
}

function PlanRow({ entry: e, position, count, reorderable, dragging, style, hintId, onDown, onMove, onUp, onCancel, onKey, onStep, ...actions }: RowProps) {
  const cfg = CATEGORY_CONFIG[e.category];
  const state = effectiveLookupState(e);
  const meta = [e.creator, e.genres].filter(Boolean).join(' · ');
  const cls = ['plan-row', position === 1 && 'plan-row--first', dragging && 'is-dragging'].filter(Boolean).join(' ');
  return (
    <li className={cls} style={style}>
      <span className="plan-row__pos"><span className="sr-only">Position </span>{position}</span>
      <div className="plan-row__main">
        <CoverImage src={e.coverUrl} alt={`${e.title} cover`} square={cfg.square} width={44} />
        <div className="plan-row__text">
          {position === 1 && <span className="plan-row__next">Up next</span>}
          {state === 'pending'
            ? <span className="entry-card__title" data-role="title">{e.title}{e.isPrivate && <PrivateLock />}</span>
            : <Link className="entry-card__title plan-row__title" data-role="title" to={`/entry/${e.id}`}>{e.title}{e.isPrivate && <PrivateLock />}</Link>}
          {meta && state === 'ok' && <span className="entry-card__meta">{meta}</span>}
          <LookupNote entry={e} {...actions} />
        </div>
      </div>
      {reorderable && (
        <>
          <MoveMenu title={e.title} position={position} count={count} onStep={onStep} />
          <button
            type="button" className="plan-row__handle" aria-label={`Reorder ${e.title}`} aria-describedby={hintId}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onKeyDown={onKey}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" /><circle cx="9" cy="12" r="1.7" />
              <circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" />
            </svg>
          </button>
        </>
      )}
    </li>
  );
}

/** The ⋯ button: Move to top / Move up / Move down (the accessible alternative to dragging). */
function MoveMenu({ title, position, count, onStep }: { title: string; position: number; count: number; onStep: (s: Step) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const disabled = (s: Step) => (s === 'down' ? position >= count : position <= 1);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onDocDown = (ev: Event) => { if (!root.current?.contains(ev.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDocDown);
    return () => document.removeEventListener('pointerdown', onDocDown);
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  function onMenuKey(ev: KeyboardEvent) {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
    else if (ev.key === 'Tab') setOpen(false);
  }

  return (
    <div ref={root} className="plan-menu">
      <button
        ref={trigger} type="button" className="plan-menu__btn" aria-label={`More actions for ${title}`}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" size={22} />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={`Move ${title}`} className="plan-menu__panel" onKeyDown={onMenuKey}>
          {MENU.map((m) => (
            <button key={m.step} type="button" role="menuitem" className="plan-menu__item" disabled={disabled(m.step)}
              onClick={() => { onStep(m.step); close(); }}>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
