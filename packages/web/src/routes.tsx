import { lazy, Suspense } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { AboutScreen } from './screens/AboutScreen';
import { WhatsNewScreen } from './screens/WhatsNewScreen';
import { AddByCodeScreen } from './screens/social/AddByCodeScreen';
import { FriendEntryDetail } from './screens/social/FriendEntryDetail';
import { FriendProfile } from './screens/social/FriendProfile';
import { FriendsScreen } from './screens/social/FriendsScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { AdminScreen } from './screens/AdminScreen';
import { ListScreen } from './screens/ListScreen';
import { MoreScreen } from './screens/MoreScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AppearanceScreen } from './screens/AppearanceScreen';
import { TierEditor } from './screens/settings/TierEditor';
import { StatsScreen } from './screens/StatsScreen';
import { Top5Screen } from './screens/Top5Screen';
import { JoinScreen } from './screens/auth/JoinScreen';
import { ResetScreen } from './screens/auth/ResetScreen';
import { UsernameSetup } from './screens/UsernameSetup';
import { Skeleton } from './design/components/Skeleton';
import { AppFrame } from './shell/AppFrame';
import { HomeRedirect } from './shell/HomeRedirect';
import { SessionGate, SETUP_PATH, useSessionMe } from './shell/SessionGate';

// Entry details load on demand: the list screen is what most visits need.
const EntryDetail = lazy(() => import('./screens/EntryDetail').then((m) => ({ default: m.EntryDetail })));

// Import pulls in the spreadsheet reader, which the rest of the app never needs.
const ImportScreen = lazy(() => import('./screens/ImportScreen').then((m) => ({ default: m.ImportScreen })));

// Compare (and the shared engine it runs) only loads when opened.
const CompareScreen = lazy(() => import('./screens/CompareScreen').then((m) => ({ default: m.CompareScreen })));

// Re-tier review loads on demand too.
const RetierScreen = lazy(() => import('./screens/RetierScreen').then((m) => ({ default: m.RetierScreen })));

function RetierRoute() {
  return (
    <Suspense fallback={
      <div className="screen" aria-busy="true" aria-label="Loading">
        <div className="screen__body"><Skeleton height={80} /></div>
      </div>
    }>
      <RetierScreen />
    </Suspense>
  );
}

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

/** Admin is for the admin only (the Worker enforces it too): anyone else lands on `/`. */
function AdminRoute() {
  return useSessionMe().isAdmin ? <AdminScreen /> : <Navigate to="/" replace />;
}

/**
 * `/` → first enabled list. Everything else sits under SessionGate, which shows sign-in to anyone without a session, Waiting to a pending account, and sends a user with no
 * username to /setup/username first. Setup has no nav; every other screen is in the AppFrame.
 */
export const routes: RouteObject[] = [
  // The reset link works signed out, so it sits outside the gate.
  { path: 'reset/:token', element: <ResetScreen /> },
  // So does a sign-up link from Dan.
  { path: 'join/:token', element: <JoinScreen /> },
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
          { path: 'activity', element: <ActivityScreen /> },
          { path: 'search', element: <SearchScreen /> },
          { path: 'profile', element: <ProfileScreen /> },
          { path: 'friends', element: <FriendsScreen /> },
          { path: 'add/:code', element: <AddByCodeScreen /> },
          { path: 'u/:username', element: <FriendProfile /> },
          { path: 'u/:username/entry/:id', element: <FriendEntryDetail /> },
          { path: 'compare', element: <CompareRoute /> },
          { path: 'retier/:set', element: <RetierRoute /> },
          { path: 'top5', element: <Top5Screen /> },
          { path: 'stats', element: <StatsScreen /> },
          { path: 'settings', element: <SettingsScreen /> },
          { path: 'settings/appearance', element: <AppearanceScreen /> },
          { path: 'settings/tiers', element: <TierEditor /> },
          { path: 'about', element: <AboutScreen /> },
          { path: 'whats-new', element: <WhatsNewScreen /> },
          { path: 'more', element: <MoreScreen /> },
          { path: 'admin', element: <AdminRoute /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
];
