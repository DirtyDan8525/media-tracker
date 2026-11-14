import { retrySignIn } from '../api/auth';
import { Button } from '../design/components/Button';

/** Shown when a re-auth hop came back still signed out (the loop guard tripped). */
export function SignedOutScreen() {
  return (
    <div className="splash">
      <h1 className="splash__title">Can't sign you in</h1>
      <p className="muted splash__text">
        Your sign-in has expired and we couldn't renew it automatically. Sign in again to get back to your lists.
      </p>
      <Button variant="primary" onClick={retrySignIn}>Sign in again</Button>
    </div>
  );
}
