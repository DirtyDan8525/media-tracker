import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError, api } from '../../api/client';
import { useAppName } from '../../data/appSettings';
import { finishSignIn, PASSWORD_MIN, resetPassword } from '../../data/auth';
import { Button } from '../../design/components/Button';
import { Skeleton } from '../../design/components/Skeleton';
import { PASSWORD_RULES } from './SignInScreen';
import { PasswordField } from './PasswordField';
import '../../design/auth.css';

const EXPIRED = 'This link has expired. Ask Dan for a new one.';

/** /reset/:token, works signed out: the link from Dan sets a new password and signs this device in. */
export function ResetScreen() {
  const appName = useAppName();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const check = useQuery({
    queryKey: ['reset-link', token],
    queryFn: () => api.get<{ username: string }>(`/api/auth/reset/${encodeURIComponent(token)}`),
    retry: false, staleTime: Infinity, gcTime: 0,
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if ([...password].length < PASSWORD_MIN) return setError(`Use at least ${PASSWORD_MIN} characters.`);
    setError(null);
    setBusy(true);
    try {
      const me = await resetPassword(token, password);
      await finishSignIn(qc, me);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setExpired(true);
      else if (err instanceof ApiError && err.status === 400) setError(`Use ${PASSWORD_MIN}–128 characters.`);
      else setError("Couldn't save your password. Check your connection and try again.");
      setBusy(false);
    }
  }

  const gone = expired || (check.isError && check.error instanceof ApiError && check.error.status === 404);
  let body;
  if (gone) {
    body = (
      <>
        <p role="alert" className="field-error">{EXPIRED}</p>
        <Button className="auth__submit" onClick={() => navigate('/', { replace: true })}>Go to sign in</Button>
      </>
    );
  } else if (check.isError) {
    body = (
      <>
        <p className="auth__sub">Couldn't check your link. Check your connection and try again.</p>
        <Button variant="primary" className="auth__submit" onClick={() => void check.refetch()}>Try again</Button>
      </>
    );
  } else if (!check.data) {
    body = <div aria-busy="true" aria-label="Loading"><Skeleton height={50} /></div>;
  } else {
    body = (
      <form className="auth__form" onSubmit={(e) => void submit(e)} noValidate>
        <h1 className="auth__title">Set a new password</h1>
        <p className="auth__sub">For @{check.data.username}</p>
        <input className="auth__vh" type="text" value={check.data.username} readOnly tabIndex={-1} aria-hidden="true" autoComplete="username" />
        <PasswordField label="New password" value={password} onChange={(v) => { setPassword(v); setError(null); }}
          autoComplete="new-password" hint={PASSWORD_RULES} invalid={!!error} autoFocus />
        {error && <p role="alert" className="field-error">{error}</p>}
        <Button type="submit" variant="primary" className="auth__submit" disabled={busy}>{busy ? 'Saving…' : 'Save and sign in'}</Button>
      </form>
    );
  }
  return (
    <main className="auth">
      <div className="auth__card">
        <span className="brand-mark auth__brand">{appName}</span>
        {body}
      </div>
    </main>
  );
}
