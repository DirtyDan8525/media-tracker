import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuthState } from '../api/auth';
import { useMe } from '../data/useMe';
import { SignedOutScreen } from '../screens/SignedOutScreen';
import { CfSetContext, ThemeColorsContext } from '../design/ThemeContext';
import { cfFor, applyTheme, themeColors } from '../design/theme';
import { Button } from '../design/components/Button';
import { Skeleton } from '../design/components/Skeleton';
import { homePath } from '../nav';
import type { Me } from '../api/types';

export const SETUP_PATH = '/setup/username';

/** The signed-in user, for screens under the gate (which only renders them once it has one). */
export function useSessionMe(): Me {
  const { data } = useMe();
  if (!data) throw new Error('useSessionMe outside SessionGate');
  return data;
}

/**
 * Loads `me` (cache first), applies the theme, and sends a user without a username to setup.
 */
export function SessionGate() {
  const { data: me, isError, refetch, isFetching } = useMe();
  const { pathname } = useLocation();
  const auth = useAuthState();
  const settings = me?.settings;

  useEffect(() => {
    if (settings) applyTheme(settings);
  }, [settings]);

  if (auth === 'signedOut') return <SignedOutScreen />;
  if (!me || auth === 'reauthing') {
    if (isError && auth === 'ok') {
      return (
        <div className="splash">
          <h1 className="splash__title">Couldn't reach Media Tracker</h1>
          <p className="muted">Check your connection and try again.</p>
          <Button variant="primary" onClick={() => void refetch()} disabled={isFetching}>Try again</Button>
        </div>
      );
    }
    return (
      <div className="splash" aria-busy="true" aria-label="Loading">
        <Skeleton width={180} height={26} />
        <Skeleton width={120} height={14} />
      </div>
    );
  }
  if (me.username === null && pathname !== SETUP_PATH) return <Navigate to={SETUP_PATH} replace />;
  if (me.username !== null && pathname === SETUP_PATH) return <Navigate to={homePath(me.settings)} replace />;

  return (
    <ThemeColorsContext.Provider value={themeColors(me.settings)}>
      <CfSetContext.Provider value={cfFor(me.settings)}>
        <Outlet />
      </CfSetContext.Provider>
    </ThemeColorsContext.Provider>
  );
}
