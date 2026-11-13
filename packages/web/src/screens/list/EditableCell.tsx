import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type CellValidation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface EditableCellProps<T> {
  /** Names the editor (e.g. "Rating for Frieren"). */
  label: string;
  /** Names the button that starts editing (e.g. "Rating for Frieren: 9.5"). */
  viewLabel: string;
  view: ReactNode;
  /** The text the editor starts with. */
  initial: string;
  /** Which arrow-key column this cell is in. */
  col: string;
  kind: 'number' | 'text' | 'select';
  options?: { value: string; label: string }[];
  validate: (raw: string) => CellValidation<T>;
  /** Called only when the value changed and passed validation. */
  onSave: (value: T) => void;
  maxLength?: number;
}

/**
 * A table cell that edits in place. Click or Enter starts; Enter or leaving the box saves; Escape
 * cancels. A select saves as soon as an option is picked. An invalid value shows an inline error
 * (and is dropped, not saved, if focus leaves).
 */
export function EditableCell<T>({ label, viewLabel, view, initial, col, kind, options, validate, onSave, maxLength }: EditableCellProps<T>) {
  const errId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const [refocus, setRefocus] = useState(false);
  const finished = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editing && refocus) { button.current?.focus(); setRefocus(false); }
  }, [editing, refocus]);

  function start() {
    finished.current = false;
    setDraft(initial);
    setError('');
    setEditing(true);
  }

  function finish(opts: { focus: boolean }) {
    finished.current = true;
    setEditing(false);
    setError('');
    if (opts.focus) setRefocus(true);
  }

  function commit(raw: string, how: 'enter' | 'blur') {
    if (finished.current) return;
    if (raw === initial) return finish({ focus: how === 'enter' });
    const v = validate(raw);
    if (!v.ok) {
      if (how === 'blur') return finish({ focus: false });
      setError(v.error);
      return;
    }
    finish({ focus: how === 'enter' });
    onSave(v.value);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!finished.current) finish({ focus: true });
    } else if (e.key === 'Enter' && kind !== 'select') {
      e.preventDefault();
      commit((e.target as HTMLInputElement).value, 'enter');
    }
  }

  if (!editing) {
    return (
      <button ref={button} type="button" className="cell-btn" data-nav={col} aria-label={viewLabel} onClick={start}>
        {view}
      </button>
    );
  }

  return (
    <span className="cell-edit">
      {kind === 'select' ? (
        <select
          autoFocus className="input input--cell" aria-label={label} value={draft}
          onChange={(e) => { setDraft(e.target.value); commit(e.target.value, 'enter'); }}
          onKeyDown={onKeyDown} onBlur={() => { if (!finished.current) finish({ focus: false }); }}
        >
          {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          autoFocus className="input input--cell" aria-label={label} value={draft} maxLength={maxLength}
          type={kind === 'number' ? 'number' : 'text'} step={kind === 'number' ? 'any' : undefined}
          min={kind === 'number' ? 0 : undefined} max={kind === 'number' ? 10 : undefined}
          inputMode={kind === 'number' ? 'decimal' : undefined}
          aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
          onChange={(e) => { setDraft(e.target.value); setError(''); }}
          onKeyDown={onKeyDown} onBlur={(e) => commit(e.target.value, 'blur')}
        />
      )}
      {error && <span id={errId} role="alert" className="field-error">{error}</span>}
    </span>
  );
}
