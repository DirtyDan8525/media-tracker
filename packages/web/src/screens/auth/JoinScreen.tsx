import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { checkJoinLink, JOIN_INVALID_TEXT, JOIN_INVITED_TEXT } from '../../data/auth';
import { Skeleton } from '../../design/components/Skeleton';
import { SignInScreen } from './SignInScreen';
import '../../design/auth.css';

/**
 * /join/:token, works signed out: the Create account tab with a banner saying the link is good (or
 * not). The token rides along with the sign-up; the server decides. A link that cannot be checked
 * still lets the person sign up, with no banner. Once signed in, the app opens at `/`.
 */
export function JoinScreen() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const check = useQuery({
    queryKey: ['join-link', token],
    queryFn: () => checkJoinLink(token),
    retry: false, staleTime: Infinity, gcTime: 0,
  });
  if (check.isPending) {
    return (
      <main className="auth">
        <div className="auth__card" aria-busy="true" aria-label="Loading"><Skeleton height={50} /></div>
      </main>
    );
  }
  const valid = check.data?.valid;
  const banner = valid === undefined ? undefined : (
    <p className={valid ? 'auth__banner' : 'auth__banner auth__banner--warn'} role="status">{valid ? JOIN_INVITED_TEXT : JOIN_INVALID_TEXT}</p>
  );
  return <SignInScreen joinToken={valid === false ? undefined : token} banner={banner} onSignedIn={() => navigate('/', { replace: true })} />;
}
