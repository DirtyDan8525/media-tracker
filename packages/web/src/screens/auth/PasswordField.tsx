import { useId, useState, type Ref } from 'react';
import { Icon } from '../../design/components/Icon';

export interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** 'current-password' to sign in, 'new-password' to choose one. */
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  invalid?: boolean;
  autoFocus?: boolean;
  /** The input, so a screen can move focus to it (after a wrong password). */
  inputRef?: Ref<HTMLInputElement>;
  /** Overrides the id (so a visible label or an error can point at it). */
  id?: string;
  /** The error text's id, joined into aria-describedby while the field is invalid. */
  errorId?: string;
}

/** A password input with a 44 px Show / Hide button (iPhone keyboards make typos easy). */
export function PasswordField({ label, value, onChange, autoComplete, hint, invalid, autoFocus, inputRef, id: idProp, errorId }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const ownId = useId();
  const id = idProp ?? ownId;
  const hintId = useId();
  return (
    <div className="auth-field">
      <div className={`text-field auth-pw${invalid ? ' has-error' : ''}`}>
        <input id={id} type={shown ? 'text' : 'password'} value={value} placeholder={label} aria-label={label}
          autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"
          autoFocus={autoFocus} maxLength={128} aria-invalid={invalid ? true : undefined}
          aria-describedby={[hint ? hintId : null, invalid && errorId ? errorId : null].filter(Boolean).join(' ') || undefined} ref={inputRef}
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="auth-pw__toggle" aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}
          onClick={() => setShown((v) => !v)}>
          <Icon name={shown ? 'eye-off' : 'eye'} size={20} />
        </button>
      </div>
      {hint && <span id={hintId} className="field-hint">{hint}</span>}
    </div>
  );
}
