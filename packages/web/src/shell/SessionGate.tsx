import { useEffect, useLayoutEffect, useMemo } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuthState } from '../api/auth';
import { AFTER_SETUP_KEY } from '../data/social';
import { useAppSettings } from '../data/appSettings';
import { useMe } from '../data/useMe';
import { SignInScreen } from '../screens/auth/SignInScreen';
import { RemovedScreen, WaitingScreen } from '../screens/auth/WaitingScreen';
import { CfSetContext, ThemeColorsContext } from '../design/ThemeContext';
import { useDeviceTheme, withDeviceLook } from '../design/deviceLook';
import { cfFor, applyTheme, themeColors } from '../design/theme';
import { RateOnCompleteHost } from '../screens/entry/RateOnCompleteHost';
import { Button } from '../design/components/Button';
import { Skeleton } from '../design/components/Skeleton';
import { homePath } from '../nav';
import type { Me } from '../api/types';

export const SETUP_PATH = '/setup/username';

/** Where setup sends the user next: the in-app path they were opening (a /add/<code> link), else null. */
export function afterSetupPath(): string | null {
  const p = sessionStorage.getItem(AFTER_SETUP_KEY);
  return p && p.startsWith('/') && !p.startsWith('//') ? p : null;
}

/** Remembers the attempted path, then goes to username setup. */
function ToSetup({ from }: { from: string }) {
  useLayoutEffect(() => {
    if (from !== '/') sessionStorage.setItem(AFTER_SETUP_KEY, from);
  }, [from]);
  return <Navigate to={SETUP_PATH} replace />;
}

/** The signed-in user, for screens under the gate (which only renders them once it has one). */
export function useSessionMe(): Me {
  const { data } = useMe();
  const dev = useDeviceTheme();
  // Theme and colours are per device: this device's choice wins over the account's value.
  const me = useMemo(() => (data && dev ? { ...data, settings: withDeviceLook(data.settings, dev) } : data), [data, dev]);
  if (!me) throw new Error('useSessionMe outside SessionGate');
  return me;
}

/**
 * Loads `me` (cache first), applies the theme, and sends a user without a username to setup.
 */
export function SessionGate() {
  const { data: me, isError, refetch, isFetching } = useMe();
  const { pathname, search } = useLocation();
  const auth = useAuthState();
  const dev = useDeviceTheme();
  const settings = useMemo(() => (me ? withDeviceLook(me.settings, dev) : undefined), [me, dev]);
  const accent = useAppSettings().brand.accent;

  useEffect(() => {
    if (settings) applyTheme(settings, document.documentElement, accent);
  }, [settings, accent]);

  // Setup is done and the user is somewhere else: the remembered path has been used.
  useEffect(() => {
    if (me?.username && pathname !== SETUP_PATH) sessionStorage.removeItem(AFTER_SETUP_KEY);
  }, [me?.username, pathname]);

  const signedOut = auth !== 'ok';
  // Signed out at some path (say /add/<code>): remember it, so the app opens there after sign-in.
  useEffect(() => {
    if (signedOut && pathname + search !== '/') sessionStorage.setItem(AFTER_SETUP_KEY, pathname + search);
  }, [signedOut, pathname, search]);

  if (auth === 'removed') return <RemovedScreen />;
  if (auth === 'signedOut') return <SignInScreen />;
  if (!me) {
    if (isError) {
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
  if (me.status === 'pending') return <WaitingScreen username={me.username} />;
  if (me.username === null && pathname !== SETUP_PATH) return <ToSetup from={pathname + search} />;
  if (me.username !== null && pathname === SETUP_PATH) return <Navigate to={afterSetupPath() ?? homePath(me.settings)} replace />;

  return (
    <ThemeColorsContext.Provider value={themeColors(settings!)}>
      <CfSetContext.Provider value={cfFor(settings!)}>
        <Outlet />
        <RateOnCompleteHost />
      </CfSetContext.Provider>
    </ThemeColorsContext.Provider>
  );
}
