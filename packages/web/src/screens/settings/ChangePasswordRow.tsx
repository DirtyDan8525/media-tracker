import { useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { changePassword, PASSWORD_MAX, PASSWORD_MIN } from '../../data/auth';
import { Button } from '../../design/components/Button';
import { useToast } from '../../design/components/Toast';
import { PasswordField } from '../auth/PasswordField';
import '../../design/auth.css';
import '../../design/account.css';

type Field = 'current' | 'next' | 'confirm';
interface Problem { field: Field | null; text: string }

/** What the toast says after a change: names how many other devices were signed out. */
export function changedMessage(others: number): string {
  if (others <= 0) return 'Password changed. No other devices were signed in.';
  return `Password changed. ${others} other ${others === 1 ? 'device was' : 'devices were'} signed out.`;
}

/** Plain words for a failed change (the server's codes, never the raw ones). */
function serverProblem(err: unknown): Problem {
  if (err instanceof ApiError) {
    if (err.status === 429 || err.error === 'too_many_attempts') return { field: null, text: 'Too many tries. Wait 15 minutes and try again.' };
    if (err.error === 'bad_credentials') return { field: 'current', text: "That isn't your current password." };
    if (err.error === 'same_password') return { field: 'next', text: 'Choose a password you are not using now.' };
    if (err.error === 'invalid') return { field: 'next', text: `Use ${PASSWORD_MIN}–${PASSWORD_MAX} characters for the new password.` };
  }
  return { field: null, text: "Couldn't change your password. Check your connection and try again." };
}

/**
 * Settings → Account → "Change password": the current password, a new one (8–128) and the new one again. It signs out
 * every other device (this one stays signed in) and says how many.
 */
export function ChangePasswordRow() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = { current: useRef<HTMLInputElement>(null), next: useRef<HTMLInputElement>(null), confirm: useRef<HTMLInputElement>(null) };
  const triggerRef = useRef<HTMLButtonElement>(null);
  const errId = useId();
  const ids = { current: useId(), next: useId(), confirm: useId() };

  function close() {
    setOpen(false); setCurrent(''); setNext(''); setConfirm(''); setProblem(null);
    // The form is gone: put focus back on the button that opened it.
    setTimeout(() => triggerRef.current?.focus(), 0);
  }
  function fail(p: Problem) {
    setProblem(p);
    if (p.field) refs[p.field].current?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!current) return fail({ field: 'current', text: 'Enter your current password.' });
    const n = [...next].length;
    if (n < PASSWORD_MIN || n > PASSWORD_MAX) return fail({ field: 'next', text: `Use ${PASSWORD_MIN}–${PASSWORD_MAX} characters for the new password.` });
    if (next === current) return fail({ field: 'next', text: 'Choose a password you are not using now.' });
    if (confirm !== next) return fail({ field: 'confirm', text: "The two new passwords don't match." });
    setProblem(null);
    setBusy(true);
    try {
      const res = await changePassword(current, next);
      toast.show(changedMessage(res.signedOutOthers));
      setBusy(false);
      close();
    } catch (err) {
      const p = serverProblem(err);
      if (p.field === 'current') setCurrent('');
      setBusy(false);
      fail(p);
    }
  }

  if (!open) {
    return (
      <div className="group__row">
        <span>Password</span>
        <span className="group__row-end">
          <Button ref={triggerRef} variant="ghost" compact aria-label="Change password" onClick={() => setOpen(true)}>Change</Button>
        </span>
      </div>
    );
  }
  const bad = (f: Field) => problem?.field === f;
  const clear = () => setProblem(null);
  return (
    <div className="group__pad">
      <form className="pw-form" aria-label="Change password" onSubmit={(e) => void submit(e)} noValidate>
        <input className="auth__vh" type="text" value="" readOnly tabIndex={-1} aria-hidden="true" autoComplete="username" />
        <div className="field">
          <label className="field-label" htmlFor={ids.current}>Current password</label>
          <PasswordField id={ids.current} label="Current password" value={current} onChange={(v) => { setCurrent(v); clear(); }}
            autoComplete="current-password" invalid={bad('current')} errorId={errId} inputRef={refs.current} autoFocus />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.next}>New password</label>
          <PasswordField id={ids.next} label="New password" value={next} onChange={(v) => { setNext(v); clear(); }}
            autoComplete="new-password" hint={`${PASSWORD_MIN}–${PASSWORD_MAX} characters`} invalid={bad('next')} errorId={errId} inputRef={refs.next} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.confirm}>Confirm new password</label>
          <PasswordField id={ids.confirm} label="Confirm new password" value={confirm} onChange={(v) => { setConfirm(v); clear(); }}
            autoComplete="new-password" invalid={bad('confirm')} errorId={errId} inputRef={refs.confirm} />
        </div>
        <p className="field-hint">This signs you out on your other devices. You stay signed in here.</p>
        {problem && <p id={errId} role="alert" className="field-error">{problem.text}</p>}
        <div className="username-form__actions">
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</Button>
          <Button variant="ghost" disabled={busy} onClick={close}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
