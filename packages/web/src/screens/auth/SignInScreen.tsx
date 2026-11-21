import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { useAppSettings } from '../../data/appSettings';
import { finishSignIn, JOIN_INVALID_KEY, login, PASSWORD_MAX, PASSWORD_MIN, signUp, USERNAME_RE } from '../../data/auth';
import { Button } from '../../design/components/Button';
import { USERNAME_RULES } from '../UsernameForm';
import { Tabs } from '../social/parts';
import { PasswordField } from './PasswordField';
import '../../design/auth.css';

type Mode = 'signin' | 'signup';
const TABS: { id: Mode; label: string }[] = [{ id: 'signin', label: 'Sign in' }, { id: 'signup', label: 'Create account' }];

const ADMIN_NAME = 'Dan';
export const PASSWORD_RULES = 'At least 8 characters';
const BAD_PASSWORD = `Use at least ${PASSWORD_MIN} characters.`;
const OFFLINE = "Couldn't sign you in. Check your connection and try again.";

/** Plain words for a sign-in / sign-up / reset error (the server's codes, never the raw ones). */
export function authError(err: unknown, mode: Mode): string {
  if (err instanceof ApiError) {
    if (err.status === 429 || err.error === 'too_many_attempts') return 'Too many tries. Wait 15 minutes and try again.';
    if (err.error === 'feature_off') return mode === 'signup' ? 'Sign-ups are closed right now. Ask Dan for a sign-up link.' : OFFLINE;
    if (err.error === 'removed') return 'Your access was removed. Ask Dan if this is a mistake.';
    if (err.error === 'taken') return 'That username is taken.';
    if (err.error === 'bad_credentials') return "That username or password isn't right.";
    if (err.error === 'invalid') return mode === 'signup' ? `${USERNAME_RULES} Passwords need ${PASSWORD_MIN}–${PASSWORD_MAX} characters.` : "That username or password isn't right.";
  }
  return OFFLINE;
}

/**
 * Shown to anyone without a session, at any path (the URL stays, so signing in lands right where
 * they were going). One screen, two tabs: Sign in and Create account. On /join/<token> the same
 * screen carries the link's token (`joinToken`), a banner, and leaves the route when done.
 */
export function SignInScreen({ joinToken, banner, onSignedIn }: { joinToken?: string; banner?: ReactNode; onSignedIn?: () => void } = {}) {
  const qc = useQueryClient();
  const app = useAppSettings();
  // Sign-ups switched off (AD2): the Create account tab says so, unless this is a sign-up link from Dan.
  const closed = !app.features.signups && !joinToken;
  const [picked, setPicked] = useState<Mode | null>(null);
  const mode: Mode = picked ?? (closed ? 'signin' : 'signup');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  function pick(next: Mode) {
    setPicked(next);
    setError(null);
    setPassword('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const user = username.trim().toLowerCase();
    if (mode === 'signup') {
      if (!USERNAME_RE.test(user)) return setError(USERNAME_RULES);
      if ([...password].length < PASSWORD_MIN) return setError(BAD_PASSWORD);
    } else if (!user || !password) {
      return setError('Enter your username and password.');
    }
    setError(null);
    setBusy(true);
    try {
      const res = mode === 'signup' ? await signUp(user, password, name.trim() || undefined, joinToken) : await login(user, password);
      const { joinLink, ...me } = res as typeof res & { joinLink?: 'invalid' };
      if (joinLink === 'invalid') sessionStorage.setItem(JOIN_INVALID_KEY, '1');
      await finishSignIn(qc, me);
      onSignedIn?.();
    } catch (err) {
      setError(authError(err, mode));
      setBusy(false);
      // A wrong password: the username stays, only the password clears, and focus goes to it to try again.
      if (mode === 'signin') {
        if (err instanceof ApiError && (err.error === 'bad_credentials' || err.error === 'invalid')) setPassword('');
        passwordRef.current?.focus();
      }
    }
  }

  const signup = mode === 'signup';
  const invited = !!joinToken && !!banner;
  const label = signup ? 'Create account' : 'Sign in';
  return (
    <main className="auth">
      <div className="auth__card">
        <span className="brand-mark auth__brand">{app.brand.name}</span>
        {app.brand.welcome && <p className="auth__welcome">{app.brand.welcome}</p>}
        <Tabs label="Sign in or create account" tabs={TABS} value={mode} onChange={pick} idPrefix="auth" />
        {banner}
        {mode === 'signup' && closed ? (
          <div className="auth__form" role="tabpanel" id="auth-panel" aria-labelledby={`auth-tab-${mode}`}>
            <p role="status" className="auth__closed"><b>Sign-ups are closed.</b> Ask {ADMIN_NAME} for a sign-up link.</p>
          </div>
        ) : (
        <form className="auth__form" role="tabpanel" id="auth-panel" aria-labelledby={`auth-tab-${mode}`} onSubmit={(e) => void submit(e)} noValidate>
          <div className={`text-field${error ? ' has-error' : ''}`}>
            <input type="text" value={username} placeholder="Username" aria-label="Username" autoComplete="username"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={20} enterKeyHint="next"
              onChange={(e) => { setUsername(e.target.value); setError(null); }} />
          </div>
          {signup && (
            <div className="text-field">
              <input type="text" value={name} placeholder="Your name (optional)" aria-label="Your name (optional)" autoComplete="name"
                maxLength={60} enterKeyHint="next" onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <PasswordField label="Password" value={password} onChange={(v) => { setPassword(v); setError(null); }}
            autoComplete={signup ? 'new-password' : 'current-password'} hint={signup ? PASSWORD_RULES : undefined} invalid={!!error} inputRef={passwordRef} errorId="auth-error" />
          {error && <p id="auth-error" role="alert" className="field-error">{error}</p>}
          <Button type="submit" variant="primary" className="auth__submit" disabled={busy}>
            {busy ? (signup ? 'Creating account…' : 'Signing in…') : label}
          </Button>
        </form>
        )}
        <p className="auth__note">
          {signup ? (invited || closed ? null : "Dan approves new accounts — you'll get in as soon as he does.") : 'Forgot your password? Ask Dan for a reset link.'}
        </p>
      </div>
    </main>
  );
}
