import { lazy, Suspense } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { AboutScreen } from './screens/AboutScreen';
import { ListScreen } from './screens/ListScreen';
import { MoreScreen } from './screens/MoreScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { UsernameSetup } from './screens/UsernameSetup';
import { Skeleton } from './design/components/Skeleton';
import { AppFrame } from './shell/AppFrame';
import { HomeRedirect } from './shell/HomeRedirect';
import { SessionGate, SETUP_PATH } from './shell/SessionGate';

// Entry details load on demand: the list screen is what most visits need.
const EntryDetail = lazy(() => import('./screens/EntryDetail').then((m) => ({ default: m.EntryDetail })));

// Import pulls in the spreadsheet reader, which the rest of the app never needs.
const ImportScreen = lazy(() => import('./screens/ImportScreen').then((m) => ({ default: m.ImportScreen })));

// Compare (and the shared engine it runs) only loads when opened.
const CompareScreen = lazy(() => import('./screens/CompareScreen').then((m) => ({ default: m.CompareScreen })));

function CompareRoute() {
  return (
    <Suspense fallback={
      <div className="screen" aria-busy="true" aria-label="Loading">
        <div className="screen__body"><Skeleton height={80} /></div>
      </div>
    }>
      <CompareScreen />
    </Suspense>
  );
}

function ImportRoute() {
  return (
    <Suspense fallback={
      <div className="screen" aria-busy="true" aria-label="Loading">
        <div className="screen__body"><Skeleton height={80} /></div>
      </div>
    }>
      <ImportScreen />
    </Suspense>
  );
}

function EntryRoute() {
  return (
    <Suspense fallback={
      <div className="screen" aria-busy="true" aria-label="Loading">
        <div className="screen__body"><Skeleton height={180} /></div>
      </div>
    }>
      <EntryDetail />
    </Suspense>
  );
}

/**
 * `/` → first enabled list. Everything sits under SessionGate, which sends a user with no
 * username to /setup/username first. Setup has no nav; every other screen is in the AppFrame.
 */
export const routes: RouteObject[] = [
  {
    element: <SessionGate />,
    children: [
      { path: SETUP_PATH, element: <UsernameSetup /> },
      {
        element: <AppFrame />,
        children: [
          { index: true, element: <HomeRedirect /> },
          { path: 'list/:category', element: <ListScreen /> },
          { path: 'entry/:id', element: <EntryRoute /> },
          { path: 'import', element: <ImportRoute /> },
          { path: 'compare', element: <CompareRoute /> },
          { path: 'settings', element: <SettingsScreen /> },
          { path: 'about', element: <AboutScreen /> },
          { path: 'more', element: <MoreScreen /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
];
