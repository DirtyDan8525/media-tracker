import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { useSaveUsername } from '../data/useMe';
import { Button } from '../design/components/Button';

export const USERNAME_RULES = '3–20 characters: letters, numbers and _ only.';

export function usernameError(err: unknown): string {
  if (err instanceof ApiError && err.error === 'taken') return 'That username is taken. Try another one.';
  if (err instanceof ApiError && err.status === 400) return USERNAME_RULES;
  return "Couldn't save your username. Check your connection and try again.";
}

export interface UsernameFormProps {
  initial?: string;
  submitLabel: string;
  onSaved: () => void;
  /** Extra buttons beside submit (e.g. Cancel). */
  extra?: ReactNode;
}

/** Username field + submit. Server errors (409 taken, 400 invalid) show inline as an alert. */
export function UsernameForm({ initial = '', submitLabel, onSaved, extra }: UsernameFormProps) {
  const [value, setValue] = useState(initial);
  const save = useSaveUsername();
  const inputId = useId();
  const hintId = useId();
  const errId = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    const name = value.trim().toLowerCase();
    if (!name) return;
    save.mutate(name, { onSuccess: onSaved });
  }

  const error = save.isError ? usernameError(save.error) : null;
  return (
    <form className="username-form" onSubmit={submit} noValidate>
      <label htmlFor={inputId} className="field-label">Username</label>
      <div className={`text-field${error ? ' has-error' : ''}`}>
        <span className="text-field__prefix" aria-hidden="true">@</span>
        <input
          id={inputId} type="text" value={value} autoComplete="username" autoCapitalize="none" autoCorrect="off"
          spellCheck={false} maxLength={20} enterKeyHint="done"
          aria-describedby={error ? `${errId} ${hintId}` : hintId} aria-invalid={error ? true : undefined}
          onChange={(e) => { setValue(e.target.value); if (save.isError) save.reset(); }}
        />
      </div>
      <span id={hintId} className="field-hint">{USERNAME_RULES}</span>
      {error && <p id={errId} role="alert" className="field-error">{error}</p>}
      <div className="username-form__actions">
        <Button type="submit" variant="primary" disabled={save.isPending || !value.trim()}>
          {save.isPending ? 'Saving…' : submitLabel}
        </Button>
        {extra}
      </div>
    </form>
  );
}
