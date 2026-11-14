import { useEffect, useId, useRef, useState } from 'react';

export type FieldCheck = (raw: string) => string | null;

export interface DetailFieldProps {
  label: string;
  value: string;
  /** Called on blur (or Enter) when the text changed and passed `check`. */
  onSave: (value: string) => void;
  /** Returns an error message, or null when the text is fine. */
  check?: FieldCheck;
  multiline?: boolean;
  type?: 'text' | 'number';
  maxLength?: number;
  placeholder?: string;
  className?: string;
  hideLabel?: boolean;
  inputClassName?: string;
}

/** A labelled box that saves when you leave it; a bad value shows an inline error and is not saved. */
export function DetailField({ label, value, onSave, check, multiline, type = 'text', maxLength, placeholder, className, hideLabel, inputClassName }: DetailFieldProps) {
  const id = useId();
  const errId = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const focused = useRef(false);

  // Follow outside changes (a Re-fetch, a rollback) unless the person is typing.
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);

  function commit() {
    focused.current = false;
    if (draft === value) { setError(''); return; }
    const problem = check?.(draft) ?? null;
    if (problem) { setError(problem); return; }
    setError('');
    onSave(draft);
  }

  const shared = {
    id, value: draft, maxLength, placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errId : undefined,
    className: inputClassName ?? 'input',
    onFocus: () => { focused.current = true; },
    onBlur: commit,
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); setError(''); },
  };

  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className={hideLabel ? 'sr-only' : 'field-label'} htmlFor={id}>{label}</label>
      {multiline
        ? <textarea {...shared} rows={3} />
        : (
          <input
            {...shared} type={type}
            {...(type === 'number' ? { step: 'any', min: 0, max: 10, inputMode: 'decimal' as const } : {})}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        )}
      {error && <span id={errId} role="alert" className="field-error">{error}</span>}
    </div>
  );
}
