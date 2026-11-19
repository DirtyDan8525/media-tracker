import { Outlet } from 'react-router';
import { BackfillProvider } from '../backfill/useBackfill';
import { useAppSettings } from '../data/appSettings';
import { useUnread } from '../data/feed';
import { useListCounts } from '../data/useEntries';
import { BottomTabs } from '../design/components/BottomTabs';
import { SideNav } from '../design/components/SideNav';
import { useIsWide } from '../hooks';
import { useSaveSettings } from '../data/useMe';
import { useEnabledLists } from './useLists';
import { useCurrentList } from './currentList';
import { CoverViewerContext } from '../screens/list/tableKit';
import { OnboardingHost } from '../screens/onboarding/OnboardingHost';
import { AddFriendProvider } from './AddFriendHost';
import { AddBubble } from './AddBubble';
import { useSessionMe } from './SessionGate';
import '../design/nav.css';

/**
 * Nav + content. Phone (< 768 px): content above the bottom bar, with the floating Add bubble.
 * PC: side nav beside the content.
 */
export function AppFrame() {
  return (
    <BackfillProvider>
      <AddFriendProvider>
        <FrameLayout />
        <OnboardingHost />
      </AddFriendProvider>
    </BackfillProvider>
  );
}

function FrameLayout() {
  const me = useSessionMe();
  const wide = useIsWide();
  const counts = useListCounts().data ?? {};
  const lists = useEnabledLists();
  const { features } = useAppSettings();
  const unread = useUnread().data;
  const activityCount = unread?.feed ?? 0;
  const messagesCount = features.messages ? unread?.messages ?? 0 : 0;
  // Incoming friend requests. The Friends badge (phone tab and PC row) adds the unread messages.
  const requestsCount = features.friends ? unread?.requests ?? 0 : 0;
  const current = useCurrentList();
  const save = useSaveSettings();
  const { side, collapsed } = me.settings.nav;
  if (wide) {
    return (
      <div className={`frame frame--wide${side === 'right' ? ' frame--nav-right' : ''}`}>
        <SideNav lists={lists} counts={counts} activityCount={activityCount} messagesCount={messagesCount} friendsCount={requestsCount}
          showActivity={features.feed} showMessages={features.messages} showFriends={features.friends} showSharpen={features.closeCalls} me={me}
          collapsed={collapsed} onToggleCollapsed={() => save.mutate({ nav: { collapsed: !collapsed } })} />
        <main className="frame__main">
          <CoverViewerContext.Provider value={me.settings.coverViewer}>
            <Outlet />
          </CoverViewerContext.Provider>
        </main>
      </div>
    );
  }
  return (
    <div className="frame frame--phone">
      <main className="frame__main">
        <Outlet />
      </main>
      <AddBubble current={current} />
      <BottomTabs activityCount={activityCount} messagesCount={messagesCount} friendsCount={requestsCount} showActivity={features.feed} showMessages={features.messages} showFriends={features.friends} />
    </div>
  );
}
