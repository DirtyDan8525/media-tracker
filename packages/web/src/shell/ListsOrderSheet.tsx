import type { Category } from '@media-tracker/shared';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useAppSettings } from '../data/appSettings';
import { useSaveSettings, SETTINGS_SAVE_ERROR } from '../data/useMe';
import { Button } from '../design/components/Button';
import { Icon } from '../design/components/Icon';
import { Sheet } from '../design/components/Sheet';
import { LIST_LABEL, orderedLists } from '../nav';
import { useSessionMe } from './SessionGate';

/** Moves the item at `from` to `to` (a new array). */
function move<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}

/**
 * "Reorder lists" (PC side bar): your own order for the lists and which of them are shown. The order is saved as
 * `settings.listOrder` and the switches as `settings.tabs` (the same ones as Settings → Tabs), so the side bar, the list
 * menus and the phone's Lists menu all follow it. Rows move by dragging the handle or with the Move up / Move down buttons.
 */
export function ListsOrderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Sheet open={open} title="Reorder lists" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
    <Editor />
  </Sheet>;
}

function Editor() {
  const me = useSessionMe();
  const { lists: adminLists } = useAppSettings();
  const save = useSaveSettings({ errorToast: SETTINGS_SAVE_ERROR });
  const [order, setOrder] = useState<Category[]>(() => orderedLists(me.settings, adminLists));
  const [live, setLive] = useState('');
  const [dragging, setDragging] = useState<Category | null>(null);
  const rows = useRef(new Map<Category, HTMLLIElement>());
  const latest = useRef(order);
  const focusAfter = useRef<{ c: Category; part: 'handle' | 'up' | 'down' } | null>(null);
  const on = (c: Category) => me.settings.tabs[c] !== false;
  const shown = order.filter(on).length;

  useEffect(() => {
    latest.current = order;
    const f = focusAfter.current;
    if (!f) return;
    focusAfter.current = null;
    const row = rows.current.get(f.c);
    const sel = { handle: '.lists-order__handle', up: '[data-move="up"]', down: '[data-move="down"]' }[f.part];
    const el = row?.querySelector<HTMLElement>(`${sel}:not(:disabled)`) ?? row?.querySelector<HTMLElement>('.lists-order__handle');
    el?.focus();
  }, [order]);

  const commit = (next: Category[]) => save.mutate({ listOrder: next });

  function moveTo(c: Category, to: number, part: 'handle' | 'up' | 'down') {
    const from = order.indexOf(c);
    if (to < 0 || to >= order.length || to === from) return;
    const next = move(order, from, to);
    setOrder(next);
    commit(next);
    setLive(`${LIST_LABEL[c]} moved to position ${to + 1} of ${order.length}`);
    focusAfter.current = { c, part };
  }

  function onHandleKey(e: KeyboardEvent, c: Category) {
    const i = order.indexOf(c);
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); moveTo(c, i - 1, 'handle'); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); moveTo(c, i + 1, 'handle'); }
  }

  // Dragging: the row follows the pointer; it swaps with whichever row the pointer is over. Saved when let go.
  function onDown(e: PointerEvent<HTMLElement>, c: Category) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(c);
  }
  function onMove(e: PointerEvent<HTMLElement>) {
    if (!dragging) return;
    const target = latest.current.find((c) => {
      const r = rows.current.get(c)?.getBoundingClientRect();
      return r && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (target && target !== dragging) {
      const next = move(latest.current, latest.current.indexOf(dragging), latest.current.indexOf(target));
      latest.current = next;
      setOrder(next);
    }
  }
  function onUp() {
    if (!dragging) return;
    setLive(`${LIST_LABEL[dragging]} dropped at position ${latest.current.indexOf(dragging) + 1} of ${latest.current.length}`);
    setDragging(null);
    commit(latest.current);
  }

  return (
    <div className="lists-order">
      <p className="hint">Drag a handle, or use the arrow buttons, to change the order. This is your order: the side bar, the list menus and the phone's Lists menu all follow it.</p>
      <ul className="lists-order__list" aria-label="Lists in order">
        {order.map((c, i) => {
          const isOn = on(c);
          return (
            <li key={c} ref={(el) => { if (el) rows.current.set(c, el); else rows.current.delete(c); }}
              className={`lists-order__row${dragging === c ? ' is-dragging' : ''}${isOn ? '' : ' is-off'}`}>
              <button type="button" className="lists-order__handle" aria-label={`Drag ${LIST_LABEL[c]} to reorder. Position ${i + 1} of ${order.length}. Arrow keys move it.`}
                onPointerDown={(e) => onDown(e, c)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={(e) => onHandleKey(e, c)}>
                <Icon name="lists" size={20} />
              </button>
              <span className="lists-order__name">{LIST_LABEL[c]}</span>
              <button type="button" className="lists-order__move" data-move="up" aria-label={`Move ${LIST_LABEL[c]} up`} disabled={i === 0}
                onClick={() => moveTo(c, i - 1, 'up')}><span className="lists-order__arrow lists-order__arrow--up"><Icon name="chevron" size={18} /></span></button>
              <button type="button" className="lists-order__move" data-move="down" aria-label={`Move ${LIST_LABEL[c]} down`} disabled={i === order.length - 1}
                onClick={() => moveTo(c, i + 1, 'down')}><span className="lists-order__arrow lists-order__arrow--down"><Icon name="chevron" size={18} /></span></button>
              <label className="switch-row">
                <input type="checkbox" role="switch" checked={isOn} aria-label={`Show ${LIST_LABEL[c]}`} disabled={isOn && shown <= 1}
                  onChange={(e) => save.mutate({ tabs: { [c]: e.target.checked } })} />
              </label>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">{live}</p>
    </div>
  );
}
