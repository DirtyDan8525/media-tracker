import type { Tier } from '@media-tracker/shared';
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { TIERS_TOP_FIRST } from '../../design/components/TierPicker';

export interface MoveMenuProps {
  /** The title being moved (names the menu). */
  title: string;
  /** Its tier now: left out of the menu. */
  current: Tier | null;
  /** Tier names and range labels, indexed by tier. */
  names: readonly string[];
  ranges?: readonly string[];
  onPick(t: Tier): void;
  /** Closes without a move; focus goes back to the button that opened it. */
  onClose(): void;
  /** The button that opened the menu: a click on it is its own toggle, not an outside click. */
  anchor: RefObject<HTMLElement | null>;
}

/** "Belongs in another tier": a small menu of the other tiers. Keys stay inside it (they never answer the question). */
export function MoveMenu({ title, current, names, ranges, onPick, onClose, anchor }: MoveMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

  useEffect(() => { items()[0]?.focus(); }, []);

  // A press outside the menu (and its button) closes it.
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      latest.current();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [anchor]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the question's keys (arrows, S, Backspace) don't apply in here
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === 'ArrowDown') { e.preventDefault(); focus(at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(at - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focus(0); }
    else if (e.key === 'End') { e.preventDefault(); focus(list.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Tab') onClose();
  };

  return (
    <div ref={ref} role="menu" aria-label={`Move ${title} to`} className="move-menu" onKeyDown={onKeyDown}>
      {TIERS_TOP_FIRST.filter((t) => t !== current).map((t) => (
        <button key={t} type="button" role="menuitem" tabIndex={-1} className="move-menu__item"
          aria-label={ranges ? `${names[t]} · ${ranges[t]}` : names[t]} onClick={() => onPick(t)}>
          <span>{names[t]}</span>
          {ranges && <small>{ranges[t]}</small>}
        </button>
      ))}
    </div>
  );
}
