import { useEffect, useRef, useState } from 'react';
import { TEXT_STEPS } from './useTextSize';
import '../textsize.css';

/** The "Aa" button (chat header, Activity): a small popover to make the text smaller or bigger (5 steps, 85%-140%). */
export function TextSizeControl({ step, onChange }: { step: number; onChange: (step: number) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const last = TEXT_STEPS.length - 1;
  return (
    <div className="textsize" ref={wrap}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
      <button ref={trigger} type="button" className="icon-btn icon-btn--plain textsize__aa" aria-label="Text size" title="Text size" aria-haspopup="true" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">Aa</span>
      </button>
      {open && (
        <div role="group" aria-label="Text size" className="menu textsize__pop">
          <button type="button" className="btn btn--secondary" aria-label="Smaller text" aria-disabled={step <= 0 || undefined} onClick={() => { if (step > 0) onChange(step - 1); }}><span aria-hidden="true" style={{ fontSize: 13 }}>A</span></button>
          <output className="textsize__value" aria-live="polite">{TEXT_STEPS[step]}%</output>
          <button type="button" className="btn btn--secondary" aria-label="Bigger text" aria-disabled={step >= last || undefined} onClick={() => { if (step < last) onChange(step + 1); }}><span aria-hidden="true" style={{ fontSize: 20 }}>A</span></button>
        </div>
      )}
    </div>
  );
}
