import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';

export interface SheetProps {
  open: boolean;
  /** Names the dialog (aria-labelledby). */
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional footer row (e.g. the Save button), pinned under the scrolling body. */
  footer?: ReactNode;
  /** A video: on PC the dialog grows to most of the screen at 16:9 (trailers, Dan 2026-11-20). */
  video?: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal: a bottom sheet on phones, a centered dialog from 768 px (CSS decides the shape).
 * Escape and the backdrop close it; focus moves in on open (to a `data-autofocus` element, else the first field;
 * on touch screens to the sheet itself so no keyboard pops up), is trapped, and returns on close.
 */
export function Sheet({ open, title, onClose, children, footer, video = false }: SheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    // On touch screens focus goes to the sheet itself, not a text field, so the keyboard doesn't pop up
    // before the person picks where to type (Dan, 2026-11-17). Screen readers still land in the dialog.
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const first = touch ? null
      : panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(`.sheet__body ${FOCUSABLE}`);
    (first ?? panel.current)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      returnTo?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const [first, last] = [items[0]!, items[items.length - 1]!];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className={video ? 'sheet sheet--video' : 'sheet'} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="sheet__grabber" aria-hidden="true" />
        <div className="sheet__header">
          <h2 id={titleId} className="sheet__title">{title}</h2>
          <IconButton label="Close" icon="close" look="plain" onClick={onClose} />
        </div>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
