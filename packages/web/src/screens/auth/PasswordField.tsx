import { useId, useState } from 'react';
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
}

/** A password input with a 44 px Show / Hide button (iPhone keyboards make typos easy). */
export function PasswordField({ label, value, onChange, autoComplete, hint, invalid, autoFocus }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const id = useId();
  const hintId = useId();
  return (
    <div className="auth-field">
      <div className={`text-field auth-pw${invalid ? ' has-error' : ''}`}>
        <input id={id} type={shown ? 'text' : 'password'} value={value} placeholder={label} aria-label={label}
          autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go"
          autoFocus={autoFocus} maxLength={128} aria-invalid={invalid ? true : undefined} aria-describedby={hint ? hintId : undefined}
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
