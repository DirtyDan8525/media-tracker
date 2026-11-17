import type { Category, ListsSetting } from '@media-tracker/shared';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useResetSetting, useSaveSetting } from '../../data/adminApp';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { IconButton } from '../../design/components/IconButton';
import { LIST_LABEL, LIST_ORDER } from '../../nav';
import { AdminPage, Result, saveError, useFeedback } from './parts';

/** Moves the item at `from` to `to` (a new array). */
export function move<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}

/** /admin/lists (AD11): the order lists appear in, and which are hidden for everyone. */
export function ListsScreen() {
  return <AdminPage title="Lists">{(app) => <Editor initial={app.settings.lists} />}</AdminPage>;
}

function Editor({ initial }: { initial: ListsSetting }) {
  const save = useSaveSetting();
  const reset = useResetSetting();
  const fb = useFeedback();
  const [order, setOrder] = useState<Category[]>(initial.order);
  const [hidden, setHidden] = useState<Category[]>(initial.hidden);
  const [live, setLive] = useState('');
  const [dragging, setDragging] = useState<Category | null>(null);
  const rows = useRef(new Map<Category, HTMLLIElement>());
  const focusAfter = useRef<{ c: Category; part: 'handle' } | null>(null);
  const shown = order.length - hidden.length;

  // After a keyboard or menu move the handle keeps focus, so the next press moves it again.
  useEffect(() => {
    if (!focusAfter.current) return;
    rows.current.get(focusAfter.current.c)?.querySelector<HTMLElement>('.admin-row__handle')?.focus();
    focusAfter.current = null;
  }, [order]);

  function moveTo(c: Category, to: number, keepFocus: boolean) {
    const from = order.indexOf(c);
    if (to < 0 || to >= order.length || to === from) return;
    setOrder(move(order, from, to));
    setLive(`${LIST_LABEL[c]} moved to position ${to + 1} of ${order.length}`);
    if (keepFocus) focusAfter.current = { c, part: 'handle' };
  }

  function toggleHidden(c: Category, hide: boolean) {
    if (hide && shown <= 1) {
      fb.fail('At least one list has to stay visible.');
      return;
    }
    setHidden(hide ? [...hidden, c] : hidden.filter((x) => x !== c));
  }

  function onHandleKey(e: KeyboardEvent, c: Category) {
    const i = order.indexOf(c);
    if (e.key === 'ArrowUp') { e.preventDefault(); moveTo(c, i - 1, true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(c, i + 1, true); }
  }

  // Dragging: the row follows the pointer; it swaps with whichever row the pointer is over.
  function onDown(e: PointerEvent<HTMLElement>, c: Category) {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(c);
  }
  function onMove(e: PointerEvent<HTMLElement>) {
    if (!dragging) return;
    const target = order.find((c) => {
      const r = rows.current.get(c)?.getBoundingClientRect();
      return r && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (target && target !== dragging) {
      setOrder((o) => move(o, o.indexOf(dragging), o.indexOf(target)));
    }
  }
  function onUp() {
    if (dragging) setLive(`${LIST_LABEL[dragging]} dropped at position ${order.indexOf(dragging) + 1} of ${order.length}`);
    setDragging(null);
  }

  async function submit() {
    try {
      await save.mutateAsync({ key: 'lists', value: { order, hidden } });
      fb.ok('Lists saved. Everyone sees them this way.');
    } catch (err) {
      fb.fail(saveError(err, 'lists'));
    }
  }
  async function useDefault() {
    try {
      await reset.mutateAsync('lists');
      setOrder([...LIST_ORDER]);
      setHidden([]);
      fb.ok('Lists are back to the built-in order.');
    } catch (err) {
      fb.fail(saveError(err, 'lists'));
    }
  }

  return (
    <section aria-labelledby="ls-title" className="group">
      <h2 id="ls-title" className="group__title">Lists <span className="muted">· {shown} shown</span></h2>
      <p className="friend-note">Drag a handle, or use the ⋯ menu, to change the order. Hidden lists disappear for everyone; people can still switch more of their own off.</p>
      <Result fb={fb.fb} />
      <ul className="admin-list" aria-label="Lists in order">
        {order.map((c, i) => {
          const isHidden = hidden.includes(c);
          return (
            <li key={c} ref={(el) => { if (el) rows.current.set(c, el); else rows.current.delete(c); }}
              className={`admin-row${dragging === c ? ' is-dragging' : ''}${isHidden ? ' is-hidden' : ''}`}>
              <button type="button" className="admin-row__handle" aria-label={`Drag ${LIST_LABEL[c]} to reorder. Position ${i + 1} of ${order.length}. Arrow keys move it.`}
                onPointerDown={(e) => onDown(e, c)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={(e) => onHandleKey(e, c)}>
                <Icon name="lists" size={20} />
              </button>
              <span className="admin-row__name">{LIST_LABEL[c]}{isHidden ? ' · hidden' : ''}</span>
              <label className="switch-row">
                <input type="checkbox" role="switch" checked={isHidden} aria-label={`Hide ${LIST_LABEL[c]} for everyone`}
                  onChange={(e) => toggleHidden(c, e.target.checked)} />
              </label>
              <MoveMenu name={LIST_LABEL[c]} first={i === 0} last={i === order.length - 1} onUp={() => moveTo(c, i - 1, false)} onDown={() => moveTo(c, i + 1, false)} />
            </li>
          );
        })}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">{live}</p>
      <div className="admin-actions">
        <Button variant="primary" disabled={save.isPending} onClick={() => void submit()}>Save lists</Button>
        <Button disabled={reset.isPending} onClick={() => void useDefault()}>Use built-in order</Button>
      </div>
    </section>
  );
}

/** ⋯ on a row: Move up / Move down, for people who don't drag. */
function MoveMenu({ name, first, last, onUp, onDown }: { name: string; first: boolean; last: boolean; onUp: () => void; onDown: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const pick = (fn: () => void, disabled: boolean) => () => { if (disabled) return; setOpen(false); fn(); };
  return (
    <div className="person__menu" ref={wrap}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); wrap.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus(); } }}>
      <IconButton label={`Move ${name}`} icon="more" look="plain" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div role="menu" aria-label={`Move ${name}`} className="menu">
          <button type="button" role="menuitem" className="menu__item" aria-disabled={first} onClick={pick(onUp, first)}>Move up</button>
          <button type="button" role="menuitem" className="menu__item" aria-disabled={last} onClick={pick(onDown, last)}>Move down</button>
        </div>
      )}
    </div>
  );
}
