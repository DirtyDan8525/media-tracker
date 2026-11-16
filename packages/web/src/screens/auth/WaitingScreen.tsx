import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { JOIN_INVALID_KEY, JOIN_INVALID_TEXT } from '../../data/auth';
import { logOut } from '../../data/logout';
import { useMe } from '../../data/useMe';
import { Button } from '../../design/components/Button';
import '../../design/auth.css';

/** How often the waiting screen asks whether Dan has approved yet. */
export const WAITING_POLL_MS = 30_000;

/** A pending account: nothing to do but wait. Polls /api/me while the page is visible; the gate opens the app when status turns active. */
export function WaitingScreen({ username }: { username: string | null }) {
  const qc = useQueryClient();
  const { refetch } = useMe();
  const joinInvalid = sessionStorage.getItem(JOIN_INVALID_KEY) === '1';

  useEffect(() => {
    const poll = () => { if (document.visibilityState !== 'hidden') void refetch(); };
    const id = setInterval(poll, WAITING_POLL_MS);
    document.addEventListener('visibilitychange', poll); // coming back to the app checks at once
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', poll); };
  }, [refetch]);

  return (
    <main className="auth auth-wait">
      <div className="auth__card">
        <div className="auth-wait__ring" aria-hidden="true"><span><i /></span></div>
        <h1 className="auth__title">{username ? `Thanks, @${username}!` : 'Thanks!'}</h1>
        <p className="auth-wait__text" role="status">Dan needs to approve your account. This page updates by itself.</p>
        {joinInvalid && <p className="auth-wait__text">{JOIN_INVALID_TEXT}</p>}
        <Button onClick={() => { sessionStorage.removeItem(JOIN_INVALID_KEY); void logOut(qc); }}>Log out</Button>
      </div>
    </main>
  );
}

/** The session was removed by the admin (401 removed). */
export function RemovedScreen() {
  const qc = useQueryClient();
  return (
    <main className="auth auth-wait">
      <div className="auth__card">
        <h1 className="auth__title">Your access was removed.</h1>
        <p className="auth-wait__text">Ask Dan if this is a mistake.</p>
        <Button onClick={() => void logOut(qc)}>Log out</Button>
      </div>
    </main>
  );
}
