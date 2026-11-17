import type { FeatureKey } from '@media-tracker/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { AboutScreen } from './screens/AboutScreen';
import { WhatsNewScreen } from './screens/WhatsNewScreen';
import { AddByCodeScreen } from './screens/social/AddByCodeScreen';
import { FriendEntryDetail } from './screens/social/FriendEntryDetail';
import { FriendProfile } from './screens/social/FriendProfile';
import { FriendsScreen } from './screens/social/FriendsScreen';
import { ChatScreen } from './screens/messages/ChatScreen';
import { MessagesScreen } from './screens/messages/MessagesScreen';
import { NewChatScreen } from './screens/messages/NewChatScreen';
import { RecommendedScreen } from './screens/messages/RecommendedScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { AdminScreen } from './screens/AdminScreen';
import { AnnouncementScreen } from './screens/admin/Announcement';
import { BackupScreen } from './screens/admin/Backup';
import { ContentScreen } from './screens/admin/Content';
import { ListsScreen } from './screens/admin/Lists';
import { LookupToolsScreen } from './screens/admin/LookupTools';
import { DefaultsScreen, LookScreen } from './screens/admin/Look';
import { ModerationScreen } from './screens/admin/Moderation';
import { NumbersScreen } from './screens/admin/Numbers';
import { SwitchesScreen } from './screens/admin/Switches';
import { ListScreen } from './screens/ListScreen';
import { MoreScreen } from './screens/MoreScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AppearanceScreen } from './screens/AppearanceScreen';
import { StatsScreen } from './screens/StatsScreen';
import { Top5Screen } from './screens/Top5Screen';
import { JoinScreen } from './screens/auth/JoinScreen';
import { ResetScreen } from './screens/auth/ResetScreen';
import { UsernameSetup } from './screens/UsernameSetup';
import { useFeature } from './data/appSettings';
import { Skeleton } from './design/components/Skeleton';
import { AppFrame } from './shell/AppFrame';
import { HomeRedirect } from './shell/HomeRedirect';
import { SessionGate, SETUP_PATH, useSessionMe } from './shell/SessionGate';

// Entry details load on demand: the list screen is what most visits need.
const EntryDetail = lazy(() => import('./screens/EntryDetail').then((m) => ({ default: m.EntryDetail })));

// Import pulls in the spreadsheet reader, which the rest of the app never needs.
const ImportScreen = lazy(() => import('./screens/ImportScreen').then((m) => ({ default: m.ImportScreen })));

// Sharpen my ratings (and its close-call cards) only loads when opened.
const SharpenScreen = lazy(() => import('./screens/sharpen/SharpenScreen').then((m) => ({ default: m.SharpenScreen })));

function SharpenRoute() {
  // Close-call questions switched off (AD2): nothing to sharpen here.
  if (!useFeature('closeCalls')) return <Navigate to="/more" replace />;
  return (
    <Suspense fallback={
      <div className="screen" aria-busy="true" aria-label="Loading">
        <div className="screen__body"><Skeleton height={80} /></div>
      </div>
    }>
      <SharpenScreen />
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

/** A screen of a feature the admin switched off (AD2) sends people home instead. */
function FeatureRoute({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  return useFeature(feature) ? <>{children}</> : <Navigate to="/" replace />;
}

/** Admin is for the admin only (the Worker enforces it too): anyone else lands on `/`. */
function AdminRoute({ children }: { children: ReactNode }) {
  return useSessionMe().isAdmin ? <>{children}</> : <Navigate to="/" replace />;
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
          { path: 'activity', element: <FeatureRoute feature="feed"><ActivityScreen /></FeatureRoute> },
          { path: 'search', element: <SearchScreen /> },
          { path: 'messages', element: <FeatureRoute feature="messages"><MessagesScreen /></FeatureRoute> },
          { path: 'messages/new', element: <FeatureRoute feature="messages"><NewChatScreen /></FeatureRoute> },
          { path: 'messages/recommended', element: <FeatureRoute feature="messages"><RecommendedScreen /></FeatureRoute> },
          { path: 'messages/:id', element: <FeatureRoute feature="messages"><ChatScreen /></FeatureRoute> },
          { path: 'profile', element: <ProfileScreen /> },
          { path: 'friends', element: <FeatureRoute feature="friends"><FriendsScreen /></FeatureRoute> },
          { path: 'add/:code', element: <FeatureRoute feature="friends"><AddByCodeScreen /></FeatureRoute> },
          { path: 'u/:username', element: <FriendProfile /> },
          { path: 'u/:username/entry/:id', element: <FriendEntryDetail /> },
          { path: 'sharpen', element: <SharpenRoute /> },
          // Compare and Re-tier review left with tiers (Ruling N9): old links land on Sharpen.
          { path: 'compare', element: <Navigate to="/sharpen" replace /> },
          { path: 'retier/:set', element: <Navigate to="/sharpen" replace /> },
          { path: 'top5', element: <Top5Screen /> },
          { path: 'stats', element: <StatsScreen /> },
          { path: 'settings', element: <SettingsScreen /> },
          { path: 'settings/appearance', element: <AppearanceScreen /> },
          { path: 'settings/tiers', element: <Navigate to="/settings" replace /> },
          { path: 'about', element: <AboutScreen /> },
          { path: 'whats-new', element: <WhatsNewScreen /> },
          { path: 'more', element: <MoreScreen /> },
          { path: 'admin', element: <AdminRoute><AdminScreen /></AdminRoute> },
          { path: 'admin/numbers', element: <AdminRoute><NumbersScreen /></AdminRoute> },
          { path: 'admin/announcement', element: <AdminRoute><AnnouncementScreen /></AdminRoute> },
          { path: 'admin/switches', element: <AdminRoute><SwitchesScreen /></AdminRoute> },
          { path: 'admin/lists', element: <AdminRoute><ListsScreen /></AdminRoute> },
          { path: 'admin/look', element: <AdminRoute><LookScreen /></AdminRoute> },
          { path: 'admin/defaults', element: <AdminRoute><DefaultsScreen /></AdminRoute> },
          { path: 'admin/content', element: <AdminRoute><ContentScreen /></AdminRoute> },
          { path: 'admin/moderation', element: <AdminRoute><ModerationScreen /></AdminRoute> },
          { path: 'admin/lookup', element: <AdminRoute><LookupToolsScreen /></AdminRoute> },
          { path: 'admin/backup', element: <AdminRoute><BackupScreen /></AdminRoute> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
];
